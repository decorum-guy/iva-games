#!/usr/bin/env python3
"""First launch and narrowly scoped image promotion for the Iva Games VPS."""

import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request

CONFIG = Path('/etc/iva-games')
STATE = Path('/var/lib/iva-games/activation')
RUNTIME = Path('/opt/iva-games/deploy')
REPOSITORY = 'decorum-guy/iva-games'
DOMAINS = ('iva-games.pro', 'chess.iva-games.pro')
RESOLVERS = ('1.1.1.1', '8.8.8.8')
SERVICES = ('chess', 'platform')
HEALTH = (
    ('iva-games.pro', '/health/ready', 'service', 'iva-platform'),
    ('chess.iva-games.pro', '/api/health', 'protocol', 'remorse-online-v1'),
    ('chess.iva-games.pro', '/api/overdrive/health', 'protocol', 'overdrive-online-v2'),
)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')


def load(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def save(path, data):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as file:
        tmp = Path(file.name)
        try:
            json.dump(data, file, indent=2, sort_keys=True)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
            os.replace(tmp, path)
            directory = os.open(path.parent, os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            tmp.unlink(missing_ok=True)


def command(*args, timeout=30, env=None, data=None):
    try:
        return subprocess.run(
            args, input=data, capture_output=True, text=True, check=True, timeout=timeout, env=env,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError) as error:
        # Docker output or exception arguments may contain private configuration.
        raise RuntimeError(f'{Path(args[0]).name} {args[1] if len(args) > 1 else ""} failed') from error


def get_json(url, timeout=6):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'iva-games-release', 'Accept': 'application/json', 'Cache-Control': 'no-cache',
    })
    with OPENER.open(request, timeout=timeout) as response:
        if response.url != url or not response.headers.get_content_type().endswith('json'):
            raise RuntimeError('Unexpected health or GitHub response')
        return json.load(response)


def write_state(status, reason, dns=None, release=None):
    path = STATE / 'state.json'
    previous = load(path, {})
    record = {
        'status': status, 'reason': reason, 'dns': dns or previous.get('dns', {}),
        'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    if release:
        record['release'] = release
    save(path, record)
    if (status, reason) != (previous.get('status'), previous.get('reason')):
        print(f'{status} {reason}', flush=True)


def dns_records(resolver, domain, kind):
    result = command('dig', f'@{resolver}', domain, kind, '+time=2', '+tries=1',
                     '+noall', '+comments', '+answer', timeout=3)
    if not re.search(r'\bstatus: NOERROR,', result):
        raise RuntimeError('DNS resolution failed')
    answers = {}
    for line in result.splitlines():
        if line and not line.startswith(';'):
            name, _, scope, type_, value = line.split(maxsplit=4)
            if scope == 'IN':
                answers.setdefault((name.lower(), type_), set()).add(value.lower())
    # Follow only the answer chain from the queried name.
    name = domain + '.'
    visited = set()
    while aliases := answers.get((name, 'CNAME')):
        if name in visited or len(aliases) != 1 or answers.get((name, kind)):
            raise RuntimeError('Ambiguous DNS alias')
        visited.add(name)
        name = next(iter(aliases))
    return {str(ipaddress.ip_address(ip)) for ip in answers.get((name, kind), set())}


def dns_sample(expected_ipv4):
    addresses = json.loads(command('ip', '-j', '-6', 'addr', 'show', 'scope', 'global'))
    ipv6 = {
        str(ipaddress.IPv6Address(address['local']))
        for interface in addresses if 'UP' in interface['flags']
        for address in interface['addr_info']
        if not address.get('tentative') and not address.get('dadfailed')
        and ipaddress.IPv6Address(address['local']).is_global
    }
    if ipv6 and not json.loads(command('ip', '-j', '-6', 'route', 'show', 'default')):
        ipv6.clear()
    report = {}
    signature = {}
    for domain in DOMAINS:
        result = []
        report[domain] = {}
        for resolver in RESOLVERS:
            try:
                a = dns_records(resolver, domain, 'A')
                aaaa = dns_records(resolver, domain, 'AAAA')
                report[domain][resolver] = {'A': sorted(a), 'AAAA': sorted(aaaa)}
                if a == {expected_ipv4} and aaaa.issubset(ipv6):
                    result.append(sorted(aaaa))
            except (RuntimeError, ValueError):
                report[domain][resolver] = {'error': 'incomplete DNS response'}
        if len(result) == len(RESOLVERS) and result[0] == result[1]:
            signature[domain] = result[0]
    return report, signature if len(signature) == len(DOMAINS) else None


def dns_readiness(expected_ipv4):
    path = STATE / 'dns.json'
    previous = load(path, {})
    report, sample = dns_sample(expected_ipv4)
    # A changed CNAME with the same terminal addresses is equivalent for routing.
    count = min(2, 1 + previous.get('consecutive', 0)) if (
        sample and sample == previous.get('signature')
    ) else int(bool(sample))
    save(path, {'signature': sample, 'consecutive': count})
    return {'consecutive': count, 'answers': report}


def platform_environment(path=None):
    values = {}
    for line in (path or CONFIG / 'platform.env').read_text().splitlines():
        if line and not line.startswith('#'):
            key, _, value = line.partition('=')
            if key in values:
                raise ValueError('Duplicate platform setting')
            values[key] = value
    return values


def mail_verification_settings():
    values = platform_environment()
    if values.get('MAIL_MODE') == 'disabled':
        return None
    if values.get('MAIL_MODE', 'smtp') != 'smtp':
        raise ValueError('Invalid production mail mode')
    host = values.get('SMTP_HOST', '')
    sender = values.get('SMTP_FROM', '')
    user = values.get('SMTP_USER', '')
    password = values.get('SMTP_PASSWORD', '')
    secure = values.get('SMTP_SECURE', 'true')
    port = int(values.get('SMTP_PORT') or (465 if secure == 'true' else 587))
    if (
        not host or host.lower().rstrip('.').endswith('.invalid')
        or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', sender)
        or sender.lower().endswith('.invalid') or bool(user) != bool(password)
        or secure not in ('true', 'false') or not 0 < port < 65536
        or values.get('TELEGRAM_ENABLED') != 'false'
    ):
        raise ValueError('SMTP settings or Telegram flag are incomplete')
    return host, port, secure == 'true', user, password


def verify_smtp(settings):
    host, port, secure, user, password = settings
    context = ssl.create_default_context()
    if secure:
        server = smtplib.SMTP_SSL(host, port, timeout=6, context=context)
    else:
        server = smtplib.SMTP(host, port, timeout=6)
    with server:
        if not secure:
            server.starttls(context=context)
        server.ehlo_or_helo_if_needed()
        if user:
            server.login(user, password)


def release_env(release):
    return {**os.environ, **{f'{name.upper()}_IMAGE': info['image']
                              for name, info in release['services'].items()}}


def compose(release, *args, timeout=30):
    return command(str(RUNTIME / 'compose.sh'), *args, timeout=timeout, env=release_env(release))


def up(release, *services):
    compose(release, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '75',
            *services, timeout=100)


def public_health():
    try:
        for domain, path, field, expected in HEALTH:
            result = get_json(f'https://{domain}{path}')
            if result.get('ok') is not True or result.get(field) != expected:
                return False
    except (OSError, RuntimeError, ValueError):
        return False
    return True


def running(release, service):
    container = compose(release, 'ps', '--quiet', service)
    return bool(container)


def activate():
    state = load(STATE / 'state.json', {})
    if state.get('status') == 'ACTIVE':
        command('systemctl', 'disable', '--now', 'iva-games-activate.timer')
        return
    cfg = load(CONFIG / 'activation.json')
    dns = dns_readiness(cfg['ipv4'])
    release = load(CONFIG / 'pins.json', {})
    try:
        settings = mail_verification_settings()
    except (OSError, ValueError):
        write_state('WAITING_CONFIG', 'production SMTP settings are required', dns, release)
        return
    if release.get('sha') != cfg.get('initial_sha') or not release.get('sha'):
        write_state('WAITING_CONFIG', 'pinned initial images are required', dns)
        return
    if dns['consecutive'] < 2:
        write_state('WAITING_DNS', 'both domains must agree twice on both resolvers', dns, release)
        return
    if not running(release, 'caddy'):
        try:
            if settings:
                verify_smtp(settings)
        except (OSError, smtplib.SMTPException):
            write_state('WAITING_CONFIG', 'SMTP TLS connection or authentication failed', dns, release)
            return
        compose(release, 'config', '--quiet')
        up(release, *SERVICES)
        # DNS can change during SMTP, pull-free startup, or database checks.
        report, sample = dns_sample(cfg['ipv4'])
        if sample is None or sample != load(STATE / 'dns.json')['signature']:
            save(STATE / 'dns.json', {'signature': None, 'consecutive': 0})
            write_state('WAITING_DNS', 'DNS changed during readiness check', {'answers': report}, release)
            return
        compose(release, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'caddy', timeout=40)
    write_state('WAITING_TLS', 'Caddy started; waiting for trusted HTTPS on both names', dns, release)
    if public_health():
        write_state('ACTIVE', 'trusted HTTPS and all three health endpoints verified', dns, release)
        command('systemctl', 'disable', '--now', 'iva-games-activate.timer')


def verify_main(sha):
    base = f'https://api.github.com/repos/{REPOSITORY}'
    main = get_json(f'{base}/branches/main')
    if main['commit']['sha'] != sha:
        raise RuntimeError('Requested release is no longer the head of main')
    checks = get_json(
        f'{base}/actions/workflows/iva-platform.yml/runs?branch=main&event=push&head_sha={sha}&status=success'
    )
    if not any(run['head_sha'] == sha and run['conclusion'] == 'success'
               for run in checks['workflow_runs']):
        raise RuntimeError('Successful main CI was not found')


def pull_release(sha, digests, token, previous):
    images = {}
    with tempfile.TemporaryDirectory(prefix='iva-registry-', dir='/run') as directory:
        env = {**os.environ, 'DOCKER_CONFIG': directory}
        command('docker', 'login', 'ghcr.io', '-u', 'decorum-guy', '--password-stdin',
                env=env, data=token + '\n')
        for service, digest in zip(SERVICES, digests, strict=True):
            repository = f'ghcr.io/{REPOSITORY}-{service}'
            image = f'{repository}@{digest}'
            tag = f'{repository}:{sha}'
            reported = command('docker', 'buildx', 'imagetools', 'inspect', '--format',
                               '{{json .Manifest}}', tag, env=env)
            if json.loads(reported)['digest'] != digest:
                raise RuntimeError('Registry digest does not match the commit tag')
            metadata = json.loads(command('docker', 'buildx', 'imagetools', 'inspect', '--format',
                                          '{{json .Image}}', image, env=env))
            fields = (metadata.get('config') or metadata.get('linux/amd64', {}).get('config', {})).get('Labels', {})
            if fields.get('org.opencontainers.image.revision') != sha or (
                fields.get('org.opencontainers.image.source') != f'https://github.com/{REPOSITORY}'
            ):
                raise RuntimeError('Image revision does not match')
            fingerprint = fields['org.iva-games.inputs']
            compatibility = fields['org.iva-games.compatibility']
            if not re.fullmatch('[0-9a-f]{64}', fingerprint) or not re.fullmatch('[0-9a-f]{64}', compatibility):
                raise RuntimeError('Missing build input or compatibility fingerprint')
            existing = previous.get('services', {}).get(service)
            if existing and existing['inputs'] == fingerprint:
                try:
                    command('docker', 'image', 'inspect', existing['image'], '--format', '{{.Id}}')
                except RuntimeError:
                    pass  # Redownload by the new digest if the old image was pruned.
                else:
                    images[service] = existing
                    continue
            command('docker', 'pull', image, env=env, timeout=180)
            images[service] = {'image': image, 'sha': sha, 'inputs': fingerprint, 'compatibility': compatibility}
    return {'sha': sha, 'services': images}


def promote(candidate, previous):
    path = CONFIG / 'pins.json'
    changed = [name for name in SERVICES
               if candidate['services'][name]['image'] != previous['services'][name]['image']]
    # Capture both databases for each changed service before replacing anything.
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    for service in changed:
        command(str(RUNTIME / 'backup.sh'), service,
                f'/srv/iva-games-backups/{stamp}-{candidate["sha"][:12]}-{service}',
                timeout=115, env=release_env(previous))
    pending = STATE / 'pending.json'
    save(pending, {'previous': previous, 'candidate': candidate, 'changed': changed})
    try:
        if changed:
            up(candidate, *changed)
        if not public_health():
            raise RuntimeError('Updated HTTPS health failed')
        save(path, candidate)
        write_state('ACTIVE', 'updated release passed HTTPS health', release=candidate)
    except RuntimeError:
        # Incompatible migrations or protocols must be fixed forward. Never
        # replace a live volume with the pre-update snapshot.
        if changed and all(candidate['services'][name]['compatibility']
                           == previous['services'][name]['compatibility'] for name in changed):
            up(previous, *changed)
            if public_health():
                pending.unlink()
        raise
    pending.unlink()


def deploy():
    request = sys.stdin.buffer.readline(512)
    token_line = sys.stdin.buffer.readline(4096)
    if not request.endswith(b'\n') or not token_line.endswith(b'\n'):
        raise RuntimeError('Invalid deploy request')
    fields = request.decode('ascii').split()
    token = token_line.decode('ascii').strip()
    if len(fields) != 3 or not SHA.fullmatch(fields[0]) or not all(
        DIGEST.fullmatch(digest) for digest in fields[1:]
    ) or not re.fullmatch(r'[A-Za-z0-9_.-]+', token):
        raise RuntimeError('Invalid deploy request')
    sha, *digests = fields
    cfg = load(CONFIG / 'activation.json')
    state = load(STATE / 'state.json', {})
    pins = load(CONFIG / 'pins.json', {})
    active = state.get('status') == 'ACTIVE'
    if not active and cfg.get('initial_sha') != sha:
        print('DEFERRED initial activation is gated')
        return
    if (STATE / 'pending.json').exists():
        raise RuntimeError('Previous deployment requires recovery from pending.json')
    if pins.get('sha') == sha:
        print('UNCHANGED release already current')
        return
    verify_main(sha)
    candidate = pull_release(sha, digests, token, pins)
    compose(candidate, 'config', '--quiet')
    verify_main(sha)
    if not active:
        save(CONFIG / 'pins.json', candidate)
        print(f'STAGED {sha}')
    else:
        promote(candidate, pins)
        print(f'DEPLOYED {sha}')


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('activate', 'deploy'):
        return 2
    mode = sys.argv[1]
    with (STATE / 'release.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Release lock busy; retry shortly')
            return 75
        try:
            (activate if mode == 'activate' else deploy)()
        except Exception as error:
            reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
            if mode == 'activate':
                write_state('ERROR', reason, release=load(CONFIG / 'pins.json', {}))
            else:
                save(STATE / 'deploy-error.json', {'reason': reason})
                print(f'ERROR {reason}', file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
