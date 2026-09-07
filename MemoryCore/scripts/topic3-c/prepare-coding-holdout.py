"""Prepare public-only task inputs for the generic SWE solver."""
import argparse,json,pathlib,subprocess,tarfile,io,hashlib
import pyarrow.parquet as pq

def run(args):
    p=subprocess.run(args,capture_output=True,text=True,encoding='utf8',errors='replace',check=True)
    return p.stdout

ap=argparse.ArgumentParser(); ap.add_argument('--task-id',required=True); ap.add_argument('--output',required=True); args=ap.parse_args()
rows=pq.read_table('scripts/topic3-c/data/swebench-verified/test-executable.parquet').to_pylist()
row=next(r for r in rows if r['instance_id']==args.task_id)
repo=row['repo'].split('/',1)[-1]; image=row['image']; tag='topic3c/holdout-'+args.task_id.split('-')[-1]+':base'
subprocess.run(['docker','pull',image],check=True)
tmp=pathlib.Path(args.output).resolve().parent/'_holdout-image'; tmp.mkdir(parents=True,exist_ok=True)
(tmp/'Dockerfile').write_text(f'FROM {image}\nRUN git checkout --detach {row["base_commit"]}\n',encoding='utf8',newline='\n')
subprocess.run(['docker','build','--pull=false','-t',tag,str(tmp)],check=True)
archive=subprocess.run(['docker','run','--rm','--entrypoint','git',tag,'archive',row['base_commit']],capture_output=True,check=True).stdout
files={}
with tarfile.open(fileobj=io.BytesIO(archive)) as ar:
    for m in ar:
        if not (m.isfile() and m.name.endswith(('.py','.pyi')) and '/tests/' not in m.name and m.size<400000):
            continue
        # SWE-bench images generally archive with a repository prefix, while
        # some images (notably Matplotlib) archive directly from repo root.
        name=m.name[len(repo)+1:] if m.name.startswith(repo+'/') else m.name
        if name and not name.startswith('.git/'):
            files[name]=ar.extractfile(m).read().decode('utf8',errors='replace')
task={'task_id':row['instance_id'],'repo':row['repo'],'query':row['problem_statement'],'created_at':row.get('created_at'),'base_commit':row['base_commit'],'image':tag,'files':files,'public_only':True,'source_sha256':hashlib.sha256((''.join(files)).encode()).hexdigest()}
out=pathlib.Path(args.output); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps([task],ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'task_id':task['task_id'],'image':tag,'base_commit':task['base_commit'],'source_files':len(files),'source_chars':sum(map(len,files.values()))}))
