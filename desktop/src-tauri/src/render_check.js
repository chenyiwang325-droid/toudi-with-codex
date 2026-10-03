/* Read-only native rendering probe. Enabled only by the developer's launch environment. */
(async () => {
  const target = window.__TOUDI_DIAG_VIEW__;
  if (target && typeof switchView === 'function') {
    const module = target === 'company' ? 'qbank' : target;
    if (typeof ensureViewData === 'function') await ensureViewData(module);
    switchView(module);
    if (target === 'company') switchPrepMode('company');
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  const box = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      display: style.display, position: style.position, background: style.backgroundColor};
  };
  const report = {
    path: location.pathname, title: document.title,
    viewport: {width: innerWidth, height: innerHeight},
    ready: document.readyState,
    scripting: typeof switchView === 'function',
    management: !!document.getElementById('managementEntry'),
    service: window.__TOUDI_SERVICE__?.mode || null,
    sidebar: box('.sidebar'), main: box('.main'), topbar: box('.topbar'), table: box('#tableView'),
    managementLayout: box('.management-body'), settings: box('#settingsView'),
    theme: document.documentElement.dataset.theme,
    motion: document.documentElement.dataset.motion,
    themeControl: document.querySelector('select[aria-label="主题"]')?.value || null,
    motionControl: document.querySelector('select[aria-label="切换反馈"]')?.value || null,
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
    reader: box('#qbMain'), reviewReader: box('#reviewMain'), prospectReader: box('#prospectMain'),
    emptySurface: box('.workspace-empty'),
    readingLayout: box('#qbView .rv-layout, #reviewView .rv-layout, #prospectView .rv-layout'),
    readingPairs: {qbank:{side:box('#qbSide'),main:box('#qbMain')},reviews:{side:box('#rvSide'),main:box('#reviewMain')},prospects:{side:box('#prospectSide'),main:box('#prospectMain')}},
    horizontalOverflow: document.body.scrollWidth > innerWidth,
    cssColor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    styles: document.querySelectorAll('style').length,
    errors: window.__TOUDI_RENDER_ERRORS__ || []
  };
  window.__TAURI__.core.invoke('native_render_report', {report});
})();
