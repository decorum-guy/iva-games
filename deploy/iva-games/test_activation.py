import pathlib
import tempfile
import unittest
from unittest.mock import patch

import activation


class ActivationTest(unittest.TestCase):
    ip = '78.137.109.13'

    def test_two_resolvers_both_domains_and_ipv6(self):
        for mode in ('old', 'one', 'wrong_aaaa', 'mixed', 'resolver_error', 'ready'):
            def records(resolver, domain, kind):
                if kind == 'AAAA':
                    return {'2001:4860::2'} if mode == 'wrong_aaaa' else set()
                if mode == 'resolver_error' and resolver == '1.1.1.1':
                    raise RuntimeError('SERVFAIL')
                if mode == 'old' or (mode == 'one' and domain == activation.DOMAINS[1]):
                    return {'192.0.2.1'}
                return {self.ip, '192.0.2.1'} if mode == 'mixed' else {self.ip}
            with self.subTest(mode=mode), patch.object(activation, 'command', return_value='[]'), (
                patch.object(activation, 'dns_records', side_effect=records)
            ):
                _, result = activation.dns_sample(self.ip)
                self.assertEqual(result is not None, mode == 'ready')

    def test_chain_checks_terminal_records(self):
        response = """;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1
chess.iva-games.pro. 60 IN CNAME iva-games.pro.
unrelated.example. 60 IN A 192.0.2.1
iva-games.pro. 60 IN A 78.137.109.13"""
        with patch.object(activation, 'command', return_value=response):
            self.assertEqual(activation.dns_records('1.1.1.1', 'chess.iva-games.pro', 'A'), {self.ip})

    def test_interrupted_success_resets_counter(self):
        with tempfile.TemporaryDirectory() as work, patch.object(activation, 'STATE', pathlib.Path(work)):
            answers = {'iva-games.pro': [], 'chess.iva-games.pro': []}
            with patch.object(activation, 'dns_sample', side_effect=[
                ({}, answers), ({}, None), ({}, answers), ({}, answers),
            ]):
                self.assertEqual([activation.dns_readiness(self.ip)['consecutive'] for _ in range(4)],
                                 [1, 0, 1, 2])

    def test_missing_smtp_keeps_sites_closed_even_when_dns_is_ready(self):
        with tempfile.TemporaryDirectory() as work, patch.object(activation, 'STATE', pathlib.Path(work)), (
            patch.object(activation, 'CONFIG', pathlib.Path(work))
        ), patch.object(activation, 'dns_readiness', return_value={'consecutive': 2}), (
            patch.object(activation, 'compose')
        ) as compose:
            activation.save(activation.CONFIG / 'activation.json', {'ipv4': self.ip})
            activation.activate()
            self.assertEqual(activation.load(activation.STATE / 'state.json')['status'], 'WAITING_CONFIG')
            compose.assert_not_called()

    def test_telegram_mode_waits_only_for_dns_before_public_start(self):
        with tempfile.TemporaryDirectory() as work, patch.object(activation, 'STATE', pathlib.Path(work)), (
            patch.object(activation, 'CONFIG', pathlib.Path(work))
        ), patch.object(activation, 'dns_readiness', return_value={'consecutive': 0}), (
            patch.object(activation, 'compose')
        ) as compose:
            (activation.CONFIG / 'platform.env').write_text('MAIL_MODE=disabled\nTELEGRAM_AUTH_ENABLED=false\n')
            activation.save(activation.CONFIG / 'activation.json', {'ipv4': self.ip, 'initial_sha': 'approved'})
            activation.save(activation.CONFIG / 'pins.json', {'sha': 'approved'})
            activation.activate()
            self.assertEqual(activation.load(activation.STATE / 'state.json')['status'], 'WAITING_DNS')
            compose.assert_not_called()

    def test_waiting_tls_and_active_dont_restart_caddy(self):
        with tempfile.TemporaryDirectory() as work, patch.object(activation, 'STATE', pathlib.Path(work)), (
            patch.object(activation, 'CONFIG', pathlib.Path(work))
        ), patch.object(activation, 'dns_readiness', return_value={'consecutive': 2}), (
            patch.object(activation, 'mail_verification_settings', return_value=None)
        ), patch.object(activation, 'running', return_value=True), (
            patch.object(activation, 'public_health', side_effect=[False, True])
        ), patch.object(activation, 'command') as commands, patch.object(activation, 'up') as up:
            activation.save(activation.CONFIG / 'activation.json', {'ipv4': self.ip, 'initial_sha': 'test'})
            activation.save(activation.CONFIG / 'pins.json', {'sha': 'test'})
            activation.activate()
            self.assertEqual(activation.load(activation.STATE / 'state.json')['status'], 'WAITING_TLS')
            activation.activate()
            activation.activate()
            self.assertEqual(activation.load(activation.STATE / 'state.json')['status'], 'ACTIVE')
            self.assertEqual(commands.call_count, 2)
            up.assert_not_called()


if __name__ == '__main__':
    unittest.main()
