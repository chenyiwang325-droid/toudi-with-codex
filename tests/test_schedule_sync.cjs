'use strict';
// Browser plugin unavailable: isolated synthetic workspace and a deterministic native bridge.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{once}=require('node:events');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(__dirname,'..'),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'toudi-sync-'));
const out=process.env.TOUDI_SCHEDULE_EVIDENCE||os.tmpdir(),token=crypto.randomBytes(32).toString('hex');
let service,browser;
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const command=process.env.TOUDI_TEST_RUNTIME||'python3',args=process.env.TOUDI_TEST_RUNTIME?['serve']:[path.join(root,'app/desktop_runtime.py'),'serve'];
  service=spawn(command,args,{env:{...process.env,TOUDI_WORKSPACE:workspace,TOUDI_APP_HOME:path.join(workspace,'config'),TOUDI_DESKTOP_TOKEN:token,TOUDI_PORT:'0'},stdio:['pipe','pipe','pipe']});
  let logs='',raw='';service.stderr.on('data',chunk=>logs+=chunk);
  const signal=await new Promise((resolve,reject)=>{service.stdout.on('data',chunk=>{raw+=chunk;try{resolve(JSON.parse(raw.split('\n')[0]));}catch(_){}});service.once('exit',code=>reject(Error('Runtime exited '+code+' '+logs)));});
  const origin='http://127.0.0.1:'+signal.port;
  browser=await pw.chromium.launch({headless:true,executablePath:process.env.TOUDI_CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1536,height:1024},extraHTTPHeaders:{Authorization:'Bearer '+token}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const get=async()=>(await context.request.get(origin+'/api/manage?module=schedule')).json();
  const commit=async(body)=>{const current=await get();const response=await context.request.post(origin+'/api/manage',{data:{module:'schedule',base:current.version,workspaceKey:current.workspaceKey,...body},headers:{Origin:origin}});assert(response.ok(),await response.text());return response.json();};
  const item=(id,overrides={})=>({id,title:'合成事项 '+id,type:'interview',status:'planned',start:'2026-10-12T09:00:00+08:00',end:'2026-10-12T10:00:00+08:00',allDay:false,timeZone:'Asia/Shanghai',notes:'完整原文\n保留第二行。',meetingInfo:'会议号 123 456',syncToCalendar:false,...overrides});
  const fixture={schemaVersion:1,timeZone:'Asia/Shanghai',calendar:{enabled:false,calendarId:''},events:[item('legacy-off'),item('legacy-on',{syncToCalendar:true}),item('unplanned',{start:null,end:null}),item('point',{end:null}),item('cancel-no-time',{status:'cancelled',start:null,end:null})]};
  await commit({action:'replace',data:fixture});
  const bridge=async()=>page.evaluate(()=>{
    window.__syncCalls=[];window.__nativeItems={};window.__holdSync=false;
    window.toudiDesktop={calendar:async(action,request)=>{
      if(action==='status')return {supported:true,authorization:'fullAccess'};
      if(action==='calendars')return {supported:true,authorization:'fullAccess',calendars:[{id:'synthetic-calendar',title:'合成日历'}]};
      if(action==='sync'){
        window.__syncCalls.push(request);
        if(window.__holdSync){window.__holdSync=false;await new Promise(resolve=>window.__releaseSync=resolve);}
        return {supported:true,authorization:'fullAccess',results:request.items.map(item=>{
          const old=window.__nativeItems[item.id],operation=item.status==='cancelled'?(old?'deleted':'noop'):!old?'created':JSON.stringify(old)===JSON.stringify(item)?'unchanged':'updated';
          if(item.status==='cancelled')delete window.__nativeItems[item.id];else window.__nativeItems[item.id]=item;
          return {id:item.id,ok:true,operation};
        })};
      }
    }};
  });
  await page.goto(origin+'/投递管理.html');await page.waitForFunction(()=>serverMode&&toudiWorkspaceStorage.id);await bridge();
  await page.locator('[data-module=schedule]').click();await page.waitForFunction(()=>document.querySelector('#scheduleCalendar [data-date]'));
  const button=page.locator('#scheduleSyncButton');assert.equal(await button.count(),1,'Schedule toolbar has a standalone sync button');
  assert.equal(await page.evaluate(()=>window.__syncCalls.length),0,'Opening a disconnected schedule never writes to the system calendar');
  await button.click();await page.locator('#scheduleNativeCalendar').selectOption('synthetic-calendar');await page.locator('[data-schedule=enable-sync]').click();
  await page.waitForFunction(()=>window.__syncCalls.length>0&&!document.getElementById('scheduleSyncButton').disabled);
  const first=await page.evaluate(()=>window.__syncCalls[0]);assert.deepEqual(first.items.map(row=>row.id),['legacy-off','legacy-on','cancel-no-time']);
  assert.equal(first.items[0].notes,fixture.events[0].notes);assert.equal(first.items[0].meetingInfo,fixture.events[0].meetingInfo);
  let stored=await get();assert.equal(stored.data.calendar.syncAll,true);assert.deepEqual(stored.data.events,fixture.events,'Enabling whole-schedule sync does not rewrite original events');
  assert.equal(await page.locator('#scheduleSyncResults .schedule-sync-row').count(),5);assert.match(await page.locator('#scheduleSyncStatus').innerText(),/2 项时间未确定/);
  await button.click();await page.waitForFunction(()=>window.__syncCalls.length===2&&!document.getElementById('scheduleSyncButton').disabled);
  assert.deepEqual(await page.evaluate(()=>Object.keys(window.__nativeItems).sort()),['legacy-off','legacy-on'],'Repeated sync does not duplicate events');
  await page.locator('[data-schedule=cancel]').first().click();await page.locator('[data-schedule=new]').first().click();
  assert.equal(await page.locator('[name=syncToCalendar]').count(),0,'Event editing has no per-event synchronization checkbox');
  await page.locator('[name=title]').fill('新建后自动同步');assert(await button.isDisabled(),'Sync cannot replace an unsaved editor');
  await page.locator('#scheduleForm [type=submit]').click();await page.waitForFunction(()=>Object.values(window.__nativeItems).some(row=>row.title==='新建后自动同步'));
  stored=await get();const created=stored.data.events.find(row=>row.title==='新建后自动同步');assert(created&&!created.syncToCalendar);
  await page.locator('[data-schedule-mode=agenda]').click();await page.locator('[data-schedule-id="'+created.id+'"]').first().click();
  await page.locator('[name=startTime]').fill('13:00');await page.locator('[name=endTime]').fill('14:00');await page.locator('#scheduleForm [type=submit]').click();
  await page.waitForFunction(id=>window.__nativeItems[id]?.start.includes('T05:00'),created.id);
  // A second save while the native call is in flight must be queued, never lost.
  await page.evaluate(()=>window.__holdSync=true);await button.click();await page.waitForFunction(()=>!!window.__releaseSync);
  assert(await button.isDisabled());
  await page.locator('[data-schedule-id="'+created.id+'"]').first().click();await page.locator('[name=title]').fill('同步中保存的新版本');await page.locator('#scheduleForm [type=submit]').click();
  await page.waitForFunction(()=>!window.toudiSchedule.hasDraft());await page.evaluate(()=>window.__releaseSync());
  await page.waitForFunction(id=>window.__nativeItems[id]?.title==='同步中保存的新版本'&&!document.getElementById('scheduleSyncButton').disabled,created.id);
  await page.locator('[data-schedule-id="'+created.id+'"]').first().click();await page.locator('[data-schedule=delete]').click();await page.waitForFunction(id=>!window.__nativeItems[id],created.id);
  assert.equal((await get()).data.events.find(row=>row.id===created.id).status,'cancelled');
  // Stop is persistent and preserves the already synchronized events.
  await page.locator('[data-schedule=connect]').click();await page.locator('[data-schedule=disconnect]').click();
  await page.waitForFunction(()=>!window.toudiSchedule.get().calendar.enabled&&!document.getElementById('scheduleSyncButton').disabled);
  const stoppedCount=await page.evaluate(()=>window.__syncCalls.length);await commit({action:'upsert',item:item('while-stopped')});await page.evaluate(()=>window.toudiSchedule.refresh());
  assert.equal(await page.evaluate(()=>window.__syncCalls.length),stoppedCount);assert.equal((await get()).data.calendar.enabled,false);
  await button.click();await page.locator('[data-schedule=enable-sync]').click();await page.waitForFunction(()=>!!window.__nativeItems['while-stopped']);
  await page.reload();await page.waitForFunction(()=>serverMode);await bridge();await page.locator('[data-module=schedule]').click();await page.waitForFunction(()=>window.__syncCalls.length>0);
  assert.equal((await get()).data.calendar.syncAll,true,'Whole-schedule policy survives restart');
  await commit({action:'upsert',item:item('agent-update')});await page.waitForFunction(()=>!!window.__nativeItems['agent-update'],null,{timeout:12000});
  // Existing installations retain their selected-only scope until an explicit global sync click.
  stored=await get();const legacy={...stored.data,calendar:{enabled:true,calendarId:'synthetic-calendar'}};
  await commit({action:'replace',data:legacy});await page.reload();await page.waitForFunction(()=>serverMode);await bridge();await page.locator('[data-module=schedule]').click();await page.waitForFunction(()=>window.__syncCalls.length>0);
  assert.deepEqual(await page.evaluate(()=>window.__syncCalls[0].items.map(row=>row.id)),['legacy-on']);
  await button.click();await page.waitForFunction(()=>window.__syncCalls.at(-1).items.some(row=>row.id==='agent-update'));
  assert.equal((await get()).data.calendar.syncAll,true);
  await page.screenshot({path:path.join(out,'日程_独立同步按钮.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'整份日程同步验收.json'),JSON.stringify({version:signal.version,checks:['standalone toolbar button','first connection opts into all events','old false flags included only after explicit global action','original data and meeting information preserved','unplanned and missing-end items saved and explained','cancelled items synchronize even without dates','repeat is idempotent','no per-event checkbox','create edit and cancel auto-sync','in-flight changes queued','stop preserves system events','re-enable includes missed changes','restart retains policy','Agent live updates auto-sync','legacy selected-only policy retained until user click'],actualEventKitWriteTested:false,errors},null,2));
  console.log('PASS '+signal.version+' whole-schedule synchronization');
})().catch(async error=>{console.error(error);for(const context of browser?.contexts()||[])for(const page of context.pages()){await page.screenshot({path:path.join(out,'整份同步_失败排查.png')}).catch(()=>{});}process.exitCode=1}).finally(async()=>{await browser?.close();if(service?.exitCode===null){service.stdin.write('shutdown\n');await once(service,'exit');}fs.rmSync(workspace,{recursive:true,force:true});});
