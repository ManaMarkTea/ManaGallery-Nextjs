#!/usr/bin/env python3
"""Import PRIVATE Bryce login hashes and artwork ownership directly into SQLite.

Never writes credentials to public/, JSON catalogues, or console output.
Re-runs preserve linked accounts and upgraded passwords.
"""
import argparse
import collections
import importlib.util
import os
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('gallery_import', ROOT / 'scripts/import-gallery.py')
gallery_import = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery_import)


def import_accounts(sql_dump, database):
    sql = Path(sql_dump).read_text(encoding='latin-1')
    accounts = list(gallery_import.insert_rows(sql, 'legacy_users'))
    if not accounts:
        raise ValueError('No legacy gallery user rows found; nothing was changed.')
    database = Path(database).resolve()
    if database.is_relative_to(ROOT / 'public'):
        raise ValueError('The account database must never be inside public/.')
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database, timeout=30)
    connection.execute('PRAGMA foreign_keys=ON')
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
    connection.executescript((ROOT / 'lib/legacy-schema.sql').read_text(encoding='utf-8'))
    connection.executescript((ROOT / 'lib/member-schema.sql').read_text(encoding='utf-8'))
    if 'is_admin' not in {row[1] for row in connection.execute('PRAGMA table_info(legacy_accounts)')}:
        connection.execute('ALTER TABLE legacy_accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
    counts = collections.Counter()
    try:
        with connection:
            for row in accounts:
                legacy_id = gallery_import.safe_number(row.get('user_id'))
                level = gallery_import.safe_number(row.get('user_level'))
                if legacy_id <= 0 or level == -1:
                    counts['guest_skipped'] += 1
                    continue
                username = row.get('user_name') or ''
                password = row.get('user_password') or ''
                if not username or not re.fullmatch(r'(?:[^:\r\n]{9}:)?[a-fA-F0-9]{32}', password):
                    raise ValueError('Unsupported account name or password format; import rolled back.')
                enabled = int(level in (2, 9))
                def timestamp(value):
                    parsed = gallery_import.safe_number(value)
                    return int(parsed) * 1000 if 0 < parsed < 253402300800 else None
                connection.execute('INSERT INTO legacy_account_dates(legacy_id,joined,last_visit) VALUES (?,?,?) ON CONFLICT(legacy_id) DO UPDATE SET joined=excluded.joined,last_visit=excluded.last_visit',
                    (legacy_id, timestamp(row.get('user_joindate')), timestamp(row.get('user_lastvisit'))))
                # Existing migrated credentials stay NULL; never resurrect old passwords.
                connection.execute('''INSERT INTO legacy_accounts(legacy_id,username,password,enabled,is_admin) VALUES (?,?,?,?,?)
                    ON CONFLICT(legacy_id) DO UPDATE SET username=excluded.username, enabled=excluded.enabled, is_admin=excluded.is_admin,
                    password=CASE WHEN legacy_accounts.user_id IS NULL THEN excluded.password ELSE NULL END''',
                    (legacy_id, username, password, enabled, int(level == 9)))
                counts['active' if enabled else 'inactive'] += 1
            for row in gallery_import.insert_rows(sql, 'legacy_images'):
                if gallery_import.safe_number(row.get('image_active')) != 1:
                    continue
                connection.execute('INSERT INTO legacy_artwork(artwork_id,legacy_user_id) VALUES (?,?) ON CONFLICT(artwork_id) DO UPDATE SET legacy_user_id=excluded.legacy_user_id',
                    (gallery_import.safe_number(row.get('image_id')), gallery_import.safe_number(row.get('user_id'))))
                counts['artwork_links'] += 1
            counts['local_name_collisions'] = connection.execute('SELECT count(*) FROM legacy_accounts l JOIN users u ON u.username=l.username WHERE l.user_id IS NULL').fetchone()[0]
    finally:
        connection.close()
    return dict(counts)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sql_dump', type=Path)
    parser.add_argument('--database', type=Path, default=Path(os.environ.get('RENDERGALLERY_DATA_DIR', ROOT / 'storage')) / 'gallery.sqlite')
    args = parser.parse_args()
    print('Private account import complete:', import_accounts(args.sql_dump, args.database))
