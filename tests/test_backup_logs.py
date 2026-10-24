import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('backup_logs', Path(__file__).resolve().parents[1] / 'scripts/publish-backup-logs.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupLogTests(unittest.TestCase):
    def test_redacts_credentials_urls_and_control_sequences_before_truncation(self):
        text = 'Fatal Access Denied: password="example pass" AWS_SECRET_ACCESS_KEY=example-key https://example.invalid/bucket?token=secret exact-private-value\x1b'
        result = module.redact(text, ['exact-private-value'])
        for secret in ('example pass', 'example-key', 'example.invalid', 'token=secret', 'exact-private-value', '\x1b'):
            self.assertNotIn(secret, result)
        self.assertIn('Access Denied', result)
        self.assertEqual(module.redact('Authorization: Bearer fictional-bearer-token'), 'Authorization: [redacted]')
        self.assertEqual(module.redact('AWS_SESSION_TOKEN=fictional-session'), 'AWS_SESSION_TOKEN=[redacted]')
        self.assertLessEqual(len(module.redact('x' * 3000)), 1000)

    def test_collects_only_fixed_units_and_exports_only_message_and_time(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(stdout=json.dumps({'__REALTIME_TIMESTAMP': '1792766515000000', 'MESSAGE': 'Fatal: Access Denied. password=secret', 'HOSTNAME': 'private-host'}))
        result = module.collect(runner=run)
        self.assertEqual(len(calls), 6)
        self.assertEqual({command[-1] for command in calls}, {f'rendergallery-{key}.service' for key in module.JOBS})
        serialized = json.dumps(result)
        self.assertNotIn('private-host', serialized)
        self.assertNotIn('password=secret', serialized)
        self.assertIn('Access Denied', serialized)
        self.assertEqual(set(result['jobs']['backup']['lines'][0]), {'at', 'message'})
        self.assertTrue(result['jobs']['backup']['lines'][0]['at'].endswith('Z'))

    def test_missing_journal_is_reported_without_leaking_command_errors(self):
        def run(*args, **kwargs): raise OSError('private credential in a system error')
        result = module.collect(runner=run)
        self.assertFalse(result['jobs']['backup']['available'])
        self.assertNotIn('credential', json.dumps(result))

    def test_secret_files_are_parsed_as_data_and_snapshot_is_atomic(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            cloud, password = directory / 'cloud.env', directory / 'password'
            cloud.write_text("AWS_ACCESS_KEY_ID=fake-key-id\nAWS_SECRET_ACCESS_KEY=example\\ secret\n")
            password.write_text('fictional-recovery-password\n')
            secrets = module.credential_values(cloud, password)
            self.assertIn('example secret', secrets)
            self.assertIn('fictional-recovery-password', secrets)
            payload = {'version': 1, 'jobs': {}}
            module.publish(directory, payload)
            self.assertEqual(json.loads((directory / 'backup-logs.json').read_text()), payload)
            self.assertEqual({p.name for p in directory.iterdir()}, {'cloud.env', 'password', 'backup-logs.json'})


if __name__ == '__main__': unittest.main()
