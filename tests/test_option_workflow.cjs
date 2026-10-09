'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const root=path.join(__dirname,'../app/browser-extension'),local={},session={};let listener,resolveModel,modelCalls=0,currentValue='',shape='shape-1',reject=false;
function storage(data){return {async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},async setAccessLevel(){}};}
const context={structuredClone,crypto:webcrypto,TextEncoder,URL,console,setTimeout,clearTimeout,chrome:{storage:{local:storage(local),session:storage(session)},runtime:{getManifest:()=>({version:'fixture-version'}),getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn}},id:'fixture'},tabs:{get:async()=>({id:1,url:'https://fixture.invalid/application?private=ignored'}),query:async()=>[{id:1,url:'https://fixture.invalid/application?private=ignored'}]}}};vm.createContext(context);context.importScripts=(...names)=>{for(const n of names)vm.runInContext(fs.readFileSync(root+'/'+n,'utf8'),context)};vm.runInContext(fs.readFileSync(root+'/worker.js','utf8'),context);

let inspections=0;
context.fixtureEngine=async(tab,op,arg)=>{
 if(op==='inspect-options'){inspections++;assert.equal(arg.fieldIds[0],'author');return {fingerprint:'shape',items:[{fieldId:'author',options:[{value:'第一作者',text:'第一作者'},{value:'通讯作者',text:'通讯作者'},{value:'其他',text:'其他'}]}]};}
 return {protocol:1,origin:'https://fixture.invalid',path:'/application',fingerprint:'shape',fields:[{id:'author',label:'作者',module:'publications',recordHint:'合成论文',adapter:'phoenix-select',type:'combobox',options:[],value:''}]};
};
context.fixtureNative=async request=>{
 assert.equal(request.op,'map');assert.equal(request.model,'fixture-model');assert.equal(request.fields[0].options.length,3);assert.equal(request.allowedFacts.length,1);assert.equal(request.allowedFacts[0].label,'作者排序');assert.equal(request.allowedFacts[0].value,'第五作者');
 return {mappings:{author:'rank'},provider:{called:true,model:'fixture-model',optionDecisions:{author:{factKey:'rank',optionValue:'其他',sourceKeys:['rank'],reason:'第五作者对应其他作者。'}}}};
};
vm.runInContext('engine=fixtureEngine;native=fixtureNative',context);
const send=m=>new Promise((resolve,reject)=>listener(m,{id:'fixture',url:'chrome-extension://fixture/popup.html'},r=>r.error?reject(Error(r.error)):resolve(r.value)));
(async()=>{
 await send({op:'profile-save',base:null,pack:{schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts:[{key:'name',label:'论文名称',value:'合成论文',module:'publications',recordId:'p'},{key:'rank',label:'作者排序',value:'第五作者',module:'publications',recordId:'p'},{key:'authors',label:'作者名单',value:'甲乙丙',module:'publications',recordId:'p'}],rules:[]}});
 await send({op:'preferences',preferences:{agentMode:'codex',agentModel:'fixture-model',autoAgent:false}});await send({op:'scan'});
 const state=await send({op:'remap',agent:true});assert.equal(inspections,1);assert.equal(state.agentReview.status,'completed');assert.equal(state.agentReview.accepted,1);assert.equal(state.plan.rows[0].status,'ready');assert.equal(state.plan.rows[0].optionValue,'其他');assert.match(state.agentReview.items[0].reason,/第五作者/);assert.deepEqual(JSON.parse(JSON.stringify(state.plan.rows[0].sourceKeys)),['rank']);
 console.log('PASS worker: inspect owned dropdown before semantic request, bounded rank value, validated option adopted with visible reason');
})().catch(e=>{console.error(e);process.exitCode=1});
