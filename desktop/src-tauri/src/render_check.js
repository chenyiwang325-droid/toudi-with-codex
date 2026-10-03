/* Read-only native rendering probe. Enabled only by the developer's launch environment. */
(() => {
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
    cssColor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    styles: document.querySelectorAll('style').length,
    errors: window.__TOUDI_RENDER_ERRORS__ || []
  };
  window.__TAURI__.core.invoke('native_render_report', {report});
})();
