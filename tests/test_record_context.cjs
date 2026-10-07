'use strict';
const assert=require('node:assert/strict'),C=require('../app/browser-extension/filling-core.js');
const facts=[];
const add=(module,recordId,label,value)=>facts.push({key:module+'.'+recordId+'.'+label,module,recordId,label,value,aliases:[label]});
for(const [id,role,start] of [['learning','合成学习委员','2020-09'],['union','合成学生会干事','2019-09']])for(const [label,value] of [['职务',role],['开始日期',start],['职责描述',role+'的实际职责']])add('campus-role',id,label,value);
for(const [id,name] of [['one','合成科研项目甲'],['two','合成实践项目乙']])for(const [label,value] of [['名称',name],['角色','合成团队成员'],['简述',name+'研究描述'],['开始日期','2024-09']])add('project',id,label,value);
for(const [id,name] of [['first','合成论文完整题目甲'],['second','合成论文完整题目乙']])for(const [label,value] of [['论文名称',name],['发表日期','2025-11']])add('publications',id,label,value);
for(const [id,name] of [['first','合成奖项甲'],['second','合成奖项乙']])for(const [label,value] of [['奖项名称',name],['获奖日期','2023-05']])add('awards',id,label,value);
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts,rules:[]}));
const scan={protocol:1,origin:'https://fixture.invalid',path:'/apply',fingerprint:'fixture',fields:[
 {id:'campusRole',module:'campus-role',label:'在校职务名称',recordHint:'合成学习委员'},
 {id:'campusDescription',module:'campus-role',label:'在校职务描述',recordHint:'合成学习委员'},
 {id:'campusDate',module:'campus-role',label:'开始时间',recordHint:'合成学习委员'},
 {id:'campusCategory',module:'campus-role',label:'在校职务类别',recordHint:'合成学习委员'},
 {id:'projectName',module:'projects',label:'在校科研及实践项目',recordHint:'合成实践项目乙'},
 {id:'projectRole',module:'projects',label:'担任角色',recordHint:'合成实践项目乙'},
 {id:'projectDescription',module:'projects',label:'实践描述',recordHint:'合成实践项目乙'},
 {id:'paperName',module:'publications',label:'名称',recordHint:'合成论文完整题目乙'},
 {id:'paperDate',module:'publications',label:'发布时间',recordHint:'合成论文完整题目乙'},
 {id:'awardDate',module:'awards',label:'获奖时间',recordHint:'合成奖项甲'},
 {id:'blankCampus',module:'campus-role',label:'开始时间',groupLabel:'在校职务 · 第2段'},
 {id:'unknownProject',module:'projects',label:'开始时间',recordHint:'无对应来源的另一个项目'},
 {id:'personalName',module:'personal',label:'名称'}
].map(f=>({...f,type:'text',value:''}))};
const plan=C.plan(p,scan),rows=Object.fromEntries(plan.rows.map(r=>[r.fieldId,r]));
assert.equal(rows.campusRole.factKey,'campus-role.learning.职务');assert.equal(rows.campusDescription.factKey,'campus-role.learning.职责描述');assert.equal(rows.campusDate.factKey,'campus-role.learning.开始日期');assert.equal(rows.campusCategory.status,'missing');assert.match(rows.campusCategory.reason,/候选选项/);
assert.equal(rows.projectName.factKey,'project.two.名称');assert.equal(rows.projectRole.factKey,'project.two.角色');assert.equal(rows.projectDescription.factKey,'project.two.简述');assert.equal(rows.paperName.factKey,'publications.second.论文名称');assert.equal(rows.paperDate.factKey,'publications.second.发表日期');assert.equal(rows.awardDate.factKey,'awards.first.获奖日期');
assert.equal(rows.blankCampus.status,'ambiguous','numbered cards cannot provide evidence');assert.equal(rows.unknownProject.status,'missing','explicit unmatched identity cannot use an unrelated record');assert.equal(rows.personalName.status,'missing','module-specific name aliases never leak to personal fields');
assert.deepEqual(C.safeAgentMappings(p,scan,{projectRole:'project.one.角色',paperDate:'publications.first.发表日期',blankCampus:'campus-role.union.开始日期',unknownProject:'project.one.开始日期'}).accepted,{});
assert.deepEqual(C.safeAgentMappings(p,scan,{projectRole:'project.two.角色',paperDate:'publications.second.发表日期'}).accepted,{projectRole:'project.two.角色',paperDate:'publications.second.发表日期'});
const duplicate=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],facts:[...facts,{key:'campus-role.duplicate.职务',module:'campus-role',recordId:'duplicate',label:'职务',value:'合成学习委员'},{key:'campus-role.duplicate.开始日期',module:'campus-role',recordId:'duplicate',label:'开始日期',value:'2021-09'}],rules:[]}));
assert.equal(C.plan(duplicate,scan).rows.find(r=>r.fieldId==='campusDate').status,'ambiguous');assert.deepEqual(C.safeAgentMappings(duplicate,scan,{campusDate:'campus-role.learning.开始日期'}).accepted,{});
const empty=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],facts:[],rules:[]}));assert.match(C.plan(empty,scan).rows.find(r=>r.fieldId==='projectName').reason,/资料版本/);
console.log('PASS scoped Phoenix field aliases, verified identity record binding, blank/duplicate/unknown identity protection, category option boundary and version-scope guidance');

const prefix='Synthetic Publication Long Identifiable Prefix';
const paperFacts=[{key:'one.name',label:'论文名称',module:'publications',recordId:'one',value:prefix+' Unique Complete Title'},{key:'one.date',label:'发表日期',module:'publications',recordId:'one',value:'2025-11'}];
const paperScan={...scan,fields:[{id:'date',module:'publications',label:'发布时间',recordHint:prefix+'…（示例期刊）',type:'text',value:''}]};
const singlePaper=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],facts:paperFacts,rules:[]}));assert.equal(C.plan(singlePaper,paperScan).rows[0].factKey,'one.date');
const duplicatePrefix=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],facts:[...paperFacts,{key:'two.name',label:'论文名称',module:'publications',recordId:'two',value:prefix+' Different Complete Title'},{key:'two.date',label:'发表日期',module:'publications',recordId:'two',value:'2026-01'}],rules:[]}));assert.equal(C.plan(duplicatePrefix,paperScan).rows[0].status,'ambiguous');assert.deepEqual(C.safeAgentMappings(duplicatePrefix,paperScan,{date:'one.date'}).accepted,{});
assert.equal(C.plan(singlePaper,{...paperScan,fields:[{...paperScan.fields[0],recordHint:'Synthetic…'}]}).rows[0].status,'missing');
assert.equal(C.plan(singlePaper,{...paperScan,fields:[{...paperScan.fields[0],recordHint:prefix}]}).rows[0].status,'missing','a shortened title without explicit ellipsis cannot activate prefix matching');
console.log('PASS explicit long publication ellipsis prefix binds only one record; duplicate and short prefixes remain unresolved');
