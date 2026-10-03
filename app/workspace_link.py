"""Local workspace binding and evidence-preserving, explicit legacy adoption."""
import hashlib
import json
import os
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit

from workbench import Workbench, MODULES, Conflict, encoded, parser
from update_common import atomic_write, data_lock, raw_rows
from prep_resources import LINK
import remote_files


def app_profile():
    override=os.environ.get('TOUDI_APP_HOME')
    if override: return Path(override).expanduser().absolute()
    if sys.platform=='darwin': return Path.home()/'Library'/'Application Support'/'TouDi'
    if os.name=='nt': return Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'AppData'/'Local')))/'TouDi'
    return Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local'/'share')))/'toudi'


def binding_file(): return app_profile()/'connection.json'


def safe_directory(path):
    candidate=Path(path).expanduser().absolute()
    # Check lexical ancestors before resolving: a symlink cannot hide the selected root.
    for ancestor in [candidate,*candidate.parents]:
        if ancestor.is_symlink(): raise ValueError('symlink workspace paths are not supported')
    if not candidate.is_dir(): raise ValueError('workspace directory must already exist')
    return candidate.resolve()


def resolve_workspace(fallback=None):
    explicit=os.environ.get('TOUDI_WORKSPACE')
    if explicit: return Path(explicit).expanduser().absolute()
    link=binding_file()
    if link.exists():
        if any(ancestor.is_symlink() for ancestor in [link,*link.parents]): raise ValueError('symlink binding profile denied')
        if link.is_symlink(): raise ValueError('symlink binding file denied')
        data=json.loads(link.read_text(encoding='utf-8'))
        if data.get('schemaVersion')!=1 or not isinstance(data.get('workspace'),str) or not Path(data['workspace']).is_absolute(): raise ValueError('invalid workspace binding')
        return safe_directory(data['workspace'])
    return Path(fallback).expanduser().absolute() if fallback is not None else app_profile()/'workspace'


def inspector(root):
    workbench=Workbench.__new__(Workbench); workbench.root=root; workbench.data=root/'投递数据'
    return workbench


def snapshot(path,allow_repair=False):
    root=safe_directory(path); wb=inspector(root); files={}; changes={}; issues=[]; mapping=[]; counts={}; materials=[]
    def read(relative, reference=False):
        try: target=wb.path(relative)
        except ValueError:
            if not reference: raise
            target=remote_files.material_path(root,relative)
            if relative not in materials: materials.append(relative); issues.append({'code':'material_registration_required','file':relative})
        if not target.is_file(): return None
        content=target.read_bytes(); files[relative]=content; return content
    values={}
    for module,(relative,default) in MODULES.items():
        raw=read(relative)
        try: values[module]=json.loads(raw) if raw is not None else json.loads(encoded(default))
        except (ValueError,UnicodeError) as exc: raise ValueError('invalid JSON: '+relative) from exc
    record_path=MODULES['records'][0]
    authority=values['settings'].get('recordsAuthority',{})
    canonical_authority=(isinstance(authority,dict) and authority.get('schemaVersion')==1 and authority.get('source')==record_path)
    if canonical_authority and record_path not in files: raise ValueError('adopted canonical records are missing')
    html_rows=None; html_hashes={}
    for relative in ('投递数据/投递管理.html','投递管理.html'):
        target=root/relative
        if not target.exists(): continue
        for part in [target,*target.parents]:
            if part==root.parent: break
            if part.is_symlink(): raise ValueError('symlink HTML source denied')
        files[relative]=target.read_bytes(); html_hashes[relative]=hashlib.sha256(files[relative]).hexdigest()
        if canonical_authority: continue
        try: rows=raw_rows(target)
        except (ValueError,UnicodeError) as exc: raise ValueError('invalid legacy HTML RAW_DATA') from exc
        wb.validate('records',rows)
        if rows:
            if html_rows is not None and html_rows!=rows: issues.append({'code':'legacy_html_conflict','file':relative})
            html_rows=rows
    if html_rows:
        if record_path not in files:
            issues.append({'code':'adopt_required','file':record_path})
            if allow_repair: values['records']=html_rows; changes[record_path]=encoded(html_rows)
        elif values['records']!=html_rows: issues.append({'code':'records_html_conflict','file':record_path})
    # Duplicate IDs are repaired only by explicit adoption, preserving order and all other fields.
    qbank=values['qbank']
    for category in qbank.get('categories',[]) if isinstance(qbank,dict) else []:
        if not isinstance(category,dict) or not isinstance(category.get('items'),list): raise ValueError('invalid qbank category')
        seen=set(); reserved={i.get('id') for i in category.get('items',[]) if isinstance(i,dict)}
        for index,item in enumerate(category.get('items',[])):
            if not isinstance(item,dict): continue
            ident=item.get('id')
            if ident in seen and isinstance(ident,str):
                issue={'code':'duplicate_qbank_id','categoryId':category.get('id'),'itemId':ident,'index':index}; issues.append(issue)
                fingerprint=hashlib.sha256(encoded({'category':category.get('id'),'index':index,'item':item})).hexdigest()[:12]
                replacement=ident+'--adopt-'+fingerprint; ordinal=2
                while replacement in reserved: replacement=ident+'--adopt-'+fingerprint+'-'+str(ordinal); ordinal+=1
                item['id']=replacement; reserved.add(replacement); mapping.append({**issue,'newId':replacement})
            seen.add(ident)
    if mapping and allow_repair: changes[MODULES['qbank'][0]]=encoded(qbank)
    for module,value in values.items():
        try: wb.validate(module,value)
        except (ValueError,KeyError,TypeError) as exc:
            if module=='qbank' and not allow_repair and 'duplicate question id' in str(exc): continue
            raise ValueError('invalid '+module+': '+str(exc)) from exc
    for entry in values['settings'].get('materialFiles',[]):
        if read(entry,reference=True) is None: raise ValueError('missing registered attachment: '+entry)
    for module,key,folder in [('preps','preps',''),('prospects','companies','岗位探查/'),('reviews','sessions','')]:
        documents=[*values[module][key],*(values[module].get('archives',[]) if module=='prospects' else [])]
        for item in documents:
            relative=folder+item['file'] if module=='prospects' else item.get('mdPath')
            if not relative:
                if module=='preps': raise ValueError('preparation missing mdPath')
                continue
            # Existing review JSON is authoritative; never re-import its Markdown.
            relative=remote_files.canonical_reference(root,'root.md',relative)
            raw=read(relative,reference=True)
            if raw is None: raise ValueError('missing document: '+relative)
            text=raw.decode('utf-8')
            if module=='preps':
                candidate=wb.prepare({**item,'markdown':text},{})
                if candidate['sections']!=item.get('sections'): raise ValueError('preparation Markdown/JSON mismatch: '+relative)
                for field in ('headerNote','cohort','titleMid'):
                    if field in item and candidate[field]!=item[field]: raise ValueError('preparation metadata mismatch: '+relative)
            refs=[]
            for attachment in item.get('attachments',[]): refs.append(remote_files.canonical_reference(root,relative,attachment['file']))
            for href in LINK.findall(text):
                reference=remote_files.linked_reference(root,relative,href)
                if reference is not None: refs.append(reference)
            for ref in refs:
                if read(ref,reference=True) is None: raise ValueError('missing attachment: '+ref)
    if allow_repair:
        settings=values['settings']; settings_changed=False
        if materials:
            registered=settings.get('materialFiles',[])
            if not isinstance(registered,list): raise ValueError('invalid materialFiles')
            settings['materialFiles']=list(dict.fromkeys([*registered,*materials])); settings_changed=True
        if not canonical_authority and (record_path in files or record_path in changes):
            settings['recordsAuthority']={'schemaVersion':1,'source':record_path,'legacyHtml':html_hashes}; settings_changed=True
        if settings_changed:
            wb.validate('settings',settings); changes[MODULES['settings'][0]]=encoded(settings)
    for module,value in values.items():
        key={'records':None,'qbank':'categories','preps':'preps','reviews':'sessions','prospects':'companies'}.get(module)
        if module=='records': counts[module]=len(value)
        elif key: counts[module]=len(value[key])
    counts['qbankItems']=sum(len(c['items']) for c in values['qbank']['categories'])
    counts['marks']=len(values['edits']['edits'])
    hashes={relative:hashlib.sha256(content).hexdigest() for relative,content in sorted(files.items())}
    # Missing canonical files are part of the baseline too, so a concurrent creation conflicts.
    for relative,_ in MODULES.values(): hashes.setdefault(relative,'missing')
    base=hashlib.sha256(encoded(hashes)).hexdigest()
    return {'workspace':str(root),'base':base,'files':hashes,'counts':counts,'issues':issues,'changes':changes,'mapping':mapping}


def public_result(result):
    return {k:v for k,v in result.items() if k not in ('changes','mapping')} | {'changes':[{'path':k,'size':len(v)} for k,v in result['changes'].items()],'idRepairs':len(result['mapping'])}


def check_workspace(path):
    result=snapshot(path)
    return {'ok':not result['issues'],**public_result(result)}


def bind_workspace(path):
    checked=check_workspace(path)
    if not checked['ok']: raise ValueError('workspace needs explicit adoption or conflict resolution: '+','.join(i['code'] for i in checked['issues']))
    profile=app_profile()
    for ancestor in [profile,*profile.parents]:
        if ancestor.is_symlink(): raise ValueError('symlink app profile denied')
    profile.mkdir(parents=True,exist_ok=True)
    with data_lock(profile):
        if binding_file().is_symlink(): raise ValueError('symlink binding file denied')
        atomic_write(binding_file(),encoded({'schemaVersion':1,'workspace':checked['workspace']}))
    return {'ok':True,'workspace':checked['workspace'],'bindingFile':str(binding_file())}


def unbind_workspace():
    profile=app_profile()
    if profile.exists():
        for ancestor in [profile,*profile.parents]:
            if ancestor.is_symlink(): raise ValueError('symlink app profile denied')
        with data_lock(profile):
            if binding_file().is_symlink(): raise ValueError('symlink binding file denied')
            binding_file().unlink(missing_ok=True)
    return {'ok':True,'bound':False}


def adopt_workspace(path,apply=False,base=None):
    preview=snapshot(path,allow_repair=True)
    blocking=[issue for issue in preview['issues'] if issue['code'] not in ('adopt_required','duplicate_qbank_id','material_registration_required')]
    result={'ok':not blocking,'applied':False,**public_result(preview)}
    if not apply: return result
    if blocking: raise ValueError('adoption conflicts require manual reconciliation')
    if base is not None and base!=preview['base']: raise Conflict('adoption baseline changed')
    root=Path(preview['workspace']); wb=inspector(root)
    # Non-mutating preview above validates references before any data directory is created.
    with data_lock(wb.data):
        wb.recover_pending()
        current=snapshot(root,allow_repair=True)
        if current['base']!=preview['base']: raise Conflict('adoption baseline changed')
        if current['changes']:
            ident=uuid.uuid4().hex
            maintenance='投递数据/.adoptions/'+ident+'.json'
            changes=dict(current['changes'])
            changes[maintenance]=encoded({'schemaVersion':1,'before':current['files'],'idMapping':current['mapping']})
            recovery=wb.transaction(changes)
        else: recovery=None
    return {**result,'ok':True,'applied':True,'recovery':recovery}


def main(argv=None):
    import argparse
    ap=argparse.ArgumentParser(description='TouDi persistent local workspace binding')
    sub=ap.add_subparsers(dest='command',required=True)
    sub.add_parser('status'); sub.add_parser('unbind')
    for command in ('check','bind','adopt'):
        parser_=sub.add_parser(command); parser_.add_argument('path')
        if command=='adopt': parser_.add_argument('--apply',action='store_true'); parser_.add_argument('--base')
    args=ap.parse_args(argv)
    try:
        if args.command=='status': result={'ok':True,'workspace':str(resolve_workspace()),'bound':binding_file().exists(),'bindingFile':str(binding_file()),'explicitOverride':bool(os.environ.get('TOUDI_WORKSPACE'))}
        elif args.command=='check': result=check_workspace(args.path)
        elif args.command=='bind': result=bind_workspace(args.path)
        elif args.command=='unbind': result=unbind_workspace()
        else: result=adopt_workspace(args.path,args.apply,args.base)
        print(json.dumps(result,ensure_ascii=False)); return 0 if result['ok'] else 2
    except (ValueError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({'ok':False,'error':str(exc)},ensure_ascii=False)); return 3 if isinstance(exc,Conflict) else 2
