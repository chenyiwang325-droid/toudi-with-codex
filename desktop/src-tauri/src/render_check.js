/* Read-only native rendering probe. Enabled only by the developer's launch environment. */
(async () => {
  await window.__TOUDI_DESKTOP_READY__;
  // A background WKWebView can pause animations; capture the settled layout.
  document.documentElement.dataset.renderDiagnostic = 'true';
  const target = window.__TOUDI_DIAG_VIEW__ || 'table';
  let filling = null;
  if (target === 'filling' && typeof window.openFilling === 'function') {
    await window.__TOUDI_DESKTOP_READY__;
    await window.openFilling();
    const frame=document.querySelector('.filling-profile-frame');
    for(let i=0;i<60;i++) {
      if(frame?.contentDocument?.querySelector('#facts') && frame.contentDocument.body.textContent.includes('个人资料')) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await new Promise(resolve=>setTimeout(resolve,500));
    const doc=frame?.contentDocument;
    for(const animation of doc?.getAnimations() || []) animation.finish();
    const summary = await (await fetch('/api/filling')).json();
    const extension = await fetch('/api/filling/extension');
    filling = {available:summary.available, counts:summary.counts,
      dialogOpen:document.querySelector('#fillingDialog')?.open,
      sidebarEntry:document.querySelector('.filling-nav #fillingEntry')?.textContent,
      extensionEntry:!!document.getElementById('fillingOpen'),
      guide:document.querySelector('.filling-footer a')?.href,
      sharedEditor:!!doc?.querySelector('#facts'),
      editorText:doc?.querySelector('h1')?.textContent,
      editorWidth:doc?.documentElement.clientWidth,
      editorScrollWidth:doc?.documentElement.scrollWidth,
      editorTheme:doc ? getComputedStyle(doc.body).backgroundColor : null,
      editorStatus:doc?.querySelector('#notice')?.textContent,
      noLegacyConnection:!document.getElementById('fillingCopy'),
      extensionSize:(await extension.arrayBuffer()).byteLength};
  } else if (target && typeof switchView === 'function') {
    const module = target.startsWith('schedule-') ? 'schedule' : target.startsWith('recruitment-') || target === 'refresh-stability' ? 'table' : target === 'company' ? 'qbank' : ['agent-settings','data-settings','preference-settings','education-preferences','industry-preferences'].includes(target) ? 'settings' : target;
    if (typeof ensureViewData === 'function') await ensureViewData(module);
    switchView(module);
    if (target === 'schedule' || target.startsWith('schedule-')) {
      await window.toudiSchedule.show();
      if (target === 'schedule-month') document.querySelector('[data-schedule-mode="dayGridMonth"]').click();
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if (target.startsWith('recruitment-') && data.length) {
      showDetail(data[0]._idx);
      if (target === 'recruitment-followup') jumpDetailSection('detailFollowup');
      if (target === 'recruitment-materials') jumpDetailSection('detailMaterials');
      for (let i=0;i<30;i++) {
        if (!document.getElementById('detailSchedule')?.textContent.includes('正在读取')) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }
    if (target === 'agent-settings') switchSettingsTab('agent');
    if (target === 'data-settings') switchSettingsTab('data');
    if (['preference-settings','education-preferences','industry-preferences'].includes(target)) switchSettingsTab('preferences');
    if (target === 'education-preferences') openPrefModal('education');
    if (target === 'industry-preferences') openPrefModal('industries');
    if (target === 'industry-preferences') {
      const major = document.querySelector('#prefIndustries .industry-group');
      if (major) major.open = true;
      const subdivision = major?.querySelector('.industry-subgroup');
      if (subdivision) subdivision.open = true;
    }
    if (target === 'company') switchPrepMode('company');
    if (target === 'qbank') switchPrepMode('general');
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  // Reveal one existing table for a read-only rendering check; no business content is changed.
  const reader = document.querySelector(target === 'prospect' ? '#prospectMain' : target === 'review' ? '#reviewMain' : ['qbank','company'].includes(target) ? '#qbMain' : '.__no_reader__');
  // The initially selected document may contain no tables. Inspect an existing one when available.
  const hasTable = text=>/(?:^|\n)\s*\|[^\n]+\|\s*\n\s*\|[\s:|\-]+\|/.test(text||'');
  if (reader && !reader.querySelector('.md-table')) {
    if (target === 'qbank') {
      const category=qbData.categories.find(category=>category.items.some(item=>hasTable(item.body)));
      if (category) {currentQbCat=category.id;qbSearch='';qbSearchDocument=false;renderQbank();}
    } else if (target === 'company') {
      const prep=prepData.preps.find(prep=>prep.sections?.some(section=>hasTable(section.md)));
      if (prep) openPrep(prep.id);
    } else if (target === 'review') {
      const session=reviewData.sessions.find(session=>hasTable(session.summary?.raw));
      if (session) openReviewSession(session.id);
    }
  }
  const firstTable = reader?.querySelector('.md-table');
  for (let parent=firstTable?.parentElement; parent && parent!==reader; parent=parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
  const markdownTables = [...(reader?.querySelectorAll('.md-table') || [])].filter(el=>el.getBoundingClientRect().width>0).map(el=>({
    wrapper: el.parentElement.className,
    width: el.getBoundingClientRect().width, viewport: el.parentElement.clientWidth,
    scrollWidth: el.parentElement.scrollWidth,
    columns: [...el.rows[0].cells].map(cell=>cell.getBoundingClientRect().width),
    rows: [...el.tBodies[0].rows].map(row=>row.getBoundingClientRect().height),
    display: getComputedStyle(el).display,
    allTextVisible: [...el.querySelectorAll('td')].every(cell=>getComputedStyle(cell).textOverflow!=='ellipsis')
  }));
  const box = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      display: style.display, position: style.position, background: style.backgroundColor};
  };
  const scheduleGeometry = [];
  let refreshStability = null;
  if (target === 'refresh-stability') {
    for (let i=0;i<60 && (workspaceRefreshRunning || workspaceRefreshSnapshots.size<9);i++) await new Promise(resolve=>setTimeout(resolve,100));
    const button = document.getElementById('workspaceRefreshButton');
    const row = document.querySelector('#tableBody tr');
    const mutations = [], samples = [];
    const observer = new MutationObserver(records=>mutations.push(...records.map(record=>({type:record.type,attribute:record.attributeName}))));
    observer.observe(button,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-busy']});
    let checks = 0;
    const previousFetch = window.fetch;
    window.fetch = function (input, ...args) {if(String(input).includes('/api/workspace-changes')) checks++;return previousFetch.call(this,input,...args);};
    try {
      for (let i=0;i<24;i++) {
        samples.push({button:box('#workspaceRefreshButton'),actions:box('.topbar-actions'),content:box('#tableView'),text:button.textContent,disabled:button.disabled});
        await new Promise(resolve=>setTimeout(resolve,400));
      }
    } finally {observer.disconnect();window.fetch=previousFetch;}
    refreshStability = {checks,mutations,samples,rowPreserved:row===document.querySelector('#tableBody tr'),snapshotCount:workspaceRefreshSnapshots.size};
  }
  if (target === 'schedule' || target.startsWith('schedule-')) {
    for (let i=0;i<4;i++) {
      scheduleGeometry.push({canvas:box('#scheduleCalendar'),inspector:box('#scheduleInspector'),events:document.querySelectorAll('[data-schedule-event]').length});
      await new Promise(resolve=>setTimeout(resolve,150));
    }
  }
  const rawErrors = window.__TOUDI_RENDER_ERRORS__ || [];
  // WebKit reports deferred resize notifications through its error event. Keep
  // that warning separately; geometry stability and its bounded count are tested.
  const resizeWarnings = rawErrors.filter(message=>/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\.?$/.test(message));
  const report = {
    path: location.pathname, title: document.title,
    viewport: {width: innerWidth, height: innerHeight},
    ready: document.readyState,
    scripting: typeof switchView === 'function',
    management: !!document.getElementById('recordDataEntry'),
    service: window.__TOUDI_SERVICE__?.mode || null,
    filling, markdownTables, refreshStability, fillingDialog:box('#fillingDialog'), fillingBody:box('.filling-body'),
    sidebar: box('.sidebar'), main: box('.main'), topbar: box('.topbar'), table: box('#tableView'),
    navigation: {sidebarSettings:document.querySelectorAll('.module-nav [data-module="settings"]').length,topSettings:document.querySelectorAll('#settingsShortcut').length,sidebarFilters:document.querySelectorAll('#deliverySearchEntry').length,recordFilter:!!document.getElementById('recordFilterButton'),idleUpdateHidden:document.getElementById('workspaceUpdatesButton')?.hidden,theme:box('.sb-footer .theme-toolbar'),toolbar:box('#dashboardToolbar'),overview:box('#recordsOverview'),tableFrame:box('.table-wrap'),legacyManagement:!!document.getElementById('managementEntry')},
    managementLayout: box('.management-body'), settings: box('#settingsView'),
    theme: document.documentElement.dataset.theme,
    motion: document.documentElement.dataset.motion,
    themeControl: document.querySelector('#themeMenu [aria-checked="true"]')?.dataset.theme || null,
    colorPalette: document.documentElement.dataset.palette,
    paletteControl: document.querySelector('.settings-palettes button[aria-pressed="true"]')?.dataset.value || null,
    settingsOpacity: getComputedStyle(document.querySelector('#settingsView')).opacity,
    brandMatchesD: document.querySelector('.brand-symbol')?.src === "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNjQgNjQiIHJvbGU9ImltZyIgYXJpYS1sYWJlbGxlZGJ5PSJ0aXRsZSI+PHRpdGxlIGlkPSJ0aXRsZSI+VG91RGkg5oqV6YCSPC90aXRsZT48cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSIxNCIgZmlsbD0iIzMxNWY2NSIvPjxwYXRoIGQ9Ik0xNiAyMy41IDQ4IDE1IDM2LjUgNDggMjkgMzRaIiBmaWxsPSIjZjRmOGY2IiBzdHJva2U9IiNmNGY4ZjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxwYXRoIGQ9Ik0yOSAzNCA0NyAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzE1ZjY1IiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPgo=",
    settingsStylesLoaded: !![...document.styleSheets].find(sheet => (sheet.href || '').endsWith('/assets/settings.css')),
    preferences: {
      defaultsAvailable: !!window.__TOUDI_PREFERENCE_DEFAULTS__,
      majorGroups: document.querySelectorAll('#prefIndustries .industry-group').length,
      subdivisions: document.querySelectorAll('#prefIndustries .industry-subgroup').length,
      educationChoices: [...document.querySelectorAll('#prefEducation input[type=checkbox]')].map(el=>el.value),
      dialog: box('#prefModal .pref-dialog'), body: box('#prefModal .pref-dialog-body'), footer: box('#prefModal .modal-actions')
    },
    motionControl: document.querySelector('.settings-segment[data-setting="motion"] button[aria-pressed="true"]')?.dataset.value || null,
    settingsGeometry: [...document.querySelectorAll('.settings-panel:not([hidden]) .setting-row')].map(el=>({height:el.getBoundingClientRect().height,controlHeight:el.querySelector('.setting-control').getBoundingClientRect().height})),
    sidebarSelection: (()=>{const el=document.querySelector('.module-nav button.active');return el?{leftBorder:getComputedStyle(el).borderLeftWidth,background:getComputedStyle(el).backgroundColor}:null})(),
    settingsTabs: [...document.querySelectorAll('.settings-tabs [role="tab"]')].map(el => ({label:el.textContent, selected:el.getAttribute('aria-selected')})),
    visibleSettingsPanels: [...document.querySelectorAll('.settings-panel')].filter(el => !el.hidden).map(el => el.id),
    agentPrivacy: (() => {
      const desktop = window.__TOUDI_DESKTOP__;
      const text = document.getElementById('agentBootstrap')?.value || '';
      const paths = desktop ? [desktop.workspace, desktop.agentTool, desktop.guideRoot].filter(Boolean) : [];
      return {textPresent:!!text, genericOmitsDirectories:paths.every(path => !text.includes(path)),
        singleCopyAction:document.querySelectorAll('#settings-panel-agent [onclick="copyAgentBootstrap()"]').length === 1,
        noLocalCopyAction:!document.querySelector('[onclick="copyAgentBootstrap(true)"]'),
        workflowPresent:['workspace status','preference-catalog','validate','commit','read','刷新资料'].every(step=>text.includes(step))};
    })(),
    rowCount: document.querySelectorAll('#tableBody tr').length,
    activeView: typeof view === 'string' ? view : null,
    counts: {
      records: typeof data !== 'undefined' ? data.length : null,
      categories: typeof qbData !== 'undefined' ? qbData.categories.length : null,
      questions: typeof qbData !== 'undefined' ? qbData.categories.reduce((n,c)=>n+c.items.length,0) : null,
      preps: typeof prepData !== 'undefined' ? prepData.preps.length : null,
      reviews: typeof reviewData !== 'undefined' ? reviewData.sessions.length : null,
      prospects: typeof prospectData !== 'undefined' ? prospectData.prospects.length : null
    },
    schedule: (target === 'schedule' || target.startsWith('schedule-')) ? {canvas:box('#scheduleCalendar'),inspector:box('#scheduleInspector'),events:document.querySelectorAll('[data-schedule-event]').length,title:document.getElementById('scheduleRange')?.textContent,notice:document.getElementById('scheduleNotice')?.textContent,nativeStatus:await window.toudiDesktop.calendar('status'),geometrySamples:scheduleGeometry,monthRows:[...document.querySelectorAll('#scheduleCalendar[data-view="dayGridMonth"] [role="rowgroup"]>[role="row"]:has(>[role="gridcell"][data-date])')].map(el=>({height:el.getBoundingClientRect().height,y:el.getBoundingClientRect().y,cells:el.querySelectorAll('[data-date]').length})),allDay:box('#scheduleCalendar [role="row"]:has(>.schedule-all-day-header)'),more:[...document.querySelectorAll('.schedule-more')].filter(el=>el.getBoundingClientRect().width>0).map(el=>el.textContent)} : null,
    detail: target.startsWith('recruitment-') ? {modal:box('#detailModal .modal'),header:box('.detail-sticky'),body:box('#detailContent'),scrollHeight:document.getElementById('detailContent').scrollHeight,clientHeight:document.getElementById('detailContent').clientHeight,title:document.getElementById('detailTitle').textContent,sections:[...document.querySelectorAll('#detailContent>.detail-section')].map(el=>el.id),materialEntries:[...document.querySelectorAll('[data-material]')].map(el=>({kind:el.dataset.material,label:el.textContent.trim()})),followupExpanded:document.getElementById('detailNotes').open,linkedEvents:document.querySelectorAll('[data-detail-event]').length,calendarAction:box('.detail-entry-actions>button'),recruitmentLinks:document.querySelectorAll('.detail-entry-actions a').length} : null,
    reader: box('#qbMain'), reviewReader: box('#reviewMain'), prospectReader: box('#prospectMain'),
    emptySurface: box('.workspace-empty'),
    readingLayout: box('#qbView .rv-layout, #reviewView .rv-layout, #prospectView .rv-layout'),
    readingPairs: {qbank:{side:box('#qbSide'),main:box('#qbMain')},reviews:{side:box('#rvSide'),main:box('#reviewMain')},prospects:{side:box('#prospectSide'),main:box('#prospectMain')}},
    horizontalOverflow: document.body.scrollWidth > innerWidth,
    cssColor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    styles: document.querySelectorAll('style').length,
    resizeWarnings,
    errors: rawErrors.filter(message=>!resizeWarnings.includes(message))
  };
  window.__TAURI__.core.invoke('native_render_report', {report});
})();
