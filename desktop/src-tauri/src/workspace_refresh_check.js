/* Opt-in native refresh acceptance: external test runner publishes synthetic data. */
(async () => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = (task, ms, message) => Promise.race([task, pause(ms).then(() => {throw Error(message);})]);
  // Diagnostic equality only: also works in a custom-protocol WebView without
  // Web Crypto. Business save versions remain the server's SHA-256 contract.
  const digest = async value => {let hash=2166136261;for(const byte of new TextEncoder().encode(JSON.stringify(value)))hash=Math.imul(hash^byte,16777619)>>>0;return 'fnv1a32:'+hash.toString(16).padStart(8,'0');};
  const snapshots = [], requests = [];
  let tableProof = null;
  const previousFetch = window.fetch;
  window.fetch = async function(input,...args) {
    const route = String(input).split('?')[0], started = performance.now();
    try {const response = await previousFetch.call(this,input,...args);requests.push({route,status:response.status,ms:Math.round(performance.now()-started)});return response;}
    catch(error) {requests.push({route,error:String(error),ms:Math.round(performance.now()-started)});throw error;}
  };
  async function capture(phase) {
    const state = {phase,visibility:document.visibilityState,hasFocus:document.hasFocus(),secureContext:isSecureContext,view:typeof view==='string'?view:null,serverMode:typeof serverMode==='boolean'?serverMode:null,
      connected:typeof apiBase!=='undefined'&&apiBase!==null,
      revisions:typeof workspaceRefreshSnapshots!=='undefined'?Object.fromEntries(workspaceRefreshSnapshots):{},
      pending:typeof workspacePendingUpdates!=='undefined'?[...workspacePendingUpdates]:[],
      readStates:typeof workspaceReadStates!=='undefined'?{...workspaceReadStates}:{},
      recordCount:typeof data!=='undefined'?data.length:null,
      recordsDigest:typeof data!=='undefined'?await digest(data.map(row=>[row._key,row['岗位']||''])):null,
      prospectsDigest:typeof prospectData!=='undefined'?await digest(prospectData.prospects.map(row=>[row.id,row.content])):null,
      renderedReportDigest:await digest(document.querySelector('#prospectMain .pp-md')?.textContent||''),
      detailCompanyDigest:await digest(document.getElementById('detailTitle')?.textContent||''),
      detailPositionDigest:await digest([...document.querySelectorAll('.detail-fact')].find(node=>node.querySelector('dt')?.textContent==='岗位与招聘方向')?.querySelector('dd')?.textContent||''),
      readOnlyNoteIsDraft:workspaceHasDraft('edits'),
      actionLinks:[...document.querySelectorAll('.detail-entry-actions a.action-link')].map(node=>({label:node.textContent.trim(),height:node.getBoundingClientRect().height,underline:getComputedStyle(node).textDecorationLine,border:getComputedStyle(node).borderTopStyle})),
      reportRows:document.querySelectorAll('#prospectList [data-prospect-id]').length,
      recordRows:document.querySelectorAll('#tableBody tr').length,
      notice:document.getElementById('workspaceRefreshNotice')?.textContent?.trim(),
      tableProof,errors:[...(window.__TOUDI_RENDER_ERRORS__||[])]};
    snapshots.push(state);
    await deadline(window.__TAURI__.core.invoke('native_render_report',{report:{phase,viewport:{width:innerWidth,height:innerHeight},snapshots,requests}}),4000,'Native report acknowledgement timed out');
    requests.push({nativeReportAccepted:phase});
    return state;
  }
  try {
    await deadline(window.__TOUDI_DESKTOP_READY__,10000,'Desktop bootstrap timed out');
    for(let i=0;i<100 && !serverMode;i++)await pause(100);
    await deadline(refreshWorkspaceData(true),15000,'Initial refresh timed out');
    const geometry = id => {const node=document.getElementById(id),rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};};
    tableProof={search:geometry('searchInput'),filter:geometry('recordFilterButton'),overview:geometry('recordsOverview'),noticeHidden:document.getElementById('workspaceRefreshNotice').hidden,noticeInToolbar:!!document.getElementById('workspaceRefreshNotice').closest('.topbar-actions'),searchCount:document.querySelectorAll('#searchInput').length};
    await ensureViewData('prospect');switchView('prospect');
    showDetail(data[0]._idx);closeDetailModal();
    const initial=await capture('initial');let latest=initial;
    for(let i=0;i<150;i++) {
      await pause(100);
      if(await digest(prospectData.prospects.map(row=>[row.id,row.content]))!==initial.prospectsDigest) {
        // The reader publishes its body before the refresh transaction records
        // the successful revision. Capture the settled transaction so the
        // next external commit cannot be confused with this one.
        await deadline(workspaceRefreshTask||Promise.resolve(),15000,'Automatic refresh did not settle');
        latest=await capture('automatic');break;
      }
    }
    if(latest===initial)throw Error('Native automatic update was not applied');
    let manualPublished=false;
    for(let i=0;i<100;i++) {
      // Publishing records can also reassociate the prospect catalogue. Wait
      // for the second complete document, not merely its catalogue revision.
      const remote=await (await fetch('/api/prospects',{cache:'no-store'})).json();
      if(remote.prospects?.some(row=>row.content.includes('手动刷新后的完整正文。'))) {manualPublished=true;break;}
      await pause(100);
    }
    if(!manualPublished)throw Error('External manual-refresh document was not published');
    document.getElementById('workspaceRefreshButton').click();
    await deadline(workspaceRefreshTask||Promise.resolve(),15000,'Manual refresh timed out');
    showDetail(data.find(row=>row['名称']==='合成企业')._idx);
    await pause(350);
    await capture('manual');
  } catch(error) {requests.push({diagnosticError:String(error)});await capture('failed');}
  finally {window.fetch=previousFetch;}
})();
