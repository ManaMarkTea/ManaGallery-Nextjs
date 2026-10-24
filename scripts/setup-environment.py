#!/usr/bin/env python3
"""Recreate one RenderGallery environment on Ubuntu 24.04. Preview by default."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = Path('/srv/rendergallery')
DATA = Path('/srv/rendergallery-data')
NODE = Path('/opt/rendergallery-node')


def log(text): print(f'[{datetime.now(timezone.utc):%H:%M:%S}] {text}', flush=True)


def configuration(path):
    value = json.loads(Path(path).read_text(encoding='utf-8'))
    expected = {'siteHost','adminUser','repository','nodeVersion','nodeSha256','restoreSnapshot','allowEmpty','manageFirewall','localBackups','cloudBackups'}
    if not isinstance(value,dict) or set(value) != expected: raise ValueError('Use the exact fields in deploy/environment.example.json')
    patterns = {'siteHost': r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', 'adminUser':r'[a-z_][a-z0-9_-]{0,30}', 'repository':r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', 'nodeVersion':r'24\.\d+\.\d+', 'nodeSha256':r'[a-f0-9]{64}'}
    for field,pattern in patterns.items():
        if not isinstance(value[field],str) or not re.fullmatch(pattern,value[field]): raise ValueError(f'Invalid {field}')
    if value['adminUser'] == 'root': raise ValueError('Use a separate SSH administrator account')
    for field in ('allowEmpty','manageFirewall','localBackups','cloudBackups'):
        if type(value[field]) is not bool: raise ValueError(f'{field} must be a boolean')
    restore = value['restoreSnapshot']
    if restore is not None and (not isinstance(restore,str) or not PurePosixPath(restore).is_absolute()): raise ValueError('restoreSnapshot must be an absolute Linux directory or null')
    if value['cloudBackups'] and not value['localBackups']: raise ValueError('Cloud copying requires local backups')
    return value


def plan(config):
    return [
        'Require Ubuntu 24.04 x86_64, an existing key-based SSH administrator, and private GitHub read access.',
        f'Install OS dependencies, official Caddy packages and checksum-pinned Node {config["nodeVersion"]}.',
        f'Build {config["repository"]} as {config["adminUser"]}, never as root; preserve any existing live app/data.',
        f'Configure the service and HTTPS for {config["siteHost"]}; preserve other Caddy sites and existing environment values.',
        'Install the scoped passwordless deployment helper.',
        'Allow detected SSH ports, HTTP and HTTPS through UFW.' if config['manageFirewall'] else 'Leave the firewall unchanged.',
        'Install/test local encrypted backups.' if config['localBackups'] else 'Leave backup configuration unchanged.',
        'Connect/test B2 using private interactive credentials, or reuse existing credentials.' if config['cloudBackups'] else 'Leave cloud credentials and timers unchanged.',
        'Check service health. DNS, OS installation, cloud account creation and secret recovery remain external prerequisites.',
    ]


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args],check=True,**kwargs)


def write_changed(path, content, mode=0o644):
    path = Path(path)
    if path.is_symlink(): raise ValueError(f'Refusing symlinked configuration: {path}')
    if path.exists() and path.read_text() == content: return False
    new_parent = not path.parent.exists()
    path.parent.mkdir(parents=True,exist_ok=True)
    if new_parent: path.parent.chmod(0o755)
    if path.exists():
        backup = path.with_name(path.name + '.before-setup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
        shutil.copy2(path,backup)
    path.write_text(content)
    path.chmod(mode)
    return True


def download(url, target):
    with urllib.request.urlopen(url,timeout=120) as source, Path(target).open('wb') as output:
        shutil.copyfileobj(source,output,1024*1024)


def install_node(config):
    if (NODE / 'bin/node').exists():
        version = subprocess.check_output([str(NODE / 'bin/node'),'--version'],text=True).strip()
        if version != 'v'+config['nodeVersion']: raise RuntimeError('Existing Node differs from configured version; explicitly upgrade it before rerunning. Live binaries were preserved.')
    else:
        destination = Path('/opt') / ('rendergallery-node-' + config['nodeVersion'])
        if destination.exists(): raise RuntimeError('Node installation directory already exists; inspect it before retrying')
        log('Downloading and verifying the pinned official Node runtime…')
        with tempfile.TemporaryDirectory(prefix='rendergallery-node-') as temporary:
            archive = Path(temporary) / 'node.tar.xz'
            download(f'https://nodejs.org/dist/v{config["nodeVersion"]}/node-v{config["nodeVersion"]}-linux-x64.tar.xz',archive)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != config['nodeSha256']: raise RuntimeError('Node checksum mismatch; refusing installation')
            with tarfile.open(archive) as bundle: bundle.extractall(Path(temporary) / 'extract',filter='data')
            extracted = Path(temporary) / 'extract' / f'node-v{config["nodeVersion"]}-linux-x64'
            shutil.copytree(extracted,destination,symlinks=True)
        NODE.symlink_to(destination)
    for command in ('node','npm','npx'):
        link = Path('/usr/local/bin') / command
        if link.is_symlink() and link.readlink() == NODE / 'bin' / command: continue
        if link.exists() or link.is_symlink(): raise RuntimeError(f'Existing {link} is not managed by this setup; it was not overwritten')
        link.symlink_to(NODE / 'bin' / command)


def copy_data(source, destination, sanitize=False):
    if source.resolve() == destination.resolve() or source.is_symlink() or any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('Data source must be a separate directory containing no symlinks')
    if not (source / 'gallery.sqlite').is_file(): raise ValueError('Missing source database')
    destination.mkdir(parents=True,exist_ok=True,mode=0o700)
    for child in source.iterdir():
        if child.name.startswith('gallery.sqlite'): continue
        if child.is_symlink(): raise ValueError('Symlinked restored data is not supported')
        if child.is_dir(): shutil.copytree(child,destination / child.name,dirs_exist_ok=True)
        elif child.is_file(): shutil.copy2(child,destination / child.name)
    with closing(sqlite3.connect(source / 'gallery.sqlite')) as original, closing(sqlite3.connect(destination / 'gallery.sqlite')) as target:
        original.backup(target)
        target.execute('PRAGMA journal_mode=DELETE')
        # Old active sessions should not carry over onto a recovered machine.
        for table in ('sessions','challenges','attempts'):
            if target.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone(): target.execute(f'DELETE FROM {table}')
        if sanitize:
            target.execute('CREATE TABLE IF NOT EXISTS site_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            for key in ('registrationOpen','adsenseEnabled'):
                target.execute("INSERT INTO site_settings(key,value) VALUES(?,'false') ON CONFLICT(key) DO UPDATE SET value='false'",(key,))
        target.commit()


def configure_proxy(host, main=None, fragment=None):
    main = main or Path('/etc/caddy/Caddyfile')
    fragment = fragment or Path('/etc/caddy/sites-enabled/rendergallery.caddy')
    if main.is_symlink() or fragment.is_symlink(): raise ValueError('Refusing symlinked proxy configuration')
    old = main.read_text() if main.exists() else ''
    originals = {p:(p.read_text(),p.stat().st_mode & 0o777) if p.exists() else None for p in (main,fragment)}
    try:
        if re.search(r'(?m)^\s*'+re.escape(host)+r'\s*\{',old):
            log('Preserving the existing inline Caddy site configuration.')
        else:
            write_changed(fragment,f'{host} {{\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:3000 {{\n        header_up X-Forwarded-For {{remote_host}}\n    }}\n}}\n')
            include = 'import /etc/caddy/sites-enabled/*.caddy'
            if include not in old: write_changed(main,old.rstrip()+'\n\n'+include+'\n')
        run('caddy','validate','--config',main,'--adapter','caddyfile')
    except Exception:
        for path,original in originals.items():
            if original is None: path.unlink(missing_ok=True)
            else:
                path.write_text(original[0]); path.chmod(original[1])
        raise


def apply(config):
    if os.geteuid() != 0: raise RuntimeError('Run --apply with sudo; preview does not require sudo')
    import pwd
    release = dict(line.split('=',1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID','').strip('"') != 'ubuntu' or release.get('VERSION_ID','').strip('"') != '24.04' or os.uname().machine != 'x86_64': raise RuntimeError('This installer supports Ubuntu 24.04 x86_64 only')
    admin = pwd.getpwnam(config['adminUser'])
    if admin.pw_uid == 0: raise RuntimeError('The deployment account cannot be root')
    home = Path(admin.pw_dir)
    seed = home / 'rendergallery-stage'
    restore = Path(config['restoreSnapshot']) if config['restoreSnapshot'] else None
    initial = not (BASE / 'app/.next/BUILD_ID').exists()
    if initial:
        try:
            connection = socket.create_connection(('127.0.0.1',3000),timeout=1)
        except OSError: pass
        else:
            connection.close()
            raise RuntimeError('Port 3000 is already in use; first installation will not replace another application')
    if BASE.is_symlink() or DATA.is_symlink(): raise RuntimeError('Refusing symlinked application/data roots')
    if DATA.exists() and not (DATA / 'gallery.sqlite').exists() and any(DATA.iterdir()): raise RuntimeError('Unrecognized nonempty data directory; nothing was overwritten')
    if not (home / '.ssh/rendergallery-github').is_file() or not (home / '.ssh/known_hosts').is_file(): raise RuntimeError('Provide the SSH user’s private GitHub read key and pinned known_hosts first; see docs/environment.md')
    if not (seed / 'data/gallery.sqlite').is_file() and not restore and not config['allowEmpty']: raise RuntimeError('No restored seed data. Set restoreSnapshot or explicitly allowEmpty for a new empty site.')
    env_file = Path('/etc/rendergallery.env')
    if env_file.exists():
        values = dict(line.split('=',1) for line in env_file.read_text().splitlines() if '=' in line and not line.startswith('#'))
        if values.get('APP_ORIGIN') != 'https://'+config['siteHost']: raise RuntimeError('Existing APP_ORIGIN differs; refusing to silently change the live domain')
    if restore:
        run(sys.executable,ROOT / 'scripts/backup-snapshot.py','verify','--output',restore)
    log('Installing base packages and the official Caddy repository…')
    package_env = {**os.environ,'DEBIAN_FRONTEND':'noninteractive'}
    run('apt-get','update',env=package_env)
    run('apt-get','install','-y','ca-certificates','curl','gnupg','debian-keyring','debian-archive-keyring','apt-transport-https','git','python3','sudo','ufw','restic',env=package_env)
    with tempfile.TemporaryDirectory() as temporary:
        key = Path(temporary) / 'caddy.key'
        download('https://dl.cloudsmith.io/public/caddy/stable/gpg.key',key)
        run('gpg','--batch','--yes','--dearmor','-o','/usr/share/keyrings/caddy-stable-archive-keyring.gpg',key)
        with urllib.request.urlopen('https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt',timeout=30) as response:
            write_changed('/etc/apt/sources.list.d/caddy-stable.list',response.read().decode())
        Path('/usr/share/keyrings/caddy-stable-archive-keyring.gpg').chmod(0o644)
    run('apt-get','update',env=package_env)
    run('apt-get','install','-y','caddy',env=package_env)
    install_node(config)
    try: pwd.getpwnam('rendergallery')
    except KeyError: run('useradd','--system','--user-group','--home-dir','/var/lib/rendergallery','--create-home','--shell','/usr/sbin/nologin','rendergallery')
    if initial:
        log('Preparing private seed data; existing seed files are preserved…')
        if not (seed / 'data/gallery.sqlite').exists():
            if restore:
                copy_data(restore / 'data',seed / 'data',sanitize=True)
                if (restore / 'public').exists(): shutil.copytree(restore / 'public',seed / 'app/public',dirs_exist_ok=True)
            else:
                (seed / 'data').mkdir(parents=True,mode=0o700)
                with closing(sqlite3.connect(seed / 'data/gallery.sqlite')) as db, db:
                    db.execute('CREATE TABLE site_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
                    db.executemany("INSERT INTO site_settings VALUES(?,'false')",[('registrationOpen',),('adsenseEnabled',)])
            run('chown','-R',f'{admin.pw_name}:{admin.pw_gid}',seed)
            run('chmod','-R','go-rwx',seed)
        log('Pulling and building as the SSH administrator using isolated data…')
        run('runuser','-u',admin.pw_name,'--','env',f'HOME={home}','bash',ROOT / 'scripts/pull-vps.sh',config['repository'],config['siteHost'],'--prepare-only')
        if not (DATA / 'gallery.sqlite').exists():
            copy_data(restore / 'data' if restore else home / 'rendergallery-git-stage/data',DATA)
            run('chown','-R','rendergallery:rendergallery',DATA)
            run('chmod','-R','go-rwx',DATA)
        BASE.mkdir(parents=True,exist_ok=True)
        BASE.chmod(0o755)
        (BASE / 'app').mkdir(parents=True,exist_ok=True)
        (BASE / 'app/.next/cache').mkdir(parents=True,exist_ok=True)
    else: log('Existing live app and data found; leaving application code/data in place.')
    if not env_file.exists():
        write_changed(env_file,f'NODE_ENV=production\nAPP_ORIGIN=https://{config["siteHost"]}\nRENDERGALLERY_DATA_DIR=/srv/rendergallery-data\nTRUST_PROXY_HEADERS=true\nADSENSE_ENABLED=false\n',0o600)
    changed = write_changed('/etc/systemd/system/rendergallery.service',(ROOT / 'deploy/rendergallery.service').read_text())
    configure_proxy(config['siteHost'])
    log('Installing scoped passwordless promotion and checking services…')
    run('bash',ROOT / 'scripts/setup-passwordless-deploy.sh',admin.pw_name)
    run('systemctl','daemon-reload')
    run('systemctl','enable','rendergallery','caddy')
    if initial: run('/usr/local/sbin/rendergallery-promote')
    elif changed: run('systemctl','restart','rendergallery')
    else: run('systemctl','start','rendergallery')
    run('systemctl','reload-or-restart','caddy')
    if config['manageFirewall']:
        ports = {int(line.split()[1]) for line in subprocess.check_output(['/usr/sbin/sshd','-T'],text=True).splitlines() if line.startswith('port ')}
        if not ports: raise RuntimeError('Could not determine SSH ports; firewall was not changed')
        for port in sorted(ports | {80,443}): run('ufw','allow',f'{port}/tcp')
        run('ufw','default','deny','incoming'); run('ufw','default','allow','outgoing'); run('ufw','--force','enable')
    # Save the desired configuration before the first backup so it is recoverable.
    write_changed('/etc/rendergallery-environment.json',json.dumps(config,indent=2)+'\n',0o600)
    if config['localBackups']:
        log('Installing backups and running an initial backup/restore check…')
        run('bash',ROOT / 'scripts/setup-backups.sh',admin.pw_name)
    if config['cloudBackups']:
        cloud_args = [] if Path('/etc/rendergallery-cloud.env').exists() else ['--init']
        run('bash',ROOT / 'scripts/setup-cloud-backups.sh',*cloud_args)
    if config['localBackups']:
        run('bash',ROOT / 'scripts/setup-backup-log-monitor.sh')
    run('systemctl','is-active','rendergallery','caddy')
    log('Waiting for the app HTTP health check…')
    for _ in range(45):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000/',timeout=3) as response:
                if response.status == 200: break
        except Exception: pass
        time.sleep(1)
    else: raise RuntimeError('App HTTP health check failed')
    log('Environment ready. Verify public DNS/HTTPS and retain independent backup credentials before relying on recovery.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config',type=Path)
    parser.add_argument('--apply',action='store_true',help='Make changes; otherwise print the plan only')
    args = parser.parse_args()
    try:
        config = configuration(args.config)
        for index,step in enumerate(plan(config),1): print(f'{index}. {step}',flush=True)
        if args.apply:
            os.umask(0o077)
            apply(config)
        else: print('Preview only. Nothing changed. Add --apply on the target VPS to install.')
    except Exception as error:
        raise SystemExit(f'Environment setup stopped: {error}')
