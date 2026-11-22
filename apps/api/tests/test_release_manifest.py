"""Publication gates must reject accidental preview APKs and dirty receipts."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('release_manifest', ROOT / 'scripts/create_release_manifest.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


@pytest.fixture
def release_files(tmp_path, monkeypatch):
    release = json.loads((ROOT / 'release/version.json').read_text(encoding='utf-8'))
    version = release['version']
    def digest(path):
        return hashlib.sha256((ROOT / path).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest()
    receipt = {
        'commit': 'release-test', 'version': version, 'working_tree_dirty': False,
        'build_timestamp': '2026-10-06T00:00:00Z',
        'locks': {key: digest(path) for key, path in {
            'web': 'apps/web/package-lock.json',
            'python': 'apps/api/requirements.txt', 'android': 'apps/web/android/app/gradle.lockfile',
        }.items()},
        'asset_manifest_sha256': digest('samples/asset-manifest.json'),
        'third_party_manifest_sha256': digest('third_party/manifest.json'),
    }
    for platform in ['web', 'android']:
        (tmp_path / f'{platform}-build-provenance.json').write_text(json.dumps(receipt))
    (tmp_path / 'android-signing.json').write_text(json.dumps({
        'version': version, 'production_ready': True,
        'certificate_sha256': gate.SIGNER, 'package_id': release['application_id'],
        'version_code': release['android_version_code'],
    }))
    for name in [f'Web-{version}.zip', f'Android-{version}.apk']:
        (tmp_path / f'CalligraphyStudio-{name}').write_bytes(b'test payload')
    monkeypatch.setattr(gate.subprocess, 'check_output', lambda *a, **kw: 'release-test')
    monkeypatch.setattr(sys, 'argv', ['manifest', '--directory', str(tmp_path), '--commit', 'release-test'])
    return tmp_path


def alter_receipt(directory, name, **updates):
    path = directory / name
    path.write_text(json.dumps({**json.loads(path.read_text()), **updates}))


def test_preview_apk_rejected(release_files):
    alter_receipt(release_files, 'android-signing.json', production_ready=False)
    with pytest.raises(AssertionError, match='debug-signed'):
        gate.main()


def test_unapproved_production_signer_rejected(release_files):
    alter_receipt(release_files, 'android-signing.json', certificate_sha256='0' * 64)
    with pytest.raises(AssertionError, match='Unapproved Android'):
        gate.main()


def test_no_electron_files_in_release(release_files):
    (release_files / 'Retired-Windows.exe').write_bytes(b'old payload')
    with pytest.raises(AssertionError, match='Unexpected release asset names'):
        gate.main()


def test_official_release_requires_clean_exact_receipts(release_files):
    alter_receipt(release_files, 'web-build-provenance.json', working_tree_dirty=True)
    with pytest.raises(AssertionError, match='Dirty source'):
        gate.main()
    alter_receipt(release_files, 'web-build-provenance.json', working_tree_dirty=False)
    gate.main()
    result = json.loads((release_files / 'release-manifest.json').read_text())
    assert {asset['platform'] for asset in result['assets']} == {'web', 'android'}
    assert result['signing']['android']['production_ready']
    assert len((release_files / 'SHA256SUMS.txt').read_text().splitlines()) == 2
