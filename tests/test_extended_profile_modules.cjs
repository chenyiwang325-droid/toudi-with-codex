'use strict';
const assert=require('node:assert/strict'),C=require('../app/browser-extension/filling-core.js'),L=require('../app/browser-extension/profile-library.js');
let pack=L.emptyPack();
for(const [mod,values] of Object.entries({'campus-role':{organization:'合成研究社',role:'负责人',start:'2023-09',end:'2024-06',tasks:'安排活动与协作'},awards:{name:'合成研究奖',level:'校级',date:'2024-05',issuer:'合成学院',description:'项目研究成果'},publications:{name:'合成城市研究论文',venue:'合成研究期刊',date:'2024-06',order:'第二作者',abstract:'研究街道空间'}})){
 pack=L.saveRecord(pack,mod,'',values);assert(pack.facts.some(f=>f.module===mod));
}
const p=C.profile(pack,'general'),fields=[{id:'role',label:'担任职务',module:'campus-role'},{id:'award',label:'获奖名称',module:'awards'},{id:'paper',label:'论文题目',module:'publications'}].map(f=>({...f,type:'text',value:''}));
const scan={protocol:1,origin:'https://fixture.invalid',path:'/apply',fingerprint:'fixture',fields};
const plan=C.plan(p,scan);assert.deepEqual(plan.rows.map(r=>r.status),['ready','ready','ready']);
const campus=pack.facts.find(f=>f.module==='campus-role' && f.label==='职务');
assert.equal(C.safeAgentMappings(p,scan,{paper:campus.key,award:campus.key}).rejected.length,2);
assert.equal(C.plan(p,scan,{award:campus.key}).rows.find(r=>r.fieldId==='award').status,'manual');
const records=L.copyRecords(pack,'general');assert.equal(records.length,3);assert(records.find(r=>r.module==='campus-role').text.includes('组织名称：合成研究社'));assert(records.find(r=>r.module==='campus-role').text.includes('职务：负责人'));
const added=L.addVersion(pack,'合成另一版','general');const second=added.pack.facts.find(f=>f.module==='campus-role' && f.profiles.includes(added.id) && f.label==='职务');second.value='另一版职务';
assert(!L.copyRecords(added.pack,'general').map(r=>r.text).join('\n').includes('另一版职务'));assert(L.copyRecords(added.pack,added.id).map(r=>r.text).join('\n').includes('另一版职务'));
const dates=['2024-06','2024-06-15'].map((value,i)=>{const fact=C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],facts:[{key:'date'+i,label:'开始日期',value,module:'campus-role'}],rules:[]});return C.plan(C.profile(fact),{...scan,fields:[{id:'date',label:'开始时间',module:'campus-role',type:'date',adapter:'phoenix-date',value:''}]}).rows[0];});
assert.deepEqual(dates.map(r=>r.status),['ready','ready']);assert.deepEqual(dates.map(r=>r.value),['2024-06','2024-06-15']);
console.log('PASS extended modules: record editing, shared aliases, cross-module rejection, version-specific field/record copy, deferred Phoenix date precision');
