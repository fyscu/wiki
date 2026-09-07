"""Synchronize the Wiki certificate from 1Panel after its managed renewal."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

SITE = Path('/opt/1panel/apps/openresty/openresty/www/sites/wiki.feiyang.ac.cn')
if not (SITE / '.feiyang-wiki-owner').exists():
    raise RuntimeError('Wiki ownership marker missing')
database = sqlite3.connect('file:/opt/1panel/db/1Panel.db?mode=ro', uri=True)
row = database.execute('SELECT pem, private_key FROM website_ssls WHERE id=4').fetchone()
if not row or not all(row):
    raise RuntimeError('Managed wildcard certificate missing')
directory = SITE / 'ssl'
directory.mkdir(mode=0o700, exist_ok=True)
files = {'fullchain.pem': row[0].encode(), 'privkey.pem': row[1].encode()}
changed = any(not (directory / name).exists() or (directory / name).read_bytes() != data for name, data in files.items())
if not changed:
    print(json.dumps({'certificate': 'unchanged'}))
    sys.exit(0)
with tempfile.TemporaryDirectory(dir=directory) as temporary:
    paths = {name: Path(temporary) / name for name in files}
    for name, data in files.items():
        paths[name].write_bytes(data)
        paths[name].chmod(0o600)
    for args in [['-checkhost', 'wiki.feiyang.ac.cn'], ['-checkend', '604800']]:
        subprocess.run(['openssl', 'x509', '-in', str(paths['fullchain.pem']), '-noout', *args], check=True, capture_output=True)
    cert_public = subprocess.check_output(['openssl', 'x509', '-in', str(paths['fullchain.pem']), '-pubkey', '-noout'])
    key_public = subprocess.check_output(['openssl', 'pkey', '-in', str(paths['privkey.pem']), '-pubout'])
    if cert_public != key_public:
        raise RuntimeError('Certificate and private key mismatch')
    before = {name: (directory / name).read_bytes() if (directory / name).exists() else None for name in files}
    for name in files:
        paths[name].replace(directory / name)
    if '--no-reload' not in sys.argv:
        try:
            subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-t'], check=True, capture_output=True)
            subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-s', 'reload'], check=True, capture_output=True)
        except Exception:
            for name, data in before.items():
                if data is not None:
                    (directory / name).write_bytes(data)
                    (directory / name).chmod(0o600)
            raise
print(json.dumps({'certificate': 'synchronized'}))
