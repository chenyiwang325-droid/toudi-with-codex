// Local application fields stay separate from display and job-preference settings.
(() => {
  if (window.__SNAPSHOT__ || window.__TOUDI_SERVICE__?.mode === 'hosted') return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dialog, previousFocus;
  async function request(path = '', payload) {
    const response = await fetch('/api/filling' + path, payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : undefined);
    const body = await response.json();
    if (!response.ok) throw Error(body.error || '辅助填报暂时不可用');
    return body;
  }
  function status(text) {const target=document.getElementById('fillingStatus');if(target)target.textContent=text;}
  async function copyCode(reset = false) {
    try {
      const value = await request('/connect', {reset});
      try {await navigator.clipboard.writeText(value.connection);status(reset ? '旧连接码已失效；新的连接码已复制。' : '连接码已复制，在 Chrome 扩展中粘贴即可。');}
      catch (_) {const box=document.createElement('textarea');box.className='filling-token';box.value=value.connection;box.readOnly=true;box.setAttribute('aria-label','本机浏览器连接码');document.getElementById('fillingConnection').append(box);box.select();status('请复制选中的连接码，在扩展中粘贴。');}
    } catch(e) {status(e.message);}
  }
  async function downloadExtension() {
    try {
      status('正在打包本地扩展…');
      const response = await fetch('/api/filling/extension');
      if (!response.ok) throw Error('浏览器扩展未能生成');
      const blob = await response.blob();
      if (window.toudiDesktop) {await window.toudiDesktop.saveBlob(blob,'TouDi-filling-pilot.zip');}
      else {const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='TouDi-filling-pilot.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
      status('扩展已生成。解压后，在 Chrome 扩展页选择解压目录 TouDi-filling。');
    } catch(e) {status(e.message);}
  }
  async function enableChrome() {
    try {
      status('正在启用 Chrome 连接…');
      await request('/chrome', {enable:true});
      document.getElementById('fillingChrome').textContent='Chrome 连接已启用';
      status('已启用。打开 Chrome 网申页面，点击插件即可；之后自动读取当前工作区，无需复制连接码。');
    } catch(e) {status(e.message);}
  }
  async function render(profile = 'general') {
    const body = dialog.querySelector('.filling-body');
    body.innerHTML='<p role="status">正在读取本机填报资料…</p>';
    try {
      const data = await request('?profile=' + encodeURIComponent(profile));
      const modules={personal:'个人',education:'教育',internship:'实习',project:'项目',language:'语言'};
      const report=data.lastReport;
      body.innerHTML=`<div class="filling-grid"><section class="filling-source"><h3>${data.available?'已有填报资料':'提供你的填报资料'}</h3><p class="filling-source-name">${escape(data.sourceName || '网申信息库.json / 填报资料/资料.json')}</p>${data.available?`<p>直接读取原资料；每次识别都核对当前版本。</p><label for="fillingProfile">预览简历口径</label><select id="fillingProfile">${data.profiles.map(p=>`<option value="${escape(p.id)}" ${p.id===profile?'selected':''}>${escape(p.label)}</option>`).join('')}</select><div class="filling-tags">${Object.entries(data.counts || {}).map(([module,count])=>`<span>${modules[module]||module} · ${count} 项</span>`).join('')}</div>`:'<p>让 Agent 按已确认的简历整理字段及填写规则。资料文件放在正式工作区，填写内容保留原始来源。</p>'}<p class="filling-note">填写前先选择对应简历口径。上传、协议和不确定项保留人工核对。</p><div class="filling-warnings">${(data.warnings||[]).map(value=>`<div>${escape(value)}</div>`).join('')}</div></section><section id="fillingConnection"><h3>在 Chrome 中开始</h3><ol class="filling-instructions"><li>安装本地扩展<small>下载并解压扩展。在 Chrome 的扩展管理页开启开发者模式，选择「加载已解压的扩展程序」，打开 TouDi-filling 文件夹。</small></li><li>${data.chromeConnection?.available?'启用 Chrome 自动连接':'首次连接资料'}<small>${data.chromeConnection?.available?'点击「启用 Chrome 连接」。安装后插件自动识别当前工作区；日常只需保持 App 打开，在 Chrome 使用插件。':'源码服务请复制一次连接码并在插件中粘贴。日常在 Chrome 识别和填写，无需在中控台打开招聘页面。'}</small></li><li>打开网申表单并核对计划<small>点击扩展，选择简历口径，识别当前页面。默认只填写空白字段；需要覆盖的内容由你逐项选择。</small></li><li>查看核验结果，再保存与提交<small>每项填入后再次读取检查。网站保存草稿和最终提交由你操作。</small></li></ol><div class="filling-actions"><button class="btn" id="fillingDownload">下载扩展</button>${data.chromeConnection?.available?`<button class="btn" id="fillingChrome">${data.chromeConnection.enabled?'Chrome 连接已启用':'启用 Chrome 连接'}</button>`:''}</div><details><summary>连接码与重置（兼容源码服务）</summary><div class="filling-actions"><button class="btn" id="fillingCopy">复制连接码</button><button class="btn" id="fillingReset">重置连接</button></div></details><div id="fillingStatus" class="filling-status" role="status"></div></section></div>${data.rules?.length?`<details class="filling-rules"><summary>资料中的填写规则 · ${data.rules.length} 条</summary><ol>${data.rules.map(value=>`<li>${escape(value)}</li>`).join('')}</ol></details>`:''}<section class="filling-report"><h3>最近核验</h3>${report?`<p>${escape(report.origin)} · ${new Date(report.checkedAt*1000).toLocaleString('zh-CN')}</p><p>读回一致 ${report.summary.verified} 项 · 未通过 ${report.summary.failed} 项 · 变更冲突 ${report.summary.conflict} 项 · 人工操作 ${report.summary.manual} 项</p><p>剩余待核对 ${report.pending.length} 项。网站保存状态尚未确认；未提交申请。</p>`:'<p>完成填写后，这里显示核验摘要。报告只保存字段状态和资料键，不保存个人字段值。</p>'}</section>`;
      document.getElementById('fillingProfile')?.addEventListener('change',event=>render(event.target.value));
      document.getElementById('fillingCopy').addEventListener('click',()=>copyCode());
      document.getElementById('fillingReset').addEventListener('click',()=>copyCode(true));
      document.getElementById('fillingDownload').addEventListener('click',downloadExtension);
      document.getElementById('fillingChrome')?.addEventListener('click',enableChrome);
    } catch(e) {body.innerHTML=`<p role="alert">${escape(e.message)}</p><p>请使用包含辅助填报功能的新版 App；资料仍保留在原工作区。</p>`;}
  }
  window.openFilling = async () => {
    if (!dialog) {
      dialog=document.createElement('dialog');dialog.className='filling-dialog';dialog.id='fillingDialog';dialog.setAttribute('aria-labelledby','fillingTitle');
      dialog.innerHTML='<div class="filling-head"><div><h2 id="fillingTitle">辅助填报</h2><p>资料核对 → 填写计划 → 读回核验</p></div><button class="btn btn-sm" id="fillingClose">关闭</button></div><div class="filling-body"></div>';
      document.body.append(dialog);document.getElementById('fillingClose').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('close',()=>previousFocus?.focus());
    }
    previousFocus=document.activeElement;dialog.showModal();await render();
  };
  const toolbar=document.querySelector('.topbar-actions');
  if(toolbar){const button=document.createElement('button');button.className='btn btn-sm';button.id='fillingEntry';button.textContent='辅助填报';button.addEventListener('click',window.openFilling);toolbar.append(button);}
})();
