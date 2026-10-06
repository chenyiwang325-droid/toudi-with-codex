'use strict';
const assert=require('node:assert/strict'),L=require('../app/browser-extension/profile-library.js'),C=require('../app/browser-extension/filling-core.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
const record=(p,mod,values,options={})=>L.saveRecord(p,mod,'',values,options);
test('blank standard library has one generic version and no personal values',()=>{
  const p=L.emptyPack();assert.deepEqual(p.profiles,[{id:'general',label:'默认资料'}]);assert.deepEqual(p.facts,[]);
  assert(L.templates.personal.fields.some(f=>f.input==='choice'));assert(L.templates.education.fields.some(f=>f.input==='date'));
  assert(!JSON.stringify(p).includes('央国企'));assert(!JSON.stringify(p).includes('AI 产品'));
});
test('normal user can create complete records and immediately match standard webpage fields',()=>{
  let p=record(L.emptyPack(),'personal',{name:'Synthetic User',email:'user@example.invalid',city:'Synthetic City',household:'Registration City'});
  p=record(p,'education',{school:'Synthetic University',degree:'本科',major:'Synthetic Major',start:'2020-09',end:'2024-06',gpa:'3.8'},{gpaScale:'4.0'});
  p=record(p,'internship',{company:'Synthetic Company',role:'Synthetic Role',start:'2024-05-06',end:'2024-08-23',tasks:'Synthetic Responsibilities'});
  p=record(p,'project',{name:'Synthetic Project',role:'Owner',start:'2024-12',end:'至今',description:'Synthetic description',tasks:'Synthetic tasks'},{dateFallback:'today'});
  p=record(p,'language',{name:'Synthetic Certificate',score:'Synthetic Score'});
  const fields=[['现居住地','personal'],['户籍所在地','personal'],['公司名称','work'],['job title','work'],['responsibilities','work'],['项目名称','projects'],['project description','projects'],['语言','language']].map(([label,module],i)=>({id:String(i),label,module,type:'text',value:''}));
  const plan=C.plan(C.profile(p),{protocol:1,origin:'https://example.invalid',path:'/apply',fingerprint:'fixture',fields});
  assert(plan.rows.every(r=>r.status==='ready'),JSON.stringify(plan.rows));assert(!p.facts.some(f=>f.value===''));assert(p.facts.every(f=>f.recordId));
  assert.equal(p.facts.find(f=>f.label==='GPA').gpaScale,'4.0');
});
test('whole-record edit preserves exact dates, stable keys, custom fields, rules and imported scopes',()=>{
  const original=C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'Default'},{id:'custom',label:'User version'}],rules:['Synthetic rule'],facts:[
    {key:'role',label:'职务',value:'Original Role',module:'internship',recordId:'w',recordLabel:'Original Company',profiles:['custom']},
    {key:'start',label:'开始',value:'2026-03-25',module:'internship',recordId:'w',recordLabel:'Original Company',profiles:['custom']},
    {key:'end',label:'结束',value:'2026-07-16',module:'internship',recordId:'w',recordLabel:'Original Company',profiles:['custom']},
    {key:'extra',label:'特殊补充',value:'Preserve me',module:'internship',recordId:'w',recordLabel:'Original Company',profiles:['custom'],manual:true},
    {key:'other',label:'职务',value:'Other version',module:'internship',recordId:'w',recordLabel:'Other Company',profiles:['general']}
  ]});
  const d=L.recordDraft(original,'internship','w','custom');assert.equal(d.fields.find(f=>f.id==='role').value,'Original Role');
  const values=Object.fromEntries(d.fields.map(f=>[f.id,f.value]));values.role='Updated Role';
  const p=L.saveRecord(original,'internship','w',values,{profileId:'custom',profiles:['custom']});
  assert.deepEqual(p.facts.find(f=>f.key==='other'),original.facts.find(f=>f.key==='other'));assert.deepEqual(p.facts.find(f=>f.key==='extra'),original.facts.find(f=>f.key==='extra'));
  for(const key of ['start','end'])assert.deepEqual(p.facts.find(f=>f.key===key),original.facts.find(f=>f.key===key));
  assert.equal(p.facts.find(f=>f.key==='role').value,'Updated Role');assert.equal(p.facts.find(f=>f.key==='role').label,'职务');assert.deepEqual(p.rules,original.rules);
});
test('invalid calendar dates, reversed ranges and duplicate contextual fields cannot be saved',()=>{
  assert.throws(()=>record(L.emptyPack(),'education',{start:'2025-02-30'}),/日期/);
  assert.throws(()=>record(L.emptyPack(),'internship',{start:'2025-09',end:'2025-08'}),/早于/);
  assert.throws(()=>record(L.emptyPack(),'personal',{}),/至少/);
  assert.throws(()=>L.addField(L.emptyPack(),{module:'project',recordId:'absent'},{label:'备注',value:'Synthetic'}),/先添加/);
  const p=record(L.emptyPack(),'education',{school:'Synthetic School'}),id=p.facts[0].recordId;
  assert.throws(()=>L.addField(p,{module:'education',recordId:id},{label:'学校',value:'Other'}),/已有/);
  const extra=L.addField(p,{module:'education',recordId:id},{label:'补充经历',value:'Synthetic'});assert.equal(extra.facts[1].recordId,id);
});
test('ongoing project policy remains opt-in and does not turn a month into an invented day',()=>{
  let p=record(L.emptyPack(),'project',{name:'Synthetic',start:'2024-12',end:'至今'}),id=p.facts[0].recordId;
  assert(!p.facts.find(f=>f.label==='结束日期').dateFallback);
  p=L.saveRecord(p,'project',id,{end:'至今'},{dateFallback:'today'});assert.equal(p.facts.find(f=>f.label==='结束日期').dateFallback,'today');
  const plan=C.plan(C.profile(p),{protocol:1,origin:'https://example.invalid',path:'/apply',fingerprint:'fixture',fields:[{id:'f',label:'开始日期',module:'project',type:'date',value:''}]});assert.equal(plan.rows[0].status,'manual');
});
test('user-named version is an independent copy, never a preset career category',()=>{
  let p=record(L.emptyPack(),'personal',{name:'Synthetic User'});p=record(p,'internship',{company:'Synthetic Company'});
  const sourceKeys=p.facts.map(f=>f.key),copied=L.addVersion(p,'自定版本','general');p=copied.pack;
  assert.deepEqual(p.facts.filter(f=>f.profiles.includes('general')).map(f=>f.key),sourceKeys);
  const draft=p.facts.find(f=>f.profiles.includes(copied.id)&&f.module==='internship');
  p=L.saveRecord(p,'internship',draft.recordId,{company:'Other Company'},{profileId:copied.id,profiles:[copied.id]});
  assert.equal(C.profile(p,'general').facts.find(f=>f.label==='单位').value,'Synthetic Company');assert.equal(C.profile(p,copied.id).facts.find(f=>f.label==='单位').value,'Other Company');
  assert.throws(()=>L.addVersion(p,'自定版本','general'),/同名/);
  const removed=L.removeVersion(p,copied.id);assert.deepEqual(removed.facts,C.profile(p,'general').facts);assert.throws(()=>L.removeVersion(removed,'general'),/至少/);assert.throws(()=>C.validatePack({...p,profiles:[]}),/版本/);
});
console.log('PASS '+checks+' profile library workflows');
