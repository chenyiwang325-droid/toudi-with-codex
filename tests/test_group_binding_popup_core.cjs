'use strict';
// The controlled extension surface is unavailable. Verify the scan-first UI with real Core
// binding decisions in an isolated page, without using private browser data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
let playwright;try{playwright=require('playwright')}catch(_){playwright=require(process.env.TOUDI_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const root=path.resolve(__dirname,'../app/browser-extension'),Core=require('../app/browser-extension/filling-core.js');let browser;
(async()=>{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:400,height:420}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.invalid/**',r=>{const name=path.basename(new URL(r.request().url()).pathname);r.fulfill({body:fs.readFileSync(name==='logo.svg'?path.join(root,'../assets/favicon.svg'):path.join(root,name)),contentType:name.endsWith('.svg')?'image/svg+xml':name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html'})});
 const records={master:{label:'硕士 · 示例甲大学',school:'示例甲大学',start:'2024-09-01',end:'2027-06-30'},bachelor:{label:'本科 · 示例乙大学',school:'示例乙大学',start:'2020-09-01',end:'2024-06-30'}};
 const labels={school:'学校',start:'开始日期',end:'结束日期',unknown:'补充说明'};
 const facts=Object.entries(records).flatMap(([id,r])=>['school','start','end'].map(k=>({key:id+'.'+k,module:'education',recordId:id,recordLabel:r.label,label:labels[k],value:r[k]}))).concat([{key:'work.start',module:'internship',recordId:'work',recordLabel:'示例实习',label:'开始日期',value:'2025-06-01'}]);
 const profile=Core.profile(Core.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts,rules:[]}));
 const scan={protocol:1,origin:'https://fixture.invalid',path:'/application',fingerprint:'fixture-grouped',fields:Object.entries(records).flatMap(([id,r])=>['school','start','end','unknown'].map(k=>({id:id+':'+k,groupId:id,groupLabel:'教育经历',module:'education',label:labels[k],type:['start','end'].includes(k)?'date':'text',value:k==='school'?r.school:''})))};
 const preferences={profile:'general',agentMode:'external',agentModel:'',autoAgent:false};let actions=[],runs=0;
 await page.exposeFunction('fixtureBackend',async m=>{
  if(m.op==='state')return {value:{profile:{count:facts.length,profiles:[{id:'general',label:'合成资料',count:facts.length}]},preferences,sync:{status:'disconnected'}}};
  if(m.op==='scan'){const binding=Core.allocateRecords(profile,scan);return {value:{plan:Core.plan(profile,scan,{},new Date('2026-10-08T00:00:00Z'),{},binding.bindings)}};}
  if(m.op==='auto-fill'){
   runs++;const binding=Core.allocateRecords(profile,scan),plan=Core.plan(profile,scan,{},new Date('2026-10-08T00:00:00Z'),{},binding.bindings);
   actions=plan.rows.filter(r=>r.status==='ready');
   for(const row of actions){const group=plan.groups.find(g=>g.groupId===row.recordBinding?.groupId);assert(group && group.status==='bound');assert(row.factKey.startsWith(group.recordId+'.'));assert(row.allowedFactKeys.includes(row.factKey));assert(row.allowedFactKeys.every(k=>k.startsWith(group.recordId+'.')),'field candidates must remain within the bound whole record');assert.equal(row.value,records[group.recordId][row.factKey.split('.')[1]]);}
   const pending=plan.rows.filter(r=>!['ready','already'].includes(r.status));
   return {value:{plan,automation:{status:'completed'},report:{summary:{verified:actions.length},results:actions.map(r=>({fieldId:r.fieldId,status:'verified'}))},pending,labels:Object.fromEntries(plan.rows.map(r=>[r.fieldId,{label:r.label,groupLabel:r.groupLabel}]))}};
  }
  return {value:{}};
 });
 await page.addInitScript(()=>{window.fixtureCalls=[];window.chrome={runtime:{sendMessage:async m=>{fixtureCalls.push(m);return fixtureBackend(m)}}};});
 await page.goto('https://fixture.invalid/popup.html');assert.equal(await page.title(),'TouDi · 辅助填报');await page.locator('#scanSummary').filter({hasText:'识别到 8 项'}).waitFor();assert.equal(runs,0,'opening scans without writes');await page.locator('#fill').click();await page.locator('#result .finish').waitFor();
 assert.equal(actions.length,4);assert.deepEqual(actions.map(r=>r.value),['2024-09-01','2027-06-30','2020-09-01','2024-06-30']);assert.match(await page.locator('#result').innerText(),/已填写 4 项/);assert.equal(await page.locator('[data-record-group],[data-map],[data-field],#review').count(),0);assert.equal(await page.locator('#scan').count(),1);
 scan.fields.find(f=>f.id==='master:school').value='网页上的未确认学校';
 await page.locator('#fill').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('已填写 2 项'));assert.equal(runs,2);assert.equal(actions.length,2);assert(actions.every(a=>a.recordBinding.recordId==='bachelor'),'an unknown existing school cannot use another record or internship date');assert.equal(await page.evaluate(()=>fixtureCalls.some(m=>m.op==='remap')),false);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS real Core + scan-first UI: read-only opening, duplicate education labels retain whole-record dates, no manual record selectors, unknown existing record never borrows another degree or internship');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
