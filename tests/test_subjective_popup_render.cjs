'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
let playwright;try{playwright=require('playwright');}catch(_){playwright=require(process.env.TOUDI_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(__dirname,'../app/browser-extension');let browser;
(async()=>{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.invalid/**',r=>{const file=path.basename(new URL(r.request().url()).pathname);r.fulfill({body:fs.readFileSync(file==='logo.svg'?path.join(root,'../assets/favicon.svg'):path.join(root,file)),contentType:file.endsWith('.svg')?'image/svg+xml':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});});
 await page.addInitScript(()=>{
 const preferences={profile:'general',agentMode:'codex',agentModel:'fixture-user-model',autoAgent:false};
 const rows=[{fieldId:'q',label:'个人评价与优劣势',module:'personal',groupLabel:'主观问答',status:'missing',reason:'资料中没有可确认的对应字段。'}];
 const state={startedAt:1,subjectiveFields:['q'],plan:{origin:'https://fixture.invalid',path:'/application',profileId:'general',rows,statusCounts:{missing:1},choices:[]}};
 window.fixtureCalls=[];window.chrome={runtime:{sendMessage:async message=>{
 window.fixtureCalls.push(message);
 if(message.op==='state')return {value:{state:window.fixtureScanned?state:null,profile:{count:1,profiles:[{id:'general',label:'合成资料',count:1}]},preferences,sync:{status:'disconnected'}}};
 if(message.op==='scan'){window.fixtureScanned=true;return {value:state};}
 if(message.op==='answer-generate'){state.answerDraft={fieldId:'q',answer:'我的优势是能够整理需求并推进原型评审。通过项目协作，我逐步学会在方案设计前明确需求和评价标准。',sourceKeys:['project.description'],sourceLabels:['跨学科城市服务需求研究与协作原型评审项目 · 项目职责与协作过程'],uncertainties:['缺少优化前后的实际效果数据，需补充后再填写。'],approved:false};return {value:state};}
 if(message.op==='answer-approve'){state.answerDraft={...state.answerDraft,answer:message.answer,approved:true};return {value:state};}
 return {value:{}};
 }}};
 });
 await page.goto('https://fixture.invalid/popup.html');
 await page.locator('#scan').click();
 await page.locator('[data-answer="q"]').click();await page.locator('#answerBox').waitFor({state:'visible'});
 await page.locator('#answerGenerate').click();await page.getByText('回答草稿已生成，请核对依据并编辑后采纳。',{exact:true}).waitFor();
 assert.match(await page.locator('#answerEvidence').innerText(),/需求研究.*项目职责/);assert(!(await page.locator('#answerEvidence').innerText()).includes('project.description'));
 await page.locator('#answerText').fill('我能够整理需求并推进原型评审，同时仍需要通过更多真实项目积累效果验证经验。');
 assert.equal(await page.locator('#answerText').inputValue(),'我能够整理需求并推进原型评审，同时仍需要通过更多真实项目积累效果验证经验。');
 const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth,evidenceScroll:document.getElementById('answerEvidence').scrollWidth,evidenceWidth:document.getElementById('answerEvidence').clientWidth}));
 assert(bounds.scroll<=bounds.width,JSON.stringify(bounds));assert(bounds.evidenceScroll<=bounds.evidenceWidth,JSON.stringify(bounds));
 await page.locator('#answerApprove').click();await page.getByText('草稿已采纳，请勾选对应字段再填入。',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-field="q"]').isChecked(),false);assert.equal(await page.locator('#fill').isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.fixtureCalls.some(m=>m.op==='fill')),false);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'/tmp/toudi-subjective-popup.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS rendered subjective popup at 440px: single-question entry, editable draft, readable source names without overflow, adoption remains unchecked, no automatic fill; screenshot /tmp/toudi-subjective-popup.png');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close()});
