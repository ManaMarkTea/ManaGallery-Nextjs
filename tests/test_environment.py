from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('environment',ROOT / 'scripts/setup-environment.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EnvironmentSetupTests(unittest.TestCase):
    def test_example_and_preview_require_no_network_or_mutations(self):
        with patch.object(module.subprocess,'run',side_effect=AssertionError('unexpected command')), patch.object(module.urllib.request,'urlopen',side_effect=AssertionError('unexpected network')):
            config = module.configuration(ROOT / 'deploy/environment.example.json')
            self.assertEqual(config['nodeVersion'],'24.22.1')
            self.assertEqual(len(module.plan(config)),9)

    def test_rejects_injected_hosts_root_accounts_unknown_secret_fields_and_bad_flags(self):
        example = json.loads((ROOT / 'deploy/environment.example.json').read_text())
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'config.json'
            for field,value in (('siteHost','example.com\nadmin off'),('adminUser','root'),('repository','owner/repo;whoami'),('nodeVersion','latest'),('nodeSha256','abc'),('allowEmpty','false'),('restoreSnapshot','relative/path'),('apiKey','never-put-a-secret-here')):
                source.write_text(json.dumps({**example,field:value}))
                with self.subTest(field=field), self.assertRaises(ValueError): module.configuration(source)
            source.write_text(json.dumps({**example,'cloudBackups':True,'localBackups':False}))
            with self.assertRaises(ValueError): module.configuration(source)

    def test_repeat_configuration_preserves_files_and_keeps_prior_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'managed.env'
            self.assertTrue(module.write_changed(target,'original\n',0o600))
            before = target.stat().st_mtime_ns
            self.assertFalse(module.write_changed(target,'original\n',0o600))
            self.assertEqual(before,target.stat().st_mtime_ns)
            self.assertTrue(module.write_changed(target,'changed\n',0o600))
            backups = list(target.parent.glob('managed.env.before-setup-*'))
            self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_text(),'original\n')

    def test_proxy_preserves_other_sites_is_repeatable_and_rolls_back_invalid_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            main, fragment = Path(temporary) / 'Caddyfile', Path(temporary) / 'sites/rendergallery.caddy'
            original = 'other.example.com {\n respond "Other site"\n}\n'
            main.write_text(original)
            with patch.object(module,'run'):
                module.configure_proxy('test.example.com',main,fragment)
                after = main.read_text()
                self.assertIn(original.strip(),after)
                self.assertEqual(after.count('import /etc/caddy/sites-enabled/*.caddy'),1)
                module.configure_proxy('test.example.com',main,fragment)
                self.assertEqual(main.read_text(),after)
            old_fragment = fragment.read_text()
            with patch.object(module,'run',side_effect=RuntimeError('invalid config')), self.assertRaises(RuntimeError):
                module.configure_proxy('replacement.example.com',main,fragment)
            self.assertEqual(fragment.read_text(),old_fragment)
            self.assertEqual(main.read_text(),after)

    def test_restored_data_and_isolated_build_seed_keep_accounts_and_settings_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, live, stage = [root / p for p in ('restored','live','stage')]
            (source / 'uploads').mkdir(parents=True)
            (source / 'uploads/example.webp').write_bytes(b'fictional artwork')
            with closing(sqlite3.connect(source / 'gallery.sqlite')) as db, db:
                db.execute('PRAGMA journal_mode=WAL')
                db.executescript("CREATE TABLE users(id INTEGER,username TEXT); INSERT INTO users VALUES(1,'Example artist'); CREATE TABLE site_settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO site_settings VALUES('adsenseEnabled','true'),('registrationOpen','true'); CREATE TABLE sessions(token TEXT); INSERT INTO sessions VALUES('fictional-session'); CREATE TABLE challenges(token TEXT); CREATE TABLE attempts(key TEXT);")
                module.copy_data(source,live)
                module.copy_data(source,stage,sanitize=True)
                self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],1)
            for destination in (live,stage):
                self.assertEqual((destination / 'uploads/example.webp').read_bytes(),b'fictional artwork')
                with closing(sqlite3.connect(destination / 'gallery.sqlite')) as db:
                    self.assertEqual(db.execute('SELECT username FROM users').fetchone()[0],'Example artist')
                    self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
                    self.assertEqual(dict(db.execute('SELECT key,value FROM site_settings'))['adsenseEnabled'],'false' if destination == stage else 'true')
            with self.assertRaises(ValueError): module.copy_data(source,source)


if __name__ == '__main__': unittest.main()
