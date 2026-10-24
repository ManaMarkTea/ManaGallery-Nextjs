"""Create/verify a consistent private staging tree for encrypted restic backups.

Files created by the app are immutable after upload. A short SQLite write lock
protects taking the database snapshot and hard-linking its referenced files;
subsequent deletions cannot remove those hard links. Archive linking and hashing
happen after releasing that lock. Staging must share a filesystem with uploads.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def safe_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'Missing or unsafe backup source: {path.name}')
    return path


def link_file(source, target):
    safe_file(source)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never chmod/chown linked files: that would change the live file too.
    os.link(source, target, follow_symlinks=False)
    safe_file(target)


def snapshot(data, public, output, configs=()):
    if Path(output).is_symlink():
        raise ValueError('Staging path must not be a symlink')
    data, public, output = (Path(p).resolve() for p in (data, public, output))
    if output == Path('/') or output in (data, public) or output in data.parents or output in public.parents or data in output.parents or public in output.parents:
        raise ValueError('Staging must be separate from live data and public assets.')
    if output.exists():
        marker = output / '.rendergallery-backup-stage'
        if not marker.is_file() or marker.read_text() != 'RenderGallery backup staging v1\n':
            raise ValueError('Refusing to replace a directory not created by this backup tool')
        shutil.rmtree(output)
    output.mkdir(parents=True, mode=0o700)
    (output / '.rendergallery-backup-stage').write_text('RenderGallery backup staging v1\n')
    destination = output / 'data'
    destination.mkdir(mode=0o700)
    database = safe_file(data / 'gallery.sqlite')
    with closing(sqlite3.connect(database, timeout=30)) as lock:
        lock.execute('BEGIN IMMEDIATE')
        try:
            with closing(sqlite3.connect(database, timeout=30)) as source:
                with closing(sqlite3.connect(destination / 'gallery.sqlite')) as target:
                    source.backup(target)
                    target.execute('PRAGMA journal_mode=DELETE')
                    if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                        raise ValueError('Database integrity check failed')
                    filenames = [r[0] for r in target.execute('SELECT filename FROM uploads')]
            for name in filenames:
                if not re.fullmatch(r'[a-f0-9-]{36}\.webp', name):
                    raise ValueError('Unexpected upload filename in database')
                link_file(data / 'uploads' / name, destination / 'uploads' / name)
                preview = data / 'uploads' / 'previews' / name
                if preview.exists():
                    link_file(preview, destination / 'uploads' / 'previews' / name)
        finally:
            lock.rollback()
    for source_root, target_root in (*((data / name, destination / name) for name in ('materials', 'models')), *((public / name, output / 'public' / name) for name in ('data', 'gallery', 'full'))):
        if not source_root.exists():
            continue
        if source_root.is_symlink():
            raise ValueError('Symlinked source directories are not supported')
        for source in source_root.rglob('*'):
            if source.is_symlink():
                raise ValueError('Symlink in backup source')
            if source.is_file():
                link_file(source, target_root / source.relative_to(source_root))
    for config in configs:
        config = Path(config)
        if config.exists():
            safe_file(config)
            target = output / 'config' / config.name
            target.parent.mkdir(mode=0o700, exist_ok=True)
            shutil.copyfile(config, target)
            target.chmod(0o600)
    # Restic authenticates all archive bytes; this manifest additionally lets a
    # restore drill check database/upload/material/config correspondence.
    files = [p for p in output.rglob('*') if p.is_file()]
    hashes = {p.relative_to(output).as_posix(): digest(p) for p in files if p.relative_to(output).parts[0] != 'public' or p.relative_to(output).parts[1] == 'data'}
    manifest = {'version': 1, 'created': datetime.now(timezone.utc).isoformat(), 'files': len(files), 'bytes': sum(p.stat().st_size for p in files), 'sha256': hashes}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    verify(output)
    return manifest


def verify(output):
    output = Path(output)
    manifest = json.loads((output / 'manifest.json').read_text())
    if manifest['version'] != 1:
        raise ValueError('Unsupported manifest version')
    for name, expected in manifest['sha256'].items():
        path = (output / name).resolve()
        if not path.is_relative_to(output.resolve()) or digest(safe_file(path)) != expected:
            raise ValueError('Restored file checksum mismatch')
    files = [p for p in output.rglob('*') if p.is_file() and p != output / 'manifest.json']
    if len(files) != manifest['files'] or sum(p.stat().st_size for p in files) != manifest['bytes']:
        raise ValueError('Restored file inventory mismatch')
    with closing(sqlite3.connect(f'file:{(output / "data/gallery.sqlite").as_posix()}?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Restored database failed integrity check')
        for (name,) in db.execute('SELECT filename FROM uploads'):
            safe_file(output / 'data' / 'uploads' / name)
    for folder, extension in (('materials', '.mat'), ('models', '.3ds')):
      catalogue = output / 'data' / folder / 'catalogue.json'
      if catalogue.exists():
        for ident, entry in json.loads(catalogue.read_text())['entries'].items():
            if not ident.isdecimal():
                raise ValueError('Invalid material ID')
            if entry:
                material = output / 'data' / folder / (ident + extension)
                if safe_file(material).stat().st_size != entry['bytes'] or digest(material) != entry['sha256']:
                    raise ValueError('Material catalogue does not match backed-up bytes')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('create', 'verify'))
    parser.add_argument('--data', type=Path, default=Path('/srv/rendergallery-data'))
    parser.add_argument('--public', type=Path, default=Path('/srv/rendergallery/app/public'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--config', type=Path, action='append', default=[])
    args = parser.parse_args()
    result = snapshot(args.data, args.public, args.output, args.config) if args.operation == 'create' else verify(args.output)
    print(f"Verified snapshot: {result['files']} files, {result['bytes']} bytes.")
