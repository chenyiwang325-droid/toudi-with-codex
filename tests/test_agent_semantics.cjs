'use strict';
const assert=require('node:assert/strict'),C=require('../app/browser-extension/filling-core.js');
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts:[
  {key:'m.mode',label:'学历类型',value:'全日制',module:'education',recordId:'m',recordHint:'硕士'},
  {key:'b.mode',label:'学历类型',value:'全日制',module:'education',recordId:'b',recordHint:'本科'},
  {key:'m.school',label:'学校',value:'示例研究大学',module:'education',recordId:'m',recordHint:'硕士'},
  {key:'b.school',label:'学校',value:'示例本科大学',module:'education',recordId:'b',recordHint:'本科'}
],rules:[]}));
const scan={protocol:1,origin:'https://fixture.invalid',path:'/apply',fingerprint:'fixture',fields:[
  {id:'mode',label:'学制',module:'education',recordHint:'硕士',type:'text',value:''},
  {id:'school',label:'毕业院校',module:'personal',type:'text',value:''}
]};
let plan=C.plan(p,scan);assert.equal(plan.rows[0].status,'missing');assert.equal(plan.rows[1].status,'ambiguous');
const request=C.agentRequest(p,scan,plan,'fixture-user-model');assert(!JSON.stringify(request).includes('全日制'));assert(!JSON.stringify(request).includes('示例研究大学'));
let safe=C.safeAgentMappings(p,scan,{mode:'m.mode',school:'m.school'});assert.deepEqual(safe.accepted,{mode:'m.mode'});assert.deepEqual(safe.rejected,['school']);
plan=C.plan(p,scan,safe.accepted);assert.equal(plan.rows[0].status,'ready');assert.equal(plan.rows[0].value,'全日制');
safe=C.safeAgentMappings(p,scan,{mode:'b.mode'});assert.deepEqual(safe.accepted,{});
scan.fields[0].label='学校名称';safe=C.safeAgentMappings(p,scan,{mode:'m.mode'});assert.deepEqual(safe.accepted,{});
console.log('PASS semantic aliases can map to existing facts; explicit meaning and record constraints remain enforced; personal values stay local');
const boundaryProfile=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],rules:[],facts:[
 {key:'person.name',label:'姓名',module:'personal',value:'Fixture',aliases:['姓名']},
 {key:'person.home',label:'现居地',module:'personal',value:'Fixture City',aliases:['现居地']},
 {key:'edu.start',label:'入学时间',module:'education',recordId:'edu',value:'2024-09',aliases:['入学时间']},
 {key:'edu.end',label:'毕业时间',module:'education',recordId:'edu',value:'2027-06',aliases:['毕业时间']},
 {key:'intern.company',label:'单位',module:'internship',recordId:'intern',value:'Fixture Company',aliases:['单位']},
 {key:'project.start',label:'开始日期',module:'project',recordId:'project',value:'2024-09'}
]}));
const boundaryFields=[
 {id:'family',label:'姓名',module:'personal',groupLabel:'家庭成员'},
 {id:'posts',label:'开始时间',module:'project',groupLabel:'在校任职'},
 {id:'awards',label:'开始时间',module:'awards'},
 {id:'publications',label:'结束时间',module:'publications'},
 {id:'unknown',label:'开始时间',module:'other-experience'},
 {id:'eduStart',label:'开始时间',module:'education'},
 {id:'eduEnd',label:'结束时间',module:'education'},
 {id:'company',label:'单位名称',module:'internship'},
 {id:'residence',label:'现居住地',module:'personal'}
].map(f=>({...f,type:'text',value:''}));
const boundaryScan={...scan,fields:boundaryFields};
const boundaryPlan=C.plan(boundaryProfile,boundaryScan);
assert.deepEqual(boundaryPlan.rows.map(r=>r.status),['manual','missing','missing','missing','missing','ready','ready','ready','ready']);
const unsafe={family:'person.name',posts:'project.start',awards:'project.start',publications:'edu.end',unknown:'project.start'};
assert.deepEqual(C.safeAgentMappings(boundaryProfile,boundaryScan,unsafe).accepted,{});
assert.equal(C.plan(boundaryProfile,boundaryScan,unsafe).rows.filter(r=>r.status==='ready').length,4);
assert(!C.agentRequest(boundaryProfile,boundaryScan,boundaryPlan).fields.some(f=>Object.hasOwn(unsafe,f.id)));
console.log('PASS family and unsupported modules reject automatic/model mappings; old aliases retain shared synonyms');
const extraPack={schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],rules:[],facts:[
 {key:'highest',label:'最高学历',module:'personal',value:'硕士研究生'},
 {key:'master.level',label:'学历',module:'education',recordId:'master',value:'硕士'},
 {key:'master.end',label:'结束日期',module:'education',recordId:'master',value:'2027-06'},
 {key:'bachelor.level',label:'学历',module:'education',recordId:'bachelor',value:'本科'},
 {key:'bachelor.end',label:'结束日期',module:'education',recordId:'bachelor',value:'2024-06'},
 {key:'mode',label:'学历类型',module:'education',recordId:'master',value:'普通全日制'},
 {key:'score',label:'考试成绩',module:'language',value:'554.00000'},
 {key:'id',label:'证件号码',module:'personal',value:'554.00000'}
]};
const extraProfile=C.profile(C.validatePack(extraPack));
const extraScan={...scan,fields:[
 {id:'grad',label:'毕业时间',module:'personal',type:'text',value:''},
 {id:'mode',label:'学历类型',module:'education',type:'select',options:[{value:'full',text:'全日制'}],value:''},
 {id:'score',label:'考试成绩',module:'language',type:'text',value:'554'},
 {id:'id',label:'证件号码',module:'personal',type:'text',value:'554'}
]};
let extraPlan=C.plan(extraProfile,extraScan);assert.equal(extraPlan.rows[0].factKey,'master.end');assert.equal(extraPlan.rows[1].optionValue,'full');assert.equal(extraPlan.rows[2].status,'already');assert.notEqual(extraPlan.rows[3].status,'already');
assert.deepEqual(C.safeAgentMappings(extraProfile,extraScan,{grad:'master.end'}).accepted,{grad:'master.end'});
assert.deepEqual(C.safeAgentMappings(extraProfile,extraScan,{grad:'bachelor.end'}).accepted,{});
for(const facts of [extraPack.facts.filter(f=>f.key!=='highest'),[...extraPack.facts,{key:'second.level',label:'学历',module:'education',recordId:'second',value:'硕士'}]]) {
 const ambiguousProfile=C.profile(C.validatePack({...extraPack,facts}));
 assert.equal(C.plan(ambiguousProfile,extraScan).rows[0].status,'missing');
 assert.deepEqual(C.safeAgentMappings(ambiguousProfile,extraScan,{grad:'master.end'}).accepted,{});
}
console.log('PASS personal graduation requires explicit highest level and unique record; study-mode synonyms and scoped numeric equality');
