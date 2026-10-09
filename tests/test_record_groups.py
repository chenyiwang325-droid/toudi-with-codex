import json
import subprocess
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from filling_profile import plan_fields

class RecordGroupsTests(unittest.TestCase):
    def test_complete_group_js_python_parity(self):
        facts=[]
        for rid,name,start,end in [('a','合成甲公司','2024-05-01','2024-08-30'),('b','合成乙公司','2025-03-25','2025-07-16')]:
            for label,value in [('单位',name),('开始日期',start),('结束日期',end),('职责',name+'完整职责')]:
                facts.append(dict(key=rid+label,module='internship',recordId=rid,recordLabel=name,recordHint=name,label=label,value=value,manual=False,sensitive=False,precision='day' if '日期' in label else None,aliases=[],profiles=['general']))
        p=dict(schemaVersion=1,sourceVersion='s',profileId='general',profiles=[dict(id='general',label='合成')],facts=facts,warnings=[],rules=[])
        fields=[dict(id=g+str(i),groupId=g,groupLabel='实习经历',module='work',label=label,type='date' if '时间' in label else 'text',value='') for g in ['x','y'] for i,label in enumerate(['单位名称','结束时间','工作职责','开始时间'])]
        scan=dict(protocol=1,origin='https://fixture.invalid',path='/apply',fingerprint='f',fields=fields)
        for bindings in [{},{'x':'b','y':'a'}]:
            planned=plan_fields(p,scan,record_bindings=bindings)
            if bindings:
                self.assertTrue(all(r['status']=='ready' for r in planned['rows']))
                for r in planned['rows']:self.assertTrue(r['factKey'].startswith(bindings[r['recordBinding']['groupId']]))
            else:self.assertTrue(all(r['status']=='ambiguous' for r in planned['rows']))
            code="const C=require('./app/browser-extension/filling-core.js'),d=JSON.parse(require('fs').readFileSync(0));console.log(JSON.stringify(C.plan(C.profile(C.validatePack(d.p)),d.scan,{},new Date(),{},d.bindings)));"
            result=subprocess.run(['node','-e',code],input=json.dumps(dict(p=p,scan=scan,bindings=bindings)),text=True,capture_output=True,check=True,cwd=Path(__file__).resolve().parents[1]);other=json.loads(result.stdout)
            for groups in (other['groups'],planned['groups']):
                for g in groups:g['candidates'].sort(key=lambda c:c['id'])
            self.assertEqual(other['groups'],planned['groups'])
            for a,b in zip(other['rows'],planned['rows']):
                for key in ['status','factKey','value','recordBinding','allowedFactKeys']:self.assertEqual(a.get(key),b.get(key),key)
        scan['fields'][0]['value']='旧名'
        self.assertEqual(plan_fields(p,scan)['groups'][0]['status'],'conflict')
        corrected=plan_fields(p,scan,record_bindings={'x':'b'})
        self.assertEqual(corrected['groups'][0]['status'],'bound')
        self.assertEqual(corrected['rows'][0]['status'],'conflict')
        with self.assertRaises(ValueError):plan_fields(p,scan,record_bindings={'x':'other-module-record'})

if __name__=='__main__':unittest.main()
