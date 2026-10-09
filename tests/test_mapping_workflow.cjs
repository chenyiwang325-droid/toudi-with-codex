'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const root=path.join(__dirname,'../app/browser-extension'),local={},session={};let listener,resolveModel,modelCalls=0,currentValue='',shape='shape-1',reject=false;
function storage(data){return {async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},async setAccessLevel(){}};}
const context={structuredClone,crypto:webcrypto,TextEncoder,URL,console,setTimeout,clearTimeout,chrome:{storage:{local:storage(local),session:storage(session)},runtime:{getManifest:()=>({version:'fixture-version'}),getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn}},id:'fixture'},tabs:{get:async()=>({id:1,url:'https://fixture.invalid/application?private=ignored'}),query:async()=>[{id:1,url:'https://fixture.invalid/application?private=ignored'}]}}};vm.createContext(context);context.importScripts=(...names)=>{for(const n of names)vm.runInContext(fs.readFileSync(root+'/'+n,'utf8'),context)};vm.runInContext(fs.readFileSync(root+'/worker.js','utf8'),context);

context.fixtureEngine=async()=>({protocol:1,engineVersion:'fixture',origin:'https://fixture.invalid',path:'/application',fingerprint:'shape',fields:[{id:'one',label:'培养模式',module:'education',recordHint:'硕士',type:'text',value:''},{id:'two',label:'补充说明',module:'personal',type:'text',value:''}]});
const reviewModules=[];
context.fixtureNative=async request=>{
 assert.equal(request.op,'map');assert.equal(request.fields.length,1);reviewModules.push(request.fields[0].module);
 const education=request.fields[0].id==='one';
 return {mappings:education?{one:'m.mode'}:{},provider:{called:true,model:'fixture-model',mappingReview:{returned:education?3:1,ignored:education?1:0,duplicates:education?1:0,rejected:education?[]:[{fieldId:'two',reason:'unknown-fact'}]}}};
};
vm.runInContext('engine=fixtureEngine;native=fixtureNative',context);
const send=m=>new Promise((resolve,reject)=>listener(m,{id:'fixture',url:'chrome-extension://fixture/popup.html'},r=>r.error?reject(Error(r.error)):resolve(r.value)));
(async()=>{
 await send({op:'profile-save',base:null,pack:{schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts:[{key:'m.mode',label:'学历类型',value:'全日制',module:'education',recordId:'m',recordHint:'硕士'},{key:'p.other',label:'其他说明',value:'合成非敏感说明',module:'personal'}],rules:[]}});
 await send({op:'preferences',preferences:{agentMode:'codex',agentModel:'fixture-model',autoAgent:false}});
 await send({op:'scan'});session.toudiFillingSession.agentError='old failure';
 const state=await send({op:'remap',agent:true});
 assert.equal(state.agentReview.status,'completed');assert.equal(state.agentReview.accepted,1);assert.equal(state.agentReview.rejected,1);
 assert.equal(state.agentReview.ignored,1);assert.equal(state.agentReview.duplicates,1);assert.equal(state.agentReview.returned,4);
 assert.deepEqual(reviewModules,['education','personal']);
 assert.equal(state.plan.rows.find(r=>r.fieldId==='one').status,'ready');assert.notEqual(state.plan.rows.find(r=>r.fieldId==='two').status,'ready');
 assert.match(state.agentReview.items.find(r=>r.fieldId==='two').reason,/有效资料键/);assert(!state.agentError);
 console.log('PASS partial model response preserves valid mapping, reports individual rejection and duplicate/unknown counts, clears stale error');
})().catch(e=>{console.error(e);process.exitCode=1});
