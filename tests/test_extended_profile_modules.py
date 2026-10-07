import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import profile_store
import filling_profile
import browser_helper

class ExtendedModulesTests(unittest.TestCase):
    def pack(self):
        return {'schemaVersion':1,'profiles':[{'id':'general','label':'合成资料'}],'rules':[],'facts':[{'key':mod+'.name','module':mod,'label':label,'value':'合成名称','recordId':mod+'-1','recordLabel':'合成经历','profiles':['general'],'aliases':[label]} for mod,label in [('campus-role','组织名称'),('awards','奖项名称'),('publications','论文名称')]]}
    def test_schema_native_and_formal_read_support_all_modules(self):
        pack=self.pack();profile_store.validate_pack(pack)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'填报资料').mkdir();(root/'填报资料/资料.json').write_text(json.dumps(pack))
            profile=filling_profile.load_profile(root)
        self.assertEqual({f['module'] for f in profile['facts']},{'campus-role','awards','publications'})
        browser_helper.validate_request({'protocol':1,'requestId':1,'op':'map','model':'fixture-model','fields':[],'allowedFacts':[{k:f[k] for k in ('key','module','label','aliases')} for f in profile['facts']]})
    def test_module_boundaries_and_context_priority(self):
        self.assertEqual(filling_profile.module_hint({'module':'project','groupLabel':'在校任职'}),'campus-role')
        self.assertEqual(filling_profile.module_hint({'module':'awards'}),'awards')
        self.assertEqual(filling_profile.module_hint({'module':'publications'}),'publications')
        fact={**self.pack()['facts'][0],'aliases':['开始时间'],'label':'开始日期','value':'2023-09'}
        self.assertFalse(filling_profile.mapping_matches({'facts':[fact]},{'module':'awards','label':'开始时间'},fact))
    def test_campus_present_date_policy_and_unknown_module_rejection(self):
        filling_profile.validate_date_policy({'module':'campus-role','label':'结束日期','value':'至今','ongoing':True})
        pack=self.pack();pack['facts'][0]['module']='unsupported'
        with self.assertRaises(ValueError):profile_store.validate_pack(pack)

if __name__=='__main__':unittest.main()
