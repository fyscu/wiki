import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request


ROOT = Path('/opt/feiyang-wiki')
STAGE = Path('/var/tmp/feiyang-wiki-bootstrap')
IMAGE = 'feiyang/answer-runtime:2.0.2'


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def sql(query):
    return run(['docker', 'exec', '-i', 'mysql', 'sh', '-c',
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names'], input=query)


credentials = json.loads((STAGE / 'credentials.json').read_text())
if credentials['db_name'] != 'feiyang_wiki_qa' or credentials['db_user'] != 'fy_wiki_qa':
    raise RuntimeError('Unexpected database identity')
if not re.fullmatch('[0-9a-f]{48}', credentials['db_password']):
    raise RuntimeError('Invalid generated database credential')
existing = sql("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='feiyang_wiki_qa';")
if existing and not (ROOT / 'owner.json').exists():
    raise RuntimeError('Database already exists without project ownership marker')
containers = [json.loads(line) for line in run(['docker', 'ps', '-a', '--format', '{{json .}}']).splitlines()]
for container in containers:
    if container['Names'] == 'feiyang-wiki-answer':
        label = run(['docker', 'inspect', 'feiyang-wiki-answer', '--format', '{{index .Config.Labels "com.feiyang.project"}}'])
        if label != 'wiki':
            raise RuntimeError('Container name is already in use')
ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
(ROOT / 'qa' / 'data').mkdir(mode=0o750, parents=True, exist_ok=True)
if not existing:
    account = sql("SELECT COUNT(*) FROM mysql.user WHERE User='fy_wiki_qa';")
    if account != '0':
        raise RuntimeError('Database account already exists without project ownership')
    sql("CREATE DATABASE `feiyang_wiki_qa` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n"
        "CREATE USER 'fy_wiki_qa'@'%' IDENTIFIED BY '" + credentials['db_password'] + "' WITH MAX_USER_CONNECTIONS 20;\n"
        "GRANT ALL PRIVILEGES ON `feiyang_wiki_qa`.* TO 'fy_wiki_qa'@'%';\n")
    (ROOT / 'owner.json').write_text(json.dumps({'project': 'feiyang-wiki', 'database': 'feiyang_wiki_qa', 'stage': 'development'}))
    os.chmod(ROOT / 'owner.json', 0o600)
env = {'AUTO_INSTALL': '1', 'DB_TYPE': 'mysql', 'DB_HOST': 'mysql:3306',
       'DB_NAME': credentials['db_name'], 'DB_USERNAME': credentials['db_user'], 'DB_PASSWORD': credentials['db_password'],
       'LANGUAGE': 'zh_CN', 'SITE_NAME': '飞扬问答', 'SITE_URL': credentials['site_url'],
       'CONTACT_EMAIL': credentials['admin_email'], 'ADMIN_NAME': credentials['admin_name'],
       'ADMIN_EMAIL': credentials['admin_email'], 'ADMIN_PASSWORD': credentials['admin_password'],
       'EXTERNAL_CONTENT_DISPLAY': 'ask_before_display'}
env_path = ROOT / 'qa' / 'init.env'
env_path.write_text(''.join(f'{key}={value}\n' for key, value in env.items()))
os.chmod(env_path, 0o600)
try:
    output = run(['docker', 'run', '--rm', '--network', '1panel-network', '--env-file', str(env_path),
                  '-v', str(ROOT / 'qa' / 'data') + ':/data', IMAGE, 'init', '-C', '/data'], timeout=90)
    (ROOT / 'qa' / 'init.log').write_text(output)
    os.chmod(ROOT / 'qa' / 'init.log', 0o600)
finally:
    env_path.unlink(missing_ok=True)
if sql("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='feiyang_wiki_qa';") == '0':
    raise RuntimeError('Answer database was not initialized')
compose = STAGE / 'compose.server.yml'
(ROOT / 'compose.yaml').write_bytes(compose.read_bytes())
print(run(['docker', 'compose', '-f', str(ROOT / 'compose.yaml'), 'up', '-d']))
for _ in range(20):
    try:
        with urllib.request.urlopen('http://127.0.0.1:9080/', timeout=3) as response:
            if response.status == 200:
                print(json.dumps({'answer': 'running', 'database': credentials['db_name'], 'port': '127.0.0.1:9080'}))
                break
    except Exception:
        time.sleep(1)
else:
    raise RuntimeError('Answer did not become healthy')
