"""Verify the local npm archive is exactly the reviewed project-owned source."""
import hashlib,json,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'third_party/legacy-matcher'
names={'package.json','index.cjs','LICENSE','README.md'}
with tarfile.open(folder/'calligra-legacy-matcher-0.3.0.tgz') as archive:
    members=archive.getmembers()
    assert {member.name for member in members}=={'package/'+name for name in names}
    for member in members:
        assert member.isfile()
        assert archive.extractfile(member).read()==(folder/member.name.removeprefix('package/')).read_bytes(),member.name
package=json.loads((folder/'package.json').read_text())
assert package['name']=='calligra-legacy-matcher' and package['version']=='0.3.0'
assert package['dependencies']=={'minimatch-modern':'npm:minimatch@11.0.1'}
assert (folder/'LICENSE').read_bytes()==(ROOT/'LICENSE').read_text().replace('\r\n','\n').encode('utf-8')
print('PASS: exact source/archive identity; own API glue delegates parsing to fixed minimatch 11.0.1')
