"""Verify exact platform receipts and hash the official Android and Web artifacts."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SIGNER = 'a65f5079bbcc7762fca3a8877dee0cf11edd7a490c8ab3069ed4ee918666d0cb'
LOCKS = {'web': 'apps/web/package-lock.json', 'python': 'apps/api/requirements.txt',
         'android': 'apps/web/android/app/gradle.lockfile'}


def canonical_sha256(file):
    return hashlib.sha256((ROOT / file).read_text(encoding='utf-8').encode()).hexdigest()


def receipt(directory, filename):
    return json.loads((directory / filename).read_text(encoding='utf-8-sig'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--allow-dirty', action='store_true', help='Only for a local, explicitly marked RC')
    args = parser.parse_args()
    release = receipt(ROOT / 'release', 'version.json')
    version = release['version']
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    assert commit == args.commit, 'Receipt commit differs from checkout'
    provenance = {platform: receipt(args.directory, f'{platform}-build-provenance.json')
                  for platform in ['web', 'android']}
    expected = {'locks': {key: canonical_sha256(file) for key, file in LOCKS.items()},
                'asset_manifest_sha256': canonical_sha256('samples/asset-manifest.json'),
                'third_party_manifest_sha256': canonical_sha256('third_party/manifest.json'),
                'build_timestamp': provenance['web']['build_timestamp']}
    for platform, record in provenance.items():
        assert record['commit'] == args.commit and record['version'] == version, 'Different commit/version across platforms'
        for key, value in expected.items():
            assert record[key] == value, f'{platform} build provenance mismatch for {key}'
        assert args.allow_dirty or not record['working_tree_dirty'], 'Dirty source cannot form a formal release'

    assets = []
    names = {f'CalligraphyStudio-Web-{version}.zip': 'web', f'CalligraphyStudio-Android-{version}.apk': 'android'}
    candidates = {file.name for file in args.directory.iterdir() if file.suffix.lower() in {'.exe', '.apk', '.zip'}}
    assert candidates == set(names), 'Unexpected release asset names'
    for filename, platform in names.items():
        file = args.directory / filename
        with file.open('rb') as payload:
            digest = hashlib.file_digest(payload, 'sha256').hexdigest()
        assets.append({'name': filename, 'sha256': digest, 'size': file.stat().st_size, 'platform': platform})

    android = receipt(args.directory, 'android-signing.json')
    assert args.allow_dirty or android['production_ready'], 'Production release forbids debug-signed Android preview'
    assert android['version'] == version and android['version_code'] == release['android_version_code']
    assert android['package_id'] == release['application_id']
    if android['production_ready']:
        assert android['certificate_sha256'] == SIGNER, 'Unapproved Android signing certificate'
    manifest = {'schema_version': 1, 'version': version, 'commit': commit,
                'local_rc': args.allow_dirty, 'build_timestamp': expected['build_timestamp'],
                'manifest_created_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'provenance': provenance, 'signing': {'android': android}, 'assets': assets}
    sums = ''.join(f"{asset['sha256']}  {asset['name']}\n" for asset in sorted(assets, key=lambda asset: asset['name']))
    (args.directory / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8', newline='\n')
    (args.directory / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('PASS: exact Web and Android receipts, SHA-256 manifest, ' + ('local RC' if args.allow_dirty else 'clean release'))


if __name__ == '__main__':
    main()
