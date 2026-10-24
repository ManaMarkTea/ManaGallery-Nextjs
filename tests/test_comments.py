import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('comments_import', ROOT / 'scripts/import-comments.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CommentImportTests(unittest.TestCase):
    def test_history_deduplication_guests_moderation_and_private_field_exclusion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'fixture.sql'
            source.write_text("""INSERT INTO legacy_images (image_id,image_active) VALUES (14,1),(15,0);
INSERT INTO legacy_comments (comment_id,image_id,user_id,user_name,comment_headline,comment_text,comment_ip,comment_date) VALUES
(1,14,2,'Former artist','Old title','Lovely<br>render &amp; light','192.0.2.42',1071616861),
(2,14,0,'Guest','', 'buy viagra now','192.0.2.43',1071616862),
(3,15,0,'Hidden guest','', 'Hidden artwork comment','192.0.2.44',1071616863);""")
            payload, skipped = module.export_comments(source)
            self.assertEqual(skipped, 1)
            self.assertEqual(len(payload['entries']), 2)
            self.assertNotIn('192.0.2.', json.dumps(payload))
            self.assertEqual(payload['entries'][0]['body'], 'Old title\nLovely\nrender & light')
            database = root / 'fixture.sqlite'
            with closing(sqlite3.connect(database)) as db, db:
                db.executescript("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT); CREATE TABLE comments(id INTEGER PRIMARY KEY,artwork_id INTEGER,user_id INTEGER,body TEXT,created TEXT); CREATE TABLE legacy_accounts(legacy_id INTEGER PRIMARY KEY,username TEXT,user_id INTEGER);")
                db.execute("INSERT INTO users VALUES(7,'Linked artist')")
                db.execute("INSERT INTO legacy_accounts VALUES(2,'Former artist',7)")
                db.execute("INSERT INTO comments VALUES(1,14,7,'New local comment','2026-01-01 00:00:00')")
            self.assertEqual(module.import_comments(payload, database), 2)
            self.assertEqual(module.import_comments(payload, database), 0)
            with closing(sqlite3.connect(database)) as db, db:
                self.assertEqual(db.execute('SELECT count(*) FROM comment_feed').fetchone()[0], 3)
                self.assertEqual(db.execute('SELECT user_id,username FROM comment_feed WHERE id=-1').fetchone(), (7,'Linked artist'))
                self.assertEqual(db.execute('SELECT user_id,username,moderation_reason FROM comment_feed WHERE id=-2').fetchone(), (None,'Guest','Possible advertising spam'))
                db.execute('UPDATE legacy_comments SET deleted=1 WHERE legacy_id=1')
                db.execute('DELETE FROM comment_moderation WHERE comment_id=-2')
            self.assertEqual(module.import_comments(payload, database), 0)
            with closing(sqlite3.connect(database)) as db, db:
                self.assertIsNone(db.execute('SELECT 1 FROM comment_feed WHERE id=-1').fetchone())
                self.assertIsNone(db.execute('SELECT moderation_reason FROM comment_feed WHERE id=-2').fetchone()[0])
                self.assertEqual(db.execute('SELECT count(*) FROM comments').fetchone()[0], 1)


if __name__ == '__main__': unittest.main()
