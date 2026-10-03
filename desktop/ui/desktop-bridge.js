/* Keep the shipped HTML unchanged: the app supplies only its transport and OS integration. */
(() => {
  const invoke = window.__TAURI__.core.invoke;
  const originalFetch = window.fetch.bind(window);
  window.__TOUDI_SERVICE__ = {mode: 'desktop'};
  window.fetch = async (input, options = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, options);
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = options.body === undefined ? null : String(options.body);
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await invoke('backend_request', {path: url.pathname + url.search, method, body});
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const bytes = Uint8Array.from(atob(result.contentBase64), c => c.charCodeAt(0));
    return new Response(bytes, {status: result.status, headers: result.headers});
  };
  document.addEventListener('click', async event => {
    const link = event.target.closest('a');
    if (!link || event.defaultPrevented) return;
    const url = new URL(link.href, location.href);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol) && url.origin !== location.origin) {
      event.preventDefault();
      try {await invoke('open_external', {url: url.href});} catch (e) {window.showToast?.('链接未能打开：' + e);}
    } else if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      event.preventDefault();
      try {
        const response = await fetch(url.href);
        if (!response.ok) throw Error('附件暂时无法读取');
        const content = new Uint8Array(await response.arrayBuffer());
        const name = url.searchParams.get('path')?.split('/').pop() || 'TouDi-资料';
        let binary = ''; for (const byte of content) binary += String.fromCharCode(byte);
        await invoke('save_file', {name, contentBase64: btoa(binary)});
      } catch (e) {window.showToast?.(String(e));}
    }
  });
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) {
      const anchor = this;
      originalFetch(anchor.href).then(r => r.arrayBuffer()).then(buffer => {
        const bytes = new Uint8Array(buffer); let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return invoke('save_file', {name: anchor.download || 'TouDi-导出', contentBase64: btoa(binary)});
      }).catch(e => window.showToast?.('导出未完成：' + e));
      return;
    }
    return originalClick.call(this);
  };
  window.toudiDesktop = {
    showWorkspace: () => invoke('show_workspace'),
    exportReading: () => invoke('export_reading'),
    saveBlob: async (blob, name) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
      return invoke('save_file', {name, contentBase64: btoa(chunks.join(''))});
    },
    version: window.__TOUDI_DESKTOP__?.version || '0.2.0'
  };
})();
