'use strict';
const assert=require('node:assert/strict'),C=require('../app/browser-extension/filling-core.js');
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],rules:[],facts:[
 {key:'a.title',label:'论文名称',value:'合成城市研究甲',module:'publications',recordId:'a'},
 {key:'a.order',label:'作者排序',value:'第五作者',module:'publications',recordId:'a'},
 {key:'a.names',label:'作者名单',value:'甲、乙、丙、丁、戊',module:'publications',recordId:'a'},
 {key:'a.index',label:'收录类别',value:'SSCI',module:'publications',recordId:'a'},
 {key:'b.title',label:'论文名称',value:'合成城市研究乙',module:'publications',recordId:'b'},
 {key:'b.order',label:'作者排序',value:'第一作者',module:'publications',recordId:'b'},
 {key:'secret',label:'邮箱',value:'private@example.invalid',module:'personal',sensitive:true}
]}));
const opts=['第一作者','通讯作者','其他'].map((text,i)=>({text,value:String(i)}));
const scan={protocol:1,origin:'https://fixture.invalid',path:'/apply',fingerprint:'fixture',fields:[{id:'author',label:'作者',module:'publications',recordHint:'合成城市研究甲',type:'select',options:opts,value:''},{id:'names',label:'作者名单',module:'publications',recordHint:'合成城市研究甲',type:'text',value:''}]};
let plan=C.plan(p,scan);assert.equal(plan.rows[0].status,'manual');assert.equal(plan.rows[1].value,'甲、乙、丙、丁、戊');
let req=C.agentRequest(p,scan,plan,'fixture-model');assert.deepEqual(req.fields[0].factKeys,['a.order']);assert.deepEqual(req.allowedFacts.map(f=>f.value),['第五作者']);assert(!JSON.stringify(req).includes('private@example.invalid'));assert(!JSON.stringify(req).includes('第一作者","module'));
const d={factKey:'a.order',optionValue:'2',reason:'本人为第五作者，归入网站其他作者选项。',sourceKeys:['a.order']};
const safe=C.safeAgentMappings(p,scan,{author:'a.order'});assert.deepEqual(safe.accepted,{author:'a.order'});
assert.deepEqual(C.safeAgentDecisions(p,scan,{author:d},safe.accepted).accepted,{author:d});
plan=C.plan(p,scan,safe.accepted,new Date(),{author:d});assert.equal(plan.rows[0].status,'ready');assert.equal(plan.rows[0].optionValue,'2');assert.match(plan.rows[0].reason,/第五作者/);assert.equal(C.confirm(plan,['author']).actions[0].optionValue,'2');
for(const patch of [{optionValue:'invented'},{optionValue:'0'},{optionValue:'1'},{sourceKeys:['b.order']},{factKey:'b.order'},{factKey:'a.names'}, {reason:''}])assert.equal(Object.keys(C.safeAgentDecisions(p,scan,{author:{...d,...patch}},safe.accepted).accepted).length,0);
const noOptions=structuredClone(scan);noOptions.fields[0].options=[];assert.deepEqual(C.safeAgentDecisions(p,noOptions,{author:d},safe.accepted).accepted,{});
const noRecord=structuredClone(scan);delete noRecord.fields[0].recordHint;assert.deepEqual(C.safeAgentMappings(p,noRecord,{author:'a.order'}).accepted,{});
const unknown=structuredClone(p);unknown.facts.find(f=>f.key==='a.order').value='作者排序待核';assert.deepEqual(C.safeAgentDecisions(unknown,scan,{author:d},safe.accepted).accepted,{});
console.log('PASS bounded author option decisions, exact option/source verification, absent options, unknowns, sensitive exclusion and cross-record refusal');

const indexScan=structuredClone(scan);indexScan.fields=[{id:'index',label:'收录类别',module:'publications',recordHint:'合成城市研究甲',type:'select',options:[{value:'sci',text:'SCI'},{value:'ssci',text:'SSCI'},{value:'scie',text:'SCIE'},{value:'cssci',text:'CSSCI'}],value:'SSCI'}];
const di={factKey:'a.index',optionValue:'ssci',reason:'资料收录类别为SSCI',sourceKeys:['a.index']};
for(const value of ['sci','scie','cssci'])assert.deepEqual(C.safeAgentDecisions(p,indexScan,{index:{...di,optionValue:value}},{index:'a.index'}).accepted,{});
assert.equal(C.plan(p,indexScan,{index:'a.index'},new Date(),{index:di}).rows[0].status,'already','existing display text is compared to option text as well as option ID');
const campus=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成'}],rules:[],facts:[{key:'role',label:'职务',value:'组织委员',module:'campus-role',recordId:'r'},{key:'level',label:'学生干部级别',value:'班级',module:'campus-role',recordId:'r'}]}));
const campusScan={...scan,fields:[{id:'cat',label:'在校职务类别',module:'campus-role',recordHint:'组织委员',type:'select',options:[{value:'other',text:'其他'},{value:'leader',text:'班长/团支书'}],value:''},{id:'level',label:'干部级别',module:'campus-role',recordHint:'组织委员',type:'select',options:[{value:'class',text:'班级'},{value:'school',text:'校级'}],value:''}]};
const cr=C.agentRequest(campus,campusScan,C.plan(campus,campusScan));assert.deepEqual(cr.fields.find(f=>f.id==='cat').factKeys,['role']);assert(!cr.fields.some(f=>f.id==='level'),'unambiguous local choice needs no model call');assert.equal(C.plan(campus,campusScan).rows.find(r=>r.fieldId==='level').factKey,'level');
console.log('PASS exact indexing tokens, existing option display readback and campus role/category-level separation');

const education=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],rules:[],facts:[{key:'edu.school',label:'学校',value:'合成大学',module:'education',recordId:'edu'},{key:'edu.mode',label:'学历类型',value:'普通全日制',module:'education',recordId:'edu'}]}));
const modeScan={...scan,fields:[{id:'studyMode',label:'学习形式',module:'education',recordHint:'合成大学',type:'combobox',adapter:'phoenix-select',options:[{value:'full',text:'全国普通高等院校全日制'},{value:'part',text:'全国普通高等院校非全日制'},{value:'adult',text:'成人高等教育'},{value:'transfer',text:'统招专升本'}],value:''}]};
let modePlan=C.plan(education,modeScan);assert.equal(modePlan.rows[0].status,'ready');assert.equal(modePlan.rows[0].optionValue,'full');assert.equal(C.agentRequest(education,modeScan,modePlan).fields.length,0,'An explicit full-time synonym is resolved locally');
modeScan.fields[0].value='全国普通高等院校全日制';assert.equal(C.plan(education,modeScan).rows[0].status,'already');
modeScan.fields[0].value='全国普通高等院校非全日制';assert.equal(C.plan(education,modeScan).rows[0].status,'conflict','Never conflate full-time and part-time');
const broad=structuredClone(education);broad.facts.find(f=>f.key==='edu.mode').value='普通高等教育';assert.equal(C.plan(broad,modeScan).rows[0].status,'manual','A broad education type does not prove full-time study');
console.log('PASS exact study-mode synonyms, existing choice readback and no inference of study mode or transfer route');
