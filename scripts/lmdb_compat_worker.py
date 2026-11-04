"""Actual LMDB operations on a fresh, synthetic, audit-owned corpus only."""
import hashlib,json,sys,struct,zlib
from pathlib import Path
import lmdb

ROOT=Path(__file__).resolve().parents[1]

def main():
    operation=sys.argv[1];path=Path(sys.argv[2]).resolve()
    assert path.is_relative_to((ROOT/'work/lmdb-compat').resolve())
    single='--single' in sys.argv
    def records():
        result={f'sample-{i:05}'.encode():('自有合成字符 '+str(i)).encode()*((i%31)+1) for i in range(256)}
        result.update({b'num-samples':b'256',b'empty-value':b'',b'binary\0key':bytes(range(256))*16,b'overflow-value':bytes(range(251))*1024,b'k'*500:b'long-key',b'provenance':b'own synthetic data; no MCCD or user database content'})
        # A tiny self-authored PNG exercises the real importer; no MCCD image is used.
        def png_chunk(kind,payload):
            return len(payload).to_bytes(4,'big')+kind+payload+(zlib.crc32(kind+payload)&0xffffffff).to_bytes(4,'big')
        png=bytes.fromhex('89504e470d0a1a0a')+png_chunk(b'IHDR',struct.pack('>IIBBBBB',4,4,8,0,0,0,0))+png_chunk(b'IDAT',zlib.compress(bytes([0,0,255,255,0])*4))+png_chunk(b'IEND',b'')
        result.update({b'image-000000001':png,b'label-000000001':b'7',b'char-000000001':b'23',b'style-000000001':b'2',b'dynasty-000000001':b'4'})
        return result
    expected=records()
    if '--upgraded' in sys.argv:expected[b'upgrade-marker']=b'committed by python-lmdb 3.0.0'
    if '--rolled-back-version' in sys.argv:expected[b'old-version-marker']=b'committed after reopening in python-lmdb 2.3.0'
    if operation=='provider':
        import io
        sys.path.insert(0,str(ROOT/'apps/api'))
        from PIL import Image
        from app.providers.mccd import MCCDLmdbProvider
        provider=MCCDLmdbProvider(path,attribute_mode='four-task',dataset_name='Own synthetic LMDB compatibility fixture',license_name='CC0-1.0',license_url='https://creativecommons.org/publicdomain/zero/1.0/',rights={key:True for key in ['commercial_use','derivatives_allowed','redistribution_allowed','research_use']},maps={'character':{'23':'山'},'style':{'2':'合成书体'},'dynasty':{'4':'合成时代'},'calligrapher':{'7':'自有合成书写者'}})
        rows=list(provider.iter_records());assert len(rows)==1
        record=rows[0];assert record.character=='山' and record.style=='合成书体' and record.calligrapher=='自有合成书写者' and record.license=='CC0-1.0'
        with Image.open(io.BytesIO(record.asset_bytes)) as image:assert image.size==(4,4)
        print(json.dumps(dict(operation=operation,binding=lmdb.__version__,native_version=lmdb.version(),records=len(rows),synthetic_only=True,character=record.character)))
        sys.exit(0)
    readonly=operation=='read'
    env=lmdb.open(str(path),subdir=not single,readonly=readonly,create=not readonly,lock=not readonly,max_readers=32,map_size=16*1024**2)
    try:
        if operation=='create':
            with env.begin(write=True) as transaction:
                for key,value in expected.items():transaction.put(key,value)
            env.sync()
        elif operation in ['upgrade','old-write']:
            with env.begin(write=True) as transaction:
                for key,value in expected.items():assert transaction.get(key)==value
                if operation=='upgrade':transaction.put(b'upgrade-marker',b'committed by python-lmdb 3.0.0')
                else:transaction.put(b'old-version-marker',b'committed after reopening in python-lmdb 2.3.0')
            aborted=env.begin(write=True);aborted.put(b'aborted-marker',b'must never persist');aborted.abort();env.sync()
        elif operation=='copy':
            destination=Path(sys.argv[3]).resolve();assert destination.is_relative_to((ROOT/'work/lmdb-compat').resolve())
            destination.mkdir();env.copy(str(destination),compact='--compact' in sys.argv)
        elif operation=='read':
            with env.begin() as transaction:
                actual=dict(transaction.cursor());assert actual==expected
                assert transaction.get(b'aborted-marker') is None
            try:env.begin(write=True)
            except lmdb.ReadonlyError:pass
            else:raise AssertionError('readonly environment accepted a write transaction')
        else:raise ValueError(operation)
        with env.begin() as transaction:
            actual=dict(transaction.cursor())
            digest=hashlib.sha256(b''.join(len(k).to_bytes(4,'big')+k+len(v).to_bytes(4,'big')+v for k,v in sorted(actual.items()))).hexdigest()
        print(json.dumps(dict(operation=operation,binding=lmdb.__version__,native_version=lmdb.version(),records=len(actual),logical_sha256=digest,stat=env.stat(),single_file=single)))
    finally:env.close()


if __name__=='__main__':
    main()
