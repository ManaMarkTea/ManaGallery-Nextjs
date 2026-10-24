#!/usr/bin/python3 -I
"""Fixed-site promotion helper. Repository code only executes as the app UID."""
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import grp
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/srv/rendergallery')
DATA = Path('/srv/rendergallery-data')
BACKUPS = Path('/srv/rendergallery-backups')


def log(message):
    print(f'[{datetime.now(timezone.utc):%H:%M:%S}] {message}', flush=True)


def unpack(stream, destination, max_bytes):
    """Only regular files/directories; never extract archive links or permissions."""
    total, last = 0, time.monotonic()
    with tarfile.open(fileobj=stream, mode='r|') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            allowed = (name.parts and name.parts[0] == 'app') or name.as_posix() in ('data',) or name.as_posix().startswith('data/models/') or name.as_posix() == 'data/models'
            if name.is_absolute() or '..' in name.parts or not allowed or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe deployment archive member')
            target = destination.joinpath(*name.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                total += member.size
                if member.size < 0 or total > max_bytes:
                    raise ValueError('Deployment exceeds available staging space')
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                # Exclusive creation rejects duplicate names and never follows links.
                with target.open('xb') as output, archive.extractfile(member) as source:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                target.chmod(0o700 if member.mode & 0o111 else 0o600)
            if time.monotonic() - last >= 10:
                log(f'Copying verified staging files: {total // 1048576:,} MiB received…')
                last = time.monotonic()
    return total


def pack(stage, reuse_archive=False):
    # Runs as the SSH user: even malicious source links cannot read root secrets.
    stage = Path(stage).resolve(strict=True)
    if not (stage / 'app/.next/BUILD_ID').is_file(): raise ValueError('No completed build')
    paths = ['app'] + [p for p in ('data/models',) if (stage / p).exists()]
    # Flatten npm .bin links while still unprivileged; root extraction rejects links.
    excludes = ['--exclude=app/public/gallery','--exclude=app/public/full'] if reuse_archive else []
    os.execv('/usr/bin/tar', ['tar','--dereference','--hard-dereference',*excludes,'-C',str(stage),'-cf','-',*paths])


def reuse_images(current, incoming):
    """Link immutable, root-owned archive files; never link app-writable data."""
    for name in ('gallery', 'full'):
        source, target = current / 'public' / name, incoming / 'public' / name
        if target.exists(): raise ValueError('Unexpected archive in code-only deployment')
        for path in [source, *source.rglob('*')]:
            info = path.lstat()
            if path.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Archive must be root-owned and read-only to other users')
            if not (path.is_dir() or path.is_file()): raise ValueError('Unexpected archive file type')
        shutil.copytree(source, target, copy_function=os.link)
        # copytree preserves modes/times, but newly created directories inherit
        # root's group. Match the readable source group without changing linked files.
        for directory in [target, *(p for p in target.rglob('*') if p.is_dir())]:
            original = source / directory.relative_to(target)
            os.chown(directory, -1, original.stat().st_gid)


def prune_releases():
    # Only successful, timestamped releases; never follow links or touch data/backups.
    import re
    releases = sorted((p for p in BASE.iterdir() if re.fullmatch(r'app\.before-\d{8}T\d{12}Z', p.name)
                       and p.is_dir() and not p.is_symlink()), reverse=True)
    for path in releases[2:]:
        log(f'Removing obsolete code release {path.name}…')
        shutil.rmtree(path)


def migrate(work):
    # Deliberately unprivileged. No SQL or Python from Git ever executes as root.
    with closing(sqlite3.connect(DATA / 'gallery.sqlite', timeout=30)) as db, db:
        db.executescript((work / 'app/lib/member-schema.sql').read_text())



def permissions(work):
    group = grp.getgrnam('rendergallery').gr_gid
    for path in [work, *work.rglob('*')]:
        if path.is_symlink(): raise ValueError('Unexpected link in extracted deployment')
        os.chown(path,0,group,follow_symlinks=False)
        path.chmod(0o750 if path.is_dir() or path.stat().st_mode & 0o100 else 0o640)
    cache = work / 'app/.next/cache'
    cache.mkdir(exist_ok=True)
    uid = pwd.getpwnam('rendergallery').pw_uid
    for path in [cache, *cache.rglob('*')]: os.chown(path,uid,group,follow_symlinks=False)


def service(action):
    subprocess.run(['/usr/bin/systemctl',action,'rendergallery.service'],check=True)


def promote(config):
    free = shutil.disk_usage(BASE).free
    if free < 8 * 1024**3: raise RuntimeError('Need 8 GiB free. Inspect old releases before deploying.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    work = Path(tempfile.mkdtemp(prefix='.incoming-',dir=BASE))
    previous, failed = BASE / f'app.before-{stamp}', BASE / f'app.failed-{stamp}'
    stopped, switched, moved = False, False, False
    try:
        reuse = config.get('reuseArchive', False) and all((BASE / 'app/public' / name).is_dir() for name in ('gallery','full'))
        log('Copying build; reusing immutable image archive…' if reuse else 'Copying build and archive as the SSH user; the current site stays online…')
        process = subprocess.Popen(['/usr/sbin/runuser','-u',config['user'],'--','/usr/bin/python3','-I',__file__,'--pack-code' if reuse else '--pack',config['stage']],stdout=subprocess.PIPE)
        try:
            unpack(process.stdout, work, free - 4 * 1024**3)
            result = process.wait(timeout=30)
        except BaseException:
            if process.poll() is None: process.terminate()
            process.wait()
            raise
        finally:
            process.stdout.close()
        if result: raise RuntimeError('Could not copy the complete staging build')
        if not (work / 'app/.next/BUILD_ID').is_file(): raise RuntimeError('Incomplete app build')
        permissions(work)
        if reuse: reuse_images(BASE / 'app', work / 'app')
        log('Waiting for any backup to finish…')
        BACKUPS.mkdir(exist_ok=True)
        with (BACKUPS / 'backup.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            log('Taking a consistent pre-deployment database backup…')
            with closing(sqlite3.connect(DATA / 'gallery.sqlite',timeout=30)) as source, closing(sqlite3.connect(BACKUPS / f'before-{stamp}.sqlite')) as target:
                source.backup(target)
                target.execute('PRAGMA journal_mode=DELETE')
            log('Stopping the app briefly to migrate and switch versions…')
            stopped = True; service('stop')
            models = work / 'data/models'
            if models.exists():
                destination = DATA / 'models'
                if destination.is_symlink(): raise RuntimeError('Unexpected model directory link')
                destination.mkdir(exist_ok=True,mode=0o700)
                uid, gid = pwd.getpwnam('rendergallery').pw_uid, grp.getgrnam('rendergallery').gr_gid
                os.chown(destination,uid,gid)
                for path in models.iterdir():
                    if not path.is_file(): raise RuntimeError('Unexpected model subdirectory')
                    target = destination / path.name
                    if target.is_symlink(): raise RuntimeError('Unexpected model link')
                    # The source tree has no links and is root-owned/read-only to the app.
                    temporary = destination / f'.deploy-{stamp}-{path.name}'
                    shutil.copyfile(path,temporary)
                    os.chown(temporary,uid,gid); temporary.chmod(0o600)
                    os.replace(temporary,target)
            subprocess.run(['/usr/sbin/runuser','-u','rendergallery','--','/usr/bin/python3','-I',__file__,'--migrate',str(work)],check=True)
            (BASE / 'app').rename(previous); moved = True
            (work / 'app').rename(BASE / 'app'); switched = True
            log('Starting the new version; waiting for startup…')
            try: service('start')
            except subprocess.CalledProcessError: pass
            for _ in range(45):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:3000/',timeout=3) as response:
                        if response.status == 200: break
                except Exception: pass
                time.sleep(1)
            else: raise RuntimeError('New version failed its HTTP health check')
            stopped = False
            log('Update successful. Previous code and database backup retained.')
            try: prune_releases()
            except OSError as error: log(f'Could not clean old releases: {error}')
    except BaseException:
        if moved:
            log('Update failed; restoring the previous code…')
            service('stop')
            if switched: (BASE / 'app').rename(failed)
            previous.rename(BASE / 'app')
        if stopped: service('start')
        raise
    finally:
        shutil.rmtree(work)


if __name__ == '__main__':
    os.umask(0o077)
    if os.geteuid() != 0:
        if len(sys.argv) == 3 and sys.argv[1] == '--pack': pack(sys.argv[2])
        elif len(sys.argv) == 3 and sys.argv[1] == '--pack-code': pack(sys.argv[2], reuse_archive=True)
        elif len(sys.argv) == 3 and sys.argv[1] == '--migrate' and pwd.getpwuid(os.getuid()).pw_name == 'rendergallery': migrate(Path(sys.argv[2]))
        else: raise SystemExit('Use sudo /usr/local/sbin/rendergallery-promote without arguments.')
    else:
        if len(sys.argv) != 1: raise SystemExit('This helper accepts no root arguments.')
        with (BASE / 'deploy.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            try: promote(json.loads(Path('/etc/rendergallery-deploy.json').read_text()))
            except Exception as error:
                log(f'Deployment failed: {error}')
                raise SystemExit(1)
