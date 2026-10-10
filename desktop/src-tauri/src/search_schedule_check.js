/* Opt-in native WKWebView interaction probe. Uses a caller-owned fixture,
   stays hidden and never requests permissions or writes system calendar data. */
(async()=>{
  const report={phase:'complete',checks:[],errors:[],actualEventKitWriteTested:false};
  const check=(ok,label)=>{report.checks.push({label,ok:!!ok});if(!ok)throw Error(label);};
  const wait=async fn=>{const until=Date.now()+40000;while(!fn()){if(Date.now()>until)throw Error('Native interaction initialization timed out');await new Promise(resolve=>setTimeout(resolve,100));}};
  try{
    await window.__TOUDI_DESKTOP_READY__;await wait(()=>serverMode&&data.length&&workspaceRefreshSnapshots.size>=7);
    const input=document.getElementById('searchInput'),totals=document.getElementById('statsBar').textContent;
    input.value='合成产品';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText'}));
    check(searchQuery==='合成产品'&&getFiltered().length===1,'native IME input filters immediately');
    check(document.getElementById('statsBar').textContent===totals,'stage totals remain fixed');
    input.value='';input.dispatchEvent(new Event('search',{bubbles:true}));check(getFiltered().length===data.length,'native search clear restores results');
    switchView('schedule');await window.toudiSchedule.show();await wait(()=>document.querySelector('#scheduleCalendar [data-date]'));
    document.querySelector('[data-schedule="new"]').click();
    const editor=document.getElementById('scheduleForm');
    editor.elements.startTime.value='14:15';editor.elements.endTime.value='15:45';editor.elements.startTime.dispatchEvent(new Event('input',{bubbles:true}));
    const canvas=document.getElementById('scheduleCalendar');
    report.preview={start:canvas.dataset.previewStart,end:canvas.dataset.previewEnd};
    check(!!report.preview.start&&!!report.preview.end,'native editor keeps a time preview');
    editor.elements.title.value='完整的合成事项';editor.elements.title.dispatchEvent(new Event('input',{bubbles:true}));
    check(canvas.dataset.previewStart===report.preview.start&&canvas.dataset.previewEnd===report.preview.end,'preview persists while editing');
    const query=document.getElementById('scheduleCompanyQuery'),started=performance.now();
    query.value='目标城市';query.dispatchEvent(new Event('input',{bubbles:true}));
    const choices=[...document.querySelectorAll('#scheduleCompanyList [role="option"]')];report.companyLookupMs=performance.now()-started;
    check(choices.length===1,'native company search narrows the fixture');choices[0].click();
    check(!!editor.elements.companyKey.value&&editor.elements.title.value==='完整的合成事项','company binding preserves current editor');
    query.value='';query.dispatchEvent(new Event('input',{bubbles:true}));check(document.querySelectorAll('#scheduleCompanyList [role="option"]').length<=20,'native company list stays bounded');
    document.querySelector('[data-schedule="cancel"]').click();check(!canvas.dataset.previewStart&&window.toudiSchedule.get().events.length===0,'cancel clears preview without creating an event');
    report.nativeStatus=await window.toudiDesktop.calendar('status');check(report.nativeStatus.supported,'native EventKit status bridge');
    // Exercise synchronization policy in WKWebView without writing system events.
    const realCalendar=window.toudiDesktop.calendar,calls=[];
    window.toudiDesktop.calendar=async(action,request)=>{
      if(action==='status')return {supported:true,authorization:'fullAccess'};
      if(action==='calendars')return {supported:true,authorization:'fullAccess',calendars:[{id:'synthetic-calendar',title:'合成日历'}]};
      calls.push(request);return {supported:true,authorization:'fullAccess',results:request.items.map(item=>({id:item.id,ok:true,operation:item.status==='cancelled'?'deleted':'updated'}))};
    };
    const syncButton=document.getElementById('scheduleSyncButton');check(!!syncButton,'native standalone sync control');syncButton.click();
    await wait(()=>document.getElementById('scheduleNativeCalendar'));
    document.getElementById('scheduleNativeCalendar').value='synthetic-calendar';document.querySelector('[data-schedule="enable-sync"]').click();
    await wait(()=>window.toudiSchedule.get().calendar.syncAll&&!syncButton.disabled);
    check(window.toudiSchedule.get().calendar.enabled,'native connection enables whole-schedule policy');
    document.querySelector('[data-schedule="new"]').click();
    check(!document.querySelector('[name="syncToCalendar"]'),'native editor has no per-event sync checkbox');
    const syncEditor=document.getElementById('scheduleForm');syncEditor.elements.title.value='合成自动同步事项';syncEditor.elements.title.dispatchEvent(new Event('input',{bubbles:true}));
    syncEditor.requestSubmit();await wait(()=>calls.some(call=>call.items.some(item=>item.title==='合成自动同步事项'))&&!syncButton.disabled);
    const saved=window.toudiSchedule.get().events[0];check(!saved.syncToCalendar,'native new event syncs without a legacy flag');
    switchView('schedule');document.querySelector('[data-schedule-mode="agenda"]').click();
    document.querySelector('[data-schedule-id]').click();document.querySelector('[data-schedule="delete"]').click();
    await wait(()=>calls.some(call=>call.items.some(item=>item.id===saved.id&&item.status==='cancelled'))&&!syncButton.disabled);
    check(window.toudiSchedule.get().events[0].status==='cancelled','native cancellation keeps tombstone and synchronizes');
    window.toudiDesktop.calendar=realCalendar;
    report.version=window.toudiDesktop.version;report.records=data.length;
    report.errors=(window.__TOUDI_RENDER_ERRORS__||[]).filter(error=>!String(error).includes('ResizeObserver loop completed'));
    check(report.errors.length===0,'native runtime has no JavaScript errors');
  }catch(error){report.phase='failed';report.failure=String(error);}
  await window.__TAURI__.core.invoke('native_render_report',{report});
})();
