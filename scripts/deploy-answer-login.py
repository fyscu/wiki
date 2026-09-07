"""Build or activate the patched Wiki backend, preserving data and rollback state."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import time
import urllib.request
import yaml

parser = argparse.ArgumentParser()
parser.add_argument('--sha256', required=True)
parser.add_argument('--activate', action='store_true')
args = parser.parse_args()
if not re.fullmatch('[0-9a-f]{64}', args.sha256):
    raise RuntimeError('Expected a full SHA-256 digest')
root = Path('/opt/feiyang-wiki')
if not (root / 'owner.json').exists():
    raise RuntimeError('Wiki ownership marker missing')
image = 'feiyang/answer-runtime:2.0.2-login-' + args.sha256[:12]
stage = Path('/var/tmp/feiyang-wiki-bootstrap')

def run(command, **kwargs):
    return subprocess.run(command, check=True, capture_output=True, **kwargs)

def api(path):
    with urllib.request.urlopen('http://127.0.0.1:9080/answer/api/v1/' + path, timeout=3) as response:
        result = json.load(response)
    if result.get('code') != 200:
        raise RuntimeError('Backend health request failed')
    return result['data']

if not args.activate:
    context = stage / ('answer-login-' + args.sha256[:12])
    context.mkdir(mode=0o700, exist_ok=True)
    with tarfile.open(stage / 'answer-runtime-login.tar.gz') as archive:
        for entry in archive.getmembers():
            target = (context / entry.name).resolve()
            if not target.is_relative_to(context.resolve()) or not (entry.isfile() or entry.isdir()):
                raise RuntimeError('Unexpected build archive member')
        archive.extractall(context, filter='data')
    if hashlib.sha256((context / 'answer').read_bytes()).hexdigest() != args.sha256:
        raise RuntimeError('Backend checksum mismatch')
    run(['docker', 'build', '--network=none', '--pull=false', '-t', image, str(context)])
    plugins = run(['docker', 'run', '--rm', '--network=none', image, 'plugin']).stdout.decode()
    if 'basic_reviewer' not in plugins:
        raise RuntimeError('Required reviewer plugin missing from image')
    print(json.dumps({'image_prepared': image, 'reviewer_included': True}))
    raise SystemExit(0)

run(['docker', 'image', 'inspect', image])
container = json.loads(run(['docker', 'inspect', 'feiyang-wiki-answer']).stdout)[0]
if container['Config']['Labels'].get('com.feiyang.project') != 'wiki':
    raise RuntimeError('Container ownership mismatch')
compose = root / 'compose.yaml'
original = compose.read_bytes()
config = yaml.safe_load(original)
if config['services']['answer']['container_name'] != 'feiyang-wiki-answer':
    raise RuntimeError('Unexpected compose service')
before_site = api('siteinfo')
before_plugins = api('plugin/status')
backup = root / 'backups' / datetime.datetime.now(datetime.timezone.utc).strftime('username-login-%Y%m%dT%H%M%SZ')
backup.mkdir(mode=0o700)
(backup / 'compose.yaml').write_bytes(original)
(backup / 'previous-image.txt').write_text(container['Config']['Image'])
with (backup / 'wiki.sql').open('wb') as output:
    subprocess.run(['docker', 'exec', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF feiyang_wiki_qa'], check=True, stdout=output)
(backup / 'wiki.sql').chmod(0o600)
with tarfile.open(backup / 'wiki-config-data.tar.gz', 'w:gz') as archive:
    archive.add(root / 'qa/data', arcname='qa/data')
config['services']['answer']['image'] = image
temporary = compose.with_suffix('.yaml.next')
temporary.write_text(yaml.safe_dump(config, sort_keys=False))
temporary.chmod(compose.stat().st_mode & 0o777)
temporary.replace(compose)
command = ['docker', 'compose', '-f', str(compose), 'up', '-d', '--no-deps', 'answer']
try:
    run(command)
    for attempt in range(25):
        try:
            after_site = api('siteinfo')
            if after_site['login'] != before_site['login'] or after_site['general'] != before_site['general']:
                raise RuntimeError('Site settings changed unexpectedly')
            if api('plugin/status') != before_plugins:
                raise RuntimeError('Plugin settings changed unexpectedly')
            break
        except Exception:
            if attempt == 24:
                raise
            time.sleep(1)
except Exception:
    compose.write_bytes(original)
    run(command)
    raise RuntimeError('Backend activation failed; original image restored') from None
print(json.dumps({'active_image': image, 'previous_image': container['Config']['Image'], 'backup': str(backup), 'settings_preserved': True}))
