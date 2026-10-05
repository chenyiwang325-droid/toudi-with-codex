import base64
import io
import json
import os
import subprocess
import urllib.request
import urllib.error
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import workbench

class WorkspaceManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name); self.w=workbench.Workbench(self.root); self.root=self.w.root
    def tearDown(self): self.tmp.cleanup()
    def commit(self,module,action='replace',**kw):
        return self.w.mutate({'module':module,'action':action,'base':self.w.get(module)['version'],**kw})
    def test_restart_conflict_identity(self):
        self.commit('records',data=[{'名称':'Fixture Alpha','公告链接':'https://example.invalid/a'}])
        self.commit('edits',data={'edits':{'Fixture Alpha':{'note':'keep','starred':True}},'pref':{'cities':['X']}})
        self.commit('preps','upsert',item={'id':'fixture-prep','company':'Fixture Alpha','companyKey':'Fixture Alpha','markdown':'# Fixture Alpha产品（批次）面试准备\n## 第一节\n### 一个问题\n完整原文'})
        old=self.w.get('records')['version']
        self.commit('records','upsert',item={'id':'Fixture Alpha','record':{'名称':'Fixture Beta','公告链接':'https://example.invalid/b'}})
        restarted=workbench.Workbench(self.root)
        self.assertEqual(restarted.get('edits')['data']['edits']['Fixture Beta']['note'],'keep')
        self.assertEqual(restarted.get('preps')['data']['preps'][0]['companyKey'],'Fixture Beta')
        with self.assertRaises(workbench.Conflict): self.w.mutate({'module':'records','base':old,'action':'replace','data':[]})
    def test_transaction_rollback_and_crash_recovery(self):
        self.commit('records',data=[{'名称':'Fixture'}])
        tx=self.root/'投递数据/.transactions'/'deadbeef'; tx.mkdir()
        relative='投递数据/投递记录.json'
        workbench.atomic_write(tx/'before'/relative,workbench.encoded([{'名称':'Fixture'}]))
        workbench.atomic_write(tx/'manifest.json',workbench.encoded({'state':'pending','before':{relative:True}}))
        workbench.atomic_write(self.root/relative,workbench.encoded([{'名称':'Incomplete'}]))
        self.assertEqual(workbench.Workbench(self.root).get('records')['data'],[{'名称':'Fixture'}])
    def test_failed_transaction_preparation_leaves_no_partial_history(self):
        self.commit('records',data=[{'名称':'Fixture'}])
        before=self.w.inventory();folder=self.root/'投递数据/.transactions';history={p.name for p in folder.iterdir()}
        real=workbench.atomic_write
        def fail(path,content):
            if 'after' in Path(path).parts:raise OSError('synthetic staging failure')
            return real(path,content)
        with patch.object(workbench,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError):self.commit('records',data=[{'名称':'New fixture'}])
        self.assertEqual(self.w.inventory(),before)
        self.assertEqual({p.name for p in folder.iterdir()},history)
        self.assertNotIn('_materials_override',self.w.__dict__)
    def test_actual_cross_file_failure(self):
        self.commit('records',data=[{'名称':'Fixture'}]); self.commit('edits',data={'edits':{'Fixture':{'note':'new-note'}},'pref':{}})
        before=self.w.inventory(); real=workbench.atomic_write
        def fail(path,content):
            if Path(path)==self.root/'投递数据/面试准备数据.json': raise OSError('later write fails')
            return real(path,content)
        with patch.object(workbench,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError): self.commit('records','upsert',item={'id':'Fixture','record':{'名称':'Renamed'}})
        self.assertEqual(self.w.inventory(),before)
    def test_backup_restore_delete_settings_drafts(self):
        self.commit('settings',data={'schemaVersion':1,'sourcePolicy':'fixture'})
        self.commit('drafts',data={'editor':{'body':'unsaved'}})
        self.commit('prospects','upsert',item={'id':'fixture','company':'Fixture','researchedAt':'2026-10-03','markdown':'# evidence','attachments':[{'file':'notes.md','label':'Notes','markdown':'full evidence'}]})
        backup=self.w.backup(); preview=self.w.restore(backup,None,True); self.assertTrue(preview['files'])
        deletion=self.commit('prospects','delete',id='fixture'); self.assertEqual(self.w.read('prospects')['companies'],[])
        self.commit('trash','restore',id=deletion['recovery']); self.assertEqual(len(self.w.read('prospects')['companies']),1)
        self.commit('settings',data={})
        self.w.restore(backup,self.w.version())
        self.assertEqual(workbench.Workbench(self.root).get('drafts')['data']['editor']['body'],'unsaved')
        self.assertEqual(self.w.read('settings')['sourcePolicy'],'fixture')
    def test_hostile_backup_and_corrupt_data(self):
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as archive:
            archive.writestr('../escape.md','bad'); archive.writestr('manifest.json','{}')
        with self.assertRaises(ValueError): self.w.restore(raw.getvalue(),None,True)
        target=self.root/'投递数据/逐字稿数据.json'; target.write_text('{broken')
        with self.assertRaises(ValueError): self.w.get('qbank')
        self.assertEqual(target.read_text(),'{broken')
    def test_preparation_attachment_and_batch_roundtrip(self):
        text='# Fixture产品（批次）面试准备\n## 第一节\n### 问题\n正文 [附件](attachment.txt)'
        self.commit('preps','upsert',item={'id':'prep','company':'Fixture','markdown':text,'attachments':[{'file':'attachment.txt','label':'Attachment'}]},files=[{'path':'面试准备/attachment.txt','contentBase64':base64.b64encode(b'evidence').decode()}])
        exported=self.w.get('preps')['data']
        self.commit('preps','import',data=exported)
        self.assertEqual(self.w.get('preps')['data']['preps'][0]['markdown'],text)
        before=self.w.inventory()
        with self.assertRaises(ValueError): self.commit('preps','upsert',item={**exported['preps'][0],'attachments':[]},files=[{'path':'面试准备/attachment.txt','delete':True}])
        self.assertEqual(self.w.inventory(),before)
        self.w.restore(self.w.backup(),None,True)
    def test_config_drafts_lightweight_save_without_trash(self):
        self.commit('records',data=[{'名称':'Fixture'}])
        before=self.w.get('trash')['data']['transactions']
        for module in ('settings','drafts'):
            base=self.w.get(module)['version']
            with patch.object(self.w,'inventory',side_effect=AssertionError('must not scan business files')):
                self.w.mutate({'module':module,'base':base,'action':'replace','data':{'value':'persisted'}})
                self.assertEqual(self.w.get(module)['data']['value'],'persisted')
            with self.assertRaises(workbench.Conflict):
                self.w.mutate({'module':module,'base':base,'action':'replace','data':{}})
        self.assertEqual(self.w.get('trash')['data']['transactions'],before)
        deletion=self.commit('records','delete',id='Fixture')
        self.commit('trash','restore',id=deletion['recovery'])
        self.assertEqual(self.w.get('records')['data'],[{'名称':'Fixture'}])
        self.assertEqual(workbench.Workbench(self.root).get('drafts')['data'],{'value':'persisted'})
    def test_reviews_import_qbank_and_nonbusiness_version(self):
        version=self.w.get('records')['version']
        self.commit('drafts',data={'body':'draft'})
        self.commit('settings',data={'theme':'dark'})
        self.assertEqual(self.w.get('records')['version'],version)
        self.commit('qbank','import',data={'categories':[{'id':'category','name':'Fixture','items':[{'id':'question','title':'Question','body':'Full answer'}]}]})
        md='# Fixture面试复盘（2026-10-03，未知）\n## 一、问题树\nQ1\n## 二、逐题\n### Q1：问题\n- 当时的回答：完整原答\n- 本题判断：到位\n## 三、情报\n未知\n## 四、分析\n保留\n## 五、追踪\n暂无'
        self.commit('reviews','import',item={'id':'review','markdown':md})
        self.assertEqual(self.w.get('reviews')['data']['sessions'][0]['date'],'2026-10-03')
        self.assertEqual(self.w.get('reviews')['data']['sessions'][0]['questions'][0]['question'],'问题')
    def test_cli_and_live_service_restart(self):
        project=Path(__file__).resolve().parents[1]
        env={**os.environ,'TOUDI_MODE':'local','TOUDI_WORKSPACE':str(self.root),'TOUDI_PORT':'0'}
        def cli(*args):
            run=subprocess.run([sys.executable,str(project/'app/workbench.py'),'--workspace',str(self.root),*args],capture_output=True,text=True,env=env)
            self.assertEqual(run.returncode,0,run.stderr); return json.loads(run.stdout)
        self.assertIn('version',cli('read','records'))
        processes=[]
        try:
            for attempt in range(2):
                process=subprocess.Popen([sys.executable,'-u',str(project/'app/server.py')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env); processes.append(process)
                ready=json.loads(process.stdout.readline()); origin='http://127.0.0.1:'+str(ready['port'])
                def request(path,payload=None):
                    body=json.dumps(payload).encode() if payload is not None else None
                    req=urllib.request.Request(origin+path,data=body,headers={'Content-Type':'application/json','Origin':origin})
                    with urllib.request.urlopen(req,timeout=5) as result: return json.load(result)
                current=request('/api/manage?module=records')
                if attempt==0:
                    saved=request('/api/manage',{'module':'records','base':current['version'],'action':'upsert','item':{'record':{'名称':'HTTP Fixture'}}})
                    self.assertEqual(saved['keys'],['HTTP Fixture'])
                    with self.assertRaises(urllib.error.HTTPError) as error: request('/api/manage',{'module':'records','base':current['version'],'action':'replace','data':[]})
                    self.assertEqual(error.exception.code,409); error.exception.close()
                    self.assertEqual(cli('read','records')['data'],[{'名称':'HTTP Fixture'}])
                else: self.assertEqual(current['data'],[{'名称':'HTTP Fixture'}])
                process.terminate(); process.wait(timeout=5); process.stdout.close(); process.stderr.close()
        finally:
            for process in processes:
                if process.poll() is None: process.kill(); process.wait()
    def test_legacy_http_saves_share_recovery_and_versions(self):
        project=Path(__file__).resolve().parents[1]
        self.commit('settings',data={'theme':'dark'}); self.commit('drafts',data={'body':'keep draft'})
        fixtures=[('edits','/api/edits',{'edits':{'Fixture':{'note':'keep'}},'pref':{}},{'edits':{},'pref':{}}),
                  ('qbank','/api/questionbank',{'categories':[{'id':'c','name':'Fixture','items':[{'id':'q','q':'Question','a':'Answer','custom':'keep'}]}]},{'categories':[]}),
                  ('reviews','/api/reviews',{'sessions':[{'id':'s','company':'Fixture','questions':[],'custom':'keep'}]},{'sessions':[]})]
        for module,_,full,_ in fixtures:
            self.commit(module,data={**full,'unknownTop':{'keep':True}})
        process=subprocess.Popen([sys.executable,'-u',str(project/'app/server.py')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'TOUDI_MODE':'local','TOUDI_WORKSPACE':str(self.root),'TOUDI_PORT':'0'})
        try:
            origin='http://127.0.0.1:'+str(json.loads(process.stdout.readline())['port'])
            def request(path,payload=None):
                req=urllib.request.Request(origin+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'Content-Type':'application/json','Origin':origin})
                with urllib.request.urlopen(req,timeout=5) as response: return json.load(response)
            for module,path,full,empty in fixtures:
                legacy=request(path); management=request('/api/manage?module='+module)
                # A changed save using the legacy mtime contract gets a durable recovery transaction.
                changed=json.loads(json.dumps(full))
                if module=='edits': changed['edits']['Fixture']['note']='changed'
                elif module=='qbank': changed['categories'][0]['name']='Changed'
                else: changed['sessions'][0]['company']='Changed'
                initial_count=len(request('/api/manage?module=trash')['data']['transactions'])
                saved=request(path,{**changed,'base':legacy['version']})
                self.assertTrue(saved['ok']); self.assertIsInstance(saved['version'],str)
                self.assertEqual(len(request('/api/manage?module=trash')['data']['transactions']),initial_count+1)
                self.assertNotEqual(request('/api/manage?module='+module)['version'],management['version'])
                with self.assertRaises(urllib.error.HTTPError) as err: request(path,{**empty,'base':legacy['version']})
                self.assertEqual(err.exception.code,409); err.exception.close()
                request(path,{**empty,'base':saved['version']})
                transactions=self.root/'投递数据/.transactions'
                relative=workbench.MODULES[module][0]
                recovery=next(tx.name for tx in transactions.iterdir() if (tx/'after'/relative).exists() and json.loads((tx/'after'/relative).read_text())=={**empty,'unknownTop':{'keep':True}})
                trash=request('/api/manage?module=trash')
                request('/api/manage',{'module':'trash','action':'restore','base':trash['version'],'id':recovery})
                self.assertEqual(self.w.read(module),{**changed,'unknownTop':{'keep':True}})
            self.assertEqual(self.w.read('settings'),{'theme':'dark'})
            self.assertEqual(self.w.read('drafts'),{'body':'keep draft'})
        finally:
            process.terminate(); process.wait(timeout=5); process.stdout.close(); process.stderr.close()
    def test_symlink_attachment_refused(self):
        folder=self.root/'面试准备';folder.mkdir(); (folder/'outside.md').symlink_to('/tmp')
        with self.assertRaises(ValueError): self.w.path('面试准备/outside.md')

if __name__=='__main__': unittest.main()
