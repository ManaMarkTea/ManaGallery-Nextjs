"""Grant admin access to an existing account using private filesystem access."""
import argparse
import os
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('username')
parser.add_argument('--database', type=Path, default=Path(os.environ.get('RENDERGALLERY_DATA_DIR', Path(__file__).resolve().parent.parent / 'storage')) / 'gallery.sqlite')
args = parser.parse_args()
if not args.database.is_file():
    raise SystemExit('Database not found. Start the app and register an account first.')
with sqlite3.connect(args.database) as db:
    row = db.execute('SELECT id FROM users WHERE username=?', (args.username,)).fetchone()
    if not row:
        raise SystemExit('Account not found. Register it in the app first.')
    db.execute("INSERT INTO account_policy(account_key,role) VALUES (?,'admin') ON CONFLICT(account_key) DO UPDATE SET role='admin'", (f'local:{row[0]}',))
print('Administrator role granted. Refresh the site.')
