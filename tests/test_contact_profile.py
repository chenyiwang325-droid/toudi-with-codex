"""Synthetic family/contact records stay on the local matching path."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from filling_profile import load_profile,plan_fields
from codex_mapping import validate_model_context

class ContactProfileTests(unittest.TestCase):
    def test_legacy_family_import_and_context_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            data={'基本信息':{'姓名':'合成本人','手机':'13800001001','紧急联系人姓名':'合成母亲','紧急联系人手机':'13800001003'},'家庭成员':{'父亲':{'姓名':'合成父亲','工作单位':'合成甲单位'},'母亲':{'姓名':'合成母亲','工作单位':'合成乙单位'},'是否有某公司亲属':'否'}}
            (root/'网申信息库.json').write_text(json.dumps(data))
            p=load_profile(root)
            self.assertEqual(len([f for f in p['facts'] if f['module']=='family']),6)
            self.assertTrue(all(f['sensitive'] and not f['manual'] for f in p['facts'] if f['module']=='family'))
            def plan(label,module='',group='',gid=None,bindings=None):
                field={'id':'f','label':label,'module':module,'groupLabel':group,'type':'text','value':''}
                if gid:field['groupId']=gid
                return plan_fields(p,{'fields':[field]},record_bindings=bindings)['rows'][0]
            self.assertEqual(plan('姓名')['value'],'合成本人')
            self.assertEqual(plan('姓名','personal','紧急联系人')['value'],'合成母亲')
            self.assertEqual(plan('联系电话','personal','紧急联系人')['value'],'13800001003')
            self.assertEqual(plan('工作单位','family','家庭成员','g',{'g':'family-父亲'})['value'],'合成甲单位')
            self.assertEqual(plan('工作单位','family','家庭成员','g')['status'],'ambiguous')
            self.assertEqual(plan('验证码')['status'],'manual')

    def test_sensitive_model_context_cannot_be_reenabled_by_flag(self):
        for module,label,value in [('family','工作单位','合成单位'),('personal','紧急联系人单位','合成单位'),('internship','证明人','合成人')]:
            with self.assertRaises(ValueError):
                validate_model_context([], [{'key':'private','module':module,'label':label,'value':value,'sensitive':False,'manual':False}])

if __name__=='__main__':unittest.main()
