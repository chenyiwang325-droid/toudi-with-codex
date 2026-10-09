'use strict';
// Browser plugin not available. Real MV3 runtime in a separate temporary profile;
// all facts and pages are synthetic; no user Chrome, login, save or submission.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),F=require('./test_record_expansion.cjs');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const repo=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'toudi-whole-form-')),extension=path.join(temp,'extension');
fs.cpSync(path.join(repo,'app/browser-extension'),extension,{recursive:true});for(const [from,to]of [['favicon.svg','logo.svg'],['form-engine.js','form-engine.js'],['form-adapters.js','form-adapters.js']])fs.copyFileSync(path.join(repo,'app/assets',from),path.join(extension,to));
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const worker=path.join(extension,'worker.js');fs.writeFileSync(worker,'const listener=chrome.action.onClicked.addListener.bind(chrome.action.onClicked);chrome.action.onClicked.addListener=fn=>{globalThis.fixtureAction=fn;listener(fn)};\n'+fs.readFileSync(worker,'utf8'));
const definitions=F.definitions.filter(d=>['internship','project'].includes(d[0]));
const facts=[...F.facts.filter(f=>['internship','project'].includes(f.module)),...[
 ['p.phone','手机','13800000000'],['p.emergency','紧急联系人姓名','合成联系人'],['p.email','电子邮箱','fixture@example.invalid']
].map(([key,label,value])=>({key,label,value,module:'personal',recordId:'person'}))];
function installWorkflow(){
 window.blockedAdds=0;window.failedWrites=0;window.saves=0;
 const wrapper=document.createElement('fieldset');wrapper.innerHTML='<legend>个人信息</legend><label>手机<input name="phone"></label><label>电子邮箱<input name="email"></label>';document.querySelector('#sections').before(wrapper);
 wrapper.querySelector('[name=phone]').addEventListener('change',()=>{if(!wrapper.querySelector('[name=emergency]'))wrapper.insertAdjacentHTML('beforeend','<label>紧急联系人<input name="emergency"></label>')});
 wrapper.querySelector('[name=email]').addEventListener('input',event=>{failedWrites++;setTimeout(()=>{event.target.value=''},120)});
 document.querySelector('form').insertAdjacentHTML('beforeend','<button type="button" id="save">保存资料</button>');document.querySelector('#save').onclick=()=>saves++;
 const attach=()=>document.querySelectorAll('.plus').forEach(button=>{
  if(button.dataset.guarded)return;button.dataset.guarded='yes';
  button.addEventListener('click',event=>{const section=button.closest('section'),last=[...section.querySelectorAll('.ux-standard-form')].at(-1);if(last && !last.querySelector('input').value){event.stopImmediatePropagation();blockedAdds++;}},true);
 });attach();new MutationObserver(attach).observe(document.querySelector('#sections'),{childList:true,subtree:true});
 const nav=document.createElement('nav');nav.innerHTML='<label>站点搜索<input type="search"></label>';document.body.prepend(nav);
}
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(F.html+'<script>('+F.installFixture.toString()+')('+JSON.stringify({definitions,variant:'phoenix',prefilled:true})+');('+installWorkflow.toString()+')()</script>')});let context;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));context=await pw.chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1360,height:900}});
 const sw=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await sw.evaluate(async facts=>{await init;await operation({op:'profile-save',base:null,pack:{schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts,rules:[]}});await chrome.storage.local.set({toudiFillingPreferences:{profile:'general',agentMode:'external',autoAgent:false}})},facts);
 await page.goto('http://127.0.0.1:'+server.address().port+'/apply');await page.bringToFront();await sw.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await fixtureAction(tab)});
 await page.waitForFunction(()=>document.querySelector('#toudi-floating-host'));let panel;
 for(let i=0;i<60;i++){panel=page.frames().find(f=>f.url().startsWith('chrome-extension:'));if(panel && await panel.locator('#scanSummary').innerText().catch(()=>''))break;await new Promise(r=>setTimeout(r,50));}
 await panel.locator('#scanSummary').filter({hasText:'识别到'}).waitFor();
 let s=await sw.evaluate(async()=>publicState(await loadState((await chrome.tabs.query({active:true,currentWindow:true}))[0].id)));
 assert(s.plan.rows.some(r=>r.label==='手机'),'mixed native control is scanned');assert(!s.plan.rows.some(r=>r.label==='站点搜索'),'navigation search is excluded');assert.equal(await page.locator('.ux-standard-form').count(),2,'Opening only scans');
 const body=s.plan.rows.find(r=>r.label==='项目描述');
 await sw.evaluate(async ({id,key})=>operation({op:'remap',mappings:{[id]:key}}),{id:body.fieldId,key:body.factKey});
 assert.equal(Object.keys(await sw.evaluate(async()=>((await chrome.storage.local.get(MAPS))[MAPS] || {}))).length,0,'Suggestions are not cached before writing');
 await panel.locator('#fillMode').selectOption('empty');await panel.locator('#fill').click();await panel.locator('#result').filter({hasText:'已填写'}).waitFor({timeout:90000});
 s=await sw.evaluate(async()=>publicState(await loadState((await chrome.tabs.query({active:true,currentWindow:true}))[0].id)));
 // Twenty experience fields minus the already-matching company and preserved
 // body, plus the newly written phone/contact. A failure is not a successful write.
 assert.equal(s.report.summary.verified,20,JSON.stringify({report:s.report,personal:s.plan.rows.filter(r=>r.module==='personal' || /联系人/.test(r.label))}));assert(s.report.passes>1);
 assert.equal(await page.locator('[name=emergency]').inputValue(),'合成联系人','Linked field is discovered and filled in the same run');
 assert.deepEqual(await page.evaluate(()=>({adds:addCounts,blockedAdds,failedWrites,saves,submissions})),{adds:{internship:2,project:1},blockedAdds:0,failedWrites:1,saves:0,submissions:0},'Fill precedes each add; unchanged failed field is tried once');
 assert(s.report.results.some(r=>r.reason==='value-not-retained'));assert.match(await panel.locator('#result').innerText(),/未完成/);await panel.locator('.remaining > summary').click();assert.match(await panel.locator('#result').innerText(),/网站未保留/);
 const cache=await sw.evaluate(async()=>((await chrome.storage.local.get(MAPS))[MAPS] || {}));assert.equal(Object.keys(cache).length,1);assert(!JSON.stringify(cache).includes(F.full),'Repair metadata stores no source paragraphs');assert(!JSON.stringify(cache).includes('13800000000'));
 const data=await sw.evaluate(async()=>{const st=await loadState((await chrome.tabs.query({active:true,currentWindow:true}))[0].id);return {fields:st.scan.fields,bindings:st.recordBindings}});
 const workGroups=[...new Set(data.fields.filter(f=>f.module==='work').map(f=>f.groupId))];assert.equal(workGroups.length,3);
 for(const groupId of workGroups){const recordId=data.bindings[groupId],expected=facts.find(f=>f.recordId===recordId&&f.label==='单位').value;assert.equal(data.fields.find(f=>f.groupId===groupId&&f.label==='单位名称').value,expected);}
 assert.equal(await page.locator('textarea').filter({hasText:'已有完整内容'}).count(),1,'Only-empty preserves the user body');
 await panel.locator('#fillMode').selectOption('all');await panel.locator('#fill').click();await page.waitForFunction(()=>window.failedWrites===2);await panel.locator('#fill').filter({hasText:'自动填写'}).waitFor({timeout:90000});
 s=await sw.evaluate(async()=>publicState(await loadState((await chrome.tabs.query({active:true,currentWindow:true}))[0].id)));
 assert.equal(s.report.summary.verified,1,JSON.stringify(s.report));assert.equal(await page.locator('.ux-standard-form').count(),5,'Repeated run never adds duplicate experiences');
 assert((await page.locator('textarea').evaluateAll(nodes=>nodes.map(n=>n.value))).every(value=>value===F.full),'Every source paragraph remains byte-for-byte complete');assert.deepEqual(errors,[]);
 if(process.env.TOUDI_QA_OUTPUT){fs.mkdirSync(process.env.TOUDI_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.TOUDI_QA_OUTPUT,'整次填写_隔离浏览器.png')});fs.writeFileSync(path.join(process.env.TOUDI_QA_OUTPUT,'整次填写_隔离浏览器.json'),JSON.stringify({version:manifest.version,initialWrites:20,repeatedWrites:1,records:5,passes:s.report.passes,duplicateRecords:0,unsaved: true,submissions:0,errors},null,2));}
 console.log('PASS actual MV3 whole form: 20 readbacks, native/Phoenix coexistence, linked contact, existing identity preservation, add only after fill, 5 bound records, repeated run no duplicates, full original text, one failed-control attempt per run, failure explanation, verified repair cache, zero save/submission');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await context?.close();server.close();fs.rmSync(temp,{recursive:true,force:true});});
