'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
let playwright;try{playwright=require('playwright');}catch(_){playwright=require(process.env.TOUDI_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(__dirname,'../app/browser-extension');let browser;
(async()=>{browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.invalid/**',r=>{const file=path.basename(new URL(r.request().url()).pathname);r.fulfill({body:fs.readFileSync(file==='logo.svg'?path.join(root,'../assets/favicon.svg'):path.join(root,file)),contentType:file.endsWith('.svg')?'image/svg+xml':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'})});
 await page.addInitScript(()=>{
  const preferences={profile:'general',agentMode:'codex',agentModel:'fixture-user-model',autoAgent:true};
  const rows=[{fieldId:'height',label:'身高',module:'personal',groupLabel:'个人信息',status:'ready',factKey:'height',displayValue:'175',reason:'合成已确认资料'},{fieldId:'unknown',label:'补充项',module:'personal',groupLabel:'个人信息',status:'missing',reason:'待核对'}];
  const plan={origin:'https://fixture.invalid',path:'/application',profileId:'general',rows,statusCounts:{ready:1,missing:1},choices:[{key:'height',label:'身高'}]};
  window.chrome={runtime:{sendMessage:async message=>{
   if(message.op==='state')return {value:{profile:{count:2,profiles:[{id:'general',label:'合成资料',count:2}]},preferences,sync:{status:'disconnected'}}};
   if(message.op==='scan')return {value:{startedAt:1,plan,autoAgentPending:true,timings:{scanMs:20,totalMs:50}}};
   if(message.op==='remap')return new Promise(resolve=>{window.finishModel=()=>resolve({value:{startedAt:1,plan:{...plan,rows:rows.map(r=>r.fieldId==='unknown'?{...r,status:'ready',factKey:'height',displayValue:'175'}:r),statusCounts:{ready:2},provider:{called:true,mapped:1}}}})});
   if(message.op==='fill')return {value:{startedAt:2,report:{summary:{verified:1},results:[{fieldId:'height',status:'verified',reason:'readback-matched'}]},labels:{height:{label:'身高'}}}};
   return {value:{}};
  }}};
 });
 await page.goto('https://fixture.invalid/popup.html');await page.locator('#scan').click();await page.locator('#review').waitFor({state:'visible'});assert.equal(await page.locator('#fill').isEnabled(),true);assert.match(await page.locator('#notice').innerText(),/正在核对歧义/);assert(await page.locator('#agentCli').isDisabled());
 await page.locator('[data-field="height"]').uncheck();await page.evaluate(()=>finishModel());await page.getByText('Agent 核对完成，请查阅匹配结果。',{exact:true}).waitFor();assert.equal(await page.locator('[data-field="height"]').isChecked(),false);
 await page.locator('#scan').click();await page.locator('#fill').click();await page.locator('#result').waitFor({state:'visible'});await page.evaluate(()=>finishModel());assert(await page.locator('#review').isHidden());assert.match(await page.locator('#result').innerText(),/1 项核验通过/);assert.deepEqual(errors,[]);
 console.log('PASS rendered popup: immediate local plan and enabled fill while model pending, preserved checkboxes, late model cannot replace completed report, zero page errors');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close()});
