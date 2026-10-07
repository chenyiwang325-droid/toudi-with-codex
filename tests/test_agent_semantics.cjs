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
