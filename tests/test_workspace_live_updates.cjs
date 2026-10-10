'use strict';
// Browser plugin not available. Isolated runtime/workspace/browser; no personal data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {makePack}=require('./profile_ui_fixture.cjs');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(__dirname,'..'),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'toudi-live-updates-'));
const out=process.env.TOUDI_PANEL_EVIDENCE || os.tmpdir(),token=crypto.randomBytes(32).toString('hex');
let service,browser;
function write(relative,data){const target=path.join(workspace,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof data==='string'?data:JSON.stringify(data));}
const modules={records:'投递数据/投递记录.json',edits:'投递数据/用户编辑数据.json',qbank:'投递数据/逐字稿数据.json',preps:'投递数据/面试准备数据.json',reviews:'投递数据/面试复盘数据.json',prospects:'岗位探查/探查目录.json'};
const report=body=>`# 合成企业岗位探查\n\n## 结论\n${body}\n\n`+Array.from({length:50},(_,i)=>`### 资料 ${i}\n可核验的合成证据 ${i}。\n`).join('\n');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  write(modules.records,[{名称:'合成企业',岗位:'研究岗位',地点:'示例城市',学历要求:'硕士',截止时间:'2027-01-01','公告链接':'https://example.test/notice','网申链接/邮箱':'https://example.test/apply'}]);
  write(modules.edits,{edits:{},pref:{}});
  write(modules.qbank,{categories:[{id:'general',name:'通用准备',items:[{id:'answer',title:'合成问题',body:'旧版通用回答'}]}]});
  write(modules.reviews,{sessions:[]});write(modules.preps,{preps:[]});
  write(modules.prospects,{companies:[{id:'sample',company:'合成企业',title:'合成企业岗位探查',researchedAt:'2026-10-08',file:'sample.md'}]});
  write('岗位探查/sample.md',report('初始探查正文'));
  write('填报资料/资料.json',makePack());
  const command=process.env.TOUDI_TEST_RUNTIME || 'python3',args=process.env.TOUDI_TEST_RUNTIME?['serve']:[path.join(root,'app/desktop_runtime.py'),'serve'];
  service=spawn(command,args,{env:{...process.env,TOUDI_WORKSPACE:workspace,TOUDI_APP_HOME:path.join(workspace,'.app-home'),TOUDI_DESKTOP_TOKEN:token,TOUDI_PARENT_PID:String(process.pid)},stdio:['pipe','pipe','pipe']});
  let logs='';service.stderr.on('data',data=>logs+=data);let ready='';
  for await(const chunk of service.stdout){ready+=chunk;if(ready.includes('\n'))break;}
  const signal=JSON.parse(ready.split('\n')[0]),base='http://127.0.0.1:'+signal.port;
  browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce',extraHTTPHeaders:{Authorization:'Bearer '+token}});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function get(route){const response=await context.request.get(base+route);assert(response.ok(),await response.text());return response.json();}
  async function commit(module,extra){const current=await get('/api/manage?module='+module);const response=await context.request.post(base+'/api/manage',{data:{module,base:current.version,workspaceKey:current.workspaceKey,...extra}});assert(response.ok(),await response.text());return response.json();}
  const first=await get('/api/workspace-changes');assert.equal(first.workspaceKey.length,64);assert.equal(Object.keys(first.revisions).length,9);assert(!(JSON.stringify(first).includes('sample.md')));
  assert.deepEqual((await get('/api/workspace-changes')).revisions,first.revisions);
  await page.goto(base+'/投递管理.html');await page.waitForFunction(()=>serverMode && data.length===1 && workspaceRefreshSnapshots.size>=7);
  // Recovery drafts from earlier App sessions are not edits in this window.
  // They used to block every later records/edits update until the App reopened.
  const archivedKey=await page.evaluate(()=>{
    const sessionId='previous-window',key=DRAFT_PREFIX.edits+toudiWorkspaceStorage.id+':'+sessionId;
    localStorage.setItem(key,JSON.stringify({format:'toudi-unsaved-draft',version:3,workspaceKey:toudiWorkspaceStorage.id,domain:'edits',sessionId,revision:1,base:editsVersion,savedAt:'2026-10-01T00:00:00.000Z',data:{edits:{'合成企业':{note:'历史未提交的完整备注'}},pref:{}}}));
    return key;
  });
  const archivedBefore=await page.evaluate(key=>localStorage.getItem(key),archivedKey);
  const originalRecords=(await get('/api/manage?module=records')).data;
  await commit('records',{action:'replace',data:[{...originalRecords[0],岗位:'历史草稿不阻挡最新岗位'}]});
  write(modules.edits,{edits:{'合成企业':{starred:true}},pref:{}});
  await page.evaluate(()=>refreshWorkspaceData(true));
  assert(await page.evaluate(()=>data.some(row=>row.岗位==='历史草稿不阻挡最新岗位')),'Archived edits must not freeze the already-open records view');
  assert(await page.evaluate(()=>userEdits['合成企业']?.starred),'The latest saved marks are read without restarting');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),archivedKey),archivedBefore,'The full recovery draft remains intact');
  assert.equal(await page.evaluate(()=>workspaceHasDraft('edits')),false,'A different session is not actively editing');
  assert(!await page.evaluate(()=>workspacePendingUpdates.has('records')||workspacePendingUpdates.has('edits')));
  await page.screenshot({path:path.join(out,'历史草稿_保留且即时更新.png')});
  await commit('records',{action:'replace',data:originalRecords});write(modules.edits,{edits:{},pref:{}});
  await page.evaluate(()=>refreshWorkspaceData(true));
  const overviewBefore=await page.locator('#recordsOverview').boundingBox(),totalBefore=await page.locator('#statsBar').innerText();
  const query=page.locator('#searchInput');await query.fill('没有这家合成企业');
  assert.equal(await page.locator('#tableBody .table-empty').count(),1,'Direct search filters the visible records');
  assert.equal(await page.locator('#statsBar').innerText(),totalBefore,'Search does not alter fixed stage totals');
  assert.equal(await query.inputValue(),'没有这家合成企业');assert(await query.evaluate(node=>node===document.activeElement),'Rendering results retains input focus');
  await query.fill('合成企业');await page.locator('#recordFilterButton').click();
  await page.getByRole('dialog',{name:'筛选投递记录'}).waitFor();
  await page.locator('#filterPanel input[data-filter="地点"][value="示例城市"]').check();
  await page.getByRole('dialog',{name:'筛选投递记录'}).getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await page.locator('#recordFilterCount').innerText(),'1');assert.equal(await query.inputValue(),'合成企业');
  assert.equal(await page.locator('#deliverySearchEntry').count(),0);await page.locator('#recordFilterButton').click();assert(await page.locator('#filterPanel input[data-filter="地点"][value="示例城市"]').isChecked(),'The single filter entry retains its conditions');
  await page.keyboard.press('Escape');await page.evaluate(()=>clearAdditional());
  assert.equal(await query.inputValue(),'');assert(await page.locator('#recordFilterCount').isHidden());
  assert(await page.locator('#workspaceUpdatesButton').isHidden(),'No idle clock/status entry');
  await page.evaluate(()=>showWorkspaceRefreshNotice('当前编辑保留，资料更新待显示。'));
  await page.locator('#workspaceUpdatesButton').click();assert(await page.locator('#workspaceRefreshNotice').isVisible());
  assert.deepEqual(await page.locator('#recordsOverview').boundingBox(),overviewBefore,'Opening update status does not move the overview or table');
  await page.keyboard.press('Escape');assert(await page.locator('#workspaceRefreshNotice').isHidden());await page.evaluate(()=>showWorkspaceRefreshNotice(''));
  await page.evaluate(()=>switchView('prospect'));await page.getByText('初始探查正文',{exact:true}).waitFor();
  await page.locator('#prospectSearchInput').fill('合成企业');
  await page.locator('#prospectMain').evaluate(node=>node.scrollTop=400);const scroll=await page.locator('#prospectMain').evaluate(node=>node.scrollTop);
  // Exercise real periodic checks with a slow response: unchanged content must
  // keep its nodes, and background polling must not flash/resize the toolbar.
  await page.waitForFunction(()=>workspaceRefreshSnapshots.size===9&&!workspaceRefreshRunning);
  let checked=0,holdNext=false,releaseCheck=null;
  await context.route('**/api/workspace-changes',async route=>{
    checked++;
    if(holdNext){holdNext=false;await new Promise(resolve=>releaseCheck=resolve);}
    else await new Promise(resolve=>setTimeout(resolve,500));
    await route.continue();
  });
  const toolbar=()=>page.locator('.topbar-actions').evaluate(el=>[...el.children].filter(node=>node.getBoundingClientRect().width).map(node=>{const rect=node.getBoundingClientRect();return {id:node.id,x:rect.x,y:rect.y,width:rect.width,height:rect.height};}));
  const initialToolbar=await toolbar();
  await page.evaluate(()=>{
    window.__refreshReader=document.querySelector('#prospectMain').firstElementChild;
    window.__refreshMutations=[];
    window.__refreshObserver=new MutationObserver(records=>window.__refreshMutations.push(...records.map(record=>({type:record.type,attribute:record.attributeName,text:document.getElementById('workspaceRefreshButton').textContent,disabled:document.getElementById('workspaceRefreshButton').disabled}))));
    window.__refreshObserver.observe(document.getElementById('workspaceRefreshButton'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-busy']});
  });
  await page.waitForFunction(()=>workspaceRefreshRunning,null,{timeout:12000});
  const checkingToolbar=await toolbar();
  await page.screenshot({path:path.join(out,'刷新资料_后台检查.png')});
  while(checked<2)await page.waitForTimeout(100);
  await page.waitForFunction(()=>!workspaceRefreshRunning);
  const stability=await page.evaluate(()=>{window.__refreshObserver.disconnect();return {mutations:window.__refreshMutations,readerPreserved:window.__refreshReader===document.querySelector('#prospectMain').firstElementChild};});
  fs.writeFileSync(path.join(out,'刷新资料_稳定性.json'),JSON.stringify({initialToolbar,checkingToolbar,...stability},null,2));
  assert.deepEqual(stability.mutations,[],'Background polling does not change button label, disabled state or busy state');
  assert.deepEqual(checkingToolbar,initialToolbar,'Background polling leaves toolbar geometry intact');
  assert(stability.readerPreserved,'Unchanged reader DOM is retained');
  assert.equal(await page.locator('#prospectSearchInput').inputValue(),'合成企业');
  assert.equal(await page.locator('#prospectMain').evaluate(node=>node.scrollTop),scroll);
  // A manual click during an automatic read joins that read, gets feedback and
  // does not issue a duplicate request or redraw unchanged reader contents.
  holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>workspaceRefreshRunning);
  while(!releaseCheck)await page.waitForTimeout(20);
  const countBeforeManual=checked;
  await page.locator('#workspaceRefreshButton').click();
  assert.equal(await page.locator('#workspaceRefreshButton').textContent(),'正在刷新…');
  assert(await page.locator('#workspaceRefreshButton').isDisabled());
  assert.deepEqual(await toolbar(),initialToolbar,'Manual progress keeps the same toolbar geometry');
  releaseCheck();await page.waitForFunction(()=>!workspaceRefreshRunning);
  assert.equal(checked,countBeforeManual,'Manual click joins the active check');
  await page.getByText('资料没有变化',{exact:true}).waitFor();
  assert(await page.evaluate(()=>window.__refreshReader===document.querySelector('#prospectMain').firstElementChild));
  await context.unroute('**/api/workspace-changes');
  stability.manualRefresh={sameGeometry:true,joinedBackgroundRead:true,readerPreserved:true};
  fs.writeFileSync(path.join(out,'刷新资料_稳定性.json'),JSON.stringify({initialToolbar,checkingToolbar,...stability},null,2));
  // Include files committed after an old manifest arrived, while one of its
  // module readers is still in flight. A fresh in-flight manifest needs no retry.
  await page.waitForFunction(()=>!workspaceRefreshRunning);
  let releaseRecords=null,manifestChecks=0;
  await context.route('**/api/workspace-changes',async route=>{manifestChecks++;await route.continue();});
  await context.route('**/api/manage?module=records',async route=>{await new Promise(resolve=>releaseRecords=resolve);await route.continue();});
  const recordsBefore=await get('/api/manage?module=records');
  await commit('records',{action:'replace',data:recordsBefore.data.map(row=>({...row,岗位:'并发更新的岗位'}))});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  while(!releaseRecords)await page.waitForTimeout(20);
  assert(await page.evaluate(()=>workspaceRefreshManifestRead && workspaceRefreshRunning));
  await commit('prospects',{action:'upsert',item:{id:'sample',company:'合成企业',title:'合成企业岗位探查',researchedAt:'2026-10-08',file:'sample.md',markdown:report('刷新点击前刚更新的完整正文')}});
  await page.locator('#workspaceRefreshButton').click();
  releaseRecords();await page.waitForFunction(()=>!workspaceRefreshRunning);
  await page.getByText('刷新点击前刚更新的完整正文',{exact:true}).waitFor();
  assert.equal(manifestChecks,2,'A manifest received before the click gets one fresh follow-up check');
  assert.deepEqual(await toolbar(),initialToolbar,'Follow-up refresh retains toolbar geometry');
  await context.unroute('**/api/manage?module=records');await context.unroute('**/api/workspace-changes');
  await commit('prospects',{action:'upsert',item:{id:'sample',company:'合成企业',title:'合成企业岗位探查',researchedAt:'2026-10-08',file:'sample.md',markdown:report('Agent 已更新探查正文')}});
  await page.getByText('Agent 已更新探查正文',{exact:true}).waitFor({timeout:12000});
  assert.equal(await page.locator('#prospectSearchInput').inputValue(),'合成企业');assert.equal(await page.evaluate(()=>currentProspectId),'sample');
  assert(Math.abs(await page.locator('#prospectMain').evaluate(node=>node.scrollTop)-scroll)<20,'Reader position preserved');
  await page.screenshot({path:path.join(out,'探查正文_打开中自动更新.png')});
  // A qbank management draft must not block another module's fresh report.
  await page.evaluate(()=>openManagement('qbank'));const draft=page.locator('[data-mfield="题库 JSON"]');await draft.fill('{"draft":"保留我的未提交修改"}');
  write('岗位探查/sample.md',report('报告单独更新仍然自动接收'));
  await page.waitForFunction(()=>prospectData.prospects[0].content.includes('报告单独更新仍然自动接收'),null,{timeout:12000});
  assert.equal(await draft.inputValue(),'{"draft":"保留我的未提交修改"}');
  const updatedBank={categories:[{id:'general',name:'通用准备',items:[{id:'answer',title:'合成问题',body:'新版通用回答'}]}]};
  await commit('qbank',{action:'replace',data:updatedBank});
  await page.waitForFunction(()=>workspacePendingUpdates.has('qbank'),null,{timeout:12000});assert.equal(await draft.inputValue(),'{"draft":"保留我的未提交修改"}');
  const managementRecovery=await page.evaluate(()=>toudiWorkspaceStorage.getItem('toudiManagementDrafts'));
  await page.evaluate(()=>closeManagement());
  await page.waitForFunction(()=>qbData.categories[0]?.items[0]?.body==='新版通用回答',null,{timeout:12000});
  assert.equal(await page.evaluate(()=>toudiWorkspaceStorage.getItem('toudiManagementDrafts')),managementRecovery,'Closing an editor keeps its recovery copy without freezing its module');
  // Resuming that copy keeps its old base: it cannot overwrite external edits.
  await page.evaluate(()=>openManagement('qbank'));
  await page.getByRole('button',{name:'继续未保存编辑',exact:true}).click();
  await page.locator('#managementStatus').filter({hasText:'已恢复草稿及原版本'}).waitFor();
  assert.equal(await draft.inputValue(),'{"draft":"保留我的未提交修改"}');
  assert.equal(await page.evaluate(()=>management.version),JSON.parse(managementRecovery).qbank.base);
  assert(await page.evaluate(()=>workspaceHasDraft('qbank')),'An explicitly resumed editor is still protected');
  await page.evaluate(()=>closeManagement());
  await page.evaluate(()=>openFilling());const frame=page.frameLocator('#fillingDialog iframe');await frame.locator('.fact-value').first().waitFor();
  const pack1=await get('/api/manage?module=profile'),phone=pack1.data.facts.find(f=>f.label==='手机');phone.value='13911111111';
  await commit('profile',{action:'replace',data:pack1.data});await frame.getByText('13911111111',{exact:true}).waitFor({timeout:12000});
  await frame.locator('[data-record-edit="personal"]').click();await frame.locator('#recordField-phone').fill('13922222222');
  const pack2=await get('/api/manage?module=profile');pack2.data.facts.find(f=>f.label==='手机').value='13933333333';await commit('profile',{action:'replace',data:pack2.data});
  await page.waitForFunction(()=>workspacePendingUpdates.has('profile'),null,{timeout:12000});
  assert.equal(await frame.locator('#recordField-phone').inputValue(),'13922222222');
  await frame.locator('#recordForm button[type="submit"]').click();await frame.locator('#recordError').filter({hasText:'另一处更新'}).waitFor();
  assert.equal(await frame.locator('#recordField-phone').inputValue(),'13922222222','Conflict preserves full edit');
  await frame.locator('#closeRecord').click();await frame.getByText('13933333333',{exact:true}).waitFor({timeout:12000});
  await page.screenshot({path:path.join(out,'App_分类资料与实时更新.png')});
  await page.locator('#fillingClose').click();
  const beforeDisconnect=await page.locator('#prospectMain').textContent();await context.route('**/api/workspace-changes',route=>route.fulfill({status:503,json:{error:'isolated test outage'}}));
  await page.locator('#workspaceUpdatesButton[data-state="error"]').waitFor({timeout:12000});
  assert(await page.locator('#workspaceRefreshNotice').isHidden(),'Background errors do not insert a notification row');
  await page.locator('#workspaceUpdatesButton').click();await page.locator('#workspaceRefreshNotice').filter({hasText:'自动重试'}).waitFor();
  assert.equal(await page.locator('#prospectMain').textContent(),beforeDisconnect);await page.keyboard.press('Escape');
  await context.unroute('**/api/workspace-changes');await commit('records',{action:'upsert',item:{id:'',record:{名称:'新增合成企业',岗位:'新岗位'}}});
  await page.waitForFunction(()=>data.some(row=>row.名称==='新增合成企业'),null,{timeout:12000});
  // A failed read must not acknowledge unread content or disconnect other modules.
  await page.waitForFunction(()=>!workspaceRefreshRunning);
  await context.route('**/api/edits',route=>route.fulfill({status:503,json:{error:'synthetic busy module'}}));
  const editsBefore=await page.evaluate(()=>workspaceRefreshSnapshots.get('edits'));
  write(modules.edits,{edits:{'合成企业':{starred:true}},pref:{}});
  write('岗位探查/sample.md',report('其他模块失败时探查仍然更新'));
  await page.evaluate(()=>refreshWorkspaceData(true));
  assert(await page.evaluate(()=>serverMode&&apiBase!==null),'A module failure does not invalidate the confirmed connection');
  assert.equal(await page.evaluate(()=>workspaceRefreshSnapshots.get('edits')),editsBefore,'Failed content is never acknowledged');
  assert.equal(await page.evaluate(()=>workspaceReadStates.edits),'error');
  assert(await page.evaluate(()=>prospectData.prospects[0].content.includes('其他模块失败时探查仍然更新')));
  await context.unroute('**/api/edits');
  await page.waitForFunction(()=>userEdits['合成企业']?.starred&&workspaceReadStates.edits==='ready',null,{timeout:12000});
  // Slow reads used to fail a redundant 1.5s connection probe.
  await context.route('**/api/edits',async route=>{await new Promise(resolve=>setTimeout(resolve,1900));await route.continue();});
  write(modules.edits,{edits:{'合成企业':{starred:true,researchNote:'外部更新后的完整记录'}},pref:{}});
  write('岗位探查/sample.md',report('服务短暂繁忙后的最新正文'));
  await page.evaluate(()=>refreshWorkspaceData(true));
  assert(await page.evaluate(()=>prospectData.prospects[0].content.includes('服务短暂繁忙后的最新正文')));
  assert(await page.evaluate(()=>serverMode&&apiBase!==null));await context.unroute('**/api/edits');
  // Read-only details update in place. Real unsaved inputs remain protected.
  await page.evaluate(()=>{showDetail(data.find(row=>row.名称==='合成企业')._idx);jumpDetailSection('detailFollowup');});
  assert(await page.locator('.detail-recruitment-links a.action-link').first().isVisible());
  assert.equal(await page.locator('.detail-recruitment-links a').first().evaluate(el=>getComputedStyle(el).textDecorationLine),'none');
  assert(await page.locator('.detail-recruitment-links a').first().evaluate(el=>el.getBoundingClientRect().height>=34));
  await commit('records',{action:'replace',data:[{名称:'新增合成企业',岗位:'新岗位'},{名称:'合成企业',岗位:'打开详情时更新后的岗位','公告链接':'https://example.test/notice','网申链接/邮箱':'https://example.test/apply'}]});
  await page.waitForFunction(()=>document.getElementById('detailContent').textContent.includes('打开详情时更新后的岗位'),null,{timeout:12000});
  assert(await page.locator('#detailNotes').evaluate(el=>el.open),'A read-only refresh preserves the expanded follow-up');
  assert(await page.locator('#detailRecruitment').isVisible());
  assert.equal(await page.evaluate(()=>byId(detailIdx)._key),'合成企业','Reordering records keeps the open company binding');
  await page.screenshot({path:path.join(out,'详情链接_按钮与原地更新.png')});
  await page.locator('#researchNote').fill('保留未保存的详细记录');
  await commit('records',{action:'replace',data:[{名称:'合成企业',岗位:'实际编辑结束后才应用的岗位'}]});
  await page.waitForFunction(()=>workspacePendingUpdates.has('records'),null,{timeout:12000});
  assert.equal(await page.locator('#researchNote').inputValue(),'保留未保存的详细记录');
  assert(await page.evaluate(()=>data.some(row=>row.岗位==='打开详情时更新后的岗位')));
  await page.locator('#researchNote').fill('外部更新后的完整记录');
  await page.evaluate(()=>closeDetailModal());
  await page.waitForFunction(()=>data.some(row=>row.岗位==='实际编辑结束后才应用的岗位'),null,{timeout:12000});
  // Textarea normalizes source CRLF into LF. Merely viewing and closing a
  // multi-line note must not make it an unsaved draft that blocks all refresh.
  write(modules.edits,{edits:{'合成企业':{researchNote:'完整第一行\r\n完整第二行'}},pref:{}});
  await page.evaluate(()=>refreshWorkspaceData(true));
  await page.evaluate(()=>showDetail(data.find(row=>row.名称==='合成企业')._idx));
  assert.equal(await page.locator('#researchNote').inputValue(),'完整第一行\n完整第二行');
  assert.equal(await page.evaluate(()=>workspaceHasDraft('edits')),false,'Read-only normalized text is not an unsaved edit: '+JSON.stringify(await page.evaluate(()=>({detailDraft:workspaceDetailDraftExists(),detailIdx,memory:[...detailInputMemory.entries()].map(([index,fields])=>({index,key:byId(index)?._key,fields:fields.filter(field=>field.id==='researchNote')})),dirty:editsDirty,conflict:editsConflict,inFlight:editsSaveInFlight,fieldEditIdx,drafts:listUnsavedDrafts().map(item=>item.domain)}))));
  await page.evaluate(()=>closeDetailModal());
  await commit('records',{action:'replace',data:[{名称:'合成企业',岗位:'只读多行文本不阻挡新岗位'}]});
  await page.waitForFunction(()=>data.some(row=>row.岗位==='只读多行文本不阻挡新岗位'),null,{timeout:12000});
  await page.evaluate(()=>showDetail(data.find(row=>row.名称==='合成企业')._idx));
  if(!await page.locator('#detailNotes').evaluate(el=>el.open))await page.locator('#detailNotes>summary').click();
  await page.locator('#researchNote').fill('真正修改的完整文本');
  assert.equal(await page.evaluate(()=>workspaceHasDraft('edits')),true,'Actual note changes remain protected');
  await page.locator('#researchNote').fill('完整第一行\n完整第二行');
  await page.evaluate(()=>closeDetailModal());
  write('岗位探查/sample.md',report('[正文中的来源链接](https://example.test/reference)'));
  await page.evaluate(()=>refreshWorkspaceData(true));
  await page.evaluate(()=>switchView('prospect'));
  assert.equal(await page.locator('#prospectMain .pp-md a').evaluate(el=>getComputedStyle(el).textDecorationLine),'underline');
  assert.deepEqual(errors,[]);
  const result={runtimeVersion:signal.version,checks:['Archived personal-data drafts stay intact without blocking fresh records or marks','Closing management preserves its recovery copy and permits automatic updates','Resuming recovery preserves the original save base and protects the active editor','Direct search preserves focus and fixed stage counts','A single detailed-filter entry retains the same conditions','Update status popover does not move content','Manual refresh includes commits after a previous manifest','Background checks leave the toolbar unchanged','Manual refresh keeps fixed geometry and joins a running check','Unchanged modules retain their DOM after manual refresh','Focused open reader receives Agent changes without navigation/reload','Markdown-only report update detected','Search, report identity and reader scroll retained','Unrelated draft does not block refresh','Dirty module deferred until draft ends','Shared profile refreshes while open','Inline edits and old save base preserved on conflict','Cancel editor refreshes automatically','Temporary connection failure preserves data and retries','New records appear','Failed module is never acknowledged and other modules still update','Automatic retry recovers without reopening','Slow personal data read completes without a redundant connection probe','Open read-only detail refreshes in place with stable company binding','Actual unsaved detail input is protected','Read-only CRLF notes do not block refresh and real edits remain protected','Action links use buttons and Markdown links stay underlined'],pageErrors:errors};
  fs.writeFileSync(path.join(out,'App自动更新验收.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS '+JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  await browser?.close();if(service && service.exitCode===null){service.stdin.write('shutdown\n');await once(service,'exit');}fs.rmSync(workspace,{recursive:true,force:true});
});
