import argparse,datetime,hashlib,json,os,platform,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description='Synthetic old/new LMDB persistence and real importer regression')
    parser.add_argument('--old-python',required=True)
    args=parser.parse_args()
    # Retain the venv executable path, including Linux symlinks; resolving it can
    # accidentally execute the base interpreter with a different site-packages.
    old=Path(os.path.abspath(args.old_python));new=Path(sys.executable)
    work=ROOT/'work/lmdb-compat'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');work.mkdir(parents=True)
    steps=[]
    def call(python,operation,path,*args):
        result=subprocess.run([str(python),str(ROOT/'scripts/lmdb_compat_worker.py'),operation,str(path),*map(str,args)],capture_output=True,text=True,encoding='utf-8',check=True)
        data=json.loads(result.stdout);steps.append(data);print(data['binding'],operation,data['records'],flush=True);return data
    original=work/'old';original.mkdir()
    baseline=call(old,'create',original);assert baseline['binding']=='2.3.0'
    file_hash=lambda folder:hashlib.sha256((folder/'data.mdb').read_bytes()).hexdigest()
    before=file_hash(original)
    modern=call(new,'read',original);assert modern['binding']=='3.0.0' and modern['logical_sha256']==baseline['logical_sha256']
    assert file_hash(original)==before,'readonly compatibility check changed original database bytes'
    assert call(new,'provider',original)['records']==1
    assert file_hash(original)==before,'actual application importer changed original database bytes'
    copy=work/'copy';compact=work/'compact'
    call(old,'copy',original,copy);call(old,'copy',original,compact,'--compact')
    assert call(new,'read',copy)['logical_sha256']==baseline['logical_sha256']
    assert call(new,'read',compact)['logical_sha256']==baseline['logical_sha256']
    call(new,'upgrade',copy)
    upgraded=call(new,'read',copy,'--upgraded');assert call(old,'read',copy,'--upgraded')['logical_sha256']==upgraded['logical_sha256']
    call(old,'old-write',copy,'--upgraded')
    rollback=call(old,'read',copy,'--upgraded','--rolled-back-version')
    assert call(new,'read',copy,'--upgraded','--rolled-back-version')['logical_sha256']==rollback['logical_sha256']
    modern_backup=work/'new-version-compact-backup'
    call(new,'copy',copy,modern_backup,'--compact')
    assert call(old,'read',modern_backup,'--upgraded','--rolled-back-version')['logical_sha256']==rollback['logical_sha256']
    assert call(new,'read',modern_backup,'--upgraded','--rolled-back-version')['logical_sha256']==rollback['logical_sha256']
    restore=work/'restored-from-compact';shutil.copytree(compact,restore)
    assert call(old,'read',restore)['logical_sha256']==baseline['logical_sha256']
    assert call(new,'read',restore)['logical_sha256']==baseline['logical_sha256']
    single=work/'single-file.mdb';single_baseline=call(old,'create',single,'--single')
    single_hash=hashlib.sha256(single.read_bytes()).hexdigest()
    assert call(new,'read',single,'--single')['logical_sha256']==single_baseline['logical_sha256']
    assert hashlib.sha256(single.read_bytes()).hexdigest()==single_hash
    assert file_hash(original)==before
    report=dict(ok=True,platform=platform.platform(),python=sys.version,work=str(work),synthetic_only=True,original_data_mdb_sha256=before,original_unchanged=True,steps=steps,limits=['This is the actual binding/native LMDB versions on this platform and Python interpreter, not arbitrary third-party databases or custom comparator/plugin formats.','No user database is opened or migrated. No MCCD corpus or private asset is used.'])
    (ROOT/'work/lmdb-compat-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    main()
