'use strict';
// Actual MV3 reload in a disposable browser profile. Never uses the user's Chrome.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
let playwright;try{playwright=require('playwright')}catch(_){playwright=require(process.env.TOUDI_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const repo=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'toudi-panel-reload-')),extension=path.join(temp,'extension');
fs.cpSync(path.join(repo,'app/browser-extension'),extension,{recursive:true});
for(const [src,dst]of [['favicon.svg','logo.svg'],['form-engine.js','form-engine.js'],['form-adapters.js','form-adapters.js']])fs.copyFileSync(path.join(repo,'app/assets',src),path.join(extension,dst));
if(process.env.TOUDI_BASELINE_HOST)fs.copyFileSync(process.env.TOUDI_BASELINE_HOST,path.join(extension,'panel-host.js'));
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const worker=path.join(extension,'worker.js');fs.writeFileSync(worker,'const listen=chrome.action.onClicked.addListener.bind(chrome.action.onClicked);chrome.action.onClicked.addListener=fn=>{globalThis.fixtureAction=fn;listen(fn)};\n'+fs.readFileSync(worker,'utf8'));
let documentLoads=0,context;
const server=http.createServer((req,res)=>{if(req.url==='/apply')documentLoads++;res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<title>合成招聘表单</title><label>姓名<input id="name" value="用户已填写内容"></label><label>手机<input id="phone"></label>');});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 context=await playwright.chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1360,height:900}});
 let sw=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await sw.evaluate(async()=>{await init;await chrome.storage.local.set({toudiPrivateProfile:Core.validatePack({schemaVersion:1,profiles:[{id:'general',label:'示例资料'}],facts:[{key:'person.name',module:'personal',recordId:'person',recordLabel:'基本信息',label:'姓名',value:'示例同学',profiles:['general']},{key:'person.phone',module:'personal',recordId:'person',recordLabel:'基本信息',label:'手机',value:'13800000000',profiles:['general']}],rules:[]}),toudiFillingPreferences:{profile:'general',agentMode:'external',autoAgent:false}});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/apply');await page.bringToFront();
 const tabId=await sw.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab.id});
 const action=async()=>{
  await sw.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{const create=document.createElement.bind(document);document.createElement=function(name,...args){const n=create(name,...args);if(name==='iframe')globalThis.fixtureFrame=n;return n}}}),tabId);
  return sw.evaluate(async id=>fixtureAction(await chrome.tabs.get(id)),tabId);
 };
 const panel=async()=>{for(let i=0;i<100;i++){const f=page.frames().find(f=>f.url().startsWith('chrome-extension:'));if(f){try{await f.locator('#scanSummary').filter({hasText:'识别到'}).waitFor({timeout:500});return f}catch(_){}}await page.waitForTimeout(50)}throw Error('New extension frame did not recognize the unchanged page')};
 const geometry=()=>sw.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>{const frame=globalThis.fixtureFrame,shell=frame.parentElement,close=shell.querySelector('.bar button:last-child'),r=close.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}}))[0].result,tabId);
 // Only the fixture observes the closed shadow's geometry, no production access is added.
 await action();let ui=await panel();assert.equal(await page.locator('#name').inputValue(),'用户已填写内容');assert.equal(await page.locator('#phone').inputValue(),'');
 const reload=async()=>{
  // This is the isolated test browser's management page, never the user's page.
  // Reproduce the same unpacked-extension reload button used by the user.
  const management=await context.newPage();await management.goto('chrome://extensions');
  const dev=management.locator('#devMode');if(!await dev.evaluate(n=>n.checked))await dev.click();
  const next=context.waitForEvent('serviceworker',{predicate:w=>w!==sw,timeout:20000});
  next.catch(()=>{});await management.locator('#dev-reload-button').click();
  sw=await next;await sw.evaluate(async()=>{await init});await management.close();await page.bringToFront();
 };
 const previousURL=ui.url();await reload();await action();ui=await panel();assert.notEqual(ui.url(),previousURL);assert.equal(await page.locator('#toudi-floating-host').count(),1);assert.equal(documentLoads,1,'The recruitment page was never refreshed');assert.equal(await page.locator('#name').inputValue(),'用户已填写内容');
 // A retained closure can reject calls into its invalidated runtime. Starting a
 // new action must still remove its orphan DOM rather than abort initialization.
 const invalidURL=ui.url();await sw.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{TouDiPanelHost.dispose=()=>{throw Error('Extension context invalidated')}}}),tabId);
 await action();ui=await panel();assert.notEqual(ui.url(),invalidURL);assert.equal(await page.locator('#toudi-floating-host').count(),1);
 // Close the old floating host after another real reload. Invalid runtime listeners
 // must not prevent the ordinary close button from removing page-owned DOM.
 const close=await geometry();await reload();if(await page.locator('#toudi-floating-host').count())await page.mouse.click(close.x,close.y);await page.locator('#toudi-floating-host').waitFor({state:'detached',timeout:3000});
 await action();ui=await panel();assert.equal(documentLoads,1);assert.equal((await page.locator('#toudi-floating-host').boundingBox()).height,690);assert.equal(await page.locator('#phone').inputValue(),'');
 await ui.locator('#fillMode').selectOption('empty');await ui.locator('#fill').click();await ui.locator('#result .finish').waitFor();assert.equal(await page.locator('#phone').inputValue(),'13800000000');assert.equal(await page.locator('#name').inputValue(),'用户已填写内容');assert.equal(documentLoads,1);assert.equal(context.pages().length,2,'No independent tool window');assert.deepEqual(errors,[]);
 console.log('PASS actual MV3 reload twice: same recruitment document, preserved input, dead-host replacement, close after reload, fresh read-only recognition and empty-only fill');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await context?.close();server.close();fs.rmSync(temp,{recursive:true,force:true})});
