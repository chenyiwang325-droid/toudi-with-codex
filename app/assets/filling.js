// Browser filling is an extension of the workbench, with an explicit private-data handoff.
(() => {
  if (window.__SNAPSHOT__) return;
  const guide='https://github.com/chenyiwang325-droid/toudi-workbench/blob/main/docs/辅助填报.md';
  const release='https://github.com/chenyiwang325-droid/toudi-workbench/releases/latest';
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dialog,previousFocus;
  function status(message){document.getElementById('fillingStatus').textContent=message;}
  async function download(path,name){
    try{
      const response=await fetch('/api/filling/'+path);
      if(!response.ok)throw Error('未能导出；请先确认工作区中的填报资料。');
      const blob=await response.blob();
      if(window.toudiDesktop)await window.toudiDesktop.saveBlob(blob,name);
      else {const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
      status(path==='extension'?'扩展已导出。解压后在 Chrome 扩展页加载 TouDi-filling 文件夹。':'私人资料包已导出。到插件「资料与设置」导入；后续原始资料更新时再导入新版。');
    }catch(e){status(e.message);}
  }
  async function openExtension(){
    try{
      if(window.__TAURI__)await window.__TAURI__.core.invoke('open_filling');
      else window.open('chrome-extension://edfgnahdkpobmkhckjhadadnlbhpbpmd/options.html','_blank','noopener');
      status('已请求打开 Chrome 中的填报资料与设置。若尚未安装扩展，请按下方安装指南完成首次安装。');
    }catch(e){status(String(e));}
  }
  async function render(){
    const body=dialog.querySelector('.filling-body');
    let data={available:false};
    if(window.__TOUDI_SERVICE__?.mode!=='hosted'){
      try{const response=await fetch('/api/filling');if(response.ok)data=await response.json();}catch(_){}
    }
    const modules={personal:'个人',education:'教育',internship:'实习／工作',project:'项目',language:'语言'};
    body.innerHTML=`<div class="filling-grid"><section class="filling-source"><h3>在 Chrome 中填写</h3><p>打开招聘网页，点击 TouDi 插件，识别字段、核对计划、填写并读回。个人资料和 Agent 设置保存在扩展本地。</p><div class="filling-actions"><button class="btn" id="fillingOpen">打开填报资料与设置 ↗</button></div><p class="filling-handoff">中控台管理投递进度；扩展负责网页填写。两边可以独立使用。</p><h3>从工作区准备资料</h3>${data.available?`<div class="filling-tags">${Object.entries(data.counts || {}).map(([key,count])=>`<span>${modules[key] || escape(key)} · ${count} 项</span>`).join('')}</div><p>导出已确认的私人资料，在扩展中导入即可开始。扩展内的修改保留在浏览器，不自动覆盖工作区母本。</p><button class="btn" id="fillingExport">导出私人填报资料</button>`:'<p>让自己的 Agent 按简历整理字段与填写要求，或在扩展内填写标准表单。资料发生变化时，显式导入新版。</p>'}</section><section><h3>首次使用</h3><ol class="filling-instructions"><li>安装浏览器扩展<small>下载工具包，解压后在 Chrome 扩展页加载 TouDi-filling 文件夹，并固定到工具栏。</small></li><li>导入或建立个人资料<small>在「资料与设置」填写标准表单或导入资料，整段添加教育、工作和项目；未确认的内容留空。</small></li><li>自行配置 Agent 协作<small>选择本机 Codex 与具体模型，或通过复制任务接入自己的 Agent。基本识别与填写不需要模型。</small></li><li>回到招聘网页开始填写<small>确认字段后填写、查阅核验结果。网站保存、附件、协议和最终提交由你操作。</small></li></ol><div class="filling-actions"><a class="btn" href="${guide}" target="_blank" rel="noreferrer">安装与使用指南 ↗</a><a class="btn" href="${release}" target="_blank" rel="noreferrer">下载浏览器工具包 ↗</a></div>${window.__TOUDI_SERVICE__?.mode==='hosted'?'':'<p><button class="filling-text-link" id="fillingDownload">从当前版本导出扩展</button></p>'}</section></div><div id="fillingStatus" class="filling-status" role="status"></div>`;
    document.getElementById('fillingOpen').addEventListener('click',openExtension);
    document.getElementById('fillingExport')?.addEventListener('click',()=>download('profile-export','TouDi-private-profile.json'));
    document.getElementById('fillingDownload')?.addEventListener('click',()=>download('extension','TouDi-filling-extension.zip'));
  }
  window.openFilling=async()=>{
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='filling-dialog';dialog.id='fillingDialog';dialog.setAttribute('aria-labelledby','fillingTitle');
      dialog.innerHTML='<div class="filling-head"><div><h2 id="fillingTitle">辅助填报 · 浏览器扩展</h2><p>投递中控台的延伸功能</p></div><button class="btn btn-sm" id="fillingClose">关闭</button></div><div class="filling-body"></div>';
      document.body.append(dialog);document.getElementById('fillingClose').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('close',()=>previousFocus?.focus());
    }
    previousFocus=document.activeElement;if(!dialog.open)dialog.showModal();await render();
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
