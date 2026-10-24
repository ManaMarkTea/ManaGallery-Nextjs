#!/usr/bin/python3 -I
"""Publish a small, redacted tail of six fixed backup units for admin diagnostics."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

JOBS = ('backup', 'cloud-copy', 'maintenance', 'cloud-maintenance', 'restore-check', 'cloud-restore-check')
DIRECTORY = Path('/var/lib/rendergallery-monitor')


def credential_values(cloud=Path('/etc/rendergallery-cloud.env'), password=Path('/etc/rendergallery-backup.password')):
    values = []
    if password.exists(): values.append(password.read_text().strip())
    if cloud.exists():
        for line in cloud.read_text().splitlines():
            if line.startswith(('AWS_ACCESS_KEY_ID=', 'AWS_SECRET_ACCESS_KEY=')):
                raw = line.split('=', 1)[1]
                values.append(raw)
                try: values.extend(shlex.split(raw))
                except ValueError: pass
    return [value for value in values if len(value) >= 4]


def redact(message, secrets=()):
    if not isinstance(message, str): return '[non-text log message]'
    for secret in sorted(secrets, key=len, reverse=True): message = message.replace(secret, '[redacted]')
    message = re.sub(r'(?:s3:)?https?://\S+|s3:[^\s]+', '[remote repository]', message)
    message = re.sub(r'(?im)(\bauthorization\s*[:=]\s*)[^\r\n]*', r'\1[redacted]', message)
    message = re.sub(r'''(?ix)(\b(?:[a-z_]*(?:password|passwd|secret|token)[a-z_]*|aws_access_key_id)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)''', r'\1[redacted]', message)
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', message)[:1000]


def collect(secrets=(), runner=subprocess.run):
    jobs = {}
    for job in JOBS:
        try:
            result = runner(['/usr/bin/journalctl', '--no-pager', '--output=json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--lines=40', '--unit', f'rendergallery-{job}.service'], check=True, capture_output=True, text=True, timeout=5)
            lines = []
            for raw in result.stdout.splitlines()[-40:]:
                record = json.loads(raw)
                stamp = None
                try:
                    stamp = datetime.fromtimestamp(int(record['__REALTIME_TIMESTAMP']) / 1_000_000, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
                except (KeyError, ValueError, TypeError, OverflowError, OSError): pass
                lines.append({'at': stamp, 'message': redact(record.get('MESSAGE'), secrets)})
            jobs[job] = {'available': True, 'lines': lines}
        except (OSError, subprocess.SubprocessError, ValueError):
            jobs[job] = {'available': False, 'lines': []}
    return {'version': 1, 'generated': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'), 'jobs': jobs}


def publish(directory, payload, group_id=None):
    if directory.is_symlink() or not directory.is_dir(): raise ValueError('Monitor directory must be a regular directory')
    output = directory / 'backup-logs.json'
    if output.is_symlink(): raise ValueError('Monitor output must not be a link')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False)
        temporary.chmod(0o640)
        if group_id is not None: os.chown(temporary, 0, group_id)
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists(): temporary.unlink()


if __name__ == '__main__':
    import grp
    import sys
    if os.geteuid() != 0 or len(sys.argv) != 1: raise SystemExit('Run the installed monitor service as root, without arguments.')
    os.umask(0o077)
    publish(DIRECTORY, collect(credential_values()), grp.getgrnam('rendergallery').gr_gid)
