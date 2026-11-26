#!/usr/bin/env python3
"""Enter the dedicated BotFather token on the Mac and configure Iva Games."""

import argparse
import getpass
import json
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time

WEBHOOK = 'https://iva-games.pro/integrations/telegram/auth-webhook'


def telegram_tunnel():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    tunnel = subprocess.Popen(
        ['/usr/bin/ssh', '-N', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
         '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
         '-L', f'127.0.0.1:{port}:api.telegram.org:443', 'kz-bot'],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(30):
            if tunnel.poll() is not None:
                break
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=1):
                    return tunnel, port
            except OSError:
                time.sleep(0.25)
        raise RuntimeError('Нет доступа к разрешённому маршруту Telegram через kz-bot.')
    except BaseException:
        tunnel.terminate()
        tunnel.wait(timeout=5)
        raise


def bot_api(port, token, method, body=None):
    # curl receives the URL and any credentials over stdin; its errors are sanitized.
    config = [
        'silent', 'max-time = 15', 'noproxy = "*"',
        f'connect-to = "api.telegram.org:443:127.0.0.1:{port}"',
        f'url = "https://api.telegram.org/bot{token}/{method}"',
        'header = "Content-Type: application/json"',
        'data-binary = ' + json.dumps(json.dumps(body or {})),
    ]
    response = subprocess.run(['/usr/bin/curl', '--config', '-'], input='\n'.join(config) + '\n',
                              capture_output=True, text=True, timeout=20, check=False)
    try:
        result = json.loads(response.stdout)
    except ValueError:
        result = {}
    if response.returncode or result.get('ok') is not True:
        raise RuntimeError(f'Telegram Bot API не подтвердил {method}. Проверьте токен и соединение.')
    return result.get('result')


def configure_vps(admin_helper, request):
    script = ("exec /opt/iva-games/deploy/configure-telegram-auth.py <<'TELEGRAM_CONFIG'\n"
              + json.dumps(request) + '\nTELEGRAM_CONFIG\n')
    result = subprocess.run([sys.executable, str(admin_helper), 'sudo', '2233'], input=script,
                            text=True, timeout=190, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('VPS не подтвердил конфигурацию. Проверьте SSH и готовность выпуска.')
    if result.stdout.strip():
        print(result.stdout.strip())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--admin-helper', required=True, type=Path)
    options = parser.parse_args()
    print('Iva Games — подключение выделенного Telegram-бота')
    print('Введите токен нового бота из @BotFather. Введённые символы скрыты.')
    token = getpass.getpass('Токен бота: ').strip()
    if not re.fullmatch(r'\d{4,}:[A-Za-z0-9_-]{20,}', token):
        raise RuntimeError('Формат токена неверен.')
    tunnel, port = telegram_tunnel()
    try:
        identity = bot_api(port, token, 'getMe')
        if not identity.get('is_bot') or not re.fullmatch('[A-Za-z0-9_]{5,32}', identity.get('username', '')):
            raise RuntimeError('Telegram не подтвердил данные бота.')
        webhook = bot_api(port, token, 'getWebhookInfo')
        if webhook.get('url') not in ('', WEBHOOK):
            raise RuntimeError('Этот бот уже подключён к другому адресу. Используйте отдельного бота для Iva Games.')
        request = {'bot_id': str(identity['id']), 'username': identity['username'], 'secret': secrets.token_urlsafe(40)}
        configure_vps(options.admin_helper, {**request, 'check': True})
        # Use the approved VPS during DNS propagation; Telegram still verifies
        # the certificate for the public hostname when delivering an update.
        bot_api(port, token, 'setWebhook', {'url': WEBHOOK, 'secret_token': request['secret'],
                'ip_address': '78.137.109.13', 'allowed_updates': ['message', 'callback_query']})
        configure_vps(options.admin_helper, request)
        try:
            for language, labels in (('', ('Profile', 'Friends', 'Incoming requests')),
                                     ('ru', ('Профиль', 'Друзья', 'Входящие заявки'))):
                commands = [{'command': cmd, 'description': label}
                            for cmd, label in zip(('profile', 'friends', 'requests'), labels, strict=True)]
                bot_api(port, token, 'setMyCommands', {'commands': commands, 'language_code': language})
        except RuntimeError:
            print('Вход настроен. Команды можно открыть кнопками бота после /start.')
        if bot_api(port, token, 'getWebhookInfo').get('url') != WEBHOOK:
            raise RuntimeError('Telegram не подтвердил адрес webhook.')
        print('Webhook сохранён. Регистрация станет доступна после публичного HTTPS.')
    finally:
        tunnel.terminate()
        tunnel.wait(timeout=5)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Настройка не завершилась. Запустите окно повторно.', file=sys.stderr)
        sys.exit(1)
