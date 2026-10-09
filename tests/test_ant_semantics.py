import json,subprocess,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from filling_profile import plan_fields
class AntSemantics(unittest.TestCase):
 def test_record_projection_and_browser_parity(self):
  facts=[]
  def f(mod,rid,label,value,**extra):facts.append(dict(key='.'.join((mod,rid,label)),module=mod,recordId=rid,recordLabel=rid,recordHint='',label=label,value=value,manual=False,sensitive=False,aliases=[label],**extra))
  f('personal','self','最高学历','硕士研究生')
  for rid,degree,school,major,start,end in [('bachelor','大学本科','合成本科学院','合成本科专业','2020-10-01','2024-06-30'),('master','硕士研究生','合成研究生大学','合成研究生专业','2024-09-01','2027-06-30')]:
   for label,value in [('学历',degree),('学校',school),('专业',major),('学历类型','全日制'),('开始日期',start),('结束日期',end)]:f('education',rid,label,value,**({'precision':'day'} if '日期' in label else {}))
  for rid,cert,score in [('cet4','大学英语四级考试','500'),('cet6','大学英语六级考试','550')]:f('language',rid,'证书类型',cert);f('language',rid,'考试成绩',score)
  for label,value in [('学历','高中'),('学校','合成高级中学'),('开始日期','2017-09-01'),('结束日期','2020-06-30')]:f('education','secondary',label,value,**({'precision':'day'} if '日期' in label else {}))
  profile={'facts':facts,'sourceVersion':'fixture','profileId':'general','warnings':[]}
  labels=['最高学历毕业院校','最高学历毕业时间','最高学历学习形式','第一学历','第一学历毕业院校','第一学历专业','已通过的英语等级证书','英语等级成绩']
  fields=[dict(id=str(i),label=l,module='personal',groupLabel='个人基本信息',type='combobox' if '时间' in l else 'text',adapter='ant-split-date' if '时间' in l else '',dateFormat='YYYY-MM' if '时间' in l else '',value='') for i,l in enumerate(labels)]
  scan=dict(protocol=1,origin='https://synthetic.invalid',path='/form',fingerprint='fixture',fields=fields)
  expected=plan_fields(profile,scan)['rows'];self.assertEqual([r['status'] for r in expected],['ready']*8)
  self.assertEqual([r['value'] for r in expected],['合成研究生大学','2027-06','全日制','大学本科','合成本科学院','合成本科专业','大学英语六级考试','550'])
  script="const C=require('./app/browser-extension/filling-core.js'),p=JSON.parse(require('fs').readFileSync(0,'utf8')),assert=require('node:assert/strict');const rows=C.plan(p.profile,p.scan).rows;rows.forEach((r,i)=>{for(const k of ['status','value','factKey'])assert.equal(r[k],p.expected[i][k],i+' '+k)});const requestScan={...p.scan,fields:p.scan.fields.map(f=>f.dateFormat?f:{...f,type:'combobox',adapter:'ant-select'})};const req=C.agentRequest(p.profile,requestScan,C.plan(p.profile,requestScan));assert(req.fields.length>0);assert(req.fields.every(f=>['education','language'].includes(f.module)));assert(req.allowedFacts.every(f=>f.module!=='personal'));assert.equal(C.plan(p.profile,p.scan,{'0':'education.bachelor.学校'}).rows[0].status,'manual');"
  out=subprocess.run(['node','-e',script],input=json.dumps(dict(profile=profile,scan=scan,expected=expected)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
  # A reference-only education record must not suppress valid first-degree fields.
  reference_only=dict(profile,facts=[dict(f,manual=True) if f['recordId']=='secondary' else f for f in facts])
  self.assertEqual(plan_fields(reference_only,scan)['rows'],expected)
  out=subprocess.run(['node','-e',script],input=json.dumps(dict(profile=reference_only,scan=scan,expected=expected)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
  # An explicit high-school section must not receive the bachelor's/master's
  # facts when high school is reference-only.
  secondary_scan=dict(scan,fields=[dict(id='secondary-school',label='学校',module='education',groupId='secondary-slot',groupLabel='高中教育经历',type='text',value='')])
  self.assertNotIn(plan_fields(reference_only,secondary_scan)['rows'][0]['status'],['ready','conflict'])
  secondary_js="const C=require('./app/browser-extension/filling-core.js'),p=JSON.parse(require('fs').readFileSync(0,'utf8')),a=require('node:assert/strict');a.ok(!['ready','conflict'].includes(C.plan(p.profile,p.scan).rows[0].status));const allocation=C.allocateRecords(p.profile,p.scan);a.ok(!allocation.bindings['secondary-slot']);a.ok(allocation.unusedGroups.includes('secondary-slot'));const scoped={...p.scan,repeatables:[{id:'secondary',module:'education',label:'高中教育经历',addStatus:'ready'}]};a.equal(C.allocateRecords(p.profile,scoped).modules.length,0,'No higher education record is added to a high-school-only section');"
  out=subprocess.run(['node','-e',secondary_js],input=json.dumps(dict(profile=reference_only,scan=secondary_scan)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
  # A missing start date in another education record cannot prove which was first.
  incomplete=dict(profile,facts=[f for f in facts if f['key']!='education.bachelor.开始日期'])
  missing=plan_fields(incomplete,scan)['rows'];self.assertEqual([r['status'] for r in missing[3:6]],['missing']*3)
  parity="const C=require('./app/browser-extension/filling-core.js'),p=JSON.parse(require('fs').readFileSync(0,'utf8')),a=require('node:assert/strict');a.deepEqual(C.plan(p.profile,p.scan).rows.slice(3,6).map(r=>r.status),['missing','missing','missing']);"
  out=subprocess.run(['node','-e',parity],input=json.dumps(dict(profile=incomplete,scan=scan)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
  # Excluding an unconfirmed bachelor's record must never promote the master's
  # record into "first qualification".
  unconfirmed=dict(profile,facts=[dict(f,manual=True) if f['recordId']=='bachelor' else f for f in facts])
  self.assertEqual([r['status'] for r in plan_fields(unconfirmed,scan)['rows'][3:6]],['missing']*3)
  out=subprocess.run(['node','-e',parity],input=json.dumps(dict(profile=unconfirmed,scan=scan)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
 def test_directory_display_and_region_depth(self):
  facts=[dict(key='major',module='education',recordId='m',recordLabel='合成记录',recordHint='',label='专业',value='合成设计学',aliases=[],manual=False,sensitive=False),dict(key='native',module='personal',recordId='self',recordLabel='',recordHint='',label='籍贯',value='合成省合成市合成区',aliases=[],manual=False,sensitive=False)]
  profile=dict(facts=facts,sourceVersion='fixture',profileId='general',warnings=[])
  fields=[dict(id='major',label='专业',module='education',recordHint='合成记录',type='combobox',adapter='ant-select',options=[],value='合成设计(设计类)'),dict(id='region',label='籍贯',module='personal',type='combobox',adapter='ant-region',regionDepth=2,options=[],value='合成省/合成市')]
  scan=dict(protocol=1,origin='https://synthetic.invalid',path='/form',fingerprint='fixture',fields=fields)
  expected=plan_fields(profile,scan)['rows'];self.assertEqual([r['status'] for r in expected],['already','already'])
  script="const C=require('./app/browser-extension/filling-core.js'),p=JSON.parse(require('fs').readFileSync(0,'utf8')),a=require('node:assert/strict');a.deepEqual(C.plan(p.profile,p.scan).rows.map(r=>r.status),['already','already']);for(const patch of [{value:'合成省/不同市'},{value:'合成省'},{regionDepth:3}]){const s=structuredClone(p.scan);Object.assign(s.fields[1],patch);a.equal(C.plan(p.profile,s).rows[1].status,'conflict');}const dup=structuredClone(p.scan);dup.fields[0].value='';dup.fields[0].options=[{value:'a',text:'合成设计'},{value:'b',text:'合成设计学'}];a.equal(C.plan(p.profile,dup).rows[0].status,'manual');"
  out=subprocess.run(['node','-e',script],input=json.dumps(dict(profile=profile,scan=scan)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
  for patch in [dict(value='合成省/不同市'),dict(value='合成省'),dict(regionDepth=3)]:
   changed=dict(scan,fields=[fields[0],dict(fields[1],**patch)]);self.assertEqual(plan_fields(profile,changed)['rows'][1]['status'],'conflict')
  from filling_profile import option_equivalent
  self.assertNotEqual(option_equivalent('数学','专业'),option_equivalent('数','专业'))
  self.assertNotEqual(option_equivalent('合成设计学','姓名'),option_equivalent('合成设计','姓名'))
 def test_qualification_is_not_skills(self):
  facts=[dict(key='skills',module='personal',recordId='self',recordLabel='',recordHint='',label='IT技能',value='合成技能介绍',aliases=[],manual=False,sensitive=False)]
  profile=dict(facts=facts,sourceVersion='fixture',profileId='general',warnings=[])
  scan=dict(protocol=1,origin='https://synthetic.invalid',path='/form',fingerprint='fixture',fields=[dict(id='certificate',label='资格证书',module='personal',type='text',value='')])
  self.assertEqual(plan_fields(profile,scan,{'certificate':'skills'})['rows'][0]['status'],'manual')
  script="const C=require('./app/browser-extension/filling-core.js'),p=JSON.parse(require('fs').readFileSync(0,'utf8')),a=require('node:assert/strict');a.deepEqual(C.safeAgentMappings(p.profile,p.scan,{certificate:'skills'}).accepted,{});a.equal(C.plan(p.profile,p.scan,{certificate:'skills'}).rows[0].status,'manual');a.equal(C.agentRequest(p.profile,p.scan,C.plan(p.profile,p.scan)).fields.length,0);p.profile.facts.push({...p.profile.facts[0],key:'qualification',label:'职业资格证书',value:'合成职业证书'});a.deepEqual(C.safeAgentMappings(p.profile,p.scan,{certificate:'qualification'}).accepted,{certificate:'qualification'});a.equal(C.plan(p.profile,p.scan).rows[0].factKey,'qualification');"
  out=subprocess.run(['node','-e',script],input=json.dumps(dict(profile=profile,scan=scan)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
  complete=dict(profile,facts=facts+[dict(facts[0],key='qualification',label='职业资格证书',value='合成职业证书')]);self.assertEqual(plan_fields(complete,scan)['rows'][0]['factKey'],'qualification')
 def test_filled_education_group_binds_after_directory_choice(self):
  facts=[]
  for rid,school,degree,major in [('master','合成研究生大学','硕士研究生','合成设计学'),('bachelor','合成本科学院','大学本科','合成设计')]:
   for label,value in [('学校',school),('学历',degree),('专业',major)]:facts.append(dict(key=rid+'.'+label,module='education',recordId=rid,recordLabel=rid,recordHint='',label=label,value=value,aliases=[],manual=False,sensitive=False))
  profile=dict(facts=facts,sourceVersion='fixture',profileId='general',warnings=[])
  fields=[dict(id=str(i),label=label,module='education',groupId='education-a',groupLabel='教育背景',type='combobox',adapter='ant-select',options=[],value=value) for i,(label,value) in enumerate([('学校','合成研究生大学'),('学历','硕士研究生'),('专业','合成设计(设计类)')])]
  scan=dict(protocol=1,origin='https://synthetic.invalid',path='/form',fingerprint='fixture',fields=fields)
  result=plan_fields(profile,scan);self.assertEqual(result['groups'][0]['recordId'],'master');self.assertEqual([r['status'] for r in result['rows']],['already']*3)
  script="const C=require('./app/browser-extension/filling-core.js'),p=JSON.parse(require('fs').readFileSync(0,'utf8')),a=require('node:assert/strict');const result=C.plan(p.profile,p.scan);a.equal(result.groups[0].recordId,'master');a.deepEqual(result.rows.map(r=>r.status),['already','already','already']);p.scan.fields[0].value='不同学校';a.equal(C.plan(p.profile,p.scan).groups[0].status,'conflict');"
  out=subprocess.run(['node','-e',script],input=json.dumps(dict(profile=profile,scan=scan)),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1]);self.assertEqual(out.returncode,0,out.stderr)
if __name__=='__main__':unittest.main()
