import { describe, expect, it, vi } from 'vitest';
import { createTelegramTransport, requiredProxyAgent } from './index';

const config = { botToken: '000000000:fixture_only_not_a_live_bot_token', proxyUrl: 'http://127.0.0.1:19080', portalOrigin: 'https://games.example.test' };
describe('mandatory explicit Telegram proxy', () => {
  it('refuses missing and unsupported proxies without an HTTP request', () => {
    const request = vi.fn();
    expect(() => createTelegramTransport({ ...config, proxyUrl: undefined, request })).toThrow(/kz-bot/);
    expect(() => requiredProxyAgent('socks5://localhost:1080')).toThrow(/удалённым DNS/);
    expect(() => requiredProxyAgent('http://localhost:1080/path?token=bad')).toThrow();
    expect(request).not.toHaveBeenCalled();
    for (const url of ['http://127.0.0.1:19080', 'https://127.0.0.1:19080', 'socks5h://127.0.0.1:19080']) requiredProxyAgent(url).destroy();
  });
  it('supplies a proxy agent for every request and limits buttons to the website invitation route', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true, result: { message_id: 17 } }) });
    const transport = createTelegramTransport({ ...config, request });
    expect(await transport.sendMessage({ chatId: '10001', text: 'Test fixture', button: { text: 'Открыть', url: config.portalOrigin + '/invitations/invite-1' } })).toEqual({ outcome: 'accepted', messageId: '17' });
    expect(request.mock.calls[0][0].agent).toBeTruthy();
    const body = JSON.parse(request.mock.calls[0][0].body);
    expect(body.parse_mode).toBeUndefined(); expect(body.chat_id).toBe('10001');
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture', button: { text: 'Login', url: 'https://other.example.test/login' } })).rejects.toThrow(/Ссылка/);
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture', button: { text: 'Открыть', url: 'https://name:password@games.example.test/invitations/invite-1' } })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(request).toHaveBeenCalledTimes(1); transport.close();
  });
  it('does not retry uncertain sends or leak a token or proxy credentials through errors', async () => {
    const request = vi.fn().mockRejectedValue(new Error(config.botToken + ' proxy-user:secret'));
    const transport = createTelegramTransport({ ...config, request });
    try { await transport.sendMessage({ chatId: '10001', text: 'Test fixture' }); throw new Error('Expected failure'); }
    catch (error) { expect(error).toMatchObject({ code: 'DELIVERY_UNKNOWN' }); expect(String(error)).not.toContain(config.botToken); expect(String(error)).not.toContain('secret'); }
    expect(request).toHaveBeenCalledTimes(1); transport.close();
  });
  it('sends a native copy button and code entity without permitting a mismatched code or invitation', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true, result: { message_id: 18 } }) });
    const transport = createTelegramTransport({ ...config, request });
    const prefix = 'Код подключения: ';
    const value = 'ABCDEFG2';
    await transport.sendMessage({ chatId: '10001', text: `${prefix}${value}\nВведите код`,
      copyCode: { value, offset: prefix.length, buttonText: 'Скопировать код' } });
    const body = JSON.parse(request.mock.calls[0][0].body);
    expect(body.entities).toEqual([{ type: 'code', offset: prefix.length, length: value.length }]);
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: 'Скопировать код', copy_text: { text: value } }]]);
    await expect(transport.sendMessage({ chatId: '10001', text: `${prefix}${value}`,
      copyCode: { value, offset: 0, buttonText: 'Скопировать код' } })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(request).toHaveBeenCalledTimes(1);
    transport.close();
  });
  it('distinguishes rate limits, blocked recipients and uncertain upstream outcomes', async () => {
    const request = vi.fn(); const transport = createTelegramTransport({ ...config, request });
    request.mockResolvedValueOnce({ status: 429, body: '{"ok":false,"parameters":{"retry_after":7}}' });
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture' })).rejects.toMatchObject({ code: 'RETRY_LATER', retryAfterSeconds: 7 });
    request.mockResolvedValueOnce({ status: 429, body: '{"ok":false,"parameters":{"retry_after":7200}}' });
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture' })).rejects.toMatchObject({ code: 'RETRY_LATER', retryAfterSeconds: 7200 });
    request.mockResolvedValueOnce({ status: 403, body: '{"ok":false}' });
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture' })).rejects.toMatchObject({ code: 'UNREACHABLE' });
    request.mockResolvedValueOnce({ status: 200, body: 'not-json' });
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture' })).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' });
    request.mockResolvedValueOnce({ status: 200, body: 'null' });
    await expect(transport.sendMessage({ chatId: '10001', text: 'Test fixture' })).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' });
    transport.close();
  });
});
