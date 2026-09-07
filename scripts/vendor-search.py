import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
wheel = next((root / '.cache').glob('mkdocs_material-9.6.15-*.whl'))
prefix = 'material/templates/assets/javascripts/'
target = root / 'docs/assets/vendor/material'
with zipfile.ZipFile(wheel) as archive:
    for name in archive.namelist():
        if not name.startswith(prefix) or not name.endswith('.js'):
            continue
        relative = Path(name.removeprefix(prefix))
        if '..' in relative.parts:
            raise RuntimeError('Invalid vendor asset path')
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(archive.read(name))
print(json.dumps({'package': 'mkdocs-material', 'version': '9.6.15', 'sha256': hashlib.sha256(wheel.read_bytes()).hexdigest()}))
