"""Offline canonical notice coverage and CODH derivative metadata gate."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'apps/web/public'

def validate_npm_coverage(manifest, lock):
    expected={}
    for relative,entry in lock['packages'].items():
        if not relative or entry.get('dev'):
            continue
        name=entry.get('name') or relative.split('node_modules/')[-1]
        expected[f"npm:{name}@{entry['version']}"]=(name,entry['version'],entry.get('license'))
    actual={c['id']:(c['name'],c['version'],c['license']) for c in manifest['components'] if c['id'].startswith('npm:')}
    assert actual==expected,'Npm notice coverage differs from locked production package versions/licenses'
def validate_reader(read):
    expected=(ROOT/'third_party/manifest.json').read_bytes()
    assert read('third-party-manifest.json')==expected,'Packaged third-party manifest differs'
    manifest=json.loads(expected)
    assert manifest['version']==json.loads((ROOT/'release/version.json').read_text(encoding='utf-8'))['version']
    ids=set()
    for component in manifest['components']:
        assert component['id'] not in ids,'Duplicate notice ID'
        ids.add(component['id'])
        for file in [component['license_text'],*component.get('additional_notices',[])]:
            assert hashlib.sha256(read(file['path'])).hexdigest()==file['sha256'],f"Licence checksum mismatch: {file['path']}"
    assert {item for item in ids if not item.startswith('npm:')}=={'application','ma-shan-zheng','zhi-mang-xing','liu-jian-mao-cao','yuji-syuku','yuji-mai','yuji-boku','yuji-akari','yuji-akebono','klee-one','jp-coverage-serif','codh','nccu','arphic','demo','harfbuzz','android-native','ionic-native'},'Canonical asset/native component coverage differs'
    validate_npm_coverage(manifest,json.loads((ROOT/'apps/web/package-lock.json').read_text(encoding='utf-8')))
    for path in ['THIRD_PARTY_NOTICE.md','third-party-licenses.html']:
        assert read(path)==(PUBLIC/path).read_bytes(),f'Packaged notice differs: {path}'
    native=[c for c in manifest['components'] if c['category']=='native']
    locked={line.split('=')[0] for line in (ROOT/'apps/web/android/app/gradle.lockfile').read_text(encoding='utf-8').splitlines() if line.endswith('=releaseRuntimeClasspath')}
    assert {coordinate for c in native for coordinate in c['resolved_dependencies']}==locked,'Native notice inventory differs from lockfile'
    assert next(c for c in native if c['id']=='ionic-native')['license']=='MIT'
    return len(ids)
def validate_codh():
    sources=json.loads((ROOT/'samples/japanese/historical/sample/manifest.json').read_text(encoding='utf-8'))['assets']
    glyphs=json.loads((PUBLIC/'japanese/glyphs.json').read_text(encoding='utf-8'))
    assert len(sources)==len(glyphs)==20
    original={item['variant_id']:item for item in sources}
    for glyph in glyphs:
        item=original[glyph['variant']['id']]; source=glyph['source']; meta=glyph['metadata']
        assert source['source_uri'].startswith('https://codh.rois.ac.jp/char-shape/')
        assert source['dataset']=='CODH Kuzushiji' and source['dataset_version']=='v2'
        assert source['work']==item['work'] and meta['book_id']==item['book_id']
        assert meta['page']==item['page'] and meta['source_bbox']==item['bbox']
        assert glyph['identity']['codepoints']==item['identity']['codepoints']
        assert '10.20676/00000340' in source['attribution']
        assert meta['original_crop_checksum']==item['sha256']
        assert meta['changes'] and meta['processing']=='ink-mask'
        assert source['license']==meta['derivative_license']=='CC-BY-SA-4.0'
        assert source['rights']['share_alike_required'] is True
        assert hashlib.sha256((PUBLIC/glyph['asset']['url']).read_bytes()).hexdigest()==glyph['asset']['checksum']
    return len(glyphs)
if __name__=='__main__':
    count=validate_reader(lambda file:(PUBLIC/file).read_bytes())
    print(f'PASS: {count} canonical licence components and {validate_codh()} full CODH derivative receipts')
