// Same-origin adapter: the extension's standard form saves into the App workspace.
(() => {
  'use strict';
  if (parent === window || parent.location.origin !== new URL(document.baseURI).origin) throw Error('资料编辑器必须由同源工作台打开。');
  window.__TOUDI_PROFILE_WORKSPACE__ = true;
  document.documentElement.dataset.profileWorkspace='true';
  function syncTheme(){
    const host=parent.document.documentElement,style=parent.getComputedStyle(host),root=document.documentElement;
    for(const [child,source] of Object.entries({bg:'bg',paper:'card',ink:'text',muted:'text3',line:'border','line-soft':'border-light',accent:'primary','accent-ink':'on-primary',tint:'primary-faint',error:'danger'})){
      const value=style.getPropertyValue('--'+source).trim();if(value)root.style.setProperty('--'+child,value);
    }
    root.style.colorScheme=host.dataset.theme==='dark'?'dark':'light';
  }
  syncTheme();
  const themeObserver=new MutationObserver(syncTheme);themeObserver.observe(parent.document.documentElement,{attributes:true,attributeFilter:['data-theme','data-palette']});
  window.addEventListener('pagehide',()=>themeObserver.disconnect());
  // srcdoc has no navigable URL. Tab selection stays inside this embedded form.
  const replaceState = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => {
    if (typeof url === 'string' && url.startsWith('#')) return;
    return replaceState(state, title, url);
  };
  let state = null, preferences = {profile:'general', agentMode:'', agentModel:'', autoAgent:false};
  let dirty = false, pending = false;
  async function request(method, body) {
    const response = await parent.fetch('/api/filling/profile', {method, headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    const value = await response.json();
    if (!response.ok) throw Error(response.status === 409 ? '资料已在另一处更新。当前编辑内容已保留。请先复制未保存内容，再重新打开核对最新资料；导出备份只包含已保存资料。' : (value.error || '工作区资料保存失败。'));
    return value;
  }
  async function dispatch(message) {
    switch (message.op) {
      case 'profile-read': {
        state = await request('GET');
        const valid = state.pack?.profiles?.some(p => p.id === preferences.profile);
        if (!valid && state.pack?.profiles?.length) preferences.profile = state.pack.profiles[0].id;
        return {pack:state.pack, preferences, sync:{status:'synced', enabled:true, workspaceKey:state.workspaceKey}};
      }
      case 'profile-save': {
        if (!state) throw Error('请先读取工作区资料。');
        if ((message.base ?? null) !== (state.pack?.sourceVersion ?? null)) throw Error('当前表单版本已变化，请保留编辑并重新核对。');
        pending = true;
        try {
          state = await request('POST', {workspaceKey:state.workspaceKey, base:state.version, pack:message.pack});
          dirty = false;
          return state.pack;
        } finally { pending = false; }
      }
      case 'preferences':
        if (Object.keys(message.preferences || {}).some(k => k !== 'profile')) throw Error('Agent 协作请在 Chrome 插件中配置。');
        preferences = {...preferences, ...message.preferences}; return preferences;
      case 'state': return {report:null};
      case 'open-workbench': parent.document.getElementById('fillingClose')?.click(); return true;
      default: throw Error('此操作属于 Chrome 插件，请在 Chrome 中打开资料与设置。');
    }
  }
  window.chrome = {runtime:{sendMessage:async message => {try {return {value:await dispatch(message)};} catch(error) {return {error:error.message};}}}};
  window.toudiProfileEditor = {hasDraft:() => dirty || pending, isSaving:() => pending};
  document.addEventListener('input', event => {
    if (event.target.closest('dialog') && !['search','profile'].includes(event.target.id)) dirty = true;
  });
  // Native export awaits the parent's save dialog; cancellation is not success.
  document.addEventListener('click', async event => {
    if (!parent.toudiDesktop || !event.target.closest('#export')) return;
    event.preventDefault();event.stopImmediatePropagation();
    if (pending) return;
    const notice=document.getElementById('notice');
    pending=true;
    try {
      const value=await dispatch({op:'profile-read'});
      if (!value.pack) throw Error('没有可导出的资料。');
      const blob=new Blob([JSON.stringify(value.pack,null,2)],{type:'application/json'});
      const saved=await parent.toudiDesktop.saveBlob(blob,'TouDi-private-profile-'+new Date().toISOString().slice(0,10)+'.json');
      notice.hidden=false;notice.classList.remove('error');notice.textContent=saved ? '私人资料备份已保存。' : '已取消导出，资料保持原样。';
    } catch(error) {notice.hidden=false;notice.textContent='备份未保存：'+error.message;notice.classList.add('error');}
    finally {pending=false;}
  },true);
  window.addEventListener('beforeunload', event => {if(dirty || pending){event.preventDefault();event.returnValue='';}});
  document.addEventListener('DOMContentLoaded', () => {
    const agent = document.getElementById('tab-agent'); agent.hidden=true; agent.removeAttribute('role'); agent.dataset.tab='profile';
    document.getElementById('workspaceSync')?.closest('.subsection')?.setAttribute('hidden','');
    document.getElementById('lastReport')?.closest('.subsection')?.setAttribute('hidden','');
    document.getElementById('deleteProfile')?.closest('details')?.setAttribute('hidden','');
    document.getElementById('openWorkbench').hidden=true;
    document.querySelector('.brand small').textContent='当前正式工作区 · 与 Chrome 共享资料';
    document.querySelector('.intro p').textContent='这里的修改直接保存到工作区，已连接的 Chrome 插件使用同一份资料。';
    document.querySelector('#panel-data > .section-intro').textContent='资料保存在当前正式工作区。可导入资料或导出备份。';
    document.querySelector('#panel-data > .section-note').textContent='Chrome 连接工作区后同步更新。导入资料包会替换当前工作区资料，请先备份。';
  });
})();
