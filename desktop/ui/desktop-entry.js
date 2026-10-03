/* Load data as JSON; the complete UI remains a Tauri-managed bundled document. */
window.__TOUDI_RENDER_ERRORS__ = [];
window.addEventListener('error', event => {
  const message = event.message || '资源未能加载';
  if (window.__TOUDI_RENDER_ERRORS__.length < 30) window.__TOUDI_RENDER_ERRORS__.push(message);
});
document.addEventListener('securitypolicyviolation', event => {
  if (window.__TOUDI_RENDER_ERRORS__.length < 30)
    window.__TOUDI_RENDER_ERRORS__.push('CSP: ' + event.effectiveDirective + ' ' + event.blockedURI);
});
window.__TOUDI_DESKTOP_READY__ = (async () => {
  const context = await window.__TAURI__.core.invoke('desktop_context');
  if (context.error) throw Error(context.error);
  window.__TOUDI_DESKTOP__ = context;
  const response = await fetch('/api/manage?module=records');
  if (!response.ok) throw Error('投递资料暂时无法读取，请保留工作区并重开应用。');
  const result = await response.json();
  if (!Array.isArray(result.data)) throw Error('投递资料格式不匹配，请保留工作区并检查。');
  window.__TOUDI_INITIAL_RECORDS__ = result.data;
})();
window.toudiDesktopStartupError = error => {
  const panel = document.createElement('section');
  panel.setAttribute('role', 'alert');
  panel.className = 'desktop-startup-error';
  const title = document.createElement('h2');
  title.textContent = '工作台未能打开，已保存的资料仍保留。';
  const message = document.createElement('p');
  message.textContent = String(error);
  const retry = document.createElement('button');
  retry.className = 'btn'; retry.textContent = '重新打开';
  retry.addEventListener('click', () => location.replace('/index.html'));
  const choose = document.createElement('button');
  choose.className = 'btn'; choose.textContent = '选择已有工作区';
  choose.addEventListener('click', () => window.toudiDesktop.selectWorkspace().catch(e => {
    message.textContent = String(e);
  }));
  panel.append(title, message, retry, choose); document.body.prepend(panel);
};
