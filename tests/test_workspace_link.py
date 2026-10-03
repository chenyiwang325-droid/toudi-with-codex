import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import workspace_link as link
import workbench

class WorkspaceLinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name).resolve(); self.work=self.root/'work'; self.work.mkdir()
        self.profile=self.root/'profile'; self.env=patch.dict(os.environ,{'TOUDI_APP_HOME':str(self.profile)})
        self.env.start(); self.old=os.environ.pop('TOUDI_WORKSPACE',None)
    def tearDown(self):
        self.env.stop()
        if self.old is not None: os.environ['TOUDI_WORKSPACE']=self.old
        self.tmp.cleanup()
    def old_fixture(self):
        data=self.work/'投递数据';data.mkdir()
        (data/'投递管理.html').write_text('const RAW_DATA = '+json.dumps([{'名称':'Fixture','公告链接':'https://example.invalid'}])+';\n')
        q={'categories':[{'id':'cat','name':'Fixture','items':[{'id':'duplicate','title':'First','body':'complete first','unknown':[1]}, {'id':'duplicate','title':'Second','body':'complete second','unknown':[2]}]}]}
        (data/'逐字稿数据.json').write_text(json.dumps(q))
        (data/'用户编辑数据.json').write_text(json.dumps({'edits':{'Sleeping':{'note':'preserve dormant mark'}},'pref':{}}))
        (data/'面试复盘数据.json').write_text(json.dumps({'sessions':[{'id':'session','questions':[],'summary':{'raw':'latest web edit'}}]}))
        return q
    def cli(self,*args):
        return subprocess.run([sys.executable,str(Path(link.__file__).parent/'desktop_runtime.py'),'workspace',*args],env=os.environ,capture_output=True,text=True)
    def test_empty_check_binding_persistence_and_closed_app_cli(self):
        self.assertTrue(link.check_workspace(self.work)['ok']); self.assertFalse((self.work/'投递数据').exists())
        link.bind_workspace(self.work)
        result=self.cli('status'); self.assertEqual(result.returncode,0,result.stderr); self.assertEqual(json.loads(result.stdout)['workspace'],str(self.work))
        source=Path(link.__file__).parent/'desktop_runtime.py'
        run=subprocess.run([sys.executable,str(source),'read','records'],capture_output=True,text=True,env=os.environ)
        self.assertEqual(run.returncode,0,run.stderr); self.assertEqual(json.loads(run.stdout)['data'],[])
        payload=self.root/'candidate.json'; payload.write_text(json.dumps({'module':'records','base':json.loads(run.stdout)['version'],'action':'upsert','item':{'record':{'名称':'Closed App Fixture'}}}))
        committed=subprocess.run([sys.executable,str(source),'commit',str(payload)],capture_output=True,text=True,env=os.environ)
        self.assertEqual(committed.returncode,0,committed.stderr)
        reread=subprocess.run([sys.executable,str(source),'read','records'],capture_output=True,text=True,env=os.environ)
        self.assertEqual(json.loads(reread.stdout)['data'],[{'名称':'Closed App Fixture'}])
        with patch.dict(os.environ,{'TOUDI_WORKSPACE':str(self.root/'explicit')}): self.assertEqual(link.resolve_workspace(),self.root/'explicit')
        link.unbind_workspace(); self.assertEqual(link.resolve_workspace(),self.profile/'workspace')
    def test_adopt_preview_apply_preserves_all_content_and_conflicts(self):
        q=self.old_fixture(); before={p:p.read_bytes() for p in (self.work/'投递数据').iterdir()}
        checked=link.check_workspace(self.work); self.assertFalse(checked['ok'])
        with self.assertRaises(ValueError): link.bind_workspace(self.work)
        plan=link.adopt_workspace(self.work); self.assertTrue(plan['ok']); self.assertEqual(plan['idRepairs'],1)
        self.assertEqual({p:p.read_bytes() for p in before},before)
        with self.assertRaises(workbench.Conflict): link.adopt_workspace(self.work,True,'stale')
        self.assertFalse((self.work/'投递数据/投递记录.json').exists())
        result=link.adopt_workspace(self.work,True,plan['base']); self.assertTrue(result['applied'])
        wb=workbench.Workbench(self.work); items=wb.read('qbank')['categories'][0]['items']
        self.assertEqual(items[0],q['categories'][0]['items'][0]); self.assertNotEqual(items[1]['id'],'duplicate')
        self.assertEqual({k:v for k,v in items[1].items() if k!='id'},{k:v for k,v in q['categories'][0]['items'][1].items() if k!='id'})
        self.assertTrue(link.check_workspace(self.work)['ok'])
        self.assertEqual((self.work/'投递数据/投递管理.html').read_bytes(),before[self.work/'投递数据/投递管理.html'])
        self.assertEqual((self.work/'投递数据/面试复盘数据.json').read_bytes(),before[self.work/'投递数据/面试复盘数据.json'])
        self.assertIn('Sleeping',wb.read('edits')['edits'])
        maintenance=list((self.work/'投递数据/.adoptions').glob('*.json'))
        self.assertEqual(len(maintenance),1); self.assertEqual(len(json.loads(maintenance[0].read_text())['idMapping']),1)
    def test_bad_json_records_disagreement_missing_attachment(self):
        data=self.work/'投递数据';data.mkdir(); (data/'用户编辑数据.json').write_text('broken')
        with self.assertRaises(ValueError): link.adopt_workspace(self.work,True)
        self.assertEqual((data/'用户编辑数据.json').read_text(),'broken')
        (data/'用户编辑数据.json').unlink(); (data/'投递管理.html').write_text('const RAW_DATA = [{"名称":"Old"}];\n'); (data/'投递记录.json').write_text('[{"名称":"New"}]')
        plan=link.adopt_workspace(self.work);self.assertFalse(plan['ok'])
        with self.assertRaises(ValueError): link.adopt_workspace(self.work,True)
        self.assertEqual((data/'投递记录.json').read_text(),'[{"名称":"New"}]')
        (data/'投递管理.html').unlink(); wb=workbench.Workbench(self.work)
        wb.mutate({'module':'preps','action':'upsert','base':wb.get('preps')['version'],'item':{'id':'prep','company':'Fixture','markdown':'# Fixture产品（批次）面试准备\n## 第一節\n正文 [missing](missing.txt)'}})
        with self.assertRaisesRegex(ValueError,'missing attachment'): link.check_workspace(self.work)
    def test_symlink_and_cli_failure(self):
        alias=self.root/'alias';alias.symlink_to(self.work,target_is_directory=True)
        with self.assertRaises(ValueError): link.bind_workspace(alias)
        result=self.cli('bind',str(alias)); self.assertNotEqual(result.returncode,0); self.assertFalse(json.loads(result.stdout)['ok'])
    def test_baseline_changes_after_preview_and_lock_are_rejected(self):
        self.old_fixture(); plan=link.adopt_workspace(self.work)
        target=self.work/'投递数据/用户编辑数据.json'; data=json.loads(target.read_text());data['pref']['cities']=['new'];target.write_text(json.dumps(data))
        with self.assertRaises(workbench.Conflict): link.adopt_workspace(self.work,True,plan['base'])
        self.assertFalse((self.work/'投递数据/投递记录.json').exists())
        original=link.snapshot; calls=[0]
        def concurrent(*args,**kwargs):
            calls[0]+=1
            if calls[0]==2:
                data['pref']['cities']=['concurrent']; target.write_text(json.dumps(data))
            return original(*args,**kwargs)
        with patch.object(link,'snapshot',side_effect=concurrent):
            with self.assertRaises(workbench.Conflict): link.adopt_workspace(self.work,True)
        self.assertFalse((self.work/'投递数据/投递记录.json').exists())
    def test_preparation_mismatch_and_invalid_parser_cli_fail_without_writes(self):
        wb=workbench.Workbench(self.work)
        wb.mutate({'module':'preps','action':'upsert','base':wb.get('preps')['version'],'item':{'id':'prep','company':'Fixture','markdown':'# Fixture产品（批次）面试准备\n## 第一節\nOriginal'}})
        path=self.work/'面试准备/prep.md'; path.write_text(path.read_text().replace('Original','Changed'))
        result=self.cli('check',str(self.work)); self.assertNotEqual(result.returncode,0); self.assertFalse(json.loads(result.stdout)['ok'])
        path.write_text('invalid preparation markdown')
        result=self.cli('adopt',str(self.work),'--apply'); self.assertNotEqual(result.returncode,0); self.assertFalse(json.loads(result.stdout)['ok'])
        self.assertEqual(path.read_text(),'invalid preparation markdown')
    def test_pending_adoption_transaction_recovery(self):
        self.old_fixture(); link.adopt_workspace(self.work,True)
        tx=next((self.work/'投递数据/.transactions').iterdir())
        state=json.loads((tx/'manifest.json').read_text()); state['state']='pending'
        (tx/'manifest.json').write_text(json.dumps(state))
        # Simulate interruption after all target replacements but before commit marker.
        wb=workbench.Workbench(self.work)
        with workbench.data_lock(wb.data): wb.recover_pending()
        self.assertFalse((self.work/'投递数据/投递记录.json').exists())
        q=json.loads((self.work/'投递数据/逐字稿数据.json').read_text())
        self.assertEqual([i['id'] for i in q['categories'][0]['items']],['duplicate','duplicate'])
        self.assertEqual(list((self.work/'投递数据/.adoptions').glob('*.json')),[])
    def test_adopted_canonical_records_remain_authoritative_after_cli_edits(self):
        self.old_fixture(); plan=link.adopt_workspace(self.work); link.adopt_workspace(self.work,True,plan['base'])
        source=Path(link.__file__).parent/'desktop_runtime.py'
        link.bind_workspace(self.work)
        def cli(*args):
            run=subprocess.run([sys.executable,str(source),*args],capture_output=True,text=True,env=os.environ)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr);return json.loads(run.stdout)
        current=cli('read','records')
        payload=self.root/'records-candidate.json'
        payload.write_text(json.dumps({'module':'records','base':current['version'],'action':'upsert','item':{'id':'Fixture','record':{'名称':'Renamed Fixture','公告链接':'https://example.invalid/new'}}}))
        cli('commit',str(payload))
        current=cli('read','records'); payload.write_text(json.dumps({'module':'records','base':current['version'],'action':'upsert','item':{'record':{'名称':'New Fixture'}}}));cli('commit',str(payload))
        canonical=(self.work/'投递数据/投递记录.json').read_bytes()
        self.assertTrue(link.check_workspace(self.work)['ok']); self.assertTrue(link.adopt_workspace(self.work)['ok']);self.assertTrue(link.bind_workspace(self.work)['ok'])
        link.adopt_workspace(self.work,True)
        self.assertEqual((self.work/'投递数据/投递记录.json').read_bytes(),canonical)
        self.assertEqual(len(cli('read','records')['data']),2)
        authority=cli('read','settings')['data']['recordsAuthority']
        self.assertEqual(authority['source'],'投递数据/投递记录.json'); self.assertIn('投递数据/投递管理.html',authority['legacyHtml'])
    def test_adopt_cross_file_failure_rolls_back(self):
        self.old_fixture(); original={p:p.read_bytes() for p in (self.work/'投递数据').iterdir()}; real=workbench.atomic_write
        def fail(path,content):
            if '.adoptions' in str(path) and '.transactions' not in str(path): raise OSError('injected maintenance write failure')
            return real(path,content)
        with patch.object(workbench,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError): link.adopt_workspace(self.work,True)
        self.assertFalse((self.work/'投递数据/投递记录.json').exists())
        self.assertEqual({p:p.read_bytes() for p in original},original)

if __name__=='__main__':unittest.main()

class WorkspaceReferencesTests(unittest.TestCase):
    setUp=WorkspaceLinkTests.setUp
    tearDown=WorkspaceLinkTests.tearDown
    def test_explicit_legacy_references_registered_without_directory_grant(self):
        wb=workbench.Workbench(self.work)
        external=self.work/'Legacy notes'; external.mkdir(); attachment=external/'evidence.txt'; attachment.write_text('all original evidence')
        hidden=external/'not-referenced.txt'; hidden.write_text('must not be exposed')
        (external/'table.xlsx').write_bytes(b'fixture workbook')
        (external/'metadata.json').write_text(json.dumps({'source':'fixture'}))
        text='# Fixture产品（批次）面试准备\n## 第一节\n[Evidence](../Legacy%20notes/evidence.txt) [Sheet](../Legacy%20notes/table.xlsx) [Metadata](../Legacy%20notes/metadata.json)'
        wb.mutate({'module':'preps','action':'upsert','base':wb.get('preps')['version'],'item':{'id':'prep','company':'Fixture','markdown':text}})
        wb.mutate({'module':'settings','action':'replace','base':wb.get('settings')['version'],'data':{'theme':'dark','custom':{'keep':True}}})
        checked=link.check_workspace(self.work); self.assertFalse(checked['ok']); self.assertTrue(any(i['code']=='material_registration_required' for i in checked['issues']))
        plan=link.adopt_workspace(self.work); self.assertTrue(plan['ok']); self.assertIn(workbench.MODULES['settings'][0],[c['path'] for c in plan['changes']])
        original=attachment.read_bytes(); link.adopt_workspace(self.work,True,plan['base'])
        self.assertEqual(attachment.read_bytes(),original); self.assertTrue(link.check_workspace(self.work)['ok'])
        settings=wb.read('settings'); self.assertEqual(settings['theme'],'dark'); self.assertEqual(settings['custom'],{'keep':True})
        self.assertEqual(set(settings['materialFiles']),{'Legacy notes/evidence.txt','Legacy notes/table.xlsx','Legacy notes/metadata.json'})
        import remote_files
        listed={row['path'] for row in remote_files.files(self.work)}
        self.assertIn('Legacy notes/evidence.txt',listed); self.assertNotIn('Legacy notes/not-referenced.txt',listed)
        with self.assertRaises(ValueError): remote_files.allowed_path(self.work,'Legacy notes/not-referenced.txt')
        backup=wb.backup(); fresh=self.root/'restored'; fresh.mkdir(); other=workbench.Workbench(fresh)
        other.restore(backup,other.version()); self.assertEqual((fresh/'Legacy notes/evidence.txt').read_bytes(),original)
        self.assertTrue(link.check_workspace(fresh)['ok'])
    def test_explicit_reference_registration_does_not_allow_hidden_outside_or_secrets(self):
        import remote_files
        for reference in ('../../outside.txt','../.hidden.txt'):
            with self.assertRaises(ValueError): remote_files.canonical_reference(self.work,'面试准备/prep.md',reference)
        for path in ('credentials/token.json','投递数据/草稿数据.json','投递数据/用户编辑数据.json'):
            with self.assertRaises(ValueError): remote_files.material_path(self.work,path)

    def test_site_resource_api_links_are_material_references_only_for_known_routes(self):
        import remote_files
        root=self.work; folder=root/'岗位探查'; folder.mkdir()
        (folder/'attachment.md').write_text('Full attachment')
        data=root/'投递数据';data.mkdir()
        (folder/'report.md').write_text('# Full report\n[API attachment](/api/prospect-file?path=attachment.md) [Other API](/api/edits) [Anchor](#section)')
        (folder/'探查目录.json').write_text(json.dumps({'companies':[{'id':'fixture','company':'Fixture','file':'report.md','researchedAt':'2026-10-04','attachments':[{'file':'attachment.md','label':'Attachment'}]}]}))
        (data/'投递记录.json').write_text('[]')
        before=(folder/'report.md').read_bytes()
        self.assertTrue(link.adopt_workspace(root)['ok']); self.assertEqual((folder/'report.md').read_bytes(),before)
        self.assertEqual(remote_files.linked_reference(root,'岗位探查/report.md','/api/prospect-file?path=attachment.md'),'岗位探查/attachment.md')
        self.assertEqual(remote_files.linked_reference(root,'面试准备/prep.md','/api/prep-resource?path=Legacy%20notes%2Fevidence.txt'),'Legacy notes/evidence.txt')
        self.assertIsNone(remote_files.linked_reference(root,'岗位探查/report.md','/api/agent/files?path=arbitrary.txt'))
        self.assertIsNone(remote_files.linked_reference(root,'岗位探查/report.md','#section'))
        for href in ('/api/prospect-file?path=../outside.md','/api/prep-resource?path=../outside.md','/api/prep-resource?path=/absolute.txt','/api/prospect-file?path=a&path=b'):
            with self.assertRaises(ValueError):remote_files.linked_reference(root,'岗位探查/report.md',href)

class ArchiveReferencesTests(unittest.TestCase):
    setUp=WorkspaceLinkTests.setUp
    tearDown=WorkspaceLinkTests.tearDown
    def catalog(self,filename='归档/report.md'):
        folder=self.work/'岗位探查'; folder.mkdir(exist_ok=True)
        (folder/'探查目录.json').write_text(json.dumps({'companies':[],'archives':[{'file':filename,'label':'Archive'}]}))
        return folder
    def test_missing_archive_blocks_check_bind_adopt_and_backup_restore(self):
        self.catalog()
        for action in (link.check_workspace,link.bind_workspace,link.adopt_workspace):
            with self.assertRaises(ValueError): action(self.work)
        self.assertFalse(link.binding_file().exists())
        from prospect_catalog import read_catalog
        with self.assertRaises(ValueError):read_catalog(self.work/'岗位探查')
        wb=workbench.Workbench(self.work)
        with self.assertRaises(ValueError): wb.restore(wb.backup(),None,True)
    def test_archive_and_body_reference_hashes_and_backup_restore(self):
        folder=self.catalog(); archives=folder/'归档'; archives.mkdir()
        report=archives/'report.md'; report.write_text('# Full archive\nEvidence [full text](../evidence.md) [API evidence](/api/prospect-file?path=evidence.md)')
        (folder/'evidence.md').write_text('all archived evidence')
        plan=link.adopt_workspace(self.work); self.assertTrue(plan['ok'])
        self.assertIn('岗位探查/归档/report.md',plan['files']);self.assertIn('岗位探查/evidence.md',plan['files'])
        wb=workbench.Workbench(self.work); raw=wb.backup(); target=self.root/'fresh';target.mkdir(); fresh=workbench.Workbench(target)
        fresh.restore(raw,fresh.version())
        self.assertEqual((target/'岗位探查/归档/report.md').read_bytes(),report.read_bytes())
        self.assertTrue(link.check_workspace(target)['ok'])
        from prospect_catalog import read_catalog
        self.assertEqual(len(read_catalog(target/'岗位探查')['archives']),1)
        (target/'岗位探查/evidence.md').unlink()
        with self.assertRaises(ValueError):fresh.restore(fresh.backup(),None,True)
    def test_archive_escape_and_symlink_denied(self):
        from prospect_catalog import read_catalog
        folder=self.catalog('../outside.md'); (self.work/'outside.md').write_text('outside catalog')
        with self.assertRaises(ValueError):link.check_workspace(self.work)
        with self.assertRaises(ValueError):read_catalog(folder)
        self.catalog('archive.md');(folder/'archive.md').symlink_to(self.work/'outside.md')
        with self.assertRaises(ValueError):link.check_workspace(self.work)
        with self.assertRaises(ValueError):read_catalog(folder)
