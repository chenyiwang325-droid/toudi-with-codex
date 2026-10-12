'use strict';
const assert=require('node:assert/strict'),W=require('../app/browser-extension/filling-workflow.js');
const plan={rows:[
 {fieldId:'name',module:'personal',label:'姓名',status:'ready'},
 {fieldId:'known',module:'personal',label:'手机',status:'already'},
 {fieldId:'work',module:'work',groupLabel:'工作经历',label:'单位名称',status:'conflict',recordBinding:{groupId:'employment-card',recordLabel:'合成全职经历'}},
 {fieldId:'intern',module:'work',groupLabel:'实习经历',label:'单位名称',status:'already',recordBinding:{groupId:'internship-card',recordLabel:'合成实习经历'}}
],expansion:[
 {sectionId:'employment',module:'internship',label:'工作经历',groupIds:['employment-card'],total:1,missing:[],canAdd:true},
 {sectionId:'internship',module:'internship',label:'实习经历',groupIds:['internship-card'],total:1,missing:[],canAdd:true},
 {sectionId:'projects',module:'project',label:'项目经历',groupIds:[],total:2,missing:[{id:'p1',label:'合成项目一'},{id:'p2',label:'合成项目二'}],canAdd:true},
 {sectionId:'award',module:'awards',label:'荣誉获奖',groupIds:[],total:1,missing:[{id:'a',label:'合成奖项'}],canAdd:false,reason:'saved-records-closed'},
 {sectionId:'school',module:'education',label:'教育经历',groupIds:[],total:2,missing:[{id:'e',label:'合成学历'}],canOpen:true,canAdd:false},
 {sectionId:'empty',module:'family',label:'家庭成员',groupIds:[],total:0,missing:[],canAdd:false}
]};
let preview=W.preview(plan);assert.equal(preview.total,7);assert.equal(preview.available,3);assert.equal(preview.complete,1);assert.equal(preview.pending,2);
assert.deepEqual(preview.modules.find(m=>m.id==='projects').planned.map(r=>r.id),['p1','p2']);assert.equal(preview.modules.find(m=>m.id==='award').canProcess,false);assert.equal(preview.modules.find(m=>m.id==='school').statusLabel,'待展开');assert.equal(preview.modules.find(m=>m.id==='school').planned.length,0,'Closed scope is not evidence of missing records');assert.equal(preview.modules.find(m=>m.id==='empty').status,'empty');
assert.equal(preview.modules.find(m=>m.id==='employment').records[0].label,'合成全职经历');assert.equal(preview.modules.find(m=>m.id==='internship').records[0].label,'合成实习经历','Parallel purposes retain their own groups');
preview=W.preview(plan,'empty');assert.equal(preview.available,2);assert.equal(preview.complete,2);assert.deepEqual(preview.modules.find(m=>m.id==='employment').records[0].kept,['单位名称']);
preview=W.preview(plan,'all',{pending:[{sectionId:'projects',reason:'add-no-new-record'}]});assert.equal(preview.modules.find(m=>m.id==='projects').canProcess,false);assert.equal(preview.modules.find(m=>m.id==='projects').reason,'add-no-new-record');assert.equal(preview.modules.find(m=>m.id==='projects').planned.length,0);
assert.equal(W.preview({rows:[]}).total,0);assert.equal(plan.rows[2].status,'conflict','Preview never changes the execution plan');
console.log('PASS whole-module preview: fieldless planned records, explicit section ownership, existing/all modes, unknown scopes and add failures are not reported as confirmed fills, unchanged execution plan');
