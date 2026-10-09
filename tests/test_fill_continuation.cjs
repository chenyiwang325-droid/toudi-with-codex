'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../app/browser-extension'),local={},session={};let listener,url='https://fixture.invalid/application?job=one',shape='shape-one';
const values={},storage=data=>({async get(key){return {[key]:structuredClone(data[key])}},async set(value){Object.assign(data,structuredClone(value))},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key]},async setAccessLevel(){}});
const tab=()=>({id:1,url});
const context={structuredClone,crypto:webcrypto,TextEncoder,URL,console,setTimeout,clearTimeout,chrome:{storage:{local:storage(local),session:storage(session)},runtime:{id:'fixture',getManifest:()=>({version:'fixture'}),getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn}}},tabs:{get:async()=>tab(),query:async()=>[tab()]}}};
vm.createContext(context);context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context));vm.runInContext(fs.readFileSync(path.join(root,'worker.js'),'utf8'),context);
context.fixtureEngine=async(_tab,op,arg)=>{
 if(op==='apply'){
  assert.equal(arg.submitted,false);const results=arg.actions.map(a=>{values[a.fieldId]=a.value;return {fieldId:a.fieldId,status:'verified',reason:'readback-matched',actualValue:a.value}});
  return {results,summary:{verified:results.length,failed:0,conflict:0,manual:0},submitted:false,saveState:'unconfirmed',warnings:[]};
 }
 return {protocol:1,engineVersion:'fixture',origin:'https://fixture.invalid',path:'/application',fingerprint:shape,fields:['name','start','end','body'].map(k=>({id:k,groupId:'work',groupLabel:'实习经历',module:'work',label:({name:'单位名称',start:'开始时间',end:'结束时间',body:'实习内容'})[k],type:['start','end'].includes(k)?'date':'text',value:values[k]||''}))};
};vm.runInContext('engine=fixtureEngine',context);
const send=m=>new Promise((resolve,reject)=>listener(m,{id:'fixture',url:'chrome-extension://fixture/popup.html'},r=>r.error?reject(Error(r.error)):resolve(r.value)));
const originalBody='合成实习原文：完整保留背景、职责、行动、结果。'.repeat(25);
const source={schemaVersion:1,profiles:[{id:'general',label:'合成资料'},{id:'alternate',label:'合成另一版'}],rules:[],facts:['a','b'].flatMap(id=>[
 ['单位','合成单位'+id],['开始日期','2025-05-01'],['结束日期','2025-08-30'],['职责',originalBody]
].map(([label,value])=>({key:id+label,module:'internship',recordId:id,recordLabel:'合成单位'+id,label,value,profiles:['general','alternate']})))};
(async()=>{
 await send({op:'profile-save',base:null,pack:source});await send({op:'scan'});
 let result=await send({op:'remap',recordBindings:{work:'b'}});assert.equal(result.plan.rows.filter(r=>r.status==='ready').length,4);
 result=await send({op:'fill',selected:['start'],overwrite:[]});assert.equal(result.report.summary.verified,1);assert.equal(result.plan.rows.length,4,'A report retains the record plan');assert.equal(result.pending.length,3);assert.equal(result.engineVersion,'fixture');
 assert.equal(session.toudiFillingSession.recordBindings.work,'b');assert.equal(local.toudiLastReport.submitted,false);assert(!('actualValue' in result.report.results[0]));
 result=await send({op:'scan',resume:true});assert.equal(result.plan.groups[0].recordId,'b');assert.equal(result.plan.rows.find(r=>r.fieldId==='start').status,'already');assert.equal(result.report,undefined);assert.equal(result.plan.rows.find(r=>r.fieldId==='body').displayValue,originalBody);
 result=await send({op:'fill',selected:['name','end','body'],overwrite:[]});assert.equal(result.report.summary.verified,3);assert.equal(values.body,originalBody);
 result=await send({op:'scan',resume:true});assert.equal(result.plan.rows.filter(r=>r.status==='already').length,4);
 // An unfilled name allows the tests below to detect record-choice reuse rather
 // than identity-based matching of values already written by this same source.
 for(const key of Object.keys(values))delete values[key];
 await send({op:'scan'});await send({op:'remap',recordBindings:{work:'b'}});
 result=await send({op:'scan',resume:true,profile:'alternate'});assert.equal(result.plan.groups[0].recordId,'a','A different profile allocates the blank slot afresh; it cannot reuse the old b choice');
 await send({op:'scan',profile:'general'});await send({op:'remap',recordBindings:{work:'b'}});shape='shape-two';
 result=await send({op:'scan',resume:true});assert.equal(result.plan.groups[0].recordId,'a','Changed structure allocates the blank slot afresh');
 await send({op:'remap',recordBindings:{work:'b'}});url='https://fixture.invalid/application?job=two';
 assert.equal((await send({op:'state'})).state,null,'Changing query identity invalidates the old page plan');
 result=await send({op:'scan',resume:true});assert.equal(result.plan.groups[0].recordId,'a');
 await send({op:'remap',recordBindings:{work:'b'}});const current=await send({op:'profile-read'});
 await send({op:'profile-save',base:current.pack.sourceVersion,pack:{...current.pack,facts:current.pack.facts.map(f=>f.label==='职责'?{...f,value:f.value+'新资料'}:f)}});
 result=await send({op:'scan',resume:true});assert.equal(result.plan.groups[0].recordId,'a','A different source version cannot reuse an old choice');
 console.log('PASS continuation: report retains plan and bindings; fresh values skip verified fields; full body remains exact; profile/structure/query/source changes cannot reuse choices; no submission');
})().catch(e=>{console.error(e);process.exitCode=1});
