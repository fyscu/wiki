"""Publish an immutable Wiki release without restarting existing applications."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path('/opt/feiyang-wiki')
STAGE = Path('/var/tmp/feiyang-wiki-bootstrap')
SITE = Path('/opt/1panel/apps/openresty/openresty/www/sites/wiki.feiyang.ac.cn')
PUBLIC = SITE / 'content' if (SITE / 'content/.feiyang-wiki-editor').exists() else SITE
CONF = Path('/opt/1panel/apps/openresty/openresty/conf/conf.d/feiyang-wiki-production.conf')
if not (ROOT / 'owner.json').exists():
    raise RuntimeError('Wiki installation ownership marker missing')
if (SITE.exists() or CONF.exists()) and not (SITE / '.feiyang-wiki-owner').exists():
    raise RuntimeError('Existing production site is not owned by this project')
backup = ROOT / 'backups' / datetime.datetime.now(datetime.timezone.utc).strftime('production-%Y%m%dT%H%M%SZ')
backup.mkdir(parents=True, mode=0o700)
backup.parent.chmod(0o700)
with (backup / 'wiki.sql').open('wb') as output:
    subprocess.run(['docker', 'exec', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF feiyang_wiki_qa'], stdout=output, check=True)
(backup / 'wiki.sql').chmod(0o600)
with tarfile.open(backup / 'wiki-config-data.tar.gz', 'w:gz') as archive:
    for name in ['compose.yaml', 'owner.json', 'qa/data']:
        if (ROOT / name).exists():
            archive.add(ROOT / name, arcname=name)
if CONF.exists():
    shutil.copy2(CONF, backup / CONF.name)
if SITE.exists():
    for name in ['community-api.conf', 'mail-gate.conf', 'account-status.json']:
        if (SITE / name).exists():
            shutil.copy2(SITE / name, backup / name)
SITE.mkdir(parents=True, exist_ok=True)
(SITE / '.feiyang-wiki-owner').write_text('feiyang-wiki\n')
release_id = hashlib.sha256((STAGE / 'wiki-dist.tar.gz').read_bytes()).hexdigest()[:12]
release = PUBLIC / 'releases' / ('mkdocs-' + release_id)
release.mkdir(parents=True, exist_ok=True)
with tarfile.open(STAGE / 'wiki-dist.tar.gz') as archive:
    for entry in archive.getmembers():
        destination = (release / entry.name).resolve()
        if not destination.is_relative_to(release.resolve()) or not (entry.isfile() or entry.isdir()):
            raise RuntimeError('Unexpected archive entry')
    archive.extractall(release, filter='data')
for page in ['index.html', 'questions/index.html', 'login/index.html', 'register/index.html', 'users/account-activation/index.html', 'users/password-reset/index.html', 'users/unsubscribe/index.html']:
    if '</html>' not in (release / page).read_text(encoding='utf-8'):
        raise RuntimeError('Incomplete release: ' + page)
tools = ROOT / 'tools'
tools.mkdir(exist_ok=True)
shutil.copy2(STAGE / 'sync-wiki-certificate.py', tools / 'sync-wiki-certificate.py')
subprocess.run(['python3', str(tools / 'sync-wiki-certificate.py'), '--no-reload'], check=True)
index = PUBLIC / 'index'
old_target = index.readlink() if index.is_symlink() else None
if index.exists() and old_target is None:
    raise RuntimeError('Production index is not a managed symlink')
files = {CONF: (STAGE / 'wiki-production.conf').read_bytes(), SITE / 'community-api.conf': (STAGE / 'community-api-production.conf').read_bytes()}
if not (SITE / 'mail-gate.conf').exists():
    files[SITE / 'mail-gate.conf'] = b'return 503;\n'
if not (SITE / 'account-status.json').exists():
    files[SITE / 'account-status.json'] = b'{"mail_ready":false}\n'
before = {path: path.read_bytes() if path.exists() else None for path in files}
if old_target:
    (backup / 'previous-release.txt').write_text(str(old_target))
temporary = PUBLIC / 'index.next'
temporary.unlink(missing_ok=True)
temporary.symlink_to(Path('releases') / release.name)
temporary.replace(index)
for path, data in files.items():
    path.write_bytes(data)
try:
    subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-t'], check=True, capture_output=True)
    subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-s', 'reload'], check=True, capture_output=True)
except subprocess.CalledProcessError as error:
    for path, data in before.items():
        if data is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(data)
    if old_target:
        temporary.symlink_to(old_target)
        temporary.replace(index)
    else:
        index.unlink(missing_ok=True)
    raise RuntimeError(error.stderr.decode() if isinstance(error.stderr, bytes) else error.stderr) from None
for name in ['feiyang-wiki-certificate.service', 'feiyang-wiki-certificate.timer']:
    shutil.copy2(STAGE / name, Path('/etc/systemd/system') / name)
shutil.copy2(STAGE / 'feiyang-wiki.logrotate', '/etc/logrotate.d/feiyang-wiki')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'feiyang-wiki-certificate.timer'], check=True)
print(json.dumps({'url': 'https://wiki.feiyang.ac.cn', 'release': release.name, 'backup': str(backup)}))
