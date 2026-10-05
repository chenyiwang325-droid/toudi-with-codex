import json
import subprocess
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from filling_profile import export_profile_pack,load_profile,plan_fields
import test_filling_profile as fixtures


class BrowserCoreTests(unittest.TestCase):
    def test_export_and_browser_plan_preserve_existing_contract(self):
        fixture=fixtures.FillingProfileTests();fixture.setUp()
        try:
            pack=export_profile_pack(fixture.root)
            labels=['姓名','手机','电子邮箱','户籍所在地','生源地','现居住地','籍贯','最高学历','最高学位','学校','专业','学位','GPA','父亲姓名','验证码','是否同意协议','个人评价','主修课程及成绩']
            fields=[fixture.field(label,id='f'+str(i)) for i,label in enumerate(labels)]
            fields += [fixture.field('学校',id='m',module='education',groupLabel='硕士'),fixture.field('学校',id='b',module='education',groupLabel='本科'),
                       fixture.field('开始日期',id='date',module='education',groupLabel='本科',type='date'),
                       fixture.field('开始日期',id='month',module='education',groupLabel='本科',type='month'),
                       fixture.field('GPA（满分4.0）',id='gpa',module='education',groupLabel='本科'),
                       fixture.field('最高学历',id='select',type='select',options=[{'value':'m','text':'硕士研究生'}]),
                       fixture.field('手机',id='conflict',value='preserved value'),fixture.field('姓名',id='cap',maxLength=3),
                       fixture.field('岗位',id='work',module='work',groupLabel='State Fixture'),fixture.field('工作职责',id='variants',module='work',groupLabel='State Fixture')]
            scan={'protocol':1,'origin':'https://example.invalid','path':'/apply','fingerprint':'fixture','fields':fields}
            cases=[]
            for pid in ['general','state','ai-product']:
                expected=plan_fields(load_profile(fixture.root,pid),scan)
                cases.append({'profile':pid,'expected':expected['rows']})
            core=Path(__file__).resolve().parents[1]/'app/browser-extension/filling-core.js'
            code="const fs=require('fs'),assert=require('assert/strict'),C=require(process.argv[1]),input=JSON.parse(fs.readFileSync(0,'utf8')),pack=C.validatePack(input.pack);for(const test of input.cases){const p=C.profile(pack,test.profile),rows=C.plan(p,input.scan).rows;for(let i=0;i<rows.length;i++)for(const key of ['fieldId','status','value','optionValue','factKey','displayValue'])assert.deepEqual(rows[i][key],test.expected[i][key],test.profile+' '+rows[i].label+' '+key);}console.log('PASS '+input.cases.length*input.scan.fields.length+' browser/Python contract checks');"
            result=subprocess.run(['node','-e',code,str(core)],input=json.dumps({'pack':pack,'scan':scan,'cases':cases}),text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            # The exported source has not been rewritten or expanded with new facts.
            self.assertEqual(pack['sourceVersion'],load_profile(fixture.root)['sourceVersion'])
        finally:fixture.tearDown()

    def test_model_cannot_pick_an_unidentified_repeated_record(self):
        fixture=fixtures.FillingProfileTests();fixture.setUp()
        try:
            pack=export_profile_pack(fixture.root)
            core=Path(__file__).resolve().parents[1]/'app/browser-extension/filling-core.js'
            code="const fs=require('fs'),assert=require('assert/strict'),C=require(process.argv[1]),p=C.profile(C.validatePack(JSON.parse(fs.readFileSync(0,'utf8')))),f=p.facts.find(f=>f.label==='学校'),scan={fields:[{id:'f',label:'毕业院校',module:'education',groupLabel:'教育经历1'}]};assert.deepEqual(C.safeAgentMappings(p,scan,{f:f.key}).accepted,{});scan.fields[0].groupLabel='本科';assert.deepEqual(C.safeAgentMappings(p,scan,{f:f.key}).accepted,{f:f.key});"
            result=subprocess.run(['node','-e',code,str(core)],input=json.dumps(pack),text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
        finally:fixture.tearDown()


if __name__=='__main__':unittest.main()
