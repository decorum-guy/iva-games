import { spawnSync } from 'node:child_process';

// Read-only preflight. Never creates tunnels, changes host keys, sends bot messages,
// or prints configured hosts, usernames, private-key paths and proxy credentials.
const result = { ssh: 'not_checked', proxy: 'not_configured', telegramDelivery: 'not_tested' };
const config = spawnSync('ssh', ['-G', '-o', 'BatchMode=yes', 'kz-bot'], { encoding: 'utf8', timeout: 10_000 });
if (config.error?.code === 'ENOENT') result.ssh = 'client_missing';
else if (config.status !== 0) result.ssh = 'configuration_unavailable';
else {
  const hostname = config.stdout.split('\n').find(line => line.startsWith('hostname '))?.slice(9).trim();
  if (!hostname || hostname === 'kz-bot') result.ssh = 'alias_not_configured';
  else {
    const probe = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', 'kz-bot', 'true'], { encoding: 'utf8', timeout: 12_000 });
    if (probe.status === 0) result.ssh = 'reachable';
    else if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(probe.stderr ?? '')) result.ssh = 'host_key_requires_review';
    else if (/Permission denied|Authentication failed/i.test(probe.stderr ?? '')) result.ssh = 'authentication_failed';
    else result.ssh = 'unreachable_or_restricted';
  }
}

const proxy = process.env.TELEGRAM_PROXY_URL;
if (proxy) {
  let url;
  try { url = new URL(proxy); } catch { /* sanitized invalid configuration below */ }
  if (!url || !['http:', 'https:', 'socks5h:'].includes(url.protocol) || url.search || url.hash || (url.pathname && url.pathname !== '/') || /[\r\n]/.test(proxy)) result.proxy = 'invalid_configuration';
  else {
    const escaped = proxy.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    // Sensitive proxy credentials are supplied over stdin, never argv.
    const probe = spawnSync('curl', ['--config', '-'], { encoding: 'utf8', timeout: 12_000,
      input: `silent\nshow-error\nmax-time = 8\nconnect-timeout = 5\noutput = "/dev/null"\nwrite-out = "%{http_code}"\nproxy = "${escaped}"\nnoproxy = ""\nurl = "https://api.telegram.org/"\n` });
    result.proxy = probe.status === 0 && /^[23]\d{2}$/.test(probe.stdout.trim()) ? 'telegram_https_reachable' : 'unreachable_or_restricted';
  }
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ssh === 'reachable' && result.proxy === 'telegram_https_reachable' ? 0 : 2;
