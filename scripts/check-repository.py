"""Inspect tracked/staged source without printing potentially sensitive matches."""
from pathlib import Path
import re
import subprocess
import sys

combined=Path(__file__).resolve().parents[2]/'scripts/check-source.py'
if combined.is_file() and Path(__file__).resolve().parents[1].name=='nextjs':
    subprocess.run([sys.executable,str(combined)],check=True)
    raise SystemExit(0)


files = subprocess.check_output(['git','ls-files','-z']).decode().split('\0')
forbidden = ('storage/','legacy/','public/data/','public/gallery/','public/full/','test-results/','node_modules/','.next/','.next-dev/')
secret_patterns = [re.compile(rb'-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----'), re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'), re.compile(rb'github_pat_[A-Za-z0-9_]{30,}'), re.compile(rb'AKIA[0-9A-Z]{16}')]
problems = []
for name in filter(None, files):
    path = Path(name)
    if name.startswith(forbidden) or path.name in ('recovery-password','backup-password','last-download.json','rendergallery-cloud.env','legacy-comments.json','environment.local.json') or path.name.startswith('rendergallery-encrypted-') or (path.name.startswith('.env') and path.name != '.env.example') or path.suffix.lower() in ('.sqlite','.db','.pem','.pfx','.p12','.zip','.gz','.dump'):
        problems.append((name, 'private/runtime file tracked'))
        continue
    # Read index content, so staged secrets cannot be hidden by editing the worktree.
    content = subprocess.check_output(['git','show',f':{name}'])
    if any(pattern.search(content) for pattern in secret_patterns):
        problems.append((name, 'possible credential'))
    if len(content) > 2_000_000:
        problems.append((name, 'unexpected large file'))
if problems:
    for name, reason in problems:
        print(f'{name}: {reason}')
    raise SystemExit('Repository content check failed. Nothing should be published until resolved.')
print(f'Checked {len(list(filter(None, files)))} source files: no runtime data or matching credentials found.')
