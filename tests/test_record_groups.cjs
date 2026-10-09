'use strict';
const assert=require('node:assert/strict'),C=require('../app/browser-extension/filling-core.js');
const facts=[];for(const [id,name,start,end] of [['a','合成甲公司','2024-05-01','2024-08-30'],['b','合成乙公司','2025-03-25','2025-07-16']])for(const [label,value] of [['单位',name],['开始日期',start],['结束日期',end],['职责',name+'完整职责']])facts.push({key:id+label,module:'internship',recordId:id,recordLabel:name,label,value});
facts.push({key:'award.scope',module:'awards',recordId:'award',label:'获奖级别',value:'国家级',aliases:['奖项等级']},{key:'award.rank',module:'awards',recordId:'award',label:'奖项等级',value:'一等奖'});
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],facts,rules:[]}));
const fields=['x','y'].flatMap(groupId=>['单位名称','结束时间','工作职责','开始时间'].map((label,i)=>({id:groupId+i,groupId,groupLabel:'实习经历',module:'work',label,type:/时间/.test(label)?'date':'text',value:''})));
const scan={protocol:1,origin:'https://fixture.invalid',path:'/apply',fingerprint:'f',fields};
let plan=C.plan(p,scan);assert(plan.rows.every(r=>r.status==='ambiguous'));assert(plan.groups.every(g=>g.status==='unbound'));assert.equal(C.agentRequest(p,scan,plan).fields.length,0);
assert.deepEqual(C.safeAgentMappings(p,scan,{x1:'a结束日期'}).accepted,{});
const bindings={x:'b',y:'a'};plan=C.plan(p,scan,{},new Date(),{},bindings);assert(plan.rows.every(r=>r.status==='ready'));for(const row of plan.rows){const id=bindings[row.recordBinding.groupId];assert(row.factKey.startsWith(id));assert(row.allowedFactKeys.every(k=>k.startsWith(id)));}
// A single supplied start cannot be combined with another record's end.
const partial={...p,facts:p.facts.filter(f=>!['a结束日期','b开始日期'].includes(f.key))};assert(C.plan(partial,scan).rows.every(r=>r.status==='ambiguous'));
// Existing old/abbreviated identities may be explicitly corrected, never auto guessed.
const old={...scan,fields:fields.map(f=>f.id==='x0'?{...f,value:'旧名'}:f)};
assert.equal(C.plan(p,old).groups[0].status,'conflict');plan=C.plan(p,old,{},new Date(),{},bindings);assert.equal(plan.groups[0].status,'bound');assert.equal(plan.rows[0].status,'conflict');assert.throws(()=>C.confirm(plan,['x0']),/覆盖/);assert.equal(C.confirm(plan,['x0'],['x0']).actions[0].value,'合成乙公司');
assert.throws(()=>C.plan(p,scan,{},new Date(),{},{x:'award'}),/模块/);
const bad=C.plan(p,scan,{x1:'a结束日期'},new Date(),{},bindings);assert.equal(bad.rows.find(r=>r.fieldId==='x1').status,'missing');
const awardScan={...scan,fields:['获奖级别','奖项等级'].map((label,i)=>({id:'award'+i,label,module:'awards',type:'text',value:''}))};assert.deepEqual(C.plan(p,awardScan).rows.map(r=>r.value),['国家级','一等奖']);
const alias={...scan,fields:fields.map(f=>f.id==='x0'?{...f,value:'合成乙公司'}:f)};assert.equal(C.plan(p,alias).groups[0].recordId,'b');
const protectedPack={...p,facts:p.facts.map(f=>f.key==='b职责'?{...f,sensitive:true}:f)};assert.deepEqual(C.safeAgentMappings(protectedPack,scan,{x2:'b职责'},bindings).accepted,{});
// Exactly one supplied record and one page card is unambiguous. Two empty cards
// must not receive the same record merely because the source has only one record.
const single={...p,facts:p.facts.filter(f=>f.module==='internship'&&f.recordId==='a')};
assert.equal(C.plan(single,{...scan,fields:fields.filter(f=>f.groupId==='x')}).groups[0].recordId,'a');
assert(C.plan(single,scan).groups.every(g=>g.status==='unbound'));
console.log('PASS group binding: cold groups never mix dates, one binding scopes complete record, explicit correction keeps overwrite guard, cross-module rejected, awards scope/rank separate');
