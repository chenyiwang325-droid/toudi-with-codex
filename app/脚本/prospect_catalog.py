"""公司级探查目录；只读已登记主报告，文件修改时间不是探查日期。"""
import os
import json
import re
from pathlib import Path
from urllib.parse import quote


def safe_path(root, relative):
    root=Path(root).resolve(); path=(root/relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('探查文件路径无效: '+relative)
    return path


def read_catalog(root, edits=None):
    root=Path(root);manifest=json.loads((root/'探查目录.json').read_text()) if (root/'探查目录.json').exists() else {'companies':[]}
    rows=[];seen=set();files=set();aliases={}
    for r in manifest['companies']:
        name=r['company'];ident=r['id']
        if name in seen or ident in {x['id'] for x in rows}:raise ValueError('同一公司重复登记: '+name)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',r['researchedAt']):raise ValueError('探查日期无效: '+name)
        seen.add(name);files.add(r['file']);content=safe_path(root,r['file']).read_text()
        attachments=[]
        for a in r.get('attachments',[]):
            safe_path(root,a['file']);attachments.append({**a,'url':'/api/prospect-file?path='+quote(a['file'],safe='')})
        rows.append({**r,'filename':r['file'],'content':content,'updatedAt':r['researchedAt'],
                     'status':'已探查','attachments':attachments})
        for alias in [name,*r.get('aliases',[])]:aliases[alias]=ident
    pending={}
    for key,v in (edits or {}).items():
        if not v.get('research'):continue
        name=key.split('｜')[0];ident=aliases.get(name,'pending:'+name)
        if ident not in pending:pending[ident]={'company':name,'notes':[],'keys':[]}
        pending[ident]['keys'].append(key)
        note=v.get('researchNote','')
        if note and note not in pending[ident]['notes']:pending[ident]['notes'].append(note)
    for ident,item in pending.items():
        existing=next((x for x in rows if x['id']==ident),None)
        if existing:
            existing['status']='待补充';existing['pendingNote']='\n\n'.join(item['notes'])
        else:
            rows.append({'id':ident,'company':item['company'],'title':item['company']+'｜待探查',
                         'researchedAt':'','updatedAt':'','filename':'','status':'待探查','attachments':[],
                         'content':'## 待探查\n\n尚无公司主报告，未开展新的调查。\n\n'+'\n\n'.join(item['notes'])})
    rows.sort(key=lambda x: (x.get('researchedAt',''),x['company']),reverse=True)
    archives=[{**a,'url':'/api/prospect-file?path='+quote(a['file'],safe='')} for a in manifest.get('archives',[])]
    # 新报告漏登记必须可见，不能再次悄悄混入平铺列表。
    unregistered=[p.name for p in root.glob('*.md') if p.name not in files and p.name not in {'探查流程与输出规范.md','README.md'}]
    return {'schemaVersion':1,'prospects':rows,'archives':archives,'unregistered':unregistered,
            'reportCount':len(manifest['companies']),'pendingCount':len(pending)}


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--write-index',action='store_true');p.add_argument('--root',type=Path,default=Path(os.environ.get('TOUDI_WORKSPACE',str(Path(__file__).resolve().parents[2]/'runtime')))/'岗位探查');a=p.parse_args()
    data=read_catalog(a.root)
    print(json.dumps({k:v for k,v in data.items() if k not in {'prospects','archives'}},ensure_ascii=False,indent=2))
    if data['unregistered']:raise SystemExit(1)
    if a.write_index:
        lines=['# 岗位探查目录','', '每家公司一份主报告；按最近实际探查日期倒序。整理日期不代表重新核验。待探查标记在中控台动态展示，不生成空报告。', '', '| 探查日期 | 公司 | 主报告 |','| --- | --- | --- |']
        for r in data['prospects']:
            lines.append(f"| {r['researchedAt']} | {r['company']} | [查看报告]({r['filename']}) |")
        lines += ['', '执行仓库docs/流程协作.md中的岗位探查约定。专项与原件由各公司主报告及中控台附件入口关联。', '', '维护：更新主报告与 `探查目录.json` 后，在项目根目录执行 `python3 -B app/脚本/prospect_catalog.py --write-index`。', '']
        (a.root/'README.md').write_text('\n'.join(lines))
