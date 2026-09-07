"""Atomically update the production registration/mail gate."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--enable', action='store_true')
args = parser.parse_args()
site = Path('/opt/1panel/apps/openresty/openresty/www/sites/wiki.feiyang.ac.cn')
if not (site / '.feiyang-wiki-owner').is_file():
    raise RuntimeError('Wiki site ownership marker missing')
files = {site / 'mail-gate.conf': b'# Mail transport verified.\n' if args.enable else b'return 503;\n', site / 'account-status.json': json.dumps({'mail_ready': args.enable}).encode()}
before = {path: path.read_bytes() for path in files}
backup = Path('/opt/feiyang-wiki/backups') / datetime.datetime.now(datetime.timezone.utc).strftime('registration-%Y%m%dT%H%M%SZ')
backup.mkdir(mode=0o700)
for path, content in before.items():
    (backup / path.name).write_bytes(content)
for path, content in files.items():
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_bytes(content)
    temporary.replace(path)
try:
    subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-t'], check=True, capture_output=True)
    subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-s', 'reload'], check=True, capture_output=True)
except Exception:
    for path, content in before.items():
        path.write_bytes(content)
    raise
print(json.dumps({'registration_gateway_enabled': args.enable, 'backup': str(backup)}))
