import datetime
import json
import subprocess
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from filling_profile import export_profile_pack,load_profile,plan_fields
import test_filling_profile as fixtures


class BrowserCoreTests(unittest.TestCase):
    def test_reference_variants_do_not_compete_with_canonical_personal_fields(self):
        original='  Synthetic full original.\nSecond full paragraph.  '
        facts=[{'key':key,'label':'自我评价','value':value,'module':'personal','recordId':record,'recordLabel':'Synthetic','profiles':['general'],'manual':manual} for key,value,record,manual in [('canonical',original,'summary',False),('reference',original+' reference','reference',True)]]
        pack={'schemaVersion':1,'profiles':[{'id':'general','label':'Default'}],'facts':facts,'rules':[]}
        scan={'protocol':1,'origin':'https://example.invalid','path':'/apply','fingerprint':'fixture','fields':[{'id':'summary','module':'personal','label':'自我评价','type':'text','value':''}]}
        from filling_profile import matching_facts
        self.assertEqual([f['key'] for f in matching_facts({'facts':facts},scan['fields'][0])],['canonical'])
        self.run_core("const p=C.profile(C.validatePack(input.pack)),row=C.plan(p,input.scan).rows[0];assert.equal(row.status,'ready');assert.equal(row.factKey,'canonical');assert.equal(row.value,input.original);",{'pack':pack,'scan':scan,'original':original})

    def run_core(self,code,value):
        core=Path(__file__).resolve().parents[1]/'app/browser-extension/filling-core.js'
        script="const fs=require('fs'),assert=require('assert/strict'),C=require(process.argv[1]),input=JSON.parse(fs.readFileSync(0,'utf8'));"+code
        result=subprocess.run(['node','-e',script,str(core)],input=json.dumps(value),text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_records_sorted_by_start_with_ids_and_profile_isolation_preserved(self):
        fixture=fixtures.FillingProfileTests();fixture.setUp()
        try:
            fixture.data['实习经历_央国企口径'].append({'单位':'Recent Fixture','开始':'2026-02-09','结束':'2026-06-26'})
            fixture.write();source=(fixture.root/'网申信息库.json').read_bytes()
            pack=export_profile_pack(fixture.root)
            self.assertEqual((fixture.root/'网申信息库.json').read_bytes(),source)
            for pid,expected in [('state',['internship-1','internship-0']),('ai-product',['internship-1','internship-2','internship-0'])]:
                loaded=load_profile(fixture.root,pid)
                ids=list(dict.fromkeys(f['recordId'] for f in loaded['facts'] if f['module']=='internship'))
                self.assertEqual(ids,expected)
                self.run_core("const p=C.profile(C.validatePack(input.pack),input.pid),ids=[...new Set(p.facts.filter(f=>f.module==='internship').map(f=>f.recordId))];assert.deepEqual(ids,input.expected);const field={id:'x',label:'单位',module:'work',groupLabel:'实习经历1',type:'text',value:''};assert.equal(C.plan(p,{protocol:1,origin:'https://example.invalid',path:'/apply',fingerprint:'x',fields:[field]}).rows[0].status,'ambiguous');",{'pack':pack,'pid':pid,'expected':expected})
            keys={f['key']:f['recordLabel'] for f in pack['facts'] if f['label']=='单位'}
            self.assertEqual(keys['internship.internship-0.单位'],'State Fixture')
            self.assertEqual(keys['internship.internship-2.单位'],'Internet Fixture')
        finally:fixture.tearDown()

    def test_present_end_date_is_dynamic_and_never_replaces_ongoing_source(self):
        fixture=fixtures.FillingProfileTests();fixture.setUp()
        try:
            fixture.data['项目经历'][0].update({'开始日期':'2025-01-13','结束日期':'至今','_结束日期兜底':'today'})
            fixture.write();pack=export_profile_pack(fixture.root)
            field=lambda id,**kw:fixture.field('项目结束日期',id=id,module='projects',groupLabel='Project Fixture',**kw)
            fields=[field('date',type='date'),field('month',type='month'),field('text'),field('select',type='select',options=[{'value':'now','text':'Present'},{'value':'past','text':'2020-01-01'}]),field('format',dateFormat='YYYY/MM/DD'),field('max',type='date',constraints={'max':'2025-12-31'}),field('min',type='month',constraints={'min':'2027-01'}),field('cap',type='date',maxLength=5),field('conflict',type='date',value='2025-04-05')]
            scan={'protocol':1,'origin':'https://example.invalid','path':'/apply','fingerprint':'fixture','fields':fields}
            expected=plan_fields(load_profile(fixture.root,'state'),scan,today=datetime.date(2026,10,6))
            rows={r['fieldId']:r for r in expected['rows']}
            self.assertEqual(rows['date']['value'],'2026-10-06');self.assertEqual(rows['month']['value'],'2026-10')
            self.assertEqual(rows['text']['value'],'至今');self.assertEqual(rows['select']['optionValue'],'now')
            self.assertEqual(rows['format']['value'],'2026/10/06')
            for id in ('max','min'):self.assertEqual(rows[id]['status'],'manual')
            self.assertEqual(rows['cap']['status'],'ready');self.assertEqual(rows['cap']['value'],'2026-10-06')
            self.assertEqual(rows['conflict']['status'],'conflict');self.assertIn('占位',rows['date']['reason'])
            self.run_core("const pack=C.validatePack(input.pack),p=C.profile(pack,'state'),rows=C.plan(p,input.scan,{},new Date(2026,9,6,10)).rows;for(let i=0;i<rows.length;i++)for(const key of ['status','value','factKey','displayValue','optionValue','dateFallbackUsed','resolvedOn'])assert.deepEqual(rows[i][key],input.rows[i][key],rows[i].fieldId+' '+key);assert.equal(p.facts.find(f=>f.module==='project' && f.label==='结束日期').value,'至今');const next=C.plan(p,input.scan,{},new Date(2026,9,7,10));assert.equal(next.rows[0].value,'2026-10-07');const stale=C.plan(p,input.scan,{},new Date(2000,0,1));assert.throws(()=>C.confirm(stale,['date']),/日期已变化/);",{'pack':pack,'scan':scan,'rows':expected['rows']})
            # Choosing an actual end date removes both flags; invalid policies cannot slip through.
            self.run_core("const fact=input.facts.find(f=>f.ongoing);fact.value='2025-04-05';assert.throws(()=>C.validatePack(input),/进行中/);",pack)
            fixture.data['项目经历'][0].pop('_结束日期兜底');fixture.write()
            self.assertEqual(plan_fields(load_profile(fixture.root,'state'),{'fields':[fields[0]]})['rows'][0]['status'],'manual')
            checkbox={'id':'present','type':'checkbox','label':'至今','module':'projects','groupId':'project-fixture','value':False}
            scan['fields']=[{**fields[0],'groupId':'project-fixture'},checkbox]
            self.assertEqual(plan_fields(load_profile(fixture.root,'state'),scan)['rows'][0]['status'],'manual')
            self.run_core("const p=C.profile(C.validatePack(input.pack),'state');assert.equal(C.plan(p,input.scan).rows[0].status,'manual');",{'pack':pack,'scan':scan})
        finally:fixture.tearDown()

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
            code="const fs=require('fs'),assert=require('assert/strict'),C=require(process.argv[1]),p=C.profile(C.validatePack(JSON.parse(fs.readFileSync(0,'utf8')))),f=p.facts.find(f=>f.label==='学校' && f.recordLabel==='本科'),scan={fields:[{id:'f',label:'毕业院校',module:'education',groupLabel:'教育经历1'}]};assert.deepEqual(C.safeAgentMappings(p,scan,{f:f.key}).accepted,{});scan.fields[0].groupLabel='本科';assert.deepEqual(C.safeAgentMappings(p,scan,{f:f.key}).accepted,{f:f.key});"
            result=subprocess.run(['node','-e',code,str(core)],input=json.dumps(pack),text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
        finally:fixture.tearDown()


if __name__=='__main__':unittest.main()
