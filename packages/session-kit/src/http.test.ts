import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, createClientAddressReader, parseTrustedProxyIps } from './http';

const request = (peer: string, header?: string | string[]) => ({
  socket: { remoteAddress: peer }, headers: { [CLIENT_IP_HEADER]: header, 'x-forwarded-for': '203.0.113.250' },
});

describe('explicit edge proxy client address', () => {
  it('ignores supplied headers by default and from every untrusted socket peer', () => {
    expect(createClientAddressReader()(request('192.0.2.1', '198.51.100.1'))).toBe('192.0.2.1');
    expect(createClientAddressReader(['192.0.2.2'])(request('192.0.2.1', '198.51.100.1'))).toBe('192.0.2.1');
  });

  it('accepts only the one client header from an exact trusted proxy and canonicalizes IPv6', () => {
    const read = createClientAddressReader(['192.0.2.2', '2001:db8::2']);
    expect(read(request('192.0.2.2', '198.51.100.1'))).toBe('198.51.100.1');
    expect(read(request('::ffff:192.0.2.2', '::ffff:198.51.100.1'))).toBe('198.51.100.1');
    expect(read(request('2001:0db8:0:0:0:0:0:2', '2001:0DB8:0:0:0:0:0:1'))).toBe('2001:db8::1');
  });

  it.each([
    undefined, '', 'unknown', '198.51.100.1, 198.51.100.2', ['198.51.100.1', '198.51.100.2'],
    '198.51.100.1:443', '[2001:db8::1]', '2001:db8::zz', 'fe80::1%eth0', ' 198.51.100.1',
    '010.0.0.1', '999.0.0.1',
  ])('keeps the socket identity for a missing, ambiguous or malformed client header (%j)', header => {
    expect(createClientAddressReader(['192.0.2.2'])(request('192.0.2.2', header))).toBe('192.0.2.2');
  });

  it('requires explicit exact IPs in configuration, with no trust-all or CIDR shorthand', () => {
    expect(parseTrustedProxyIps(undefined)).toEqual([]);
    expect(parseTrustedProxyIps('')).toEqual([]);
    expect(parseTrustedProxyIps(' 127.0.0.1, ::ffff:127.0.0.1, 2001:0db8::2 ')).toEqual(['127.0.0.1', '2001:db8::2']);
    for (const value of ['*', 'true', 'caddy', '127.0.0.0/8', '127.0.0.1,', 'fe80::1%eth0']) {
      expect(() => parseTrustedProxyIps(value)).toThrow(/TRUSTED_PROXY_IPS/);
    }
  });
});
