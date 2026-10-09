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
  p=record(p,'language',{name:'Synthetic Certificate',language:'Synthetic Language',score:'Synthetic Score'});
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
test('one personal editor preserves legacy IDs, references, exact original text and extra-field scope',()=>{
  const fact=(key,recordId,label,value,extra={})=>({key,module:'personal',recordId,recordLabel:'合成资料',label,value,profiles:['general'],...extra});
  const full='  合成完整原文，保留所有说明与换行。\n第二段完整内容。  ';
  const p=C.validatePack({...L.emptyPack(),facts:[fact('p.name','base','姓名','合成姓名'),fact('p.skill','skills','IT技能',full),fact('p.summary','summary','个人评价',full),fact('p.reference','reference','自我评价',full+'参考原文',{manual:true}),fact('p.extra','base','自定义字段',full)]});
  const draft=L.recordDraft(p,'personal','personal','general');assert.equal(draft.fields.find(f=>f.id==='skills').value,full);assert.equal(draft.fields.find(f=>f.id==='summary').fact.key,'p.summary');assert(draft.extraFacts.some(f=>f.key==='p.reference'));
  const values=Object.fromEntries(draft.fields.map(f=>[f.id,f.value]));values.name='修改后合成姓名';values.skills=full+'\n补充的完整内容。  ';
  const saved=L.saveRecord(p,'personal','personal',values,{profileId:'general',profiles:['general'],extraValues:{'p.extra':full+'\n补充字段。'}});
  for(const old of p.facts)assert.equal(saved.facts.find(f=>f.key===old.key).recordId,old.recordId);
  assert.equal(saved.facts.find(f=>f.key==='p.skill').value,values.skills);assert.deepEqual(saved.facts.find(f=>f.key==='p.reference'),p.facts.find(f=>f.key==='p.reference'));
  assert.throws(()=>L.saveRecord(p,'personal','personal',{}, {extraValues:{'p.name':'不能用补充入口更改标准键'}}),/补充字段/);
  assert.throws(()=>L.saveRecord(p,'personal','personal',{}, {extraValues:{'other.key':'外部字段'}}),/补充字段/);
  const added=L.addField(p,{module:'personal',recordId:'personal'},{label:'新补充字段',value:full});assert.equal(added.facts.at(-1).value,full);
  const plan=C.plan(C.profile(p),{protocol:1,origin:'https://example.invalid',path:'/apply',fingerprint:'fixture',fields:[{id:'summary',module:'personal',label:'自我评价',type:'text',value:''}]});assert.equal(plan.rows[0].status,'ready');assert.equal(plan.rows[0].factKey,'p.summary');assert.equal(plan.rows[0].value,full);
});
test('legacy awards scope/category/description bind to standard fields and round-trip without duplicates',()=>{
  const values=[['scope','获奖等级','国家级'],['rank','奖项等级','一等奖'],['category','获奖类型','学科竞赛'],['body','奖项描述','合成获奖完整原文']];
  const p=C.validatePack({...L.emptyPack(),facts:values.map(([key,label,value])=>({key:'award.'+key,module:'awards',recordId:'r',recordLabel:'合成奖项',label,value,profiles:['general']}))});
  const draft=L.recordDraft(p,'awards','r');assert.equal(draft.extraFacts.length,0);
  const expected={level:'国家级',rank:'一等奖',category:'学科竞赛',description:'合成获奖完整原文'};
  for(const [id,value] of Object.entries(expected))assert.equal(draft.fields.find(f=>f.id===id).value,value);
  const saved=L.saveRecord(p,'awards','r',Object.fromEntries(draft.fields.map(f=>[f.id,f.value])));
  assert.deepEqual(saved.facts.map(f=>[f.key,f.label,f.value]),p.facts.map(f=>[f.key,f.label,f.value]));
  const changed=L.saveRecord(p,'awards','r',{category:'规划竞赛',description:'更新完整原文'});assert.equal(changed.facts.length,4);assert.equal(changed.facts.find(f=>f.key==='award.category').value,'规划竞赛');assert.equal(changed.facts.find(f=>f.key==='award.body').value,'更新完整原文');
});
