import hashlib
import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('retention_prepare', Path(__file__).with_name('prepare-realtime-image.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def response(value):
    stream = io.BytesIO(json.dumps(value).encode())
    stream.geturl = lambda: prepare.INVENTORY_URL
    stream.headers = Message(); stream.headers['Content-Type'] = 'application/json'
    return stream


def digest(character):
    return 'sha256:' + character * 64


def manifest(runtime, client):
    return {'runtime': runtime, 'client': client, 'rules': 'forpost-0.1', 'content': 'forpost-content-1',
            'protocol': '1', 'serializer': 'forpost-world-1', 'bot': 'forpost-bot-0.1', 'map': 'forpost-maps-0.1',
            'physics': 'forpost-kinematic-1', 'prng': 'xorshift32-1'}


class RetentionPreparationTest(unittest.TestCase):
    revision = 'b' * 40

    def inventory(self):
        return {'format': 1, 'buildRevision': self.revision, 'current': {'runtime': digest('b'), 'client': digest('e')},
                'manifests': [manifest(digest('a'), digest('d'))]}

    def bundle(self):
        body = {'format': 1, 'buildRevision': self.revision, 'current': self.inventory()['current'],
                'artifacts': [digest('a'), digest('b')], 'clients': [digest('d'), digest('e')],
                'readers': {'format': 1, 'store': {'id': 'realtime-sqlite-record-1', 'userVersions': [0]}, 'profiles': []}}
        return {**body, 'seal': 'sha256:' + hashlib.sha256(prepare.canonical(body).encode()).hexdigest()}

    def docker(self, calls, bundle=None, invalid_labels=False):
        labels = {'org.opencontainers.image.source': prepare.SOURCE, 'org.opencontainers.image.revision': self.revision}
        if invalid_labels: labels['org.opencontainers.image.source'] = 'https://untrusted.invalid/repo'
        def run(*args):
            calls.append(args)
            if args[1:3] == ('buildx', 'imagetools'):
                return json.dumps({'digest': digest('f')} if args[-2] == '{{json .Manifest}}' else {'config': {'Labels': labels}})
            if args[1:3] == ('image', 'inspect'): return json.dumps(labels)
            if args[1] == 'cp': (Path(args[-1]) / 'bundle.json').write_text(json.dumps(bundle or self.bundle()))
            return ''
        return run

    def test_404_is_explicit_empty_build_input_without_docker_but_keeps_final_host_gate(self):
        opener = Mock(); opener.open.side_effect = urllib.error.HTTPError(prepare.INVENTORY_URL, 404, 'absent', {}, None)
        docker = Mock()
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'input'
            result = prepare.prepare(target, opener, docker)
            self.assertTrue(result['bootstrap']); self.assertTrue(result['hostPreflightRequired'])
            self.assertEqual(json.loads((target / 'input.json').read_text()), {'format': 1, 'bootstrap': True, 'inventory': None, 'image': None})
        docker.assert_not_called()

    def test_auth_network_errors_and_redirects_do_not_become_bootstrap(self):
        for status in (401, 403, 429, 500, 503):
            opener = Mock(); opener.open.side_effect = urllib.error.HTTPError(prepare.INVENTORY_URL, status, 'fixture', {}, None)
            with self.subTest(status=status), self.assertRaisesRegex(RuntimeError, f'HTTP {status}'):
                prepare.fetch_inventory(opener)
        with self.assertRaisesRegex(RuntimeError, 'redirect refused'):
            prepare.RefuseRedirects().redirect_request(None, None, 302, '', {}, 'https://other.invalid/')

    def test_public_inventory_is_deduplicated_and_rejects_private_fields_or_nonrevision_input(self):
        value = self.inventory(); value['manifests'] *= 2
        self.assertEqual(len(prepare.sanitize_inventory(value)['manifests']), 1)
        value['manifests'][0]['world'] = 'private-world'
        with self.assertRaisesRegex(RuntimeError, 'saved manifest'): prepare.sanitize_inventory(value)
        value = self.inventory(); value['buildRevision'] = '../../mutable-main'
        with self.assertRaisesRegex(RuntimeError, 'revision'): prepare.sanitize_inventory(value)
        value = self.inventory(); value['format'] = True
        with self.assertRaisesRegex(RuntimeError, 'inventory'): prepare.sanitize_inventory(value)
        opener = Mock(); opener.open.return_value = response(self.inventory())
        prepare.fetch_inventory(opener)
        request = opener.open.call_args.args[0]
        self.assertIsNone(request.get_header('Authorization'))
        self.assertEqual(request.full_url, prepare.INVENTORY_URL)

    def test_copies_current_and_recursive_bundle_by_validated_revision_then_digest(self):
        calls = []; opener = Mock(); opener.open.return_value = response(self.inventory())
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'input'
            result = prepare.prepare(target, opener, self.docker(calls))
            value = json.loads((target / 'input.json').read_text())
            copied = json.loads((target / 'bundle/bundle.json').read_text())
            self.assertFalse(result['bootstrap'])
            self.assertEqual(copied['artifacts'], [digest('a'), digest('b')])
            self.assertEqual(value['image']['revision'], self.revision)
            self.assertEqual(value['image']['digest'], digest('f'))
        self.assertEqual(calls[0][-1], f'{prepare.REPOSITORY}:{self.revision}')
        pulls = [call for call in calls if call[1] == 'pull']
        self.assertEqual(pulls, [('docker', 'pull', f'{prepare.REPOSITORY}@{digest("f")}')])
        self.assertTrue(any(call[1] == 'create' and call[call.index('--network') + 1] == 'none' for call in calls))
        self.assertEqual(calls[-1][1:3], ('rm', '--force'))

    def test_foreign_source_label_is_rejected_before_pull_or_container_creation(self):
        calls = []; opener = Mock(); opener.open.return_value = response(self.inventory())
        with tempfile.TemporaryDirectory() as root, self.assertRaisesRegex(RuntimeError, 'labels'):
            prepare.prepare(Path(root) / 'input', opener, self.docker(calls, invalid_labels=True))
        self.assertFalse(any(call[1] in ('pull', 'create') for call in calls))

    def test_malformed_image_metadata_is_rejected_before_pull(self):
        calls = []; opener = Mock(); opener.open.return_value = response(self.inventory())
        valid = self.docker(calls)
        def run(*args):
            if '{{json .Image}}' in args:
                calls.append(args)
                return '[]'
            return valid(*args)
        with tempfile.TemporaryDirectory() as root, self.assertRaisesRegex(RuntimeError, 'configuration is missing'):
            prepare.prepare(Path(root) / 'input', opener, run)
        self.assertFalse(any(call[1] in ('pull', 'create') for call in calls))

    def test_missing_n_minus_two_version_fails_and_cleans_its_own_container(self):
        bundle = self.bundle(); bundle['artifacts'] = [digest('b')]
        body = {key: value for key, value in bundle.items() if key != 'seal'}
        bundle['seal'] = 'sha256:' + hashlib.sha256(prepare.canonical(body).encode()).hexdigest()
        calls = []; opener = Mock(); opener.open.return_value = response(self.inventory())
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, 'Required saved version missing'):
                prepare.prepare(Path(root) / 'input', opener, self.docker(calls, bundle))
            self.assertFalse((Path(root) / 'input').exists())
        self.assertEqual(calls[-1][1:3], ('rm', '--force'))

    def test_bundle_revision_and_seal_are_checked_after_copy(self):
        for mode in ('revision', 'seal'):
            bundle = self.bundle()
            if mode == 'revision':
                bundle['buildRevision'] = 'c' * 40
                bundle['seal'] = 'sha256:' + hashlib.sha256(prepare.canonical({k: v for k, v in bundle.items() if k != 'seal'}).encode()).hexdigest()
            else: bundle['seal'] = digest('0')
            calls = []; opener = Mock(); opener.open.return_value = response(self.inventory())
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root, self.assertRaises(RuntimeError):
                prepare.prepare(Path(root) / 'input', opener, self.docker(calls, bundle))
            self.assertEqual(calls[-1][1:3], ('rm', '--force'))

    def test_existing_output_is_not_deleted_or_replaced(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'input'; target.mkdir(); (target / 'marker').write_text('keep')
            opener = Mock()
            with self.assertRaisesRegex(RuntimeError, 'refusing to overwrite'): prepare.prepare(target, opener)
            self.assertEqual((target / 'marker').read_text(), 'keep'); opener.open.assert_not_called()


if __name__ == '__main__':
    unittest.main()
