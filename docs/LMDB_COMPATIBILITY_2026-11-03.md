# Python LMDB 3 compatibility

This updates the Python binding from 2.3.0 to 3.0.0. On the tested Windows x64/CPython 3.12 wheels, `lmdb.version()` reports native LMDB 0.9.35 and 0.9.36 respectively. A Python major version number alone does not establish a database-format migration. The application importer remains read-only, with the same `readonly=True`, `lock=False`, `readahead=False` and `meminit=False` calls; no production database migration or rewrite is added. Python >=3.11 remains the project requirement.

The regression creates an old-version database only inside a fresh `work/lmdb-compat` directory. Its 267 records contain self-authored Unicode values, empty/binary data, a long key, an overflow-page value and one tiny generated PNG with synthetic indexed attributes. There is no MCCD corpus, user database or private asset in this fixture; its generated bitmap and labels are CC0 test data.

The old/new interpreters are separate processes and their actual binding/native versions are recorded. Twenty operations verify:

- Opening the old directory database in 3.0.0, all key/value bytes and rejection of write transactions on a read-only environment.
- The actual `MCCDLmdbProvider` reading the old database, decoding the PNG and retaining indexed Unicode attributes and explicit synthetic provenance.
- Original `data.mdb` SHA-256 remaining unchanged after both generic reads and the application importer.
- Old-version normal/compact backups opened in the new version, and restoration of the original snapshot in both versions.
- New-version committed writes, explicitly aborted writes remaining absent, reopening and committing in 2.3.0, then reading all data again in 3.0.0.
- A new-version compact backup opened in both the old and new versions, preserving post-upgrade committed records.
- The single-file (`subdir=False`) layout opening read-only in 3.0.0 with unchanged file bytes.

Local API tests pass (98 tests) and the complete runtime dependency audit reports no known vulnerabilities. CI repeats the compatibility process with an isolated 2.3.0 interpreter and the actual 3.0.0 API environment on Linux, then uploads only the JSON result. Exact-head CI still has to pass before merge. The normal API tests/security, web/browser, Windows candidate and Android gates remain enabled.

Run from the repository root with the 3.0.0 API interpreter:

```text
python scripts/test_lmdb_compatibility.py --old-python PATH_TO_ISOLATED_LMDB_2_3_PYTHON
```

Use the venv executable path itself, including a Linux symlink, so the old interpreter loads the old environment. The command checks that the baseline is actually binding 2.3.0 and the new process is actually 3.0.0. CLI modules are safe to import during test collection.

These results cover the recorded architectures, native versions and synthetic standard layout. They do not certify arbitrary custom comparators, named-database schemas, cross-word-size/endianness files or every third-party LMDB build. Preserve independent backups of real data; this regression never opens or migrates it. Application and dataset licences/rights are unchanged.
