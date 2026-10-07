'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const root=path.join(__dirname,'../app/browser-extension'),local={},session={};let listener,resolveModel,modelCalls=0,profileCalls=0;
function storage(data){return {async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},async setAccessLevel(){}};}
const context={structuredClone,crypto:webcrypto,TextEncoder,URL,console,setTimeout,clearTimeout,chrome:{storage:{local:storage(local),session:storage(session)},runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn}},id:'fixture'},tabs:{query:async()=>[{id:1,url:'https://fixture.invalid/application'}]}}};vm.createContext(context);context.importScripts=(...names)=>{for(const n of names)vm.runInContext(fs.readFileSync(root+'/'+n,'utf8'),context)};vm.runInContext(fs.readFileSync(root+'/worker.js','utf8'),context);
context.fixtureEngine=async()=>({protocol:1,origin:'https://fixture.invalid',path:'/application',fingerprint:'fixture',fields:[{id:'height',label:'身高',module:'personal',type:'text',value:''},{id:'unknown',label:'身高补充项',module:'personal',type:'text',value:''}]});
context.fixtureNative=async p=>{if(p.op==='map'){modelCalls++;return new Promise(resolve=>{resolveModel=resolve})}profileCalls++;throw Error('合成断线')};vm.runInContext('engine=fixtureEngine;native=fixtureNative',context);
const send=m=>new Promise((resolve,reject)=>listener(m,{id:'fixture',url:'chrome-extension://fixture/popup.html'},r=>r.error?reject(Error(r.error)):resolve(r.value)));
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 await send({op:'profile-save',base:null,pack:{schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts:[{key:'height',label:'身高cm',value:'175',module:'personal'}],rules:[]}});
 await send({op:'preferences',preferences:{agentMode:'codex',agentModel:'fixture-user-model',autoAgent:true}});
 const before=Date.now();let state=await send({op:'scan'});assert.equal(modelCalls,0,'scan must not wait for or call a model');assert(state.autoAgentPending);assert.equal(state.plan.statusCounts.ready,1);assert(Date.now()-before<250);
 const mapping=send({op:'remap',agent:true,startedAt:state.startedAt});await tick();assert.equal(modelCalls,1);
 const fast=await Promise.race([send({op:'state'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('model blocked local state')),250))]);assert.equal(fast.state.plan.statusCounts.ready,1);assert.equal(profileCalls,0,'opening popup must not wait for native sync');
 const manual=await send({op:'remap',mappings:{unknown:'height'}});assert.equal(manual.plan.statusCounts.ready,2);resolveModel({mappings:{unknown:'height'},provider:{called:true}});await assert.rejects(mapping,/手动匹配已变化/);
 await new Promise(r=>setTimeout(r,2));state=await send({op:'scan'});const pending=send({op:'remap',agent:true,startedAt:state.startedAt});await tick();await send({op:'clear-plan'});resolveModel({mappings:{unknown:'height'},provider:{called:true}});await assert.rejects(pending,/重新识别/);assert.equal((await send({op:'state'})).state,null,'late model must not revive a cleared or filled plan');
 console.log('PASS scan returns before model, local state/manual mapping stay responsive during pending model, late model cannot overwrite manual choices or revive cleared plans');
})().catch(e=>{console.error(e);process.exitCode=1});
