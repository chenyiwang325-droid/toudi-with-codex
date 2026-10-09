'use strict';
// Browser plugin unavailable. Isolated Chrome, synthetic records, no user browser/profile writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const L=require('../app/browser-extension/profile-library.js'),{makePack,installFixture,fullText}=require('./profile_ui_fixture.cjs');
let pw;try{pw=require('playwright')}catch(_){pw=require(process.env.TOUDI_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const root=path.resolve(__dirname,'../app/browser-extension'),out=process.env.TOUDI_PANEL_EVIDENCE || os.tmpdir(),baseline=process.env.TOUDI_UI_BASELINE;
let pack=makePack();pack.facts=pack.facts.filter(f=>f.module!=='awards');
for(const [category,count] of [['荣誉称号',7],['奖学金',5],['学科竞赛',3],['自定义类别',1]])for(let i=0;i<count;i++){
  pack=L.saveRecord(pack,'awards','',{name:`示例${category}记录 ${i+1}`,category,date:`2024-06-${String(i+1).padStart(2,'0')}`,issuer:'示例评审单位',level:'校级',rank:'一等奖',description:fullText});
}
pack.sourceVersion='density-fixture-v1';const records=Object.fromEntries(pack.profiles.map(p=>[p.id,L.copyRecords(pack,p.id)]));
const total=pack.facts.filter(f=>f.profiles.includes('general')).length;let browser;
async function openSurface(context,dir,name,width,height){
  const page=await context.newPage();page.on('pageerror',e=>{throw e});await page.setViewportSize({width,height});
  await page.route('https://fixture.invalid/**',route=>{const file=path.basename(new URL(route.request().url()).pathname);return route.fulfill({body:fs.readFileSync(file==='logo.svg'?path.join(root,'../assets/favicon.svg'):path.join(dir,file)),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html'});});
  await page.goto('https://fixture.invalid/'+name);return page;
}
async function metrics(context,dir,label){
  const popup=await openSurface(context,dir,'popup.html#library',400,660);await popup.locator('[data-copy-fact]').first().waitFor();
  const data=await popup.evaluate(()=>{
    const sections=[...document.querySelectorAll('.copy-section')],box=document.querySelector('#copyRecords').getBoundingClientRect();
    return {listHeight:box.height,personalHeight:sections.filter(s=>s.dataset.module.startsWith('personal:')).reduce((n,s)=>n+s.getBoundingClientRect().height,0),awardsHeight:sections.filter(s=>s.dataset.module.startsWith('awards')).reduce((n,s)=>n+s.getBoundingClientRect().height,0),visibleFacts:[...document.querySelectorAll('[data-copy-fact]')].filter(n=>{const r=n.getBoundingClientRect();return r.top>=box.top && r.bottom<=box.bottom}).length,shortRowHeight:document.querySelector('[data-copy-fact]').closest('.copy-fact').getBoundingClientRect().height};
  });
  await popup.screenshot({path:path.join(out,label+'_资料首屏.png')});
  const target=await popup.locator('[data-copy-module^="awards"]').first();await target.click();await popup.screenshot({path:path.join(out,label+'_获奖分类.png')});
  const options=await openSurface(context,dir,'options.html',1240,900);await options.locator('.module-section').first().waitFor();
  data.settingsPersonalHeight=await options.locator('[data-profile-module="personal"]').evaluate(n=>n.getBoundingClientRect().height);
  data.settingsShortRowHeight=await options.locator('.fact-short').first().evaluate(n=>n.getBoundingClientRect().height);
  await options.screenshot({path:path.join(out,label+'_资料设置.png')});
  return {popup,options,data};
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({reducedMotion:'reduce'});await context.addInitScript(installFixture,{pack,records});
  const before=baseline?await metrics(context,baseline,'修改前'):null,after=await metrics(context,root,'修改后'),{popup,options}=after;
  assert.equal(await popup.title(),'TouDi · 辅助填报');assert.equal(await popup.locator('[data-copy-fact]').count(),total);
  assert.deepEqual(await popup.locator('.award-section').evaluateAll(nodes=>nodes.map(n=>[n.dataset.module,n.querySelectorAll('.copy-record').length])),[['awards:honor',7],['awards:scholarship',5],['awards:competition',3],['awards:other',1]]);
  assert.deepEqual(await options.locator('.award-group').evaluateAll(nodes=>nodes.map(n=>[n.dataset.profileLocation,n.querySelectorAll('.record').length])),[['awards:honor',7],['awards:scholarship',5],['awards:competition',3],['awards:other',1]]);
  for(const type of ['honor','scholarship','competition','other']){
    await popup.locator(`[data-copy-module="awards:${type}"]`).click();await popup.waitForFunction(type=>document.querySelector(`[data-copy-module="awards:${type}"]`).getAttribute('aria-current')==='location',type);
    assert.equal(await popup.locator('[data-copy-fact]').count(),total,'An anchor must not hide any facts');
    const name=popup.locator(`[data-module="awards:${type}"] .copy-record-name`).first();await name.click();const nameKey=await name.getAttribute('data-copy-fact');assert.equal(await popup.evaluate(()=>fixtureCopied),pack.facts.find(f=>f.key===nameKey).value);
    await options.locator(`[data-profile-target="awards:${type}"]`).click();const heading=await options.locator(`[data-profile-location="awards:${type}"] > h4`).boundingBox();assert(heading.y>60 && heading.y<850,'The category anchor must reveal its heading');
    assert.equal(await options.locator('.record').count(),25,'All 16 awards and existing records remain present');
  }
  await popup.locator('#copySearch').fill('荣誉');assert.equal(await popup.locator('.copy-record').count(),7);assert.equal(await popup.locator('[data-copy-fact]').count(),49);
  await popup.locator('#copySearch').fill('奖学金');assert.equal(await popup.locator('.copy-record').count(),5);
  await popup.locator('#copySearch').fill('竞赛');assert.equal(await popup.locator('.copy-record').count(),3);
  await popup.locator('#copySearch').fill('自定义类别');assert.equal(await popup.locator('.copy-record').count(),1,'Unknown types remain searchable');
  await popup.locator('#copySearch').fill('');await popup.locator('[data-copy-module="awards:competition"]').click();
  const description=popup.locator('[data-module="awards:competition"] .copy-value').filter({hasText:'项目背景：记录完整需求'}).first();assert.equal(await description.textContent(),fullText);await description.click();assert.equal(await popup.evaluate(()=>fixtureCopied),fullText);
  await description.locator('..').locator('.expand-value').click();assert.equal(await description.evaluate(n=>n.classList.contains('collapsed')),false);assert.equal(await description.textContent(),fullText);
  await options.locator('#search').fill('竞赛');assert.equal(await options.locator('.record').count(),3);assert.equal(await options.locator('.fact').count(),21);
  const awardId=pack.facts.find(f=>f.module==='awards' && f.value==='学科竞赛').recordId;await options.locator(`[data-record-edit="${awardId}"]`).click();assert.equal(await options.locator('#recordField-description').inputValue(),fullText);assert.equal(await options.locator('#recordField-category').inputValue(),'学科竞赛');await options.locator('#closeRecord').click();
  await options.locator('#search').fill('');
  for(const scheme of ['light','dark']){
    await popup.emulateMedia({colorScheme:scheme});await options.emulateMedia({colorScheme:scheme});
    for(const width of [320,400]){await popup.setViewportSize({width,height:660});assert(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await popup.locator('#copyRecords').evaluate(n=>n.clientHeight>400));}
    for(const width of [700,1240]){await options.setViewportSize({width,height:900});assert(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await options.locator('[data-profile-target="awards:scholarship"]').click();assert(await options.locator('[data-profile-location="awards:scholarship"] > h4').evaluate(n=>n.getBoundingClientRect().top>=document.querySelector('#panel-profile .toolbar').getBoundingClientRect().bottom));}
  }
  await popup.emulateMedia({colorScheme:'light'});await popup.setViewportSize({width:400,height:660});await popup.locator('[data-copy-module="awards:scholarship"]').click();await popup.screenshot({path:path.join(out,'获奖目录_奖学金定位.png')});
  await popup.locator('#copyRecords').hover();await popup.mouse.wheel(0,100000);await popup.waitForFunction(()=>{const n=document.querySelector('#copyRecords');return n.scrollHeight-n.clientHeight-n.scrollTop<2;});assert.equal(await popup.locator('[data-copy-module="family"]').getAttribute('aria-current'),'location');assert.equal(await popup.locator('[data-copy-fact]').count(),total);
  await options.emulateMedia({colorScheme:'light'});await options.setViewportSize({width:1240,height:900});await options.locator('[data-profile-target="awards:honor"]').click();await options.screenshot({path:path.join(out,'资料设置_分类目录.png')});
  const report={before:before?.data,after:after.data};
  if(before){
    report.reduction={personal:1-after.data.personalHeight/before.data.personalHeight,awards:1-after.data.awardsHeight/before.data.awardsHeight,settings:1-after.data.settingsPersonalHeight/before.data.settingsPersonalHeight};
    assert(report.reduction.personal>=.25,JSON.stringify(report));assert(report.reduction.awards>=.25,JSON.stringify(report));assert(after.data.visibleFacts>=before.data.visibleFacts+3,JSON.stringify(report));assert(after.data.settingsShortRowHeight<=before.data.settingsShortRowHeight*.7,JSON.stringify(report));
  }
  assert(!(await popup.evaluate(()=>fixtureCalls.some(m=>m.op==='profile-save'))));assert(!(await options.evaluate(()=>fixtureCalls.some(m=>m.op==='profile-save'))));
  fs.writeFileSync(path.join(out,'资料密度比较.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS density and award navigation: '+JSON.stringify(report)+'; all facts preserved; 7/5/3/1 groups; anchors and search; name/full-description copies; award editor complete; continuous wheel to last fact; 320/400 popup, 700/1240 settings light/dark; no profile-save.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
