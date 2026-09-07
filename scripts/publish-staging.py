import json
from pathlib import Path
import subprocess
import tarfile
import hashlib


stage = Path('/var/tmp/feiyang-wiki-bootstrap')
site = Path('/opt/1panel/apps/openresty/openresty/www/sites/feiyang-wiki-staging')
configuration = Path('/opt/1panel/apps/openresty/openresty/conf/conf.d/feiyang-wiki-staging.conf')
if site.exists() and not (site / '.feiyang-wiki-owner').exists():
    raise RuntimeError('Existing site does not belong to this project')
if configuration.exists() and not (site / '.feiyang-wiki-owner').exists():
    raise RuntimeError('Existing web configuration does not belong to this project')
site.mkdir(parents=True, exist_ok=True)
(site / '.feiyang-wiki-owner').write_text('feiyang-wiki\n')
release_id = hashlib.sha256((stage / 'wiki-dist.tar.gz').read_bytes()).hexdigest()[:12]
release = site / 'releases' / ('mkdocs-' + release_id)
release.mkdir(parents=True, exist_ok=True)
with tarfile.open(stage / 'wiki-dist.tar.gz') as archive:
    for entry in archive.getmembers():
        destination = (release / entry.name).resolve()
        if release.resolve() not in destination.parents and destination != release.resolve():
            raise RuntimeError('Archive path escapes release directory')
        if not (entry.isfile() or entry.isdir()):
            raise RuntimeError('Unexpected special file in static build')
    archive.extractall(release, filter='data')
for required in ['index.html', 'questions/index.html', 'ask/index.html', 'question/index.html', 'login/index.html']:
    path = release / required
    if not path.is_file() or '</html>' not in path.read_text(encoding='utf-8'):
        raise RuntimeError('Incomplete static build: ' + required)
index = site / 'index'
old_target = index.readlink() if index.is_symlink() else None
temporary = site / 'index.next'
temporary.unlink(missing_ok=True)
temporary.symlink_to(Path('releases') / release.name)
temporary.replace(index)
original = configuration.read_bytes() if configuration.exists() else None
api_configuration = site / 'community-api.conf'
old_api = api_configuration.read_bytes() if api_configuration.exists() else None
api_configuration.write_bytes((stage / 'community-api.conf').read_bytes())
configuration.write_bytes((stage / 'wiki-staging.conf').read_bytes())
check = subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-t'], capture_output=True, text=True)
if check.returncode:
    if original is None:
        configuration.unlink()
    else:
        configuration.write_bytes(original)
    if old_api is None:
        api_configuration.unlink()
    else:
        api_configuration.write_bytes(old_api)
    if old_target:
        temporary.symlink_to(old_target)
        temporary.replace(index)
    raise RuntimeError(check.stderr)
subprocess.run(['docker', 'exec', '1Panel-openresty-evhO', 'nginx', '-s', 'reload'], check=True)
print(json.dumps({'wiki': 'published', 'port': '127.0.0.1:9081', 'release': str(release)}))
