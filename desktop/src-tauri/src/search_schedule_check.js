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
    report.version=window.toudiDesktop.version;report.records=data.length;
    report.errors=(window.__TOUDI_RENDER_ERRORS__||[]).filter(error=>!String(error).includes('ResizeObserver loop completed'));
    check(report.errors.length===0,'native runtime has no JavaScript errors');
  }catch(error){report.phase='failed';report.failure=String(error);}
  await window.__TAURI__.core.invoke('native_render_report',{report});
})();
