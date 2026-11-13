"""Fail every npm advisory in both full trees and the production web tree."""
import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def audit(folder,production=False):
    cmd=['npm.cmd' if __import__('os').name=='nt' else 'npm','audit','--json']+(['--omit=dev'] if production else [])
    result=subprocess.run(cmd,cwd=ROOT/folder,capture_output=True,text=True)
    data=json.loads(result.stdout)
    assert result.returncode in [0,1] and 'metadata' in data,'Audit unavailable; do not interpret an error as zero vulnerabilities'
    return data
def main():
    policy=json.loads((ROOT/'release/dependency-policy.json').read_text(encoding='utf-8'))
    assert policy['schema_version']==2 and policy['maximum_vulnerabilities']==0 and policy['exceptions']==[], 'No advisory exceptions are permitted'
    report={}
    for folder,production in [('apps/web',True),('apps/web',False),('apps/desktop',False)]:
        data=audit(folder,production);key=folder+(':production' if production else ':full')
        report[key]=data
        assert data['metadata']['vulnerabilities']['total']==0,f'Dependency vulnerabilities in {key}'
        print(key, json.dumps(data['metadata']['vulnerabilities']))
    target=ROOT/'work/dependency-audit-rc.json';target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({'review_policy':policy,'audits':report},indent=2)+'\n',encoding='utf-8')
    print('PASS: zero advisories in web production, full web and full desktop dependency trees; no exceptions')
if __name__=='__main__':main()
