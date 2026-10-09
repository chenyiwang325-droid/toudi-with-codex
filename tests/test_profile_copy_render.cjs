'use strict';
// Browser plugin unavailable; Playwright uses an isolated, synthetic profile, never user Chrome.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),L=require('../app/browser-extension/profile-library.js');
const {makePack,installFixture,fullText}=require('./profile_ui_fixture.cjs');
let pw;try{pw=require('playwright');}catch(_){pw=require(process.env.TOUDI_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const pack=makePack(),records=Object.fromEntries(pack.profiles.map(p=>[p.id,L.copyRecords(pack,p.id)])),root=path.resolve(__dirname,'../app/browser-extension'),out=process.env.TOUDI_PANEL_EVIDENCE || os.tmpdir();let browser;
(async()=>{
  browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({reducedMotion:'reduce'}),errors=[];
  await context.route('https://fixture.invalid/**',r=>{const file=path.basename(new URL(r.request().url()).pathname);r.fulfill({body:fs.readFileSync(file==='logo.svg'?path.join(root,'../assets/favicon.svg'):path.join(root,file)),contentType:file.endsWith('.svg')?'image/svg+xml':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});});
  await context.addInitScript(installFixture,{pack,records});
  const popup=await context.newPage();popup.on('pageerror',e=>errors.push(e.message));await popup.setViewportSize({width:400,height:720});await popup.goto('https://fixture.invalid/popup.html#library');
  await popup.locator('[data-copy-fact]').first().waitFor();assert.equal(await popup.locator('.copy-record').count(),14);assert.equal(await popup.locator('[data-module="education"] .copy-record').count(),2);assert.equal(await popup.locator('[data-copy-fact]').count(),pack.facts.filter(f=>f.profiles.includes('general')).length);assert.equal(await popup.evaluate(()=>fixtureCalls.some(c=>c.op==='scan')),false);
  assert.deepEqual(await popup.locator('.copy-section[data-module^="personal:"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.module)),['personal:basic','personal:contact','personal:address','personal:emergency','personal:skills']);
  assert.equal(await popup.locator('[data-module="personal:emergency"] [data-copy-fact]').count(),4);
  assert.equal(await popup.locator('[data-copy-fact]').evaluateAll(nodes=>new Set(nodes.map(n=>n.dataset.copyFact)).size),pack.facts.filter(f=>f.profiles.includes('general')).length,'Every fact appears once, without duplicate or missing values');
  await popup.screenshot({path:path.join(out,'资料浏览_合成示例.png')});
  for(const mod of ['internship','project','campus-role','publications']){
    const fact=popup.locator(`.copy-section[data-module="${mod}"] .copy-value`).filter({hasText:'项目背景：记录完整需求'}).first();
    assert.equal(await fact.textContent(),fullText);await fact.click();assert.equal(await popup.evaluate(()=>fixtureCopied),fullText);
  }
  await popup.locator('#profile').selectOption('alternate');await popup.locator('[data-copy-fact="alternate.skill"]').waitFor();assert.equal(await popup.locator('[data-copy-fact]').count(),1);assert(!(await popup.locator('#copyRecords').innerText()).includes('示例公司'));
  const options=await context.newPage();options.on('pageerror',e=>errors.push(e.message));await options.setViewportSize({width:1240,height:900});await options.goto('https://fixture.invalid/options.html');
  await options.locator('[data-profile-target="project"]').waitFor();assert.equal(await options.locator('.module-section').count(),9);assert.equal(await options.locator('#profileDirectoryItems > button:not(.directory-subgroup)').count(),9);
  const recordId=pack.facts.find(f=>f.module==='project').recordId;
  const record=options.locator(`[data-record="project|${recordId}"]`);assert.equal(await record.getAttribute('open'),null);
  await options.locator(`[data-record-edit="${recordId}"]`).click();assert.equal(await options.locator('#recordField-description').inputValue(),fullText);assert(await options.locator('#recordField-description').evaluate(n=>n.clientHeight>=150));
  const draft=fullText+'\n追加的完整原文：用户正在编辑，尚未保存。';await options.locator('#recordField-description').fill(draft);
  await options.locator('#recordExtras summary').click();await options.locator('#addRecordField').click();assert(await options.locator('#recordEditor').isVisible());assert.equal(await options.locator('dialog:visible').count(),0,'Record and custom field editing stay in the page');assert.equal(await options.locator('#factModule').inputValue(),'project');assert.equal(await options.locator('#factRecord').inputValue(),recordId);
  await options.locator('#factLabel').fill('交付信息');await options.locator('#factValue').fill(fullText);await options.locator('#editForm button[type=submit]').click();await options.locator('#editor').waitFor({state:'hidden'});assert.equal(await options.locator('#recordField-description').inputValue(),draft);
  await options.locator('#recordForm button[type=submit]').click();await options.locator('#recordEditor').waitFor({state:'hidden'});
  const saved=await options.evaluate(()=>fixtureSaved);assert.equal(saved.facts.find(f=>f.recordId===recordId && f.label==='项目描述').value,draft);assert.equal(saved.facts.find(f=>f.recordId===recordId && f.label==='交付信息').value,fullText);
  for(const old of pack.facts.filter(f=>f.recordId!==recordId))assert.deepEqual(saved.facts.find(f=>f.key===old.key),old);
  await options.locator(`[data-record-edit="${recordId}"]`).click();
  const taskDraft=fullText+'\n未保存的完整职责编辑。';await options.locator('#recordField-tasks').fill(taskDraft);
  await options.locator('#recordExtras summary').click();const tasksKey=saved.facts.find(f=>f.recordId===recordId && f.label==='本人职责').key;
  await options.locator('#constraintField').selectOption(tasksKey);await options.locator('#editConstraint').click();await options.locator('#matchingOptions summary').click();await options.locator('#factAliases').fill('本人职责\n完整职责');await options.locator('#editForm button[type=submit]').click();await options.locator('#editor').waitFor({state:'hidden'});assert.equal(await options.locator('#recordField-tasks').inputValue(),taskDraft,'Changing aliases of the same field cannot overwrite its unsaved draft');
  // Editing the child value reflects in an untouched parent input; a deleted field cannot reappear.
  await options.locator('#recordExtras summary').click();const resultKey=saved.facts.find(f=>f.recordId===recordId && f.label==='项目成果').key;
  await options.locator('#constraintField').selectOption(resultKey);await options.locator('#editConstraint').click();await options.locator('#factValue').fill('补充后的完整成果原文');await options.locator('#editForm button[type=submit]').click();await options.locator('#editor').waitFor({state:'hidden'});assert.equal(await options.locator('#recordField-results').inputValue(),'补充后的完整成果原文');
  await options.locator('#recordExtras summary').click();await options.locator('#constraintField').selectOption(resultKey);await options.locator('#editConstraint').click();options.once('dialog',d=>d.accept());await options.locator('#removeFact').click();await options.locator('#editor').waitFor({state:'hidden'});assert.equal(await options.locator('#recordField-results').inputValue(),'');assert.equal(await options.locator('#recordField-tasks').inputValue(),taskDraft);
  await options.locator('#recordForm button[type=submit]').click();await options.locator('#recordEditor').waitFor({state:'hidden'});assert.equal(await options.evaluate(k=>fixtureSaved.facts.some(f=>f.key===k),resultKey),false);assert.equal(await options.evaluate(k=>fixtureSaved.facts.find(f=>f.key===k).value,tasksKey),taskDraft);
  await options.locator('[data-profile-target="project"]').click();assert.equal(await options.locator('.module-section').count(),9);
  await record.locator('[data-fact-copy]').first().click();assert.equal(await options.evaluate(()=>fixtureCopied),'辅助工具设计与实现');
  const description=saved.facts.find(f=>f.recordId===recordId && f.label==='项目描述');await options.locator(`[data-fact-copy="${description.key}"]`).click();assert.equal(await options.evaluate(()=>fixtureCopied),draft);
  await options.screenshot({path:path.join(out,'资料设置_项目编辑入口.png')});
  await options.locator('[data-add-record="campus-role"]').click();await options.locator('#recordField-organization').fill('新增合成组织');await options.locator('#recordField-role').fill('新增合成职务');await options.locator('#recordField-start-precision').selectOption('day');await options.locator('#recordField-start').fill('2024-10-01');await options.locator('#recordField-end-precision').selectOption('day');await options.locator('#recordField-end').fill('2025-06-30');await options.locator('#recordField-tasks').fill(fullText);await options.locator('#recordForm button[type=submit]').click();await options.locator('#recordEditor').waitFor({state:'hidden'});
  assert.equal(await options.evaluate(()=>fixtureSaved.facts.find(f=>f.module==='campus-role' && f.value==='新增合成组织')?.recordId!==undefined),true);
  await options.locator('[data-profile-target="personal"]').click();await options.screenshot({path:path.join(out,'资料设置_合成示例.png')});
  await options.locator('#search').fill('交付信息');assert.equal(await options.locator('.module-section').count(),1);await options.locator('#search').fill('');assert.equal(await options.locator('.module-section').count(),9);
  for(const width of [700,1240]){await options.setViewportSize({width,height:900});assert(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await options.emulateMedia({colorScheme:'dark'});await options.screenshot({path:path.join(out,'资料设置_深色检查.png')});assert.deepEqual(errors,[]);
  console.log('PASS profile UI: complete original text copied; profile isolation; direct edit of collapsed records; long textarea; contextual add-field preserves unsaved draft; exact-day new record; other values unchanged; continuous anchors and search; 700/1240px light/dark; zero page errors.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
