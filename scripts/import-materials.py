#!/usr/bin/env python3
"""Restore archived material or 3D-model downloads into private local storage."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('gallery_import', ROOT / 'scripts/import-gallery.py')
gallery_import = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery_import)


def import_materials(sql_dump, site, storage, models=False):
    site, storage = Path(site).resolve(), Path(storage).resolve()
    if storage.is_relative_to(ROOT / 'public'):
        raise ValueError('Exchange downloads must be kept outside public/.')
    sql = Path(sql_dump).read_text(encoding='latin-1')
    category, extension = (19, '.3ds') if models else (12, '.mat')
    folder = storage / ('models' if models else 'materials')
    folder.mkdir(parents=True, exist_ok=True)
    entries, restored, missing, preview_only = {}, 0, 0, 0
    for row in gallery_import.insert_rows(sql, 'legacy_images'):
        if gallery_import.safe_number(row.get('cat_id')) != category or gallery_import.safe_number(row.get('image_active')) != 1:
            continue
        image_id = gallery_import.safe_number(row.get('image_id'))
        if image_id < 1:
            continue
        name = gallery_import.safe_filename(row.get('image_media_file'))
        entries[str(image_id)] = None
        if not name or Path(name).suffix.lower() != extension:
            preview_only += 1
            continue
        if any(ord(c) < 32 for c in name) or '\\' in name:
            raise ValueError('Invalid material filename.')
        source_root = site / 'data/media' / str(category)
        source = (source_root / name).resolve()
        if not source.is_relative_to(source_root) or not source.is_file() or source.stat().st_size == 0:
            missing += 1
            continue
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        target = folder / f'{image_id}{extension}'
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            # Replace atomically so an interrupted refresh cannot serve half a preset.
            with tempfile.NamedTemporaryFile(dir=folder, delete=False) as temporary:
                temporary.write(content)
                temp_path = Path(temporary.name)
            os.replace(temp_path, target)
        entries[str(image_id)] = {'name': name, 'bytes': len(content), 'sha256': digest}
        restored += 1
    if not entries:
        raise ValueError('No exchange entries found; catalogue was not replaced.')
    manifest = json.dumps({'version': 1, 'entries': entries}, ensure_ascii=False)
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=folder,delete=False) as temporary:
        temporary.write(manifest)
        temp_path = Path(temporary.name)
    os.replace(temp_path, folder / 'catalogue.json')
    return {'entries':len(entries),'restored_models' if models else 'restored_materials':restored,'preview_only_entries':preview_only,'missing_files':missing}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sql_dump', type=Path)
    parser.add_argument('--models', action='store_true', help='Import the archived .3ds model exchange instead of materials')
    parser.add_argument('--site',type=Path,default=ROOT / 'legacy/bryce5')
    parser.add_argument('--storage',type=Path,default=Path(os.environ.get('RENDERGALLERY_DATA_DIR',ROOT / 'storage')))
    args = parser.parse_args()
    print('Exchange import:',import_materials(args.sql_dump,args.site,args.storage,args.models))
