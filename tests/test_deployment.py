import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
import sqlite3
from types import SimpleNamespace


@unittest.skipUnless(os.name == 'posix', 'Linux deployment helper')
class DeploymentArchiveTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('promote', Path(__file__).resolve().parents[1] / 'scripts/promote-vps.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.destination = Path(self.temp.name) / 'incoming'
        self.destination.mkdir()

    def tearDown(self): self.temp.cleanup()

    def archive(self, name, content=b'fixture', kind=None):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as tar:
            entry = tarfile.TarInfo(name)
            entry.mode = 0o7777
            if kind:
                entry.type = kind
                entry.linkname = '/etc/shadow'
                tar.addfile(entry)
            else:
                entry.size = len(content)
                tar.addfile(entry,io.BytesIO(content))
        stream.seek(0)
        return stream

    def test_extracts_only_regular_files_without_archived_permissions(self):
        self.module.unpack(self.archive('app/.next/BUILD_ID'),self.destination,1000)
        target = self.destination / 'app/.next/BUILD_ID'
        self.assertEqual(target.read_bytes(),b'fixture')
        self.assertEqual(target.stat().st_mode & 0o7777,0o700)

    def test_rejects_escape_links_devices_unexpected_data_and_size_overrun(self):
        for name,kind in (('../escape',None),('/tmp/escape',None),('app/../../escape',None),('data/gallery.sqlite',None),('app/link',tarfile.SYMTYPE),('app/hard',tarfile.LNKTYPE),('app/device',tarfile.CHRTYPE)):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.module.unpack(self.archive(name,kind=kind),self.destination,1000)
        with self.assertRaises(ValueError):
            self.module.unpack(self.archive('app/large',b'x'*100),self.destination,10)

    def test_tar_flattens_npm_links_before_privileged_extraction(self):
        stage = Path(self.temp.name) / 'stage'
        (stage / 'app/node_modules/.bin').mkdir(parents=True)
        (stage / 'app/node_modules/tool').write_bytes(b'fixture executable')
        (stage / 'app/node_modules/.bin/tool').symlink_to('../tool')
        result = subprocess.check_output(['/usr/bin/tar','--dereference','--hard-dereference','-C',str(stage),'-cf','-','app'])
        self.module.unpack(io.BytesIO(result),self.destination,1000)
        self.assertFalse((self.destination / 'app/node_modules/.bin/tool').is_symlink())
        self.assertEqual((self.destination / 'app/node_modules/.bin/tool').read_bytes(),b'fixture executable')

    def test_code_only_package_excludes_archive_but_preserves_metadata(self):
        stage = Path(self.temp.name) / 'stage'
        for directory in ('app/.next','app/public/full','app/public/gallery','app/public/data'):
            (stage / directory).mkdir(parents=True)
        (stage / 'app/.next/BUILD_ID').write_text('fixture')
        (stage / 'app/public/full/image.jpg').write_bytes(b'image')
        (stage / 'app/public/gallery/image.jpg').write_bytes(b'preview')
        (stage / 'app/public/data/gallery.json').write_text('[]')
        with patch.object(self.module.os, 'execv') as execute:
            self.module.pack(stage, reuse_archive=True)
        arguments = execute.call_args.args[1]
        payload = subprocess.check_output(['/usr/bin/tar', *arguments[1:]])
        self.module.unpack(io.BytesIO(payload), self.destination, 10000)
        self.assertFalse((self.destination / 'app/public/full').exists())
        self.assertFalse((self.destination / 'app/public/gallery').exists())
        self.assertEqual((self.destination / 'app/public/data/gallery.json').read_text(), '[]')

    def deployment(self, healthy):
        root = Path(self.temp.name)
        base, data, backups, stage = [root / name for name in ('live','data','backups','stage')]
        for directory in (base / 'app',data,stage / 'app/.next'): directory.mkdir(parents=True)
        (base / 'app/version').write_text('previous')
        (stage / 'app/version').write_text('new')
        (stage / 'app/.next/BUILD_ID').write_text('fixture')
        with sqlite3.connect(data / 'gallery.sqlite') as db: db.execute('CREATE TABLE fixture(id INTEGER)')
        real_popen = subprocess.Popen
        def pack_as_current_user(*args, **kwargs):
            return real_popen(['/usr/bin/tar','--dereference','--hard-dereference','-C',str(stage),'-cf','-','app'],stdout=subprocess.PIPE)
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self,*args): pass
        with ExitStack() as stack:
            stack.enter_context(patch.object(self.module.shutil,'disk_usage',return_value=SimpleNamespace(free=12*1024**3)))
            for key,value in (('BASE',base),('DATA',data),('BACKUPS',backups)):
                stack.enter_context(patch.object(self.module,key,value))
            stack.enter_context(patch.object(self.module,'permissions'))
            stack.enter_context(patch.object(self.module,'service'))
            stack.enter_context(patch.object(self.module.subprocess,'Popen',side_effect=pack_as_current_user))
            stack.enter_context(patch.object(self.module.subprocess,'run'))
            stack.enter_context(patch.object(self.module.time,'sleep'))
            http = stack.enter_context(patch.object(self.module.urllib.request,'urlopen'))
            if healthy: http.return_value = Response()
            else: http.side_effect = OSError('simulated startup failure')
            if healthy: self.module.promote({'user':'fixture','stage':str(stage)})
            else:
                with self.assertRaisesRegex(RuntimeError,'health check'):
                    self.module.promote({'user':'fixture','stage':str(stage)})
        self.assertEqual((base / 'app/version').read_text(),'new' if healthy else 'previous')
        self.assertEqual(len(list(backups.glob('before-*.sqlite'))),1)
        self.assertEqual(list(base.glob('.incoming-*')),[])
        if not healthy: self.assertEqual(len(list(base.glob('app.failed-*'))),1)

    def test_health_check_promotes_prepared_code_and_retains_backup(self): self.deployment(True)

    def test_failed_health_check_restores_previous_code(self): self.deployment(False)

    def test_archive_reuse_links_bytes_without_copying_and_rejects_links(self):
        current = Path(self.temp.name) / 'current'
        incoming = Path(self.temp.name) / 'new'
        for name in ('gallery','full'):
            directory = current / 'public' / name
            directory.mkdir(parents=True)
            directory.chmod(0o750)
            (directory / 'image.jpg').write_bytes(b'immutable image')
            (directory / 'image.jpg').chmod(0o640)
        # Production validates actual root ownership; this fixture can run as SSH user.
        real_lstat = Path.lstat
        def root_owned(path):
            info = real_lstat(path)
            values = list(info)
            values[4] = 0
            return os.stat_result(values)
        with patch.object(Path, 'lstat', root_owned), patch.object(self.module.os, 'chown', wraps=os.chown) as ownership:
            self.module.reuse_images(current, incoming)
        for name in ('gallery', 'full'):
            ownership.assert_any_call(incoming / 'public' / name, -1, (current / 'public' / name).stat().st_gid)
        source, target = current / 'public/full/image.jpg', incoming / 'public/full/image.jpg'
        self.assertEqual(source.stat().st_ino, target.stat().st_ino)
        self.assertEqual(target.read_bytes(), b'immutable image')
        (current / 'public/gallery/unsafe').symlink_to('/etc/passwd')
        with patch.object(Path, 'lstat', root_owned), self.assertRaises(ValueError):
            self.module.reuse_images(current, Path(self.temp.name) / 'reject')

    def test_retention_keeps_two_previous_releases_and_unrelated_paths(self):
        base = Path(self.temp.name) / 'releases'
        base.mkdir()
        names = [f'app.before-20261023T06000{i}000000Z' for i in range(4)]
        for name in [*names, 'app', 'app.failed-20261023T060000000000Z', 'app.before-manual']:
            (base / name).mkdir()
        external = Path(self.temp.name) / 'external'
        external.mkdir()
        (base / 'app.before-20261023T070000000000Z').symlink_to(external, target_is_directory=True)
        with patch.object(self.module, 'BASE', base): self.module.prune_releases()
        self.assertFalse((base / names[0]).exists())
        self.assertFalse((base / names[1]).exists())
        self.assertTrue((base / names[2]).exists())
        self.assertTrue((base / names[3]).exists())
        for name in ('app', 'app.failed-20261023T060000000000Z', 'app.before-manual'):
            self.assertTrue((base / name).exists())
        self.assertTrue(external.exists())


if __name__ == '__main__': unittest.main()
