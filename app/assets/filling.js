// Reuse the extension standard form against the current App workspace.
(() => {
  if (window.__SNAPSHOT__) return;
  const guide='https://github.com/chenyiwang325-droid/toudi-with-codex/blob/main/docs/辅助填报.md';
  const release='https://github.com/chenyiwang325-droid/toudi-with-codex/releases/latest';
  let dialog,previousFocus;
  async function downloadExtension(){
    try{
      const response=await fetch('/api/filling/extension');
      if(!response.ok)throw Error('扩展导出失败，请通过安装指南下载当前工具包。');
      const blob=await response.blob(),name='TouDi-filling-extension.zip';
      if(window.toudiDesktop){if(!await window.toudiDesktop.saveBlob(blob,name)){status('已取消扩展导出。');return;}}
      else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
      status('扩展已导出。解压后按安装指南加载扩展，并安装浏览器连接组件。');
    }catch(error){status(error.message);}
  }
  function status(message){dialog.querySelector('.filling-head p').textContent=message;}
  async function openExtension(){
    try{
      if(window.__TAURI__)await window.__TAURI__.core.invoke('open_filling');
      else window.open('chrome-extension://edfgnahdkpobmkhckjhadadnlbhpbpmd/options.html','_blank','noopener');
      status('已请求打开 Chrome 中的填报资料与设置。若尚未安装扩展，请按底部安装与连接指南完成首次安装。');
    }catch(e){status(String(e));}
  }
  async function render(){
    const body=dialog.querySelector('.filling-body');
    if(window.__TOUDI_SERVICE__?.mode==='hosted'){
      body.innerHTML='<p>填报资料在本机工作区管理。请打开 TouDi App，或在 Chrome 插件中维护自己的资料。</p>';return;
    }
    body.innerHTML='<p role="status">正在读取当前工作区资料…</p>';
    try{
      const response=await fetch('/browser-extension/options.html');
      if(!response.ok)throw Error('无法加载资料表单，请检查当前版本资源。');
      let html=await response.text();
      html=html.replace('<head>','<head><script src="/assets/profile-workspace.js"></script>');
      // Absolute same-origin URLs also avoid srcdoc speculative preload requests.
      html=html.replace(/\b(src|href)="([^"]+)"/g,(all,attribute,path)=>path.startsWith('/') || path.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(path) ? all : attribute+'="/browser-extension/'+path+'"');
      html=html.replace('</head>','<link rel="stylesheet" href="/assets/filling.css"></head>');
      html=html.replaceAll('这个浏览器中','当前工作区中').replaceAll('插件中的资料副本','当前工作区的资料').replaceAll('插件资料已清除','工作区资料已清除');
      const frame=document.createElement('iframe');frame.className='filling-profile-frame';frame.title='个人填报资料与填写要求';frame.srcdoc=html;
      body.replaceChildren(frame);
    }catch(error){body.textContent=error.message;}
  }
  function close(){
    const editor=dialog.querySelector('iframe')?.contentWindow?.toudiProfileEditor;
    if(editor?.isSaving()){alert('资料正在保存，请稍候再关闭。');return;}
    if(editor?.hasDraft() && !confirm('当前有未保存的编辑内容，关闭将保留已保存资料并丢弃未保存内容。确认关闭？'))return;
    dialog.close();
  }
  window.openFilling=async()=>{
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='filling-dialog';dialog.id='fillingDialog';dialog.setAttribute('aria-labelledby','fillingTitle');
      dialog.innerHTML='<div class="filling-head"><div><h2 id="fillingTitle">辅助填报 · 共享资料</h2><p>个人资料与填写要求在工作区统一保存</p></div><div class="filling-head-actions"><button class="btn btn-sm" id="fillingOpen">Chrome 连接与设置 ↗</button><button class="btn btn-sm" id="fillingClose">关闭</button></div></div><div class="filling-body"></div><footer class="filling-footer"><a class="action-link" href="'+guide+'" target="_blank" rel="noreferrer">安装与连接指南 ↗</a><a class="action-link" href="'+release+'" target="_blank" rel="noreferrer">下载浏览器工具包 ↗</a><button type="button" id="fillingDownload" class="action-link">导出当前扩展</button></footer>';
      document.body.append(dialog);document.getElementById('fillingClose').addEventListener('click',close);
      document.getElementById('fillingOpen').addEventListener('click',openExtension);
      document.getElementById('fillingDownload').hidden=window.__TOUDI_SERVICE__?.mode==='hosted';
      document.getElementById('fillingDownload').addEventListener('click',downloadExtension);
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      dialog.addEventListener('close',()=>previousFocus?.focus());
    }
    previousFocus=document.activeElement;if(!dialog.open){dialog.showModal();await render();}
  };
  function installEntry(){
    if(document.getElementById('fillingEntry'))return true;
    const modules=document.querySelector('.module-nav');
    if(!modules)return false;
    const nav=document.createElement('nav');nav.className='filling-nav';nav.setAttribute('aria-label','扩展功能');
    nav.innerHTML='<span>扩展功能</span><button id="fillingEntry" type="button">辅助填报 <span aria-hidden="true">↗</span></button>';
    modules.after(nav);document.getElementById('fillingEntry').addEventListener('click',window.openFilling);
    return true;
  }
  if(!installEntry()){
    // Desktop initialization waits for the backend before constructing the sidebar.
    const observer=new MutationObserver(()=>{if(installEntry())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
  }
})();
