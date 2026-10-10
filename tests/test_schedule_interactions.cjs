'use strict';
// Browser plugin not available. Synthetic fixtures and a separate headless browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{once}=require('node:events');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(__dirname,'..'),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'toudi-interactions-')),out=process.env.TOUDI_SCHEDULE_EVIDENCE||os.tmpdir(),token=crypto.randomBytes(32).toString('hex');
let service,browser;
(async()=>{
  fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(workspace,'投递数据'));
  const records=Array.from({length:5000},(_,i)=>({名称:'合成企业'+String(i).padStart(4,'0'),岗位:i===4321?'合成产品岗位':'研究岗位',地点:i===4321?'目标城市':'示例城市'}));
  fs.writeFileSync(path.join(workspace,'投递数据/投递记录.json'),JSON.stringify(records));
  service=spawn('python3',[path.join(root,'app/desktop_runtime.py'),'serve'],{env:{...process.env,TOUDI_WORKSPACE:workspace,TOUDI_APP_HOME:path.join(workspace,'config'),TOUDI_PORT:'0',TOUDI_DESKTOP_TOKEN:token},stdio:['pipe','pipe','pipe']});
  let raw='';for await(const chunk of service.stdout){raw+=chunk;if(raw.includes('\n'))break;}const signal=JSON.parse(raw.split('\n')[0]);
  browser=await pw.chromium.launch({headless:true,executablePath:process.env.TOUDI_CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1536,height:1024},extraHTTPHeaders:{Authorization:'Bearer '+token}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+signal.port+'/投递管理.html');await page.waitForFunction(()=>serverMode&&data.length===5000);
  const totals=await page.locator('#statsBar').innerText();
  const search=await page.evaluate(()=>{const input=document.getElementById('searchInput'),start=performance.now();input.focus();input.value='合成产品';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText'}));return {query:searchQuery,count:getFiltered().length,elapsed:performance.now()-start,focus:document.activeElement===input};});
  assert.equal(search.query,'合成产品');assert.equal(search.count,1);assert(search.focus);assert.equal(await page.locator('#statsBar').innerText(),totals);
  await page.evaluate(()=>{const input=document.getElementById('searchInput');input.value='';input.dispatchEvent(new Event('search',{bubbles:true}));});assert.equal(await page.evaluate(()=>getFiltered().length),5000);
  await page.locator('[data-module="schedule"]').click();await page.waitForFunction(()=>document.querySelector('#scheduleCalendar [data-date]'));
  const date=await page.locator('#scheduleCalendar [data-date]').first().getAttribute('data-date');
  const lane=await page.locator('#scheduleCalendar [data-date="'+date+'"]').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().toJSON()).filter(box=>box.height>200).at(-1));
  const viewport=await page.locator('#scheduleCalendar').boundingBox(),x=lane.x+lane.width/2,y=viewport.y+200;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+60,{steps:12});await page.mouse.up();await page.locator('#scheduleForm').waitFor();
  const highlights=()=>page.locator('#scheduleCalendar .fc-monarch-PHz').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height>0).length);
  assert(await highlights()>0,'Mouse-selected time region remains after the editor opens');
  await page.locator('#scheduleForm [name=title]').fill('完整事项原文');assert(await highlights()>0,'Focusing and typing in the editor retains selection');
  await page.locator('#scheduleForm [name=startTime]').fill('14:15');await page.locator('#scheduleForm [name=endTime]').fill('15:45');
  let preview=await page.locator('#scheduleCalendar').evaluate(node=>({start:node.dataset.previewStart,end:node.dataset.previewEnd}));
  assert.equal(preview.start,date+'T06:15:00.000Z');assert.equal(preview.end,date+'T07:45:00.000Z');assert(await highlights()>0);
  const notes='完整的事项备注。\n保留第二行。';await page.locator('[name=notes]').fill(notes);
  const picker=page.locator('#scheduleCompanyQuery');await picker.focus();assert.equal(await page.locator('#scheduleCompanyList [role=option]').count(),20,'Company options stay bounded even with 5,000 records');
  const lookup=await picker.evaluate(input=>{const start=performance.now();input.value='目标城市';input.dispatchEvent(new Event('input',{bubbles:true}));return performance.now()-start;});
  await page.locator('#scheduleCompanyList [role=option]').filter({hasText:'合成企业4321'}).click();
  assert.equal(await page.locator('[name=companyKey]').inputValue(),'合成企业4321');assert.equal(await page.locator('[name=title]').inputValue(),'完整事项原文');assert.equal(await page.locator('[name=notes]').inputValue(),notes);assert(await highlights()>0);
  assert(await page.locator('#scheduleCompanyRecord').isVisible());await page.screenshot({path:path.join(out,'选区预览与公司检索.png')});
  await picker.fill('合成企业0002');await picker.press('ArrowDown');await picker.press('Enter');assert.equal(await page.locator('[name=companyKey]').inputValue(),'合成企业0002');
  await page.locator('#scheduleCompanyClear').click();assert.equal(await page.locator('[name=companyKey]').inputValue(),'');await picker.press('Escape');
  await page.locator('[name=scheduled]').uncheck();assert.equal(await highlights(),0);await page.locator('[name=scheduled]').check();assert(await highlights()>0);
  await page.locator('[name=allDay]').check();assert.equal(await page.locator('#scheduleCalendar').getAttribute('data-preview-start'),date);assert(await highlights()>0);
  await page.locator('[data-schedule=cancel]').first().click();assert.equal(await highlights(),0,'Cancel removes only the preview');assert.equal(await page.evaluate(()=>window.toudiSchedule.get().events.length),0);
  // Delayed permission status paints progress immediately; cancel must remain cancelled.
  await page.evaluate(()=>{window.__calendarReplies='full';window.toudiDesktop={calendar:async(action,request)=>{
    if(action==='status'){await new Promise(resolve=>window.__releaseCalendarStatus=resolve);return {supported:true,authorization:'fullAccess'};}
    if(action==='calendars')return {supported:true,authorization:'fullAccess',calendars:[{id:'synthetic-calendar',title:'合成日历'}]};
    if(action==='sync')return window.__calendarReplies==='unavailable'?{supported:true,authorization:'denied'}:{supported:true,authorization:'fullAccess',results:window.__calendarReplies==='missing'?[]:request.items.map(item=>({id:item.id,ok:true,operation:'created'}))};
  }};});
  await page.locator('[data-schedule=connect]').click();await page.getByText('正在检查日历权限…',{exact:true}).waitFor();
  await page.locator('[data-schedule=cancel]').first().click();await page.evaluate(()=>window.__releaseCalendarStatus());await page.waitForTimeout(100);assert.equal(await page.locator('#scheduleNativeCalendar').count(),0);
  await page.locator('[data-schedule=connect]').click();await page.waitForFunction(()=>!!window.__releaseCalendarStatus);await page.evaluate(()=>window.__releaseCalendarStatus());await page.locator('#scheduleNativeCalendar').selectOption('synthetic-calendar');
  await page.evaluate(()=>{window.__selectedCalendarNode=document.getElementById('scheduleNativeCalendar');window.dispatchEvent(new Event('focus'));window.__releaseCalendarStatus();});
  await page.waitForTimeout(100);
  assert(await page.evaluate(()=>window.__selectedCalendarNode.isConnected&&window.__selectedCalendarNode.value==='synthetic-calendar'),'Background permission recheck preserves a pending calendar choice');
  await page.locator('[data-schedule=enable-sync]').click();
  await page.getByText('日历已连接 · 暂无勾选同步的事项',{exact:true}).waitFor();
  await page.locator('[data-schedule=cancel]').first().click();await page.locator('[data-schedule=new]').first().click();await page.locator('[name=title]').fill('同步核验事项');await page.locator('[name=syncToCalendar]').check();
  await page.evaluate(()=>window.__calendarReplies='missing');await page.locator('#scheduleForm [type=submit]').click();await page.getByText('1 项未同步 · 在日历连接中查看',{exact:true}).waitFor();
  await page.locator('[data-schedule=connect]').click();await page.evaluate(()=>window.__releaseCalendarStatus());await page.getByText('系统日历未返回该事项的确认结果，请重试同步',{exact:true}).waitFor();
  await page.evaluate(()=>window.__calendarReplies='full');await page.locator('[data-schedule=sync]').click();await page.getByText('1 项已同步到本机日历',{exact:true}).first().waitFor();
  await page.evaluate(()=>window.__calendarReplies='unavailable');await page.locator('[data-schedule=sync]').click();await page.locator('#scheduleNotice').filter({hasText:'系统日历同步失败'}).waitFor();
  await page.evaluate(()=>window.__calendarReplies='full');await page.locator('[data-schedule=sync]').click();await page.locator('#scheduleNotice').waitFor({state:'hidden'});assert.equal(await page.locator('#scheduleSyncStatus').innerText(),'1 项已同步到本机日历','Recovered synchronization clears its stale failure notice');
  await page.evaluate(()=>{window.toudiDesktop.calendar=async()=>({supported:true,authorization:'denied'});});await page.locator('[data-schedule=connect]').first().click();assert(await page.locator('[data-schedule=calendar-settings]').isVisible());assert.equal(await page.locator('[data-schedule=authorize]').count(),0);
  await page.screenshot({path:path.join(out,'日历连接_权限状态.png')});
  await page.evaluate(()=>{window.toudiDesktop.calendar=async(action)=>{
    if(action==='authorize'){await new Promise(resolve=>window.__releaseCalendarAuthorization=resolve);return {supported:true,authorization:'notDetermined',granted:false,error:'合成授权错误'};}
    if(window.__holdFocusStatus)await new Promise(resolve=>window.__releaseFocusStatus=resolve);
    return {supported:true,authorization:'notDetermined'};
  };});
  await page.locator('[data-schedule=connect]').first().click();
  const focusPreservesConnection=await page.evaluate(()=>{const button=document.querySelector('[data-schedule=authorize]');window.__holdFocusStatus=true;window.dispatchEvent(new Event('focus'));return button.isConnected;});
  assert(focusPreservesConnection,'Returning to the App must not remove the authorization button before its click completes');
  await page.locator('[data-schedule=authorize]').click();await page.evaluate(()=>{window.__holdFocusStatus=false;window.__releaseFocusStatus();});await page.getByText('等待 macOS 日历授权，请在系统提示中选择允许…',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-schedule=authorize]').count(),0,'Waiting for OS authorization cannot queue another prompt');
  await page.evaluate(()=>window.__releaseCalendarAuthorization());await page.getByText('合成授权错误',{exact:true}).waitFor();assert(await page.locator('[data-schedule=authorize]').isVisible());
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'搜索与日历交互验收.json'),JSON.stringify({version:signal.version,search,companyLookupMs:lookup,recordCount:5000,preview,checks:['IME input filters immediately','native search clear restores results','fixed counts and input focus','actual mouse selection persists','date/time/all-day preview follows editor','cancel removes preview without saving','bounded company results and keyboard selection','company selection preserves editor','delayed connection and cancel','no eligible items does not claim synced','missing native result is failure','per-item result readback','denied permission directs to system settings'],actualEventKitWriteTested:false,errors},null,2));console.log('PASS search and calendar interactions');
})().catch(async error=>{console.error(error);for(const context of browser?.contexts()||[])for(const page of context.pages()){console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:path.join(out,'交互失败排查.png')}).catch(()=>{});}process.exitCode=1}).finally(async()=>{await browser?.close();if(service?.exitCode===null){service.stdin.write('shutdown\n');await once(service,'exit');}fs.rmSync(workspace,{recursive:true,force:true});});
