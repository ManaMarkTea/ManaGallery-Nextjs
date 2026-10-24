"""Download a consistent encrypted restic repository over an existing SSH key.

No private keys/passwords are embedded. Recovery passwords must be saved
separately. Requires Python 3.11+ and an available ssh command/SSH agent.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
from uuid import uuid4


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', required=True, help='SSH host or user@host, without a password')
parser.add_argument('--destination', required=True, type=Path)
parser.add_argument('--keep', type=int, default=3)
args = parser.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_.@:-]+', args.host) or args.host.startswith('-'):
    raise SystemExit('Invalid SSH destination')
if args.keep < 2:
    raise SystemExit('Keep at least two independent downloaded repository copies')
destination = args.destination.resolve()
destination.mkdir(parents=True, exist_ok=True, mode=0o700)
remote = 'flock --shared /srv/rendergallery-backups/backup.lock tar -C /srv/rendergallery-backups/repository -cf - .'
size = subprocess.check_output(['ssh','-o','BatchMode=yes',args.host,'du -sk /srv/rendergallery-backups/repository'], text=True)
required = int(size.split()[0]) * 1024
if shutil.disk_usage(destination).free < required + 1024**3:
    raise SystemExit('Not enough disk space for a new backup plus 1 GiB margin')
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
target = destination / f'rendergallery-encrypted-{stamp}.tar'
temporary = target.with_suffix('.tar.' + uuid4().hex + '.partial')
try:
    with temporary.open('xb') as output:
        subprocess.run(['ssh','-o','BatchMode=yes',args.host,remote], stdout=output, check=True)
    with tarfile.open(temporary) as archive:
        entries = archive.getmembers()
        names = {e.name.removeprefix('./') for e in entries}
        if 'config' not in names or not any(n.startswith('snapshots/') and n != 'snapshots/' for n in names):
            raise ValueError('Downloaded repository has no config/snapshots; previous backups retained')
    temporary.replace(target)
    with target.open('rb') as content:
        checksum = hashlib.file_digest(content, 'sha256').hexdigest()
    target.with_suffix('.tar.sha256').write_text(checksum + '  ' + target.name + '\n')
    (destination / 'last-download.json').write_text(json.dumps({'completed':stamp,'archive':target.name,'bytes':target.stat().st_size,'sha256':checksum}, indent=2))
    # Delete only this tool's older exports, after a new transfer is verified.
    exports = sorted(destination.glob('rendergallery-encrypted-????????T??????Z.tar'), reverse=True)
    for old in exports[args.keep:]:
        old.unlink()
        old.with_suffix('.tar.sha256').unlink(missing_ok=True)
    print(f'Encrypted off-server backup saved: {target}')
    print('Keep the recovery password separately; this archive cannot be decrypted without it.')
except BaseException:
    temporary.unlink(missing_ok=True)
    raise
