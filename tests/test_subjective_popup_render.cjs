'use strict';
// Supplementary answer tools moved to settings. No personal browser is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),F=require('./profile_ui_fixture.cjs'),L=require('../app/browser-extension/profile-library.js');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
let browser;
(async()=>{
 browser=await pw.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1240,height:950}}),pack=F.makePack(),records=Object.fromEntries(pack.profiles.map(p=>[p.id,L.copyRecords(pack,p.id)])),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(F.installFixture,{pack,records});
 await page.addInitScript(()=>{
  const original=chrome.runtime.sendMessage;const state={tabId:19,startedAt:1,subjectiveFields:['q'],plan:{rows:[{fieldId:'q',label:'个人优势',status:'missing'}]}};window.fixtureAgentCalls=[];
  chrome.runtime.sendMessage=async m=>{
   fixtureAgentCalls.push(m);
   if(m.op==='agent-context')return {value:state};
   if(['answer-task','agent-task','structure-task'].includes(m.op))return {value:{task:'合成有依据的任务'}};
   if(m.op==='answer-generate'){state.answerDraft={fieldId:'q',answer:'我的优势是结合专业知识整理需求并推进方案。',sourceKeys:['p.body'],sourceLabels:['合成项目职责'],uncertainties:[],approved:false};return {value:state}}
   if(m.op==='answer-approve'){state.answerDraft={...state.answerDraft,answer:m.answer,approved:true};return {value:state}}
   if(m.op==='fill'){if(!state.answerDraft?.approved)throw Error('Draft not approved');state.report={summary:{verified:1}};return {value:state}}
   return original(m);
  };
 });
 await page.route('https://fixture.invalid/**',r=>{const file=path.basename(new URL(r.request().url()).pathname);return r.fulfill({body:fs.readFileSync(path.join(__dirname,file==='logo.svg'?'../app/assets/favicon.svg':'../app/browser-extension/'+file)),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'})});await page.goto('https://fixture.invalid/options.html#agent');await page.locator('#agentTools summary').click();await page.locator('#loadAgentTarget').click();await page.locator('#questionField option').waitFor({state:'attached'});assert.equal(await page.locator('#questionField').inputValue(),'q');
 await page.locator('#copyQuestionTask').click();assert.equal(await page.evaluate(()=>fixtureCopied),'合成有依据的任务');await page.locator('#generateQuestion').click();await page.locator('#questionDraft').filter({visible:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#questionDraft').value.length>0);assert.equal(await page.evaluate(()=>fixtureAgentCalls.some(m=>m.op==='fill')),false,'Generating an answer alone cannot write');
 await page.locator('#questionDraft').fill('使用用户编辑的完整回答。');await page.locator('#approveQuestion').click();await page.getByText('回答已填入并检查。',{exact:true}).waitFor();const calls=await page.evaluate(()=>fixtureAgentCalls.filter(m=>['answer-task','answer-generate','answer-approve','fill'].includes(m.op)));assert(calls.every(m=>m.targetTabId===19));assert.equal(calls.find(m=>m.op==='answer-approve').answer,'使用用户编辑的完整回答。');assert.deepEqual(calls.find(m=>m.op==='fill').selected,['q']);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS settings answer tools: original résumé fallback untouched; bound recruitment target, copy task, generate/edit draft, explicit adoption then write, no automatic draft submission and no overflow');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
