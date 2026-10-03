"""Persistent bounded workspace operations shared by HTTP and the Agent CLI."""
import ast
import types
import base64
import copy
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlsplit, unquote
sys.path.insert(0, str(Path(__file__).parent / '脚本'))
from update_common import atomic_write, data_lock, runtime_keys
from publish_records import validate as validate_records
import remote_files

MODULES = {
 'records': ('投递数据/投递记录.json', []),
 'edits': ('投递数据/用户编辑数据.json', {'edits': {}, 'pref': {}}),
 'qbank': ('投递数据/逐字稿数据.json', {'categories': []}),
 'preps': ('投递数据/面试准备数据.json', {'preps': []}),
 'reviews': ('投递数据/面试复盘数据.json', {'sessions': []}),
 'prospects': ('岗位探查/探查目录.json', {'companies': []}),
 'settings': ('投递数据/工作区配置.json', {'schemaVersion': 1}),
 'drafts': ('投递数据/草稿数据.json', {}),
}
class Conflict(ValueError): pass

def encoded(value): return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()
def parser(name):
    # Load existing pure parser functions without their CLI workspace initialization.
    path=Path(__file__).parent/'脚本'/name
    source=path.read_text().replace("open(path, encoding='utf-8').read()", "Path(path).read_text(encoding='utf-8')")
    tree=ast.parse(source)
    tree.body=[node for node in tree.body if not isinstance(node,(ast.Expr,ast.If))]
    mod=types.ModuleType('toudi_'+name); mod.__file__=str(path); mod.Path=Path
    exec(compile(tree,str(path),'exec'),mod.__dict__)
    return mod

class Workbench:
    def __init__(self, root):
        self.root=Path(root).resolve(); self.data=self.root/'投递数据'; self.data.mkdir(parents=True, exist_ok=True)
    def path(self, relative):
        if relative == MODULES['drafts'][0]:
            relative_path=Path(relative)
            if (self.root/relative_path).is_symlink(): raise ValueError('symlink denied')
            return self.root/relative_path
        return remote_files.allowed_path(self.root, relative)
    def read(self, module):
        relative, default=MODULES[module]; path=self.path(relative)
        if not path.exists(): return copy.deepcopy(default)
        value=json.loads(path.read_text(encoding='utf-8')); self.validate(module,value); return value
    def validate(self,module,value):
        if module=='records': return validate_records(value)
        if not isinstance(value,dict): raise ValueError('JSON root must be an object')
        key={'qbank':'categories','preps':'preps','reviews':'sessions','prospects':'companies'}.get(module)
        if key:
            rows=value.get(key)
            if not isinstance(rows,list): raise ValueError(key+' must be an array')
            ids=[]
            for row in rows:
                if not isinstance(row,dict) or not isinstance(row.get('id'),str) or not row['id']: raise ValueError('nonempty id required')
                ids.append(row['id'])
            if len(ids)!=len(set(ids)): raise ValueError('duplicate id')
            if module=='qbank':
                for category in rows:
                    if not isinstance(category.get('name'),str) or not isinstance(category.get('items'),list): raise ValueError('invalid category')
                    item_ids=[]
                    for item in category['items']:
                        if not isinstance(item.get('id'),str) or not item['id'] or not (all(isinstance(item.get(k),str) for k in ('title','body')) or all(isinstance(item.get(k),str) for k in ('q','a'))): raise ValueError('invalid question item')
                        item_ids.append(item['id'])
                    if len(item_ids)!=len(set(item_ids)): raise ValueError('duplicate question id')
            if module=='reviews':
                for row in rows:
                    if not isinstance(row.get('questions',[]),list): raise ValueError('questions must be an array')
            if module=='prospects':
                names=[row.get('company') for row in rows]
                if len(names)!=len(set(names)): raise ValueError('duplicate prospect company')
                for row in rows:
                    if not row.get('company') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',row.get('researchedAt','')): raise ValueError('company/date required')
                    self.path('岗位探查/'+row['file'])
        if module=='settings':
            def check_settings(node):
                if isinstance(node,dict):
                    for key,child in node.items():
                        normalized=re.sub('[^a-z]','',key.lower())
                        if normalized in {'password','token','agenttoken','desktoptoken','apikey','secret','sessionsecret'}: raise ValueError('credentials belong in protected environment, not workspace settings')
                        check_settings(child)
                elif isinstance(node,list):
                    for child in node: check_settings(child)
            check_settings(value)
        if module=='edits' and (not isinstance(value.get('edits'),dict) or not isinstance(value.get('pref'),dict) or any(not isinstance(v,dict) for v in value['edits'].values())): raise ValueError('invalid edits/pref')
    def inventory(self):
        out={}
        for relative in [row['path'] for row in remote_files.files(self.root)]+[MODULES['drafts'][0]]:
            path=self.path(relative)
            if path.is_file(): out[relative]=path.read_bytes()
        return out
    def version(self,module=None):
        if module in ('settings','drafts'):
            relative=MODULES[module][0]; path=self.path(relative)
            values={relative:path.read_bytes()} if path.is_file() else {}
        else:
            values=self.inventory()
        if module in MODULES and module not in ('settings','drafts'):
            values={k:v for k,v in values.items() if k not in (MODULES['settings'][0],MODULES['drafts'][0])}
        return hashlib.sha256(encoded({k:hashlib.sha256(v).hexdigest() for k,v in sorted(values.items())})).hexdigest()
    def recover_pending(self):
        folder=self.data/'.transactions'
        if not folder.exists(): return
        for tx in folder.iterdir():
            manifest=tx/'manifest.json'
            if not manifest.exists(): continue
            state=json.loads(manifest.read_text())
            if state['state']!='pending': continue
            self.rollback(tx,state); state['state']='rolledback'; atomic_write(manifest,encoded(state))
    def rollback(self,tx,state):
        for relative,exists in state['before'].items():
            target=self.path(relative)
            if exists: atomic_write(target,(tx/'before'/relative).read_bytes())
            else: target.unlink(missing_ok=True)
    def transaction(self, changes):
        tx=self.data/'.transactions'/uuid.uuid4().hex; tx.mkdir(parents=True)
        state={'state':'pending','before':{}}
        for relative,content in changes.items():
            target=self.path(relative); state['before'][relative]=target.exists()
            if target.exists(): atomic_write(tx/'before'/relative,target.read_bytes())
            if content is not None: atomic_write(tx/'after'/relative,content)
        atomic_write(tx/'manifest.json',encoded(state))
        try:
            for relative,content in changes.items():
                target=self.path(relative)
                if content is None: target.unlink(missing_ok=True)
                else: atomic_write(target,content)
            state['state']='committed'; atomic_write(tx/'manifest.json',encoded(state))
        except BaseException:
            self.rollback(tx,state); state['state']='rolledback'; atomic_write(tx/'manifest.json',encoded(state)); raise
        return tx.name
    def get(self,module):
        with data_lock(self.data):
            self.recover_pending()
            if module=='workspace': return {'version':self.version(),'data':{'modules':list(MODULES)}}
            if module=='trash':
                txs=self.data/'.transactions'
                rows=[]
                for tx in txs.iterdir() if txs.exists() else []:
                    state=json.loads((tx/'manifest.json').read_text()) if (tx/'manifest.json').exists() else {}
                    if state.get('state')=='committed' and set(state['before']) - {MODULES['settings'][0],MODULES['drafts'][0]}:
                        rows.append({'id':tx.name,'files':list(state['before'])})
                return {'version':self.version(),'data':{'transactions':rows}}
            value=self.view(module)
            return {'version':self.version(module),'data':value,**({'keys':runtime_keys(value)} if module=='records' else {})}
    def view(self,module):
        value=self.read(module)
        if module=='preps':
            for item in value['preps']:
                path=self.path(item['mdPath']); item['markdown']=path.read_text() if path.exists() else ''
                from prep_resources import LINK
                attachments=item.setdefault('attachments',[]); known={a['file'] for a in attachments}
                for href in LINK.findall(item['markdown']):
                    url=urlsplit(href)
                    if url.scheme or url.netloc or not url.path: continue
                    filename=unquote(url.path)
                    try: target=self.path((Path(item['mdPath']).parent/filename).as_posix())
                    except ValueError: continue
                    if target.is_file() and filename not in known:
                        attachments.append({'file':filename,'label':target.name}); known.add(filename)
        if module=='prospects':
            for item in value['companies']:
                item['markdown']=self.path('岗位探查/'+item['file']).read_text()
                for attachment in item.get('attachments',[]): attachment['markdown']=self.path('岗位探查/'+attachment['file']).read_text()
        return value
    def legacy_commit_locked(self,module,patch):
        """Caller owns data_lock and has checked legacy mtime base after recovery.

        Keep legacy collection payloads while sharing the durable recovery transaction.
        This helper deliberately never acquires another flock.
        """
        if module not in ('edits','qbank','reviews'): raise ValueError('unsupported legacy module')
        current=self.read(module)
        value={**current,**copy.deepcopy(patch)}
        self.validate(module,value)
        return self.transaction({MODULES[module][0]:encoded(value)})
    def mutate(self,payload):
        with data_lock(self.data):
            self.recover_pending()
            module=payload['module']
            if payload.get('base')!=self.version(module): raise Conflict('version_conflict')
            module=payload['module']; action=payload['action']; changes={}
            if module in ('settings','drafts'):
                if action not in ('replace','import') or 'data' not in payload or payload.get('files'): raise ValueError('settings/drafts require replace or import without material files')
                # Validate existing data first: damaged files are never replaced as an empty default.
                self.read(module)
                value=copy.deepcopy(payload['data']); self.validate(module,value)
                atomic_write(self.path(MODULES[module][0]),encoded(value))
                return {'ok':True,'version':self.version(module),'data':value}
            if module=='trash' and action=='restore':
                ident=payload['id']
                if not re.fullmatch('[a-f0-9]{32}',ident): raise ValueError('invalid recovery id')
                tx=self.data/'.transactions'/ident; state=json.loads((tx/'manifest.json').read_text())
                for relative,exists in state['before'].items(): changes[relative]=(tx/'before'/relative).read_bytes() if exists else None
            else:
                value=self.read(module); item=copy.deepcopy(payload.get('item',{})); ident=payload.get('id') or item.get('id')
                if action in ('replace','import') and 'data' in payload:
                    value=copy.deepcopy(payload['data'])
                    if module=='preps': value['preps']=[self.prepare(row,changes) for row in value['preps']]
                    if module=='prospects': value['companies']=[self.prospect(row,changes) for row in value['companies']]
                    if module=='records': self.reassociate(self.read('records'),value,payload.get('identityMap',{}),changes)
                elif module=='records':
                    old=copy.deepcopy(value); keys=runtime_keys(value)
                    index=keys.index(ident) if ident in keys else None
                    if action=='delete':
                        if index is None: raise ValueError('record missing')
                        value.pop(index)
                    elif action=='upsert':
                        record=item.get('record',item); record.pop('id',None)
                        if index is None: value.append(record)
                        else: value[index]=record
                    else: raise ValueError('unknown action')
                    newkeys=runtime_keys(value)
                    mapping={k:newkeys[i if index is None or i<index else i-1] for i,k in enumerate(keys) if action=='delete' and i!=index} if action=='delete' else {k:newkeys[i] for i,k in enumerate(keys)}
                    self.reassociate(old,value,mapping,changes)
                elif module in ('preps','prospects','reviews','qbank'):
                    key={'preps':'preps','prospects':'companies','reviews':'sessions','qbank':'categories'}[module]
                    if not isinstance(ident,str) or not ident: raise ValueError('id required')
                    if action=='delete':
                        if not any(r['id']==ident for r in value[key]): raise ValueError('item missing')
                        value[key]=[r for r in value[key] if r['id']!=ident]
                    elif action in ('upsert','import'):
                        if module=='preps': item=self.prepare(item,changes)
                        elif module=='prospects': item=self.prospect(item,changes)
                        elif module=='reviews' and 'markdown' in item: item=self.review(item,changes)
                        old=next((r for r in value[key] if r['id']==ident),{})
                        item={**old,**item}; value[key]=[r for r in value[key] if r['id']!=ident]+[item]
                    else: raise ValueError('unknown action')
                else: raise ValueError('use replace with data')
                self.validate(module,value); changes[MODULES[module][0]]=encoded(value)
                for attachment in payload.get('files',[]):
                    relative=attachment['path']
                    if attachment.get('delete'):
                        if not relative.startswith(('面试准备/','岗位探查/','复盘/')): raise ValueError('invalid attachment path')
                        self.path(relative); changes[relative]=None; continue
                    content=base64.b64decode(attachment['contentBase64'],validate=True)
                    if not relative.startswith(('面试准备/','岗位探查/','复盘/')): raise ValueError('attachments must be bounded materials')
                    remote_files.check_content(relative,content,validate_records); self.path(relative); changes[relative]=content
            self.check_references(changes)
            recovery=self.transaction(changes)
            return {'ok':True,'version':self.version(module),'data':self.view(module) if module in MODULES else {},'recovery':recovery,**({'keys':runtime_keys(value)} if module=='records' else {})}
    def check_references(self,changes):
        def content(relative):
            if relative in changes: return changes[relative]
            path=self.path(relative)
            return path.read_bytes() if path.exists() else None
        for module,key,folder in [('preps','preps',''),('prospects','companies','岗位探查/')]:
            value=json.loads(content(MODULES[module][0]) or encoded(MODULES[module][1]))
            for row in value[key]:
                relative=folder+row['file'] if folder else row['mdPath']
                self.path(relative)
                if content(relative) is None: raise ValueError('missing referenced document '+relative)
                if module=='preps':
                    parsed=self.prepare({**row,'markdown':content(relative).decode()}, {})
                    if parsed['sections']!=row['sections']: raise ValueError('preparation Markdown and JSON differ')
                    from prep_resources import LINK
                    for href in LINK.findall(content(relative).decode()):
                        url=urlsplit(href)
                        if url.scheme or url.netloc or not url.path: continue
                        linked=(Path(row['mdPath']).parent/unquote(url.path)).as_posix()
                        # Missing historical references remain visible as missing, but a managed deletion cannot break active references.
                        if linked in changes and changes[linked] is None: raise ValueError('document still references deleted attachment')
                for attachment in row.get('attachments',[]):
                    relative=folder+attachment['file'] if folder else (Path(row['mdPath']).parent/attachment['file']).as_posix(); self.path(relative)
                    if content(relative) is None: raise ValueError('missing referenced attachment')
    def reassociate(self,old,new,mapping,changes):
        validate_records(new); oldkeys=runtime_keys(old); newkeys=runtime_keys(new)
        if len(newkeys)!=len(set(newkeys)): raise ValueError('ambiguous record identities')
        for key,row in zip(oldkeys,old):
            if key not in mapping:
                exact=[k for k,r in zip(newkeys,new) if r==row]
                if len(exact)==1: mapping[key]=exact[0]
                elif key in newkeys: mapping[key]=key
        edits=self.read('edits'); original=copy.deepcopy(edits['edits'])
        for source,target in mapping.items():
            if source not in oldkeys or target not in newkeys: raise ValueError('invalid identityMap')
            if source!=target and source in original:
                if target in original and target not in mapping: raise ValueError('mark identity collision')
                edits['edits'].pop(source,None)
        for source,target in mapping.items():
            if source in original: edits['edits'][target]=original[source]
        changes[MODULES['edits'][0]]=encoded(edits)
        for module,key in [('preps','preps'),('reviews','sessions')]:
            data=self.read(module)
            for row in data[key]:
                if row.get('companyKey') in mapping: row['companyKey']=mapping[row['companyKey']]
            changes[MODULES[module][0]]=encoded(data)
    def prepare(self,item,changes):
        ident=item['id']; relative=item.get('mdPath') or '面试准备/'+ident+'.md'; self.path(relative)
        if not relative.startswith('面试准备/') or Path(relative).stem!=ident: raise ValueError('prep id must match Markdown stem')
        item=copy.deepcopy(item)
        item['attachments']=[{k:v for k,v in a.items() if k!='contentBase64'} for a in item.get('attachments',[])]
        text=item['markdown']; mod=parser('9_面试准备导入.py')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/(ident+'.md'); path.write_text(text)
            try: _,title,cohort,mid,note,sections=mod.parse_doc(path,[])
            except SystemExit as exc: raise ValueError('invalid preparation Markdown') from exc
        company=item.get('company',''); position=item.get('position','')
        if not company: company,position=mod.split_company_position(title,[r['名称'] for r in self.read('records')])
        if not company: raise ValueError('cannot infer company; provide company and position')
        changes[relative]=text.encode()
        return {k:v for k,v in {**item,'company':company,'position':position,'cohort':cohort,'titleMid':mid,'headerNote':note,'sections':sections,'mdPath':relative}.items() if k!='markdown'}
    def prospect(self,item,changes):
        relative=item.get('file') or item['id']+'.md'
        if Path(relative).suffix!='.md': raise ValueError('prospect requires Markdown')
        self.path('岗位探查/'+relative); changes['岗位探查/'+relative]=item['markdown'].encode()
        attachments=[]
        for a in item.get('attachments',[]):
            self.path('岗位探查/'+a['file'])
            if Path(a['file']).suffix!='.md': raise ValueError('prospect attachment requires Markdown')
            if 'markdown' in a: changes['岗位探查/'+a['file']]=a['markdown'].encode()
            elif not self.path('岗位探查/'+a['file']).exists(): raise ValueError('attachment missing')
            attachments.append({k:v for k,v in a.items() if k!='markdown'})
        return {**{k:v for k,v in item.items() if k!='markdown'},'file':relative,'attachments':attachments}
    def review(self,item,changes):
        mod=parser('6_复盘导入.py'); text=item['markdown']; sections=mod.split_sections(text)
        if any(k not in sections for k in '一二三四五'): raise ValueError('review requires five sections')
        relative='复盘/'+item['id']+'.md'; self.path(relative); changes[relative]=text.encode()
        try: header=mod.parse_header(text,relative)
        except SystemExit as exc: raise ValueError('review date/header invalid') from exc
        try:
            result={**{k:v for k,v in item.items() if k!='markdown'},**header,'questions':mod.parse_questions(sections['二']),'questionTree':sections['一'],'counterIntel':sections['三'],'summary':mod.parse_summary(sections['四']),'tracking':mod.parse_tracking(sections['五']),'mdPath':relative}
        except SystemExit as exc: raise ValueError('invalid review question structure') from exc
        return result
    def backup(self):
        with data_lock(self.data):
            self.recover_pending(); files=self.inventory(); manifest={'schemaVersion':1,'files':{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}}
            output=io.BytesIO()
            with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('manifest.json',encoded(manifest))
                for relative,content in files.items(): archive.writestr(relative,content)
            return output.getvalue()
    def inspect_backup(self,raw):
        if len(raw)>150*1024*1024: raise ValueError('backup too large')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos=archive.infolist()
            if len(infos)>10000 or sum(i.file_size for i in infos)>300*1024*1024: raise ValueError('expanded backup too large')
            names=[i.filename for i in infos]
            if len(names)!=len(set(names)): raise ValueError('duplicate backup paths')
            for info in infos:
                if (info.external_attr>>16)&0o170000==0o120000: raise ValueError('symlink denied')
                if info.filename!='manifest.json': self.path(info.filename)
            manifest=json.loads(archive.read('manifest.json'))
            if manifest.get('schemaVersion')!=1 or set(names)-{'manifest.json'}!=set(manifest['files']): raise ValueError('invalid backup manifest')
            files={k:archive.read(k) for k in manifest['files']}
            for relative,content in files.items():
                if hashlib.sha256(content).hexdigest()!=manifest['files'][relative]: raise ValueError('backup checksum mismatch')
                for module,(path,_) in MODULES.items():
                    if path==relative: self.validate(module,json.loads(content))
            for module,key,folder in [('preps','preps',''),('prospects','companies','岗位探查/')]:
                data=json.loads(files.get(MODULES[module][0],encoded(MODULES[module][1])))
                for row in data[key]:
                    reference=folder+row['file'] if folder else row['mdPath']
                    if reference not in files: raise ValueError('backup missing document '+reference)
                    for attachment in row.get('attachments',[]):
                        if (folder+attachment['file'] if folder else (Path(row['mdPath']).parent/attachment['file']).as_posix()) not in files: raise ValueError('backup missing attachment')
            candidates={path:encoded(default) for path,default in MODULES.values() if path not in files}
            candidates.update(files); self.check_references(candidates)
            return files
    def restore(self,raw,base,preview=False):
        files=self.inspect_backup(raw)
        if preview: return {'ok':True,'files':[{'path':k,'size':len(v)} for k,v in files.items()]}
        with data_lock(self.data):
            self.recover_pending()
            if base!=self.version(): raise Conflict('version_conflict')
            changes={k:None for k in self.inventory() if k not in files}; changes.update(files)
            self.check_references(changes)
            recovery=self.transaction(changes)
            return {'ok':True,'version':self.version(),'recovery':recovery}

def main(argv=None):
    import argparse
    ap=argparse.ArgumentParser(description='TouDi bounded Agent workspace CLI')
    ap.add_argument('--workspace',default=os.environ.get('TOUDI_WORKSPACE'),type=Path)
    sub=ap.add_subparsers(dest='command',required=True)
    read=sub.add_parser('read'); read.add_argument('module',choices=[*MODULES,'workspace','trash'])
    commit=sub.add_parser('commit'); commit.add_argument('payload',type=Path)
    check=sub.add_parser('validate'); check.add_argument('module',choices=MODULES); check.add_argument('file',type=Path)
    ingest=sub.add_parser('import'); ingest.add_argument('module',choices=MODULES); ingest.add_argument('file',type=Path); ingest.add_argument('--base',required=True)
    export=sub.add_parser('export'); export.add_argument('module',choices=MODULES); export.add_argument('output',type=Path)
    backup=sub.add_parser('backup'); backup.add_argument('output',type=Path)
    restore=sub.add_parser('restore'); restore.add_argument('file',type=Path); restore.add_argument('--base'); restore.add_argument('--preview',action='store_true')
    args=ap.parse_args(argv)
    if args.workspace is None: ap.error('--workspace or TOUDI_WORKSPACE is required')
    workbench=Workbench(args.workspace)
    try:
        if args.command=='read': result=workbench.get(args.module)
        elif args.command=='commit': result=workbench.mutate(json.loads(args.payload.read_text()))
        elif args.command=='validate': workbench.validate(args.module,json.loads(args.file.read_text())); result={'ok':True}
        elif args.command=='import': result=workbench.mutate({'module':args.module,'action':'import','base':args.base,'data':json.loads(args.file.read_text())})
        elif args.command=='export': atomic_write(args.output,encoded(workbench.get(args.module)['data'])); result={'ok':True,'path':str(args.output)}
        elif args.command=='backup': atomic_write(args.output,workbench.backup()); result={'ok':True,'path':str(args.output)}
        else: result=workbench.restore(args.file.read_bytes(),args.base,args.preview)
        print(json.dumps(result,ensure_ascii=False)); return 0
    except (ValueError,OSError,KeyError,zipfile.BadZipFile) as exc:
        print(json.dumps({'ok':False,'error':str(exc)},ensure_ascii=False),file=sys.stderr); return 3 if isinstance(exc,Conflict) else 2
if __name__=='__main__': sys.exit(main())
