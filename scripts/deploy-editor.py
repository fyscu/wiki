"""Provision the repository-scoped editor and its private state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tarfile
import time
import urllib.request

ROOT = Path('/opt/feiyang-wiki-editor')
STAGE = Path('/var/tmp/feiyang-wiki-bootstrap')
SITE = Path('/opt/1panel/apps/openresty/openresty/www/sites/wiki.feiyang.ac.cn')
NODE_VERSION = 'node-v24.16.0-linux-x64'
NODE_SHA = 'd804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9'
parser = argparse.ArgumentParser()
parser.add_argument('--install', action='store_true')
args = parser.parse_args()
if not Path('/opt/feiyang-wiki/owner.json').is_file() or not (SITE / '.feiyang-wiki-owner').is_file():
    raise RuntimeError('Wiki ownership markers missing')
if ROOT.exists() and not (ROOT / '.owner').is_file():
    raise RuntimeError('Existing directory is not managed by this installer')
legacy = Path('/opt/feiyang-wiki/editor')
try:
    prior = pwd.getpwnam('wiki-editor')
    if prior.pw_dir == str(legacy) and (legacy / '.owner').is_file() and not ROOT.exists():
        subprocess.run(['usermod', '--home', str(ROOT), '--move-home', 'wiki-editor'], check=True)
except KeyError:
    pass
ROOT.mkdir(mode=0o750, exist_ok=True)
(ROOT / '.owner').write_text('feiyang-wiki-editor\n')
try:
    account = pwd.getpwnam('wiki-editor')
    if account.pw_dir != str(ROOT):
        raise RuntimeError('Existing editor account has a different home')
except KeyError:
    subprocess.run(['useradd', '--system', '--home-dir', str(ROOT), '--shell', '/usr/sbin/nologin', 'wiki-editor'], check=True)
    account = pwd.getpwnam('wiki-editor')
os.chown(ROOT, account.pw_uid, account.pw_gid)
for name in ['keys', 'state', 'jobs', 'runtime']:
    path = ROOT / name
    path.mkdir(mode=0o700, exist_ok=True)
    os.chown(path, account.pw_uid, account.pw_gid)
node_archive = STAGE / (NODE_VERSION + '.tar.xz')
node_dir = ROOT / 'runtime' / NODE_VERSION
if not node_dir.exists():
    if hashlib.sha256(node_archive.read_bytes()).hexdigest() != NODE_SHA:
        raise RuntimeError('Node archive checksum mismatch')
    with tarfile.open(node_archive) as archive:
        archive.extractall(ROOT / 'runtime', filter='data')
key = ROOT / 'keys/editor_ed25519'
if not key.exists():
    subprocess.run(['runuser', '-u', 'wiki-editor', '--', 'ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'feiyang-wiki-editor', '-f', str(key)], check=True)
known_hosts = ROOT / 'keys/known_hosts'
shutil.copy2(STAGE / 'github-known-hosts', known_hosts)
known_hosts.chmod(0o644)
venv = ROOT / 'venv'
if not (venv / 'bin/pip').exists():
    subprocess.run(['runuser', '-u', 'wiki-editor', '--', 'python3', '-m', 'venv', '--without-pip', str(venv)], check=True)
    wheel = STAGE / 'pip-25.0.1-py3-none-any.whl'
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != 'c46efd13b6aa8279f33f2864459c8ce587ea6a1a59ee20de055868d8f7688f7f':
        raise RuntimeError('Pip wheel checksum mismatch')
    local_wheel = ROOT / 'runtime' / wheel.name
    shutil.copy2(wheel, local_wheel)
    local_wheel.chmod(0o644)
    subprocess.run(['runuser', '-u', 'wiki-editor', '--', 'env', 'PYTHONPATH=' + str(local_wheel), str(venv / 'bin/python'), '-m', 'pip', 'install', '--no-index', str(local_wheel)], check=True)
content = SITE / 'content'
content.mkdir(mode=0o755, exist_ok=True)
(content / '.feiyang-wiki-editor').write_text('feiyang-wiki-editor\n')
os.chown(content, account.pw_uid, account.pw_gid)
(content / 'releases').mkdir(mode=0o755, exist_ok=True)
os.chown(content / 'releases', account.pw_uid, account.pw_gid)
if not (content / 'index').exists():
    bootstrap = content / 'releases/bootstrap'
    if not bootstrap.exists():
        shutil.copytree((SITE / 'index').resolve(), bootstrap)
    (content / 'index').symlink_to('releases/bootstrap')
environment = {
    'PATH': str(node_dir / 'bin') + ':/usr/bin:/bin',
    'GIT_SSH_COMMAND': f'ssh -i {key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile={known_hosts}',
    'EDITOR_ROOT': str(ROOT), 'EDITOR_REPO': str(ROOT / 'app'), 'EDITOR_SITE': str(content), 'EDITOR_DEPS': str(ROOT / 'app'),
    'WIKI_PYTHON': str(venv / 'bin/python'), 'QA_ORIGIN': 'http://127.0.0.1:9080', 'WIKI_ORIGIN': 'https://wiki.feiyang.ac.cn', 'EDITOR_PORT': '9090',
    'NODE_OPTIONS': '--max-old-space-size=512',
}
config = ROOT / 'editor.env'
config.write_text('\n'.join(name + '=' + json.dumps(value) for name, value in environment.items()) + '\n')
config.chmod(0o600)

def run_user(arguments, cwd=None):
    command = ['runuser', '-u', 'wiki-editor', '--', 'env', *[name + '=' + value for name, value in environment.items()], *arguments]
    return subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)

if not args.install:
    print(json.dumps({'prepared': True, 'public_key_path': str(key) + '.pub'}))
    raise SystemExit(0)
app = ROOT / 'app'
if not (app / '.git').is_dir():
    run_user(['git', 'clone', '--branch', 'main', 'ssh://git@ssh.github.com:443/fyscu/wiki.git', str(app)])
else:
    run_user(['git', 'diff', '--exit-code'], app)
    run_user(['git', 'fetch', 'origin', 'main'], app)
    run_user(['git', 'merge', '--ff-only', 'origin/main'], app)
run_user(['git', 'config', 'user.name', 'Feiyang Wiki Editor'], app)
run_user(['git', 'config', 'user.email', 'wiki-editor@feiyang.ac.cn'], app)
run_user(['npm', 'ci'], app)
run_user([str(venv / 'bin/python'), '-m', 'pip', 'install', '-r', 'requirements.txt'], app)
shutil.copy2(STAGE / 'feiyang-wiki-editor.service', '/etc/systemd/system/feiyang-wiki-editor.service')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'feiyang-wiki-editor.service'], check=True)
subprocess.run(['systemctl', 'restart', 'feiyang-wiki-editor.service'], check=True)
for attempt in range(30):
    try:
        with urllib.request.urlopen('http://127.0.0.1:9090/health', timeout=2) as response:
            if response.status == 200:
                break
    except Exception:
        if attempt == 29:
            raise RuntimeError('Editor did not become ready; inspect its systemd journal') from None
        time.sleep(1)
print(json.dumps({'editor': 'ready', 'port': '127.0.0.1:9090', 'git_commit': run_user(['git', 'rev-parse', 'HEAD'], app).stdout.strip()}))
