import copy
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import profile_store as ps
import workbench
import browser_helper

class SharedProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name).resolve()
        self.w=workbench.Workbench(self.root)
    def tearDown(self):self.tmp.cleanup()
    def pack(self):
        pack=ps.empty_pack()
        pack['facts']=[{'key':'personal.name','label':'姓名','value':'合成候选人','module':'personal','profiles':['general']}]
        pack['supplements']=[{'label':'补充材料','sourceKey':'fixture/key','module':'education'}]
        pack['extensionMetadata']={'keep':True}
        return pack
    def save(self,pack=None):
        state=ps.read(self.root)
        return ps.write(self.root,state['version'],pack or self.pack(),state['workspaceKey'])
    def archive(self,files,scope=None):
        manifest={'schemaVersion':1,'files':{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}}
        if scope is not None:manifest['profileScope']=scope
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            z.writestr('manifest.json',json.dumps(manifest))
            for k,v in files.items():z.writestr(k,v)
        return out.getvalue()
    def test_shared_native_and_agent_readback(self):
        state=self.save()
        with patch.dict(os.environ,{'TOUDI_WORKSPACE':str(self.root),'TOUDI_APP_HOME':str(self.root/'home')}):
            request={'protocol':1,'requestId':1,'op':'profile-read'}
            native=browser_helper.operation(request)
            self.assertEqual(native,state)
            pack=copy.deepcopy(native['pack']);pack['facts'][0]['value']='另一个合成姓名'
            browser_helper.operation(dict(request,op='profile-write',workspaceKey=native['workspaceKey'],base=native['version'],pack=pack))
        actual=workbench.Workbench(self.root).get('profile')['data']
        self.assertEqual(actual['facts'][0]['value'],'另一个合成姓名')
        self.assertEqual(actual['supplements'],self.pack()['supplements'])
        self.assertTrue(actual['extensionMetadata']['keep'])
        with self.assertRaises(workbench.Conflict):ps.write(self.root,state['version'],self.pack(),state['workspaceKey'])
        with self.assertRaises(workbench.Conflict):ps.write(self.root,ps.revision(self.root),self.pack(),'0'*64)
    def test_legacy_first_adoption_preserves_original_and_conflicts(self):
        legacy=self.root/ps.LEGACY_PATH;legacy.write_text(json.dumps({'基本信息':{'姓名':'合成姓名'}}))
        original=legacy.read_bytes();state=ps.read(self.root);self.assertTrue(state['legacySource'])
        legacy.write_text(json.dumps({'基本信息':{'姓名':'改动合成姓名'}}))
        with self.assertRaises(workbench.Conflict):ps.write(self.root,state['version'],state['pack'],state['workspaceKey'])
        state=ps.read(self.root);old=legacy.read_bytes()
        result=ps.write(self.root,state['version'],state['pack'],state['workspaceKey'])
        self.assertFalse(result['legacySource']);self.assertEqual(legacy.read_bytes(),old)
        self.assertNotEqual(old,original)
    def test_old_formal_pack_read_without_rewriting(self):
        path=ps.safe_path(self.root,ps.PROFILE_PATH);path.parent.mkdir()
        pack={'schemaVersion':1,'facts':[],'rules':[],'unknown':{'preserve':1}}
        path.write_text(json.dumps(pack));before=path.read_bytes()
        self.assertEqual(ps.read_data(self.root)['profiles'],[{'id':'general','label':'默认资料'}])
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(ps.read_data(self.root)['unknown'],pack['unknown'])
    def test_invalid_pack_no_write(self):
        for key,value in [('supplements','broken'),('supplements',[1]),('warnings',{}),('profiles',[])]:
            pack=self.pack();pack[key]=value
            with self.assertRaises(ValueError):self.save(pack)
        pack=self.pack();pack['facts'][0]['profiles']=[{}]
        with self.assertRaises(ValueError):self.save(pack)
        self.assertFalse(ps.safe_path(self.root,ps.PROFILE_PATH).exists())
    def test_dry_run_has_no_profile_write(self):
        state=self.w.get('profile')
        self.w.mutate({'module':'profile','action':'replace','base':state['version'],'data':self.pack(),'dryRun':True})
        self.assertFalse(ps.safe_path(self.root,ps.PROFILE_PATH).exists())
    def test_new_backup_roundtrip_and_old_backup_preserves_profile(self):
        legacy=self.root/ps.LEGACY_PATH;legacy.write_text('{"基本信息":{}}')
        self.save();snapshot=self.w.inventory();raw=self.w.backup()
        self.assertIn(ps.PROFILE_PATH,self.w.inspect_backup(raw));self.assertIn(ps.LEGACY_PATH,self.w.inspect_backup(raw))
        changed=self.pack();changed['facts'][0]['value']='合成修改';self.save(changed)
        self.w.restore(raw,self.w.version());self.assertEqual(self.w.inventory(),snapshot)
        old=self.archive({k:v for k,v in snapshot.items() if k not in (ps.PROFILE_PATH,ps.LEGACY_PATH)})
        preview=self.w.restore(old,None,True);self.assertEqual(set(preview['preserved']),{ps.PROFILE_PATH,ps.LEGACY_PATH})
        self.w.restore(old,self.w.version());self.assertEqual(self.w.inventory(),snapshot)
    def test_invalid_legacy_backup_rejected_before_restore(self):
        self.save();before=self.w.inventory()
        raw=self.archive({ps.LEGACY_PATH:b'[]'})
        with self.assertRaises(ValueError):self.w.restore(raw,None,True)
        self.assertEqual(self.w.inventory(),before)
    def test_native_rejects_paths_and_model_values(self):
        with self.assertRaises(ValueError):browser_helper.validate_request({'protocol':1,'requestId':1,'op':'profile-read','path':'any'})
        with self.assertRaises(ValueError):browser_helper.validate_request({'protocol':1,'requestId':1,'op':'map','model':'fixture','fields':[],'allowedFacts':[{'key':'a','value':'private'}]})
    def test_no_source_corruption_hidden(self):
        path=ps.safe_path(self.root,ps.PROFILE_PATH);path.parent.mkdir();path.write_text('{broken')
        with self.assertRaises(ValueError):ps.read(self.root)
        self.assertEqual(path.read_text(),'{broken')

if __name__=='__main__':unittest.main()
