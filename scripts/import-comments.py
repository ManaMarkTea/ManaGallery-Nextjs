#!/usr/bin/env python3
"""Restore public gallery comments without importing IP addresses or credentials."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import importlib.util
import json
import os
import re
import unicodedata
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
RULES = json.loads((ROOT / 'lib/comment-rules.json').read_text())
spec = importlib.util.spec_from_file_location('gallery_import', ROOT / 'scripts/import-gallery.py')
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)
    def handle_starttag(self, tag, attrs):
        if tag in ('br', 'p', 'div'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('p', 'div'): self.parts.append('\n')


def plain(value):
    parser = PlainText()
    parser.feed(value or '')
    return ''.join(parser.parts).replace('\x00', '').strip()


def export_comments(sql_dump):
    sql = Path(sql_dump).read_text(encoding='latin-1')
    published = {gallery.safe_number(r.get('image_id')) for r in gallery.insert_rows(sql, 'legacy_images') if gallery.safe_number(r.get('image_active')) == 1}
    entries, skipped = [], 0
    for row in gallery.insert_rows(sql, 'legacy_comments'):
        ident, artwork = gallery.safe_number(row.get('comment_id')), gallery.safe_number(row.get('image_id'))
        timestamp = gallery.safe_number(row.get('comment_date'))
        if ident < 1 or artwork not in published or not 0 < timestamp < 253402300800:
            skipped += 1
            continue
        title, body = plain(row.get('comment_headline')), plain(row.get('comment_text'))
        text = '\n'.join(p for p in (title, body) if p)
        if not text:
            skipped += 1
            continue
        normalized = unicodedata.normalize('NFKC', text).lower().translate({ord(c): None for c in '\u200b\u200c\u200d\ufeff'})
        reason = None
        if any(re.search(r'\b' + re.escape(word) + r'\b', normalized) for word in RULES['profanity']): reason = 'Possible profanity'
        elif any(phrase in normalized for phrase in RULES['spamPhrases']): reason = 'Possible advertising spam'
        elif len(re.findall(r'https?://|www\.|\[url[=\]]', normalized)) >= 3: reason = 'Links need review'
        elif re.search(r'(.)\1{29,}', normalized): reason = 'Repetitive text'
        entries.append({'id': ident, 'artworkId': artwork, 'legacyUserId': max(0, gallery.safe_number(row.get('user_id'))), 'username': unescape(row.get('user_name') or '').strip() or 'Former member', 'body': text, 'created': datetime.fromtimestamp(timestamp, timezone.utc).strftime('%Y-%m-%d %H:%M:%S'), 'reviewReason': reason})
    if not entries: raise ValueError('No published gallery comments found; nothing was replaced.')
    return {'version': 1, 'entries': entries}, skipped


def import_comments(payload, database):
    if payload.get('version') != 1 or not isinstance(payload.get('entries'), list):
        raise ValueError('Invalid comment export')
    database = Path(database).resolve()
    if database.is_relative_to(ROOT / 'public'): raise ValueError('Private database cannot be inside public/')
    with closing(sqlite3.connect(database, timeout=30)) as connection, connection:
        # Existing app/isolated fixture databases have these base tables.
        connection.executescript((ROOT / 'lib/comments-schema.sql').read_text())
        imported = 0
        for entry in payload['entries']:
            if not isinstance(entry['id'], int) or entry['id'] < 1 or not isinstance(entry['artworkId'], int) or entry['artworkId'] < 1:
                raise ValueError('Invalid comment identity')
            inserted = connection.execute('INSERT INTO legacy_comments(legacy_id,artwork_id,legacy_user_id,username,body,created) VALUES(?,?,?,?,?,?) ON CONFLICT(legacy_id) DO NOTHING', (entry['id'],entry['artworkId'],entry['legacyUserId'],entry['username'],entry['body'],entry['created'])).rowcount
            imported += inserted
            if inserted and entry.get('reviewReason'):
                connection.execute('INSERT INTO comment_moderation(comment_id,reason) VALUES(?,?)', (-entry['id'],entry['reviewReason']))
        return imported


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--export', type=Path, help='Export public fields only from the private SQL dump')
    parser.add_argument('--database', type=Path)
    args = parser.parse_args()
    if args.export:
        payload, skipped = export_comments(args.source)
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        os.chmod(args.export, 0o600)
        held = sum(bool(e['reviewReason']) for e in payload['entries'])
        print(f"Exported {len(payload['entries'])} comments ({held} held for review); skipped {skipped} unavailable/empty entries. No IP addresses exported.")
    else:
        if not args.database: parser.error('--database is required when importing JSON')
        payload = json.loads(args.source.read_text(encoding='utf-8'))
        print(f'Imported {import_comments(payload, args.database)} comments; existing comments and moderation preserved.')
