"""Security and failure-boundary tests. No real server, Docker or network calls."""

import contextlib
import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error


DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ops_status', DIRECTORY / 'ops-status.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
SECRET = 'PRIVATE-FIXTURE-DO-NOT-EXPORT'
VERSION = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
CONTAINER = 'c' * 64
AT = '2026-11-26T18:20:03Z'


def release():
    return {'sha': VERSION, 'services': {
        name: {'sha': VERSION, 'image': f'ghcr.io/decorum-guy/iva-games-{name}@{DIGEST}',
               'inputs': 'd' * 64, 'compatibility': 'e' * 64}
        for name in ('chess', 'platform')
    }}


def snapshot():
    return {'schema': ops.SCHEMA, 'collected_at': AT, 'snapshot_status': 'ok',
            'activation': {'availability': 'present', 'status': 'ACTIVE',
                           'reason_code': 'activation_verified', 'checked_at': AT, 'dns_consecutive': 2},
            'pins': {'availability': 'present', **release()},
            'pending': {'availability': 'missing'},
            'last_deploy_error': {'availability': 'missing'},
            'host': {'uptime_seconds': 123, 'memory_bytes': {'total': 4096, 'available': 2048},
                     'filesystems': {'root': {'total_bytes': 8192, 'available_bytes': 4096}}},
            'units': {'docker.service': {'load': 'loaded', 'active': 'active',
                                         'sub': 'running', 'enabled': 'enabled'}},
            'containers': {'platform': {'availability': 'present', 'count': 1,
                                         'container_id': CONTAINER, 'image_id': DIGEST,
                                         'state': 'running', 'health': 'none', 'restarts': 0}},
            'health': {name: 'ok' for name in ops.HEALTH_ENDPOINTS},
            'activation_events': {'availability': 'present', 'inspected_records': 1,
                                  'omitted_records': 0,
                                  'events': [{'at': AT, 'code': 'activation_verified'}]}}


class SanitizerTest(unittest.TestCase):
    def test_preserves_evidence_and_is_idempotent(self):
        safe = ops.sanitize_snapshot(snapshot())
        self.assertEqual(safe['pins']['services']['chess']['digest'], DIGEST)
        self.assertEqual(safe['containers']['platform']['container_id'], CONTAINER)
        self.assertEqual(safe['containers']['platform']['image_id'], DIGEST)
        self.assertEqual(safe['activation']['status'], 'ACTIVE')
        self.assertEqual(safe['activation_events']['events'][0]['code'], 'activation_verified')
        self.assertEqual(safe, ops.sanitize_snapshot(safe))

    def test_recursively_discards_unknown_fields_and_raw_strings(self):
        payload = snapshot()
        def contaminate(value):
            if type(value) is dict:
                for child in list(value.values()):
                    contaminate(child)
                value[SECRET] = SECRET
                value['environment'] = {'BOT_TOKEN': SECRET}
            elif type(value) is list:
                for child in value:
                    contaminate(child)
        contaminate(payload)
        payload['activation']['reason'] = SECRET
        payload['last_deploy_error'] = {'availability': 'present', 'reason_code': SECRET, 'reason': SECRET}
        payload['units']['sshd-injected.service'] = SECRET
        payload['health']['arbitrary-host'] = SECRET
        payload['containers']['platform']['labels'] = SECRET
        output = ops.encode_snapshot(payload)
        self.assertNotIn(SECRET.encode(), output)
        self.assertNotIn(b'environment', output)
        self.assertNotIn(b'labels', output)
        self.assertEqual(json.loads(output)['last_deploy_error']['reason_code'], 'unrecognized')

    def test_invalid_enum_numeric_timestamp_and_identifier_values_are_not_exported(self):
        payload = snapshot()
        payload['collected_at'] = '2026-99-99T99:99:99Z'
        payload['snapshot_status'] = '::error::' + SECRET
        payload['pins']['sha'] = VERSION + '\n' + SECRET
        payload['pins']['services']['platform']['image'] = 'file:///etc/iva-games/platform.env'
        payload['pins']['services']['chess']['inputs'] = {'token': SECRET}
        payload['activation']['dns_consecutive'] = True
        payload['host']['uptime_seconds'] = -1
        payload['host']['memory_bytes']['available'] = 1 << 100
        payload['containers']['platform']['state'] = SECRET
        payload['containers']['platform']['container_id'] = ';cat /etc/shadow'
        safe = ops.sanitize_snapshot(payload)
        self.assertIsNone(safe['collected_at'])
        self.assertEqual(safe['snapshot_status'], 'error')
        self.assertIsNone(safe['pins']['sha'])
        self.assertIsNone(safe['pins']['services']['platform']['digest'])
        self.assertIsNone(safe['pins']['services']['chess']['inputs'])
        self.assertIsNone(safe['activation']['dns_consecutive'])
        self.assertIsNone(safe['host']['uptime_seconds'])
        self.assertIsNone(safe['host']['memory_bytes']['available'])
        self.assertIsNone(safe['containers']['platform']['container_id'])
        self.assertNotIn(SECRET, json.dumps(safe))

    def test_every_incorrect_field_type_is_handled_without_leak(self):
        for field in snapshot():
            if field == 'schema':
                continue
            for wrong in (None, True, 123, SECRET, [SECRET], {'token': SECRET}):
                with self.subTest(field=field, wrong=type(wrong).__name__):
                    payload = snapshot()
                    payload[field] = wrong
                    self.assertNotIn(SECRET.encode(), ops.encode_snapshot(payload))

    def test_pending_uses_only_two_fixed_services(self):
        payload = snapshot()
        payload['pending'] = {'availability': 'present', 'previous_sha': VERSION,
                              'candidate_sha': 'f' * 40, 'changed': ['platform', SECRET, 'chess']}
        safe = ops.sanitize_snapshot(payload)['pending']
        self.assertEqual(safe['changed'], ['platform'])
        self.assertEqual(safe['candidate_sha'], 'f' * 40)

    def test_caps_event_count_and_serialized_output(self):
        payload = snapshot()
        payload['activation_events']['events'] *= 1000
        output = ops.encode_snapshot(payload)
        self.assertLessEqual(len(output), ops.MAX_JSON)
        self.assertEqual(len(json.loads(output)['activation_events']['events']), ops.MAX_EVENTS)

    def test_actions_control_strings_cannot_escape_into_output(self):
        payload = snapshot()
        injection = '::add-mask::secret\n::error::TOKEN\r\x1b[31m'
        payload['activation']['reason_code'] = injection
        payload['activation_events']['events'].append({'at': AT, 'code': injection})
        payload['pins']['sha'] = injection
        output = ops.encode_snapshot(payload)
        self.assertEqual(output.count(b'\n'), 1)
        self.assertNotIn(b'::', output)
        self.assertNotIn(b'\x1b', output)

    def test_strict_json_rejects_duplicates_nonfinite_nonobjects_and_oversize(self):
        cases = [b'{"schema":1,"schema":2}', b'{"value":NaN}', b'{"value":Infinity}',
                 b'[]', b'null', b'"private"', b'\xff', b'{' + b' ' * ops.MAX_JSON + b'}',
                 b'{"x":' + b'[' * 2000 + b'0' + b']' * 2000 + b'}']
        for raw in cases:
            with self.subTest(raw=raw[:30]), self.assertRaises(ops.UnsafeInput):
                ops.strict_json(raw)
        with self.assertRaises(ops.UnsafeInput):
            ops.sanitize_snapshot({'schema': SECRET})


class FileAndStateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = self.root / 'config'
        self.state = self.root / 'state'
        self.config.mkdir()
        self.state.mkdir()
        self.config_patch = patch.object(ops, 'CONFIG', self.config)
        self.state_patch = patch.object(ops, 'STATE', self.state)
        self.config_patch.start()
        self.state_patch.start()

    def tearDown(self):
        self.state_patch.stop()
        self.config_patch.stop()
        self.temp.cleanup()

    def write(self, path, value):
        path.write_text(json.dumps(value))

    def test_reads_only_allowed_state_fields_without_writing(self):
        self.write(self.config / 'pins.json', release())
        self.write(self.state / 'state.json', {'status': 'ACTIVE', 'checked_at': AT,
                    'reason': 'trusted HTTPS and all three health endpoints verified',
                    'dns': {'consecutive': 2, 'answers': SECRET}, 'private': SECRET})
        self.write(self.state / 'pending.json', {'previous': release(), 'candidate': release(),
                                                'changed': ['chess', 'platform'], 'private': SECRET})
        self.write(self.state / 'deploy-error.json', {'reason': SECRET})
        self.write(self.config / 'platform.env', {'BOT_TOKEN': SECRET})
        before = {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        with patch.object(ops, 'bytes_file', wraps=ops.bytes_file) as reads:
            data = ops.read_release_state()
        after = {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual({call.args[0].name for call in reads.call_args_list},
                         {'pins.json', 'state.json', 'pending.json', 'deploy-error.json'})
        self.assertEqual(data['activation']['reason_code'], 'activation_verified')
        self.assertEqual(data['last_deploy_error']['reason_code'], 'unrecognized')
        self.assertNotIn(SECRET, json.dumps(data))
        self.assertFalse((self.state / 'release.lock').exists())

    def test_deploy_lock_is_nonblocking_and_not_created_or_modified(self):
        lock = self.state / 'release.lock'
        lock.write_bytes(b'')
        with lock.open('rb') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(ops, 'json_file') as read:
                data = ops.read_release_state()
            self.assertEqual(data['snapshot_status'], 'busy')
            read.assert_not_called()
        self.assertEqual(lock.read_bytes(), b'')

    def test_missing_malformed_and_oversized_files_are_reported_without_contents(self):
        self.assertEqual(ops.json_file(self.state / 'state.json'), ('missing', {}))
        for content in (b'{"token":', b'{"token":1,"token":2}', SECRET.encode() * 5000):
            (self.state / 'state.json').write_bytes(content)
            self.assertEqual(ops.json_file(self.state / 'state.json'), ('invalid', {}))

    def test_symlinks_and_fifo_are_rejected_without_reading_target_or_blocking(self):
        target = self.root / 'secret'
        target.write_text(SECRET)
        link = self.state / 'state.json'
        link.symlink_to(target)
        self.assertEqual(ops.json_file(link), ('invalid', {}))
        link.unlink()
        os.mkfifo(link)
        started = time.monotonic()
        self.assertEqual(ops.json_file(link), ('invalid', {}))
        self.assertLess(time.monotonic() - started, 1)


class CollectorTest(unittest.TestCase):
    def test_command_has_bounded_output_timeout_and_no_inherited_secrets(self):
        with patch.dict(os.environ, {'OPS_TEST_TOKEN': SECRET}):
            output = ops.bounded_command((sys.executable, '-I', '-c',
                                          'import os; print(os.getenv("OPS_TEST_TOKEN", "clean"))'))
        self.assertEqual(output, b'clean\n')
        with self.assertRaises(ops.OperationFailed):
            ops.bounded_command((sys.executable, '-I', '-c', 'print("x"*10000)'), limit=100)
        started = time.monotonic()
        with self.assertRaises(ops.OperationFailed):
            ops.bounded_command((sys.executable, '-I', '-c', 'import time; time.sleep(30)'), timeout=0.1)
        self.assertLess(time.monotonic() - started, 2)

    def test_failed_command_does_not_return_stderr(self):
        with self.assertRaises(ops.OperationFailed) as error:
            ops.bounded_command((sys.executable, '-I', '-c',
                                 'import sys; sys.stderr.write("' + SECRET + '"); sys.exit(1)'))
        self.assertNotIn(SECRET, str(error.exception))

    def test_container_queries_select_only_metadata_and_validate_ids(self):
        def command(args, **options):
            self.assertEqual(args[0], '/usr/bin/docker')
            self.assertLessEqual(options['timeout'], 2)
            if args[1] == 'ps':
                self.assertIn('label=com.docker.compose.project=iva-games', args)
                return (CONTAINER + '\n').encode()
            self.assertEqual(args[1:3], ('inspect', '--type=container'))
            self.assertIn('--format', args)
            template = args[args.index('--format') + 1]
            self.assertNotIn('.Config', template)
            self.assertNotIn('.Log', template)
            self.assertEqual(args[-1], CONTAINER)
            return json.dumps({'state': 'running', 'health': 'healthy', 'restarts': 2,
                               'image_id': DIGEST, 'private': SECRET}).encode()
        with patch.object(ops, 'bounded_command', side_effect=command) as calls:
            data = ops.container_status()
        self.assertEqual(calls.call_count, 6)
        self.assertEqual(data['chess']['container_id'], CONTAINER)
        self.assertNotIn(SECRET, json.dumps(data))
        with patch.object(ops, 'bounded_command', return_value=b';cat /etc/shadow\n') as calls:
            data = ops.container_status()
        self.assertEqual(calls.call_count, 3)
        self.assertEqual(data['chess']['availability'], 'unavailable')

    def test_multiple_containers_are_not_silently_treated_as_one(self):
        with patch.object(ops, 'bounded_command', return_value=((CONTAINER + '\n') * 2).encode()) as calls:
            data = ops.container_status()
        self.assertEqual(calls.call_count, 3)
        self.assertEqual(data['chess']['count'], 2)
        self.assertNotIn('container_id', data['chess'])

    def test_journal_returns_only_known_messages_and_bounded_timestamps(self):
        rows = [
            {'__REALTIME_TIMESTAMP': '1795717203000000',
             'MESSAGE': 'ACTIVE trusted HTTPS and all three health endpoints verified', 'private': SECRET},
            {'__REALTIME_TIMESTAMP': '1795717204000000', 'MESSAGE': 'ERROR ' + SECRET},
            {'__REALTIME_TIMESTAMP': '1795717205000000', 'MESSAGE': 'Release lock busy; retry shortly'},
            {'__REALTIME_TIMESTAMP': '1795717206000000', 'MESSAGE': '::add-mask::' + SECRET},
        ]
        with patch.object(ops, 'bounded_command', return_value=b'\n'.join(json.dumps(r).encode() for r in rows)) as call:
            data = ops.activation_events()
        self.assertIn('--unit=iva-games-activate.service', call.call_args.args[0])
        self.assertIn('--lines=40', call.call_args.args[0])
        self.assertEqual(data['inspected_records'], 4)
        self.assertEqual(data['omitted_records'], 2)
        self.assertEqual([row['code'] for row in data['events']], ['activation_verified', 'release_busy'])
        self.assertNotIn(SECRET, json.dumps(data))
        self.assertNotIn('MESSAGE', json.dumps(data))

    def test_journal_limit_rejects_excess_records(self):
        with patch.object(ops, 'bounded_command', return_value=b'{}\n' * 41):
            self.assertEqual(ops.activation_events(), {'availability': 'unavailable'})

    def test_health_checks_only_fixed_urls_and_never_export_payload(self):
        class Response:
            def __init__(self, request):
                self.url = request.full_url
                self.status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, limit):
                self_test.assertEqual(limit, 4097)
                item = next(item for item in ops.HEALTH_ENDPOINTS.values() if item[0] == self.url)
                return json.dumps({'ok': True, item[1]: item[2], 'token': SECRET}).encode()
        class Opener:
            def open(self, request, timeout):
                self_test.assertEqual(timeout, 2)
                self_test.assertIn(request.full_url, [item[0] for item in ops.HEALTH_ENDPOINTS.values()])
                self_test.assertNotIn('/session', request.full_url)
                return Response(request)
        self_test = self
        with patch.object(ops.urllib.request, 'build_opener', return_value=Opener()) as build:
            result = ops.public_health()
        self.assertEqual(set(result.values()), {'ok'})
        self.assertTrue(any(isinstance(arg, ops.NoRedirect) for arg in build.call_args.args))
        proxies = next(arg for arg in build.call_args.args if isinstance(arg, ops.urllib.request.ProxyHandler))
        self.assertEqual(proxies.proxies, {})
        self.assertIsNone(ops.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.invalid'))

    def test_health_errors_do_not_export_exception_or_body(self):
        class Opener:
            def open(self, *_args, **_kwargs):
                raise urllib.error.URLError(SECRET)
        with patch.object(ops.urllib.request, 'build_opener', return_value=Opener()):
            self.assertEqual(set(ops.public_health().values()), {'transport_error'})


class CommandLineTest(unittest.TestCase):
    def cli(self, args, raw=b''):
        return subprocess.run([sys.executable, '-I', str(DIRECTORY / 'ops-status.py'), *args],
                              input=raw, capture_output=True, timeout=5)

    def test_offline_filter_runs_without_server_access_and_discards_unknown_fields(self):
        payload = snapshot()
        payload['token'] = SECRET
        result = self.cli(['--sanitize-stdin'], json.dumps(payload).encode())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['schema'], ops.SCHEMA)
        self.assertNotIn(SECRET.encode(), result.stdout + result.stderr)

    def test_filter_does_not_collect_and_unknown_arguments_are_rejected(self):
        for args in (['status'], ['--sanitize-stdin', '/etc/shadow'], ['--file', SECRET]):
            result = self.cli(args)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, b'')
            self.assertNotIn(SECRET.encode(), result.stderr)
        with patch.object(ops, 'collect_snapshot') as collect:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(ops.main(['--unknown']), 2)
            collect.assert_not_called()

    def test_invalid_filter_input_has_no_echo_or_traceback(self):
        for raw in (SECRET.encode(), b'{"schema":' + SECRET.encode(), b'x' * (ops.MAX_JSON + 1)):
            result = self.cli(['--sanitize-stdin'], raw)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, b'')
            self.assertNotIn(SECRET.encode(), result.stderr)
            self.assertNotIn(b'Traceback', result.stderr)

    def test_wrapper_rejects_command_and_args_before_sudo(self):
        wrapper = str(DIRECTORY / 'ops-status')
        for args, command in ((['status'], ''), ([], 'cat /etc/shadow'), ([], 'sftp'),
                               ([], 'env BOT_TOKEN=' + SECRET)):
            environment = {**os.environ, 'SSH_ORIGINAL_COMMAND': command}
            result = subprocess.run(['/bin/sh', wrapper, *args], env=environment,
                                    input=SECRET.encode(), capture_output=True, timeout=2)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, b'')
            self.assertNotIn(SECRET.encode(), result.stderr)

    def test_installer_has_exact_sudo_noargs_and_no_existing_deploy_mutation(self):
        policy = (DIRECTORY / 'iva-ops.sudoers').read_text()
        self.assertIn('/opt/iva-games/ops/ops-status.py ""', policy)
        self.assertNotIn('NOPASSWD: ALL', policy)
        installer = (DIRECTORY / 'install-ops.sh').read_text()
        self.assertIn("'\\nMatch all\\nInclude '", installer)
        self.assertIn('ForceCommand /opt/iva-games/ops/ops-status', installer)
        self.assertNotIn('usermod', installer)
        self.assertNotIn('systemctl restart', installer)


if __name__ == '__main__':
    unittest.main(verbosity=2)
