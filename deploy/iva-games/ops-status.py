#!/usr/bin/python3 -I
"""Fixed, bounded, read-only VPS snapshot; no credentials or raw logs leave here.

With no arguments this runs on the VPS. --sanitize-stdin is an unprivileged,
offline second filter for the GitHub runner. Neither mode accepts commands,
paths, service names, URLs or log selectors from its caller.
"""

import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import signal
import ssl
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

SCHEMA = 'iva-games-ops-v1'
MAX_JSON = 32768
MAX_FILE = 32768
MAX_COMMAND = 65536
MAX_EVENTS = 12
MAX_JOURNAL_RECORDS = 40
TOTAL_TIMEOUT = 35
CONFIG = Path('/etc/iva-games')
STATE = Path('/var/lib/iva-games/activation')
UNIT_NAMES = ('docker.service', 'ssh.service', 'ssh.socket', 'fail2ban.service',
              'iva-games-activate.service', 'iva-games-activate.timer')
SERVICES = ('chess', 'platform', 'caddy')
AVAILABILITY = ('present', 'missing', 'invalid', 'unavailable', 'busy')
STATUSES = ('WAITING_CONFIG', 'WAITING_DNS', 'WAITING_TLS', 'ACTIVE', 'ERROR')
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
HEX64 = re.compile(r'[0-9a-f]{64}')
STAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')

# Exact strings from activation.py only. Never return an unfamiliar exception,
# even if it appears to be a harmless message. Values are public machine codes.
REASONS = {
    'production SMTP settings are required': 'configuration_required',
    'pinned initial images are required': 'initial_images_required',
    'both domains must agree twice on both resolvers': 'dns_waiting',
    'SMTP TLS connection or authentication failed': 'smtp_check_failed',
    'DNS changed during readiness check': 'dns_changed',
    'Caddy started; waiting for trusted HTTPS on both names': 'https_waiting',
    'trusted HTTPS and all three health endpoints verified': 'activation_verified',
    'updated release passed HTTPS health': 'release_verified',
    'Requested release is no longer the head of main': 'main_changed',
    'Successful main CI was not found': 'main_ci_missing',
    'Release must contain both image digests': 'digests_missing',
    'Registry digest does not match the commit tag': 'digest_mismatch',
    'Image revision does not match': 'revision_mismatch',
    'Missing build input or compatibility fingerprint': 'fingerprint_missing',
    'Updated HTTPS health failed': 'release_health_failed',
    'Invalid deploy request': 'deploy_request_invalid',
    'Previous deployment requires recovery from pending.json': 'recovery_required',
    'DNS resolution failed': 'dns_lookup_failed',
    'Ambiguous DNS alias': 'dns_alias_invalid',
    'Duplicate platform setting': 'configuration_invalid',
    'Invalid production mail mode': 'configuration_invalid',
    'SMTP settings or Telegram flag are incomplete': 'configuration_invalid',
    'Unexpected health or GitHub response': 'upstream_response_invalid',
    'compose.sh up failed': 'containers_start_failed',
    'compose.sh ps failed': 'containers_query_failed',
    'docker pull failed': 'image_pull_failed',
    'docker buildx failed': 'image_metadata_failed',
    'docker image failed': 'image_query_failed',
    'docker login failed': 'registry_auth_failed',
    'backup.sh chess failed': 'chess_backup_failed',
    'backup.sh platform failed': 'platform_backup_failed',
    'ValueError': 'invalid_data',
    'FileNotFoundError': 'required_file_missing',
    'PermissionError': 'permission_error',
    'TimeoutError': 'timeout',
    'OSError': 'os_error',
}
REASON_CODES = tuple(sorted(set(REASONS.values()) | {'unrecognized'}))
HEALTH_ENDPOINTS = {
    'portal': ('https://iva-games.pro/health/ready', 'service', 'iva-platform'),
    'remorse': ('https://chess.iva-games.pro/api/health', 'protocol', 'remorse-online-v1'),
    'overdrive': ('https://chess.iva-games.pro/api/overdrive/health', 'protocol', 'overdrive-online-v2'),
}
HEALTH_RESULTS = ('ok', 'unexpected', 'http_error', 'transport_error', 'timeout', 'unavailable')
UNIT_ENUMS = {
    'load': ('loaded', 'not-found', 'masked', 'error', 'bad-setting', 'merged', 'stub'),
    'active': ('active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating',
               'maintenance', 'refreshing'),
    'sub': ('running', 'exited', 'dead', 'failed', 'listening', 'waiting', 'start',
            'start-pre', 'start-post', 'stop', 'stop-sigterm', 'stop-sigkill', 'auto-restart'),
    'enabled': ('enabled', 'enabled-runtime', 'linked', 'linked-runtime', 'alias', 'masked',
                'masked-runtime', 'static', 'disabled', 'indirect', 'generated', 'transient'),
}
CONTAINER_STATES = ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead')
CONTAINER_HEALTH = ('healthy', 'unhealthy', 'starting', 'none')
COMMAND_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'HOME': '/nonexistent'}


class UnsafeInput(ValueError):
    """Rejected input; never includes input data in its message."""


class OperationFailed(Exception):
    """Bounded operation failed; caller exports only a fixed status code."""


def object_(value):
    return value if type(value) is dict else {}


def enum(value, choices, default='unknown'):
    return value if type(value) is str and value in choices else default


def integer(value, maximum=(1 << 60)):
    return value if type(value) is int and 0 <= value <= maximum else None


def matched(value, pattern):
    return value if type(value) is str and len(value) <= 128 and pattern.fullmatch(value) else None


def timestamp(value):
    if not matched(value, STAMP):
        return None
    try:
        datetime.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        return None
    return value


def strict_json(raw, limit=MAX_JSON):
    if len(raw) > limit:
        raise UnsafeInput('size')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise UnsafeInput('duplicate')
            result[key] = value
        return result
    def invalid_constant(_value):
        raise UnsafeInput('constant')
    try:
        result = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise UnsafeInput('json') from error
    if type(result) is not dict:
        raise UnsafeInput('object')
    stack = [(result, 0)]
    visited = 0
    while stack:
        item, depth = stack.pop()
        visited += 1
        if depth > 12 or visited > 4096:
            raise UnsafeInput('complexity')
        if type(item) is dict:
            stack.extend((child, depth + 1) for child in item.values())
        elif type(item) is list:
            stack.extend((child, depth + 1) for child in item)
    return result


def bytes_file(path, limit=MAX_FILE):
    # O_NONBLOCK prevents a replaced FIFO/device from trapping the privileged
    # collector. Parent directories belong to root; final symlinks are rejected.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
            raise UnsafeInput('file')
        result = bytearray()
        while len(result) <= limit:
            chunk = os.read(fd, min(4096, limit + 1 - len(result)))
            if not chunk:
                break
            result.extend(chunk)
        if len(result) > limit:
            raise UnsafeInput('size')
        return bytes(result)
    finally:
        os.close(fd)


def json_file(path):
    try:
        return 'present', strict_json(bytes_file(path), MAX_FILE)
    except FileNotFoundError:
        return 'missing', {}
    except (OSError, UnsafeInput):
        return 'invalid', {}


def release_fields(data):
    data = object_(data)
    services = object_(data.get('services'))
    result = {'sha': matched(data.get('sha'), SHA), 'services': {}}
    for service in ('chess', 'platform'):
        item = object_(services.get(service))
        image = item.get('image')
        prefix = f'ghcr.io/decorum-guy/iva-games-{service}@'
        digest = item.get('digest')
        if type(image) is str and image.startswith(prefix):
            digest = image[len(prefix):]
        result['services'][service] = {
            'sha': matched(item.get('sha'), SHA),
            'digest': matched(digest, DIGEST),
            'inputs': matched(item.get('inputs'), HEX64),
            'compatibility': matched(item.get('compatibility'), HEX64),
        }
    return result


def safe_availability(value):
    return enum(object_(value).get('availability'), AVAILABILITY, 'unavailable')


def sanitize_snapshot(data):
    """Rebuild every output field. Unknown keys/strings never pass through."""
    if type(data) is not dict or data.get('schema') != SCHEMA:
        raise UnsafeInput('schema')
    result = {
        'schema': SCHEMA,
        'collected_at': timestamp(data.get('collected_at')),
        'snapshot_status': enum(data.get('snapshot_status'), ('ok', 'partial', 'busy', 'error'), 'error'),
    }
    activation = object_(data.get('activation'))
    result['activation'] = {
        'availability': safe_availability(activation),
        'status': enum(activation.get('status'), STATUSES),
        'reason_code': enum(activation.get('reason_code'), REASON_CODES, 'unrecognized'),
        'checked_at': timestamp(activation.get('checked_at')),
        'dns_consecutive': integer(activation.get('dns_consecutive'), 2),
    }
    pins = object_(data.get('pins'))
    result['pins'] = {'availability': safe_availability(pins), **release_fields(pins)}
    pending = object_(data.get('pending'))
    changed = pending.get('changed')
    result['pending'] = {
        'availability': safe_availability(pending),
        'previous_sha': matched(pending.get('previous_sha'), SHA),
        'candidate_sha': matched(pending.get('candidate_sha'), SHA),
        'changed': [service for service in ('chess', 'platform')
                    if type(changed) is list and service in changed[:2]],
    }
    error = object_(data.get('last_deploy_error'))
    result['last_deploy_error'] = {
        'availability': safe_availability(error),
        'reason_code': enum(error.get('reason_code'), REASON_CODES, 'unrecognized'),
    }
    host = object_(data.get('host'))
    memory = object_(host.get('memory_bytes'))
    filesystems = object_(host.get('filesystems'))
    result['host'] = {
        'uptime_seconds': integer(host.get('uptime_seconds'), 1_000_000_000),
        'memory_bytes': {name: integer(memory.get(name))
                         for name in ('total', 'available', 'swap_total', 'swap_free')},
        'filesystems': {
            name: {field: integer(object_(filesystems.get(name)).get(field))
                   for field in ('total_bytes', 'available_bytes')}
            for name in ('root', 'docker')
        },
    }
    units = object_(data.get('units'))
    result['units'] = {
        name: {field: enum(object_(units.get(name)).get(field), choices)
               for field, choices in UNIT_ENUMS.items()} for name in UNIT_NAMES
    }
    containers = object_(data.get('containers'))
    result['containers'] = {}
    for name in SERVICES:
        item = object_(containers.get(name))
        result['containers'][name] = {
            'availability': safe_availability(item), 'count': integer(item.get('count'), 8),
            'state': enum(item.get('state'), CONTAINER_STATES),
            'health': enum(item.get('health'), CONTAINER_HEALTH),
            'restarts': integer(item.get('restarts'), 1_000_000_000),
            'container_id': matched(item.get('container_id'), HEX64),
            'image_id': matched(item.get('image_id'), DIGEST),
        }
    health = object_(data.get('health'))
    result['health'] = {
        name: enum(health.get(name), HEALTH_RESULTS, 'unavailable') for name in HEALTH_ENDPOINTS
    }
    events = object_(data.get('activation_events'))
    safe_events = []
    entries = events.get('events')
    if type(entries) is list:
        for entry in entries[:MAX_EVENTS]:
            entry = object_(entry)
            at = timestamp(entry.get('at'))
            code = enum(entry.get('code'), (*REASON_CODES, 'release_busy'), None)
            if at and code and code != 'unrecognized':
                safe_events.append({'at': at, 'code': code})
    result['activation_events'] = {
        'availability': safe_availability(events),
        'inspected_records': integer(events.get('inspected_records'), MAX_JOURNAL_RECORDS),
        'omitted_records': integer(events.get('omitted_records'), MAX_JOURNAL_RECORDS),
        'events': safe_events,
    }
    return result


def encode_snapshot(data):
    raw = json.dumps(sanitize_snapshot(data), ensure_ascii=True, allow_nan=False,
                     separators=(',', ':'), sort_keys=True).encode('ascii') + b'\n'
    if len(raw) > MAX_JSON:
        raise UnsafeInput('output_size')
    return raw


def bounded_command(args, timeout=3, limit=MAX_COMMAND):
    """Fixed argv, empty stdin, no inherited secrets, bounded pipe and lifetime."""
    process = None
    try:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env=COMMAND_ENV,
                                   start_new_session=True)
        output = bytearray()
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OperationFailed()
                if not selector.select(remaining):
                    raise OperationFailed()
                chunk = os.read(process.stdout.fileno(), min(4096, limit + 1 - len(output)))
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > limit:
                    raise OperationFailed()
        if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
            raise OperationFailed()
        return bytes(output)
    except (OSError, subprocess.SubprocessError) as error:
        raise OperationFailed() from error
    finally:
        if process is not None:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=1)
            if process.stdout:
                process.stdout.close()


def read_release_state():
    result = {}
    fd = None
    try:
        try:
            fd = os.open(STATE / 'release.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise UnsafeInput('lock')
            fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except FileNotFoundError:
            pass
        except BlockingIOError:
            return {'snapshot_status': 'busy', **{
                name: {'availability': 'busy'} for name in
                ('activation', 'pins', 'pending', 'last_deploy_error')
            }}
        availability, data = json_file(STATE / 'state.json')
        result['activation'] = {
            'availability': availability, 'status': data.get('status'),
            'reason_code': REASONS.get(data.get('reason'), 'unrecognized')
            if type(data.get('reason')) is str else 'unrecognized',
            'checked_at': data.get('checked_at'),
            'dns_consecutive': object_(data.get('dns')).get('consecutive'),
        }
        availability, data = json_file(CONFIG / 'pins.json')
        result['pins'] = {'availability': availability, **release_fields(data)}
        availability, data = json_file(STATE / 'pending.json')
        result['pending'] = {
            'availability': availability,
            'previous_sha': object_(data.get('previous')).get('sha'),
            'candidate_sha': object_(data.get('candidate')).get('sha'),
            'changed': data.get('changed'),
        }
        availability, data = json_file(STATE / 'deploy-error.json')
        result['last_deploy_error'] = {
            'availability': availability,
            'reason_code': REASONS.get(data.get('reason'), 'unrecognized')
            if type(data.get('reason')) is str else 'unrecognized',
        }
        return result
    except (OSError, UnsafeInput):
        return {'snapshot_status': 'partial'}
    finally:
        if fd is not None:
            os.close(fd)


def host_status():
    result = {'memory_bytes': {}, 'filesystems': {}}
    try:
        content = bytes_file('/proc/meminfo', 8192).decode('ascii')
        fields = {'MemTotal': 'total', 'MemAvailable': 'available',
                  'SwapTotal': 'swap_total', 'SwapFree': 'swap_free'}
        for line in content.splitlines():
            match = re.fullmatch(r'(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d{1,15}) kB', line)
            if match:
                result['memory_bytes'][fields[match[1]]] = int(match[2]) * 1024
        uptime = bytes_file('/proc/uptime', 128).decode('ascii').split()[0]
        if re.fullmatch(r'\d{1,10}\.\d{1,2}', uptime):
            result['uptime_seconds'] = int(uptime.split('.')[0])
    except (OSError, UnsafeInput, UnicodeError, IndexError):
        pass
    for name, path in (('root', '/'), ('docker', '/var/lib/docker')):
        try:
            info = os.statvfs(path)
            result['filesystems'][name] = {
                'total_bytes': info.f_blocks * info.f_frsize,
                'available_bytes': info.f_bavail * info.f_frsize,
            }
        except OSError:
            pass
    return result


def unit_status():
    try:
        raw = bounded_command(('/usr/bin/systemctl', 'show', '--no-pager',
                               '--property=Id,LoadState,ActiveState,SubState,UnitFileState',
                               *UNIT_NAMES), limit=8192).decode('utf-8')
        result = {}
        fields = {'LoadState': 'load', 'ActiveState': 'active',
                  'SubState': 'sub', 'UnitFileState': 'enabled'}
        for block in raw.split('\n\n'):
            values = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
            if values.get('Id') in UNIT_NAMES:
                result[values['Id']] = {target: values.get(source) for source, target in fields.items()}
        return result
    except (OperationFailed, UnicodeError):
        return {}


def container_status():
    result = {}
    # A format template selects fields at the Docker daemon. Environment,
    # mounts, labels, healthcheck output and logs are never requested.
    template = ('{"state":{{json .State.Status}},"health":'
                '{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},'
                '"restarts":{{json .RestartCount}},"image_id":{{json .Image}}}')
    for service in SERVICES:
        try:
            raw = bounded_command(('/usr/bin/docker', 'ps', '--all', '--quiet', '--no-trunc',
                                   '--filter', 'label=com.docker.compose.project=iva-games',
                                   '--filter', f'label=com.docker.compose.service={service}'),
                                  timeout=2, limit=1024).decode('ascii')
            ids = raw.splitlines()
            if len(ids) > 8 or any(not HEX64.fullmatch(identifier) for identifier in ids):
                raise OperationFailed()
            result[service] = {'availability': 'present' if ids else 'missing', 'count': len(ids)}
            # More than one container means an ambiguous/stale service. Report
            # the count, not an arbitrary choice that could conceal the issue.
            if len(ids) == 1:
                result[service]['container_id'] = ids[0]
                data = strict_json(bounded_command(('/usr/bin/docker', 'inspect', '--type=container',
                                                   '--format', template, ids[0]), timeout=2, limit=2048))
                result[service].update({key: data.get(key) for key in
                                        ('state', 'health', 'restarts', 'image_id')})
        except (OperationFailed, UnsafeInput, UnicodeError):
            result[service] = {'availability': 'unavailable'}
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def public_health():
    # Explicitly ignore HTTP(S)_PROXY and never follow a Location header.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    result = {}
    for name, (url, field, expected) in HEALTH_ENDPOINTS.items():
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'iva-games-ops/1',
                                                          'Accept': 'application/json'})
            with opener.open(request, timeout=2) as response:
                if response.url != url or response.status != 200:
                    result[name] = 'unexpected'
                    continue
                data = strict_json(response.read(4097), 4096)
                result[name] = 'ok' if data.get('ok') is True and data.get(field) == expected else 'unexpected'
        except urllib.error.HTTPError:
            result[name] = 'http_error'
        except TimeoutError:
            result[name] = 'timeout'
        except (OSError, urllib.error.URLError):
            result[name] = 'transport_error'
        except UnsafeInput:
            result[name] = 'unexpected'
    return result


def activation_events():
    try:
        raw = bounded_command(('/usr/bin/journalctl', '--unit=iva-games-activate.service',
                               '--since=-24h', f'--lines={MAX_JOURNAL_RECORDS}', '--output=json',
                               '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager', '--quiet'),
                              timeout=2, limit=MAX_COMMAND)
        lines = raw.splitlines()
        if len(lines) > MAX_JOURNAL_RECORDS:
            raise OperationFailed()
        events = []
        omitted = 0
        for line in lines:
            try:
                row = strict_json(line, 4096)
                message = row.get('MESSAGE')
                micros = row.get('__REALTIME_TIMESTAMP')
                if type(message) is not str or type(micros) is not str or not re.fullmatch(r'\d{1,17}', micros):
                    raise UnsafeInput('event')
                code = None
                if message == 'Release lock busy; retry shortly':
                    code = 'release_busy'
                else:
                    status, _, reason = message.partition(' ')
                    if status in STATUSES:
                        code = REASONS.get(reason)
                if code is None:
                    raise UnsafeInput('message')
                at = datetime.datetime.fromtimestamp(int(micros) / 1_000_000,
                                                      datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                events.append({'at': at, 'code': code})
            except (UnsafeInput, ValueError, OverflowError):
                omitted += 1
        return {'availability': 'present', 'inspected_records': len(lines),
                'omitted_records': omitted, 'events': events[-MAX_EVENTS:]}
    except OperationFailed:
        return {'availability': 'unavailable'}


def collect_snapshot():
    result = {'schema': SCHEMA, 'snapshot_status': 'ok',
              'collected_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    result.update(read_release_state())
    result['host'] = host_status()
    result['units'] = unit_status()
    result['containers'] = container_status()
    result['health'] = public_health()
    result['activation_events'] = activation_events()
    if result['snapshot_status'] == 'ok' and (
        result.get('activation', {}).get('availability') != 'present'
        or result.get('pins', {}).get('availability') != 'present'
        or not result['units']
        or any(item.get('availability') == 'unavailable' for item in result['containers'].values())
        or result['activation_events'].get('availability') != 'present'
    ):
        result['snapshot_status'] = 'partial'
    return sanitize_snapshot(result)


def deadline(_signum, _frame):
    raise TimeoutError()


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args not in ([], ['--sanitize-stdin']):
        print('Unsupported snapshot arguments.', file=sys.stderr)
        return 2
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(TOTAL_TIMEOUT)
    try:
        if args:
            # This branch intentionally never calls collect_snapshot, network,
            # subprocess or server-file readers. It runs without sudo in CI.
            data = strict_json(sys.stdin.buffer.read(MAX_JSON + 1))
        else:
            if os.geteuid() != 0 or os.environ.get('SSH_ORIGINAL_COMMAND'):
                print('Snapshot must use the installed no-command SSH entry point.', file=sys.stderr)
                return 2
            data = collect_snapshot()
        sys.stdout.buffer.write(encode_snapshot(data))
        return 0
    except Exception:
        # No traceback: errors can retain sensitive captured input in locals.
        print('Snapshot unavailable or invalid.', file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    raise SystemExit(main())
