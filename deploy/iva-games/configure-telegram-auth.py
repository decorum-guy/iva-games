#!/usr/bin/env python3
"""Privileged VPS helper. Read public bot identity and a webhook secret on stdin."""

import base64
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile

import activation


def write_env(path, text):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as output:
        destination = Path(output.name)
        try:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
            os.replace(destination, path)
        finally:
            destination.unlink(missing_ok=True)


def configure():
    if os.geteuid() != 0:
        raise RuntimeError('Run the VPS helper with sudo.')
    request = json.loads(sys.stdin.buffer.read(4096))
    bot_id, username, secret = (request[k] for k in ('bot_id', 'username', 'secret'))
    if not all(isinstance(value, str) for value in (bot_id, username, secret)) or (
        not re.fullmatch(r'[1-9]\d{3,18}', bot_id)
        or not re.fullmatch('[A-Za-z0-9_]{5,32}', username)
        or not re.fullmatch('[A-Za-z0-9_-]{32,256}', secret)
    ):
        raise RuntimeError('Invalid bot configuration.')
    with (activation.STATE / 'release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (activation.STATE / 'pending.json').exists():
            raise RuntimeError('Resolve the pending platform deployment first.')
        path = activation.CONFIG / 'platform.env'
        config = activation.platform_environment(path)
        if config.get('TELEGRAM_AUTH_BOT_ID') not in (None, '', bot_id):
            raise RuntimeError('Switching bot identity requires an account migration.')
        if request.get('check') is True:
            return
        if config.get('MAIL_MODE') != 'disabled':
            raise RuntimeError('The Telegram platform release is not installed.')
        pins = activation.load(activation.CONFIG / 'pins.json')
        old_text = path.read_text()
        key = config.get('TELEGRAM_AUTH_CODE_KEY_BASE64') or base64.b64encode(secrets.token_bytes(32)).decode()
        settings = {
            'TELEGRAM_AUTH_ENABLED': 'true',
            'TELEGRAM_AUTH_BOT_ID': bot_id,
            'TELEGRAM_AUTH_BOT_USERNAME': username,
            'TELEGRAM_AUTH_WEBHOOK_SECRET': secret,
            'TELEGRAM_AUTH_CODE_KEY_BASE64': key,
        }
        original = [line for line in old_text.splitlines() if line.partition('=')[0] not in settings]
        new_text = '\n'.join(original + [f'{field}={value}' for field, value in settings.items()]) + '\n'
        write_env(path, new_text)
        try:
            activation.up(pins, 'platform')
            probe = activation.compose(
                pins, 'exec', '-T', 'platform', 'node', '-e',
                """fetch('http://127.0.0.1:4310/api/platform/v1/session').then(r=>r.json()).then(s=>{
                    if (!s.auth?.telegram || s.auth.email) process.exit(1);
                }).catch(()=>process.exit(1))""",
            )
            if probe:
                raise RuntimeError('Unexpected platform readiness result.')
        except RuntimeError:
            write_env(path, old_text)
            activation.up(pins, 'platform')
            raise
    print(f'Telegram account bot @{username} is configured on the VPS.')


if __name__ == '__main__':
    try:
        configure()
    except (KeyError, OSError, TypeError, ValueError, RuntimeError) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Cannot configure the account bot.', file=sys.stderr)
        sys.exit(1)
