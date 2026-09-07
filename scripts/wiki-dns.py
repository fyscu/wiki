"""Manage only the authorized Wiki record using the existing 1Panel DNS account."""
import json
from pathlib import Path
import sqlite3
import sys
import zipfile

dependencies = Path('/opt/feiyang-wiki/tools/dns')
dependencies.mkdir(parents=True, exist_ok=True)
for wheel in Path('/var/tmp/feiyang-wiki-bootstrap/dns-wheels').glob('*-none-any.whl'):
    with zipfile.ZipFile(wheel) as package:
        package.extractall(dependencies)
sys.path.insert(0, str(dependencies))

from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.dnspod.v20210323 import dnspod_client, models

database = sqlite3.connect('file:/opt/1panel/db/1Panel.db?mode=ro', uri=True)
record = database.execute("SELECT authorization FROM website_dns_accounts WHERE id=1 AND type='TencentCloud'").fetchone()
if not record:
    raise RuntimeError('Expected DNS account not found')
account = json.loads(record[0])
client = dnspod_client.DnspodClient(credential.Credential(account['secretID'], account['secretKey']), '')
request = models.DescribeRecordListRequest()
request.from_json_string(json.dumps({'Domain': 'feiyang.ac.cn', 'Subdomain': 'wiki', 'Limit': 100}))
try:
    response = client.DescribeRecordList(request)
    records = response.RecordList or []
except TencentCloudSDKException as error:
    if error.get_code() == 'ResourceNotFound.NoDataOfRecord':
        records = []
    else:
        raise RuntimeError('DNS lookup failed: ' + error.get_code()) from None
matching = [r for r in records if r.Name == 'wiki']
conflicts = [r for r in matching if r.Type in ['A', 'AAAA', 'CNAME'] and not (r.Type == 'A' and r.Value == '45.40.247.178' and r.Status == 'ENABLE')]
if conflicts:
    raise RuntimeError('Conflicting DNS record exists; no records changed')
exists = any(r.Type == 'A' and r.Value == '45.40.247.178' for r in matching)
created = False
if '--apply' in sys.argv and not exists:
    request = models.CreateRecordRequest()
    request.from_json_string(json.dumps({'Domain': 'feiyang.ac.cn', 'SubDomain': 'wiki', 'RecordType': 'A', 'RecordLine': '\u9ed8\u8ba4', 'RecordLineId': '0', 'Value': '45.40.247.178', 'TTL': 600}))
    try:
        response = client.CreateRecord(request)
    except TencentCloudSDKException as error:
        raise RuntimeError('DNS creation failed: ' + error.get_code()) from None
    created = True
    state = Path('/opt/feiyang-wiki/dns-record.json')
    state.write_text(json.dumps({'domain': 'feiyang.ac.cn', 'subdomain': 'wiki', 'record_id': response.RecordId}))
    state.chmod(0o600)
print(json.dumps({'hostname': 'wiki.feiyang.ac.cn', 'address': '45.40.247.178', 'exists': exists or created, 'created': created}))
