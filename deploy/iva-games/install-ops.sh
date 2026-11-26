#!/usr/bin/env bash
# Add an independent read-only SSH identity to an already activated Iva Games
# host. Never rerun install-host.sh for this. The only input is a PUBLIC key.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
umask 077
if [[ "$EUID" != 0 || $# != 1 ]]; then
  echo 'Usage: sudo bash install-ops.sh /absolute/path/iva-games-ops.pub' >&2
  exit 2
fi
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
public_key="$1"
[[ "$public_key" == /* ]] || { echo 'Use an absolute public-key path.' >&2; exit 2; }
for utility in python3 ssh-keygen sshd sudo visudo timeout systemctl useradd userdel groupdel getent id install flock; do
  command -v "$utility" >/dev/null || { echo 'A required host utility is missing.' >&2; exit 1; }
done
[[ -f /etc/iva-games/release.env && -d /opt/iva-games/deploy ]] || {
  echo 'Install the Iva Games host before adding diagnostics.' >&2; exit 1;
}
getent passwd iva-admin >/dev/null
getent passwd iva-deploy >/dev/null

# Validate the destinations before writing anything. Do not follow an unexpected
# symlink or take ownership of a pre-existing, unrelated account/directory.
python3 -I - <<'PY'
import os, pathlib, stat
paths = (
    '/opt', '/opt/iva-games', '/etc', '/etc/ssh', '/etc/ssh/sshd_config',
    '/etc/sudoers.d', '/var', '/var/lib', '/root',
    '/opt/iva-games/ops', '/opt/iva-games/ops/ops-status',
    '/opt/iva-games/ops/ops-status.py', '/var/lib/iva-ops',
    '/var/lib/iva-ops/.ssh', '/var/lib/iva-ops/.ssh/authorized_keys',
    '/var/lib/iva-ops/.iva-games-ops-managed-v1', '/etc/sudoers.d/iva-ops',
    '/etc/ssh/iva-games-ops-match.conf', '/root/iva-games-ops-install',
)
for name in paths:
    path = pathlib.Path(name)
    try:
        meta = path.lstat()
    except FileNotFoundError:
        continue
    if (meta.st_uid != 0 or meta.st_mode & 0o022
            or not (stat.S_ISREG(meta.st_mode) or stat.S_ISDIR(meta.st_mode))):
        raise SystemExit('A managed destination is not a protected root-owned file/directory.')
PY
exec 9>/run/iva-games-ops-install.lock
flock -n 9 || { echo 'Another diagnostics installation is running.' >&2; exit 1; }
install -d -o root -g root -m 700 /root/iva-games-ops-install
stage="$(mktemp -d /root/iva-games-ops-install/run.XXXXXXXX)"
changed=0
created_user=0
created_runtime=0
finished=0
reload_unit=''
for unit in ssh.service sshd.service; do
  if systemctl is-active --quiet "$unit"; then reload_unit="$unit"; break; fi
done
if [[ -z "$reload_unit" ]] && ! systemctl is-active --quiet ssh.socket; then
  echo 'No active SSH service or socket was found; no configuration changed.' >&2
  exit 1
fi
destinations=(
  /opt/iva-games/ops/ops-status
  /opt/iva-games/ops/ops-status.py
  /var/lib/iva-ops/.ssh/authorized_keys
  /var/lib/iva-ops/.iva-games-ops-managed-v1
  /etc/sudoers.d/iva-ops
  /etc/ssh/iva-games-ops-match.conf
  /etc/ssh/sshd_config
)
mkdir "$stage/backup"
for i in "${!destinations[@]}"; do
  if [[ -f "${destinations[$i]}" ]]; then
    cp -p -- "${destinations[$i]}" "$stage/backup/$i"
  fi
done
rollback() {
  local status=$?
  trap - EXIT
  if (( finished == 0 )); then
    if (( changed == 1 )); then
      for i in "${!destinations[@]}"; do
        rm -f -- "${destinations[$i]}.iva-ops-new"
        if [[ -f "$stage/backup/$i" ]]; then
          cp -p -- "$stage/backup/$i" "${destinations[$i]}.iva-ops-restore"
          mv -f -- "${destinations[$i]}.iva-ops-restore" "${destinations[$i]}"
        else
          rm -f -- "${destinations[$i]}"
        fi
      done
      if sshd -t >/dev/null 2>&1 && [[ -n "$reload_unit" ]]; then
        systemctl reload "$reload_unit" >/dev/null 2>&1 || true
      fi
    fi
    if (( created_user == 1 )); then
      if userdel iva-ops >/dev/null 2>&1; then
        groupdel iva-ops >/dev/null 2>&1 || true
        # Only remove our now-empty directories; never remove user content.
        rmdir /var/lib/iva-ops/.ssh /var/lib/iva-ops 2>/dev/null || true
      fi
    fi
    if (( created_runtime == 1 )); then rmdir /opt/iva-games/ops 2>/dev/null || true; fi
    echo 'Diagnostics installation did not complete; managed changes were rolled back.' >&2
    echo 'Private validation details and prior files remain under /root/iva-games-ops-install.' >&2
    [[ "$status" != 0 ]] || status=1
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Accept one raw Ed25519 public key, never authorized_keys options, a certificate,
# a private key, multiline input or a caller-controlled comment.
python3 -I - "$public_key" "$stage/key.pub" <<'PY'
import base64, os, pathlib, re, stat, struct, sys
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
try:
    meta = os.fstat(fd)
    if not stat.S_ISREG(meta.st_mode) or meta.st_size > 4096:
        raise ValueError()
    raw = os.read(fd, 4097)
    if len(raw) > 4096:
        raise ValueError()
    lines = raw.decode('ascii').splitlines()
    if len(lines) != 1:
        raise ValueError()
    parts = lines[0].split()
    if len(parts) < 2 or parts[0] != 'ssh-ed25519' or not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', parts[1]):
        raise ValueError()
    blob = base64.b64decode(parts[1], validate=True)
    expected = struct.pack('>I', 11) + b'ssh-ed25519' + struct.pack('>I', 32)
    if len(blob) != len(expected) + 32 or not blob.startswith(expected):
        raise ValueError()
    pathlib.Path(sys.argv[2]).write_text('ssh-ed25519 ' + parts[1] + '\n')
except (OSError, ValueError, UnicodeError):
    raise SystemExit('Expected one valid Ed25519 public key.')
finally:
    os.close(fd)
PY
ssh-keygen -lf "$stage/key.pub" >"$stage/key-fingerprint.txt" 2>"$stage/validation.log"
python3 -I - "$stage/key.pub" <<'PY'
import os, pathlib, pwd, re, stat, sys
candidate = pathlib.Path(sys.argv[1]).read_text().split()[1]
for name in ('iva-admin', 'iva-deploy'):
    path = pathlib.Path(pwd.getpwnam(name).pw_dir) / '.ssh/authorized_keys'
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        continue
    try:
        meta = os.fstat(fd)
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > 65536:
            raise SystemExit('Existing public keys need local review before diagnostics installation.')
        content = os.read(fd, 65537).decode('utf-8')
        if len(content) > 65536:
            raise SystemExit('Existing public keys need local review before diagnostics installation.')
        if candidate in re.findall(r'(?:^|\s)ssh-ed25519\s+([A-Za-z0-9+/=]+)', content):
            raise SystemExit('Use a new diagnostics key, separate from administrator and deployment keys.')
    finally:
        os.close(fd)
PY
if getent passwd iva-ops >"$stage/account.txt"; then
  [[ -f /var/lib/iva-ops/.iva-games-ops-managed-v1 ]] || {
    echo 'iva-ops already exists without this installer marker; refusing to adopt it.' >&2; exit 1;
  }
else
  [[ ! -e /var/lib/iva-ops && ! -e /etc/sudoers.d/iva-ops && ! -e /etc/ssh/iva-games-ops-match.conf ]] || {
    echo 'Unmanaged diagnostics files already exist; review them locally first.' >&2; exit 1;
  }
  useradd --system --user-group --no-create-home --home-dir /var/lib/iva-ops --shell /bin/sh iva-ops
  created_user=1
fi
python3 -I - <<'PY'
import grp, os, pathlib, pwd
account = pwd.getpwnam('iva-ops')
groups = os.getgrouplist('iva-ops', account.pw_gid)
if (account.pw_uid == 0 or account.pw_dir != '/var/lib/iva-ops' or account.pw_shell != '/bin/sh'
        or len(set(groups)) != 1 or grp.getgrgid(account.pw_gid).gr_name != 'iva-ops'):
    raise SystemExit('iva-ops account must have only its private group and the dedicated home/shell.')
marker = pathlib.Path('/var/lib/iva-ops/.iva-games-ops-managed-v1')
if marker.exists() and marker.read_text() != 'iva-games-ops-v1\n':
    raise SystemExit('Unknown diagnostics installer marker.')
PY

cat >"$stage/ssh-match.conf" <<'EOF'
# Managed by deploy/iva-games/install-ops.sh. Included at END of sshd_config.
Match User iva-ops
    AllowUsers iva-ops
    AllowGroups iva-ops
    AuthenticationMethods publickey
    PubkeyAuthentication yes
    PubkeyAcceptedAlgorithms ssh-ed25519
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AuthorizedKeysFile /var/lib/iva-ops/.ssh/authorized_keys
    AuthorizedKeysCommand none
    TrustedUserCAKeys none
    ForceCommand /opt/iva-games/ops/ops-status
    DisableForwarding yes
    AllowTcpForwarding no
    AllowAgentForwarding no
    AllowStreamLocalForwarding no
    PermitTunnel no
    PermitOpen none
    PermitListen none
    PermitTTY no
    PermitUserRC no
    X11Forwarding no
    MaxSessions 1
    AcceptEnv IVA_OPS_UNUSED_ENV
EOF

# Prepare and compare effective policies before installing the candidate. An
# Include in sshd_config.d could make later global directives illegal after a
# Match; the dedicated Include belongs at the end, after an explicit Match all.
python3 -I - "$stage" <<'PY' >"$stage/ssh-validation.txt" 2>>"$stage/validation.log"
import fnmatch, os, pathlib, subprocess, sys
stage = pathlib.Path(sys.argv[1])
original = pathlib.Path('/etc/ssh/sshd_config').read_text()
begin = '# BEGIN IVA GAMES OPS V1'
end = '# END IVA GAMES OPS V1'
if original.count(begin) != original.count(end) or original.count(begin) > 1:
    raise SystemExit('Malformed diagnostics SSH marker.')
if begin in original:
    prefix, tail = original.split(begin, 1)
    _, suffix = tail.split(end, 1)
    original = prefix.rstrip() + '\n' + suffix.lstrip('\n')
def render(include):
    return original.rstrip() + '\n\n' + begin + '\nMatch all\nInclude ' + include + '\n' + end + '\n'
candidate = stage / 'sshd_config.candidate'
candidate.write_text(render(str(stage / 'ssh-match.conf')))
(stage / 'sshd_config.install').write_text(render('/etc/ssh/iva-games-ops-match.conf'))
def command(*args):
    process = subprocess.run(['/usr/sbin/sshd', *args], capture_output=True, timeout=10)
    if process.returncode or len(process.stdout) > 65536:
        raise SystemExit('SSH configuration validation failed.')
    return process.stdout.decode('utf-8')
command('-t')
command('-t', '-f', str(candidate))
if command('-T') != command('-T', '-f', str(candidate)):
    raise SystemExit('Global SSH policy changed; refusing installation.')
contexts = [
    'host=localhost,addr=127.0.0.1,laddr=127.0.0.1,lport=2233',
    'host=snapshot.invalid,addr=198.51.100.10,laddr=192.0.2.10,lport=2233',
    'host=snapshot.invalid,addr=2001:db8::10,laddr=2001:db8::20,lport=2233',
]
connection = os.environ.get('SSH_CONNECTION', '').split()
if len(connection) == 4:
    import ipaddress
    try:
        remote, _, local, port = connection
        ipaddress.ip_address(remote)
        ipaddress.ip_address(local)
        if 0 < int(port) < 65536:
            contexts.append(f'host=snapshot.invalid,addr={remote},laddr={local},lport={port}')
    except ValueError:
        raise SystemExit('Invalid SSH_CONNECTION context.')
expected = {
    'authenticationmethods': 'publickey', 'pubkeyauthentication': 'yes',
    'pubkeyacceptedalgorithms': 'ssh-ed25519', 'passwordauthentication': 'no',
    'kbdinteractiveauthentication': 'no', 'disableforwarding': 'yes',
    'allowtcpforwarding': 'no', 'allowagentforwarding': 'no',
    'allowstreamlocalforwarding': 'no', 'permittunnel': 'no',
    'permitopen': 'none', 'permitlisten': 'none', 'permittty': 'no',
    'permituserrc': 'no', 'x11forwarding': 'no', 'maxsessions': '1',
    'authorizedkeysfile': '/var/lib/iva-ops/.ssh/authorized_keys',
    'authorizedkeyscommand': 'none', 'trustedusercakeys': 'none',
    'forcecommand': '/opt/iva-games/ops/ops-status',
    'allowusers': 'iva-ops', 'allowgroups': 'iva-ops',
    'acceptenv': 'IVA_OPS_UNUSED_ENV', 'permituserenvironment': 'no',
}
for context in contexts:
    for user in ('iva-admin', 'iva-deploy', 'root'):
        test = 'user=' + user + ',' + context
        before = command('-T', '-C', test)
        after = command('-T', '-f', str(candidate), '-C', test)
        if before != after:
            raise SystemExit('Existing administrator/deploy SSH policy changed; refusing installation.')
    output = command('-T', '-f', str(candidate), '-C', 'user=iva-ops,' + context)
    values = {}
    for line in output.splitlines():
        key, _, value = line.partition(' ')
        values.setdefault(key, []).append(value.strip())
    for key, value in expected.items():
        if values.get(key) != [value]:
            raise SystemExit('An existing SSH rule conflicts with the restricted diagnostics policy.')
    for key in ('denyusers', 'denygroups'):
        for row in values.get(key, []):
            for pattern in row.split():
                # A deny policy is never removed or bypassed by this installer.
                if '@' in pattern or pattern.startswith('!') or fnmatch.fnmatchcase('iva-ops', pattern):
                    raise SystemExit('An SSH deny rule needs administrator review before adding iva-ops.')
print('Global policy and existing admin/deploy/root policies are unchanged in all checked contexts.')
print('The diagnostics identity has the exact restricted policy in all checked contexts.')
PY
visudo -cf "$source_dir/iva-ops.sudoers" >"$stage/sudoers-validation.txt" 2>>"$stage/validation.log"
python3 -I - "$source_dir/ops-status.py" "$stage/ops-status.pyc" <<'PY'
import py_compile, sys
py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)
PY
bash -n "$source_dir/ops-status"

[[ -d /opt/iva-games/ops ]] || created_runtime=1
install -d -o root -g root -m 755 /opt/iva-games/ops /var/lib/iva-ops /var/lib/iva-ops/.ssh
printf 'restrict,command="/opt/iva-games/ops/ops-status" %s\n' "$(cat "$stage/key.pub")" >"$stage/authorized_keys"
printf 'iva-games-ops-v1\n' >"$stage/marker"
changed=1
atomic_install() {
  local mode="$1" input="$2" destination="$3"
  install -o root -g root -m "$mode" -- "$input" "${destination}.iva-ops-new"
  mv -f -- "${destination}.iva-ops-new" "$destination"
}
atomic_install 755 "$source_dir/ops-status" /opt/iva-games/ops/ops-status
atomic_install 755 "$source_dir/ops-status.py" /opt/iva-games/ops/ops-status.py
atomic_install 644 "$stage/authorized_keys" /var/lib/iva-ops/.ssh/authorized_keys
atomic_install 644 "$stage/marker" /var/lib/iva-ops/.iva-games-ops-managed-v1
atomic_install 440 "$source_dir/iva-ops.sudoers" /etc/sudoers.d/iva-ops
atomic_install 600 "$stage/ssh-match.conf" /etc/ssh/iva-games-ops-match.conf
atomic_install 600 "$stage/sshd_config.install" /etc/ssh/sshd_config
visudo -c >"$stage/sudoers-installed.txt" 2>>"$stage/validation.log"
sshd -t >"$stage/sshd-installed.txt" 2>>"$stage/validation.log"
sudo -n -l -U iva-ops -- /opt/iva-games/ops/ops-status.py >"$stage/sudo-allowed.txt" 2>>"$stage/validation.log"
for denied in /bin/sh /usr/bin/docker /opt/iva-games/deploy/activation.py; do
  if sudo -n -l -U iva-ops -- "$denied" >>"$stage/sudo-denied.txt" 2>&1; then
    echo 'An existing sudo rule grants extra access to iva-ops; refusing installation.' >&2; exit 1
  fi
done
if sudo -n -l -U iva-ops -- /opt/iva-games/ops/ops-status.py --sanitize-stdin >>"$stage/sudo-denied.txt" 2>&1; then
  echo 'The diagnostics sudo command must reject all arguments.' >&2; exit 1
fi
if [[ -n "$reload_unit" ]]; then systemctl reload "$reload_unit"; fi
finished=1
echo 'Installed the restricted iva-ops snapshot identity. SSH ports and existing keys were preserved.'
echo 'An independent SSH connection and the GitHub snapshot job still require acceptance.'
echo 'Prior files and private validation details are under /root/iva-games-ops-install.'
