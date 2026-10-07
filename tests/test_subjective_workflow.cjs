'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const root=path.join(__dirname,'../app/browser-extension'),local={},session={};let listener,resolveModel,modelCalls=0,currentValue='',shape='shape-1',reject=false;
function storage(data){return {async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},async setAccessLevel(){}};}
const context={structuredClone,crypto:webcrypto,TextEncoder,URL,console,setTimeout,clearTimeout,chrome:{storage:{local:storage(local),session:storage(session)},runtime:{getManifest:()=>({version:'fixture-version'}),getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn}},id:'fixture'},tabs:{query:async()=>[{id:1,url:'https://fixture.invalid/application?private=ignored'}]}}};vm.createContext(context);context.importScripts=(...names)=>{for(const n of names)vm.runInContext(fs.readFileSync(root+'/'+n,'utf8'),context)};vm.runInContext(fs.readFileSync(root+'/worker.js','utf8'),context);

let actions=[];
context.fixtureEngine=async(tab,op,arg)=>{
 if(op==='apply'){actions=arg.actions;currentValue=actions[0].value;return {summary:{verified:1},results:[{fieldId:'q',status:'verified'}]};}
 return {protocol:1,engineVersion:'fixture',origin:'https://fixture.invalid',path:'/application',fingerprint:shape,fields:[{id:'q',label:'个人评价',module:'personal',type:'textarea',value:currentValue,maxLength:30}]};
};context.fixtureNative=async p=>{assert.equal(p.op,'answer');assert.equal(p.model,'fixture-model');return {answer:{answer:'我善于整理需求。',sourceKeys:['project.description'],uncertainties:[]}}};vm.runInContext('engine=fixtureEngine;native=fixtureNative',context);
const send=m=>new Promise((resolve,reject)=>listener(m,{id:'fixture',url:'chrome-extension://fixture/popup.html'},r=>r.error?reject(Error(r.error)):resolve(r.value)));
(async()=>{
 await send({op:'profile-save',base:null,pack:{schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts:[{key:'project.description',label:'项目职责',value:'整理需求',module:'project'}],rules:[]}});
 await send({op:'preferences',preferences:{agentMode:'codex',agentModel:'fixture-model',autoAgent:false}});
 let state=await send({op:'scan'});state=await send({op:'answer-generate',fieldId:'q'});
 assert.equal(state.answerDraft.approved,false);await assert.rejects(()=>send({op:'fill',selected:['q']}));assert.equal(actions.length,0);
 await send({op:'answer-approve',fieldId:'q',answer:'我善于整理需求并完成原型。'});
 const profileBefore=JSON.stringify(local.toudiPrivateProfile);
 state=await send({op:'fill',selected:['q']});assert.equal(state.report.summary.verified,1);assert.equal(actions[0].expectedValue,'');assert.equal(actions[0].overwrite,false);assert.equal(JSON.stringify(local.toudiPrivateProfile),profileBefore);
 currentValue='原有回答';await send({op:'scan'});await send({op:'answer-generate',fieldId:'q'});await send({op:'answer-approve',fieldId:'q',answer:'我善于整理需求。'});
 await assert.rejects(()=>send({op:'fill',selected:['q']}),/覆盖/);await send({op:'fill',selected:['q'],overwrite:['q']});assert.equal(actions[0].expectedValue,'原有回答');assert.equal(actions[0].overwrite,true);
 await send({op:'scan'});await send({op:'answer-generate',fieldId:'q'});currentValue='网页编辑';await assert.rejects(()=>send({op:'answer-approve',fieldId:'q',answer:'回答'}),/已变化/);
 console.log('PASS subjective full worker: draft cannot fill before adoption, approved bounded action uses original-value guard, explicit overwrite, unchanged profile and stale-page rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
