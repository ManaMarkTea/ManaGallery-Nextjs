import importlib.util
import json
import hashlib
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
import shutil
import subprocess

spec = importlib.util.spec_from_file_location('snapshot', Path(__file__).resolve().parents[1] / 'scripts/backup-snapshot.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        self.public = self.root / 'public'
        self.output = self.root / 'snapshot'
        self.data.mkdir()
        (self.public / 'gallery').mkdir(parents=True)
        self.name = '12345678-1234-1234-1234-123456789abc.webp'
        (self.data / 'uploads' / 'previews').mkdir(parents=True)
        (self.data / 'uploads' / self.name).write_bytes(b'fake immutable upload')
        (self.data / 'uploads' / 'previews' / self.name).write_bytes(b'fake preview')
        (self.public / 'gallery' / 'example.jpg').write_bytes(b'fake archive image')
        (self.data / 'models').mkdir()
        model = b'fictional model bytes'
        (self.data / 'models/42.3ds').write_bytes(model)
        (self.data / 'models/42.glb').write_bytes(b'fictional GLB derivative')
        (self.data / 'models/previews.json').write_text(json.dumps({'version': 1, 'geometryOnly': True, 'entries': {}}))
        (self.data / 'models/catalogue.json').write_text(json.dumps({'version': 1, 'entries': {'42': {'name': 'example.3ds', 'bytes': len(model), 'sha256': hashlib.sha256(model).hexdigest()}}}))
        self.db = sqlite3.connect(self.data / 'gallery.sqlite')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE uploads (filename TEXT)')
        self.db.execute('INSERT INTO uploads VALUES (?)', (self.name,))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_wal_snapshot_survives_live_deletion_and_keeps_live_permissions(self):
        source = self.data / 'uploads' / self.name
        before = source.stat().st_mode
        module.snapshot(self.data, self.public, self.output)
        self.assertEqual(before, source.stat().st_mode)
        self.db.execute('DELETE FROM uploads')
        self.db.commit()
        source.unlink()
        manifest = module.verify(self.output)
        self.assertGreater(manifest['files'], 2)
        with closing(sqlite3.connect(self.output / 'data/gallery.sqlite')) as restored:
            self.assertEqual(restored.execute('SELECT count(*) FROM uploads').fetchone()[0], 1)
        self.assertEqual((self.output / 'data/uploads' / self.name).read_bytes(), b'fake immutable upload')
        self.assertEqual((self.output / 'data/models/42.3ds').read_bytes(), b'fictional model bytes')
        self.assertEqual((self.output / 'data/models/42.glb').read_bytes(), b'fictional GLB derivative')

    def test_generated_model_derivatives_are_authenticated_by_restore_verification(self):
        module.snapshot(self.data, self.public, self.output)
        (self.output / 'data/models/42.glb').write_bytes(b'corrupt derivative')
        with self.assertRaises(ValueError):
            module.verify(self.output)

    def test_verification_detects_missing_and_corrupted_files(self):
        module.snapshot(self.data, self.public, self.output)
        (self.output / 'data/uploads' / self.name).write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            module.verify(self.output)

    def test_unsafe_output_and_filename_are_rejected(self):
        with self.assertRaises(ValueError):
            module.snapshot(self.data, self.public, self.data)
        self.db.execute('UPDATE uploads SET filename=?', ('../../private',))
        self.db.commit()
        with self.assertRaises(ValueError):
            module.snapshot(self.data, self.public, self.output)

    def test_unrelated_existing_directory_is_never_deleted(self):
        self.output.mkdir()
        protected = self.output / 'keep.txt'
        protected.write_text('preserve this')
        with self.assertRaises(ValueError):
            module.snapshot(self.data, self.public, self.output)
        self.assertEqual(protected.read_text(), 'preserve this')

    @unittest.skipUnless(shutil.which('restic'), 'restic is not installed')
    def test_encrypted_repository_round_trip_and_retention_policy(self):
        module.snapshot(self.data, self.public, self.output)
        key = self.root / 'test-only-password'
        key.write_text('fictional-key-for-automated-tests-only')
        command = ['restic', '--repo', str(self.root / 'repository'), '--password-file', str(key)]
        def run(*args):
            subprocess.run(command + list(args), check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        run('init')
        run('backup', '--ignore-ctime', '--tag', 'rendergallery', str(self.output))
        run('check', '--read-data')
        # Independent cloud-style repository: repeat copies must be idempotent,
        # and recovery must still work when the source repository is unavailable.
        cloud = ['restic', '--repo', str(self.root / 'cloud'), '--password-file', str(key)]
        source = ['--from-repo', str(self.root / 'repository'), '--from-password-file', str(key)]
        def remote(*args):
            return subprocess.check_output(cloud + list(args), stderr=subprocess.PIPE)
        remote('init', *source, '--copy-chunker-params')
        remote('copy', *source, '--tag', 'rendergallery')
        remote('copy', *source, '--tag', 'rendergallery')
        self.assertEqual(len(json.loads(remote('snapshots', '--json'))), 1)
        remote('check', '--read-data')
        cloud_restore = self.root / 'cloud-restore'
        remote('restore', 'latest', '--tag', 'rendergallery', '--target', str(cloud_restore))
        module.verify(cloud_restore / self.output.relative_to(self.output.anchor))
        run('forget', '--tag', 'rendergallery', '--keep-hourly', '24', '--keep-daily', '7', '--keep-weekly', '4', '--keep-monthly', '6', '--dry-run')
        restore = self.root / 'restore'
        run('restore', 'latest', '--tag', 'rendergallery', '--target', str(restore))
        restored = restore / self.output.relative_to(self.output.anchor)
        module.verify(restored)
        self.assertEqual((restored / 'data/models/42.glb').read_bytes(), b'fictional GLB derivative')
        self.assertEqual((restored / 'data/uploads' / self.name).read_bytes(), b'fake immutable upload')


if __name__ == '__main__':
    unittest.main()
