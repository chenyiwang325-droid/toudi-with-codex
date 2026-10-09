'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../app/browser-extension'),local={},session={},sent=[],timers=[];
const storage=store=>({setAccessLevel:async()=>{},get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,value),remove:async keys=>{for(const key of [keys].flat())delete store[key];}});
let handler;
const context=vm.createContext({console,TextEncoder,crypto:require('crypto').webcrypto,URL,structuredClone,Option:undefined,
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();timers.push(timer);return timer;},clearTimeout,
  chrome:{storage:{local:storage(local),session:storage(session)},tabs:{query:async()=>[{id:1,url:'https://example.invalid/apply'}],get:async()=>({id:1,url:'https://example.invalid/apply'})},
    runtime:{id:'fixture',getURL:name=>'chrome-extension://fixture/'+name,onMessage:{addListener:fn=>handler=fn},
      connectNative:()=>{let onMessage;return {onMessage:{addListener:fn=>onMessage=fn},onDisconnect:{addListener:()=>{}},postMessage:message=>{sent.push(message);queueMicrotask(()=>onMessage({requestId:message.requestId,value:{mappings:{},provider:{called:true,model:message.model}}}));},disconnect:()=>{}};}}}});
context.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context));
vm.runInContext(fs.readFileSync(path.join(root,'worker.js'),'utf8'),context);
(async()=>{
  const Config=context.TouDiAgentConfig;
  assert.equal(Config.normalize().agentModel,'');assert.equal(Config.normalize().autoAgent,false);
  assert.equal(Config.normalize({autoLuna:false}).agentMode,'');
  assert.equal(Config.normalize({profile:'state',autoLuna:true}).agentModel,'gpt-6-luna');
  assert.equal(Config.normalize({agentMode:'external',agentModel:'ignored',autoAgent:true}).autoAgent,false);
  const op=value=>context.operation(value);
  const Core=context.TouDiFillingCore;
  const pack=Core.validatePack({schemaVersion:1,name:'Synthetic',profiles:[{id:'general',label:'默认资料'},{id:'ai-product',label:'Synthetic variant'}],facts:[{key:'personal.city',label:'现居地',value:'Synthetic City',module:'personal'},{key:'edu.mode',label:'学历类型',value:'全日制',module:'education',recordId:'edu'}],rules:[]});
  pack.sourceVersion='fixture';local.toudiPrivateProfile=pack;
  function plan(){const scan={protocol:1,origin:'https://example.invalid',path:'/apply',fingerprint:'fixture',fields:[{id:'f',label:'学习方式',module:'education',type:'text',options:[],value:''}]};session.toudiFillingSession={startedAt:Date.now(),tabId:1,origin:scan.origin,path:scan.path,sourceVersion:pack.sourceVersion,scan,mappings:{},plan:Core.plan(Core.profile(pack,'general'),scan)};}
  plan();await assert.rejects(op({op:'remap',agent:true}),/先.*选择/);assert.equal(sent.length,0);
  let pref=await op({op:'preferences',preferences:{agentMode:'codex',agentModel:'fixture-user-model',autoAgent:false}});
  assert.equal(pref.agentModel,'fixture-user-model');assert.equal(pref.autoAgent,false);
  pref=await op({op:'preferences',preferences:{profile:'ai-product'}});assert.equal(pref.agentModel,'fixture-user-model');
  plan();await assert.rejects(op({op:'remap',agent:true,model:'different-model'}),/不一致/);assert.equal(sent.length,0);
  await op({op:'remap',agent:true});assert.equal(sent.length,1);assert.equal(sent[0].model,'fixture-user-model');
  assert(!JSON.stringify(sent).includes('Synthetic City'));assert(JSON.stringify(sent).includes('全日制'));assert(!JSON.stringify(sent).includes('personal.city'));
  pref=await op({op:'preferences',preferences:{agentMode:'external',agentModel:'',autoAgent:false}});assert.equal(pref.profile,'ai-product');assert.equal(pref.agentModel,'');
  plan();await assert.rejects(op({op:'remap',agent:true}),/先.*选择/);assert.equal(sent.length,1);
  const reply=sender=>new Promise(resolve=>{assert.equal(handler({op:'state'},sender,resolve),true);});
  assert((await reply({id:'fixture',url:'chrome-extension://fixture/options.html#agent'})).value);
  assert.match((await reply({id:'other',url:'chrome-extension://fixture/options.html'})).error,/权限/);
  console.log('PASS Agent config: new/legacy initialization, explicit model, both collaboration modes, preferences preserved, only field-related nonsensitive values sent, authorized deep-link, no fallback');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>timers.forEach(clearTimeout));
