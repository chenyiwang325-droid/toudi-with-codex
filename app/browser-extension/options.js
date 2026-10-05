'use strict';
const el=id=>document.getElementById(id);
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modules={personal:'个人信息',education:'教育经历',internship:'实习／工作',project:'项目经历',language:'语言能力'};
let currentPack=null, pref=TouDiAgentConfig.normalize(), editingKey=null, saving=false;
const openRecords=new Set();
let recordsInitialized=false;
function disclosureAction(){return '<span class="disclosure-action" aria-hidden="true"><span class="when-closed">展开</span><span class="when-open">收起</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 5 7 7-7 7"/></svg></span>';}
function selectTab(key,focus=false){
  if(!['profile','rules','agent','data'].includes(key))key='profile';
  history.replaceState(null,'','#'+key);
  document.querySelectorAll('.settings-tabs [role=tab]').forEach(button=>{const selected=button.dataset.tab===key;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();});
  document.querySelectorAll('main > .settings-panel').forEach(panel=>panel.hidden=panel.id!=='panel-'+key);
}
document.querySelector('.settings-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button)selectTab(button.dataset.tab);});
document.querySelector('.settings-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=[...document.querySelectorAll('.settings-tabs [role=tab]')],index=tabs.indexOf(event.target);if(index<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTab(tabs[next].dataset.tab,true);
});
document.querySelector('label[for=importFile]').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();el('importFile').click();}});
async function send(op,data={}) {const result=await chrome.runtime.sendMessage({op,...data});if(result?.error)throw Error(result.error);return result.value;}
function notice(message,error=false) {el('notice').hidden=!message;el('notice').textContent=message;el('notice').classList.toggle('error',error);}
async function action(fn) {if(saving)return;saving=true;try{await fn();}catch(e){notice(e.message,true);if(el('editor').open){el('editorError').hidden=false;el('editorError').textContent=e.message;}}finally{saving=false;}}
async function reload() {const value=await send('profile-read');currentPack=value.pack;pref=value.preferences;el('profile').value=pref.profile;syncAgentSettings();render();}
async function save(candidate,imported=false) {await send('profile-save',{pack:candidate,base:currentPack?.sourceVersion || null,imported});await reload();}
function dateLabel(value){if(!value)return '未注明';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(date);}
function emptyPack() {return {schemaVersion:1,name:'个人填报资料',savedAt:null,facts:[],rules:[],warnings:[],supplements:[]};}
function render() {
  el('export').disabled=!currentPack;el('addFact').disabled=false;el('editRules').disabled=false;el('deleteProfile').disabled=!currentPack;
  document.querySelectorAll('[data-profile]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.profile===el('profile').value)));
  if(!currentPack){el('facts').innerHTML='<div class="empty"><strong>尚未保存资料</strong><p>导入私人资料包，或点击「添加字段」手动建立资料。</p></div>';el('factCount').textContent='当前口径 0 项';el('source').innerHTML='<p>尚未保存资料。</p>';el('rules').innerHTML='<p>尚未保存额外填写要求。</p>';return;}
  const find=el('search').value.trim().toLowerCase(), id=el('profile').value;
  const facts=TouDiFillingCore.profile(currentPack,id).facts.filter(f=>!find || [f.label,f.recordLabel,f.recordHint,...f.aliases].join(' ').toLowerCase().includes(find));
  const groups=new Map();
  for(const mod of Object.keys(modules))for(const fact of facts.filter(f=>f.module===mod)) {const key=mod+'|'+fact.recordId;if(!groups.has(key))groups.set(key,{label:modules[mod]+(fact.recordLabel?' · '+fact.recordLabel:''),facts:[]});groups.get(key).facts.push(fact);}
  if(!recordsInitialized && groups.size){openRecords.add(groups.keys().next().value);recordsInitialized=true;}
  const total=currentPack.facts.filter(f=>f.profiles.includes(id)).length;
  el('factCount').textContent=`当前口径 ${total} 项${find?' · 搜索结果 '+facts.length+' 项':''}`;
  el('facts').innerHTML=facts.length?[...groups.entries()].map(([key,group])=>`<details class="record" data-record="${esc(key)}" ${find||openRecords.has(key)?'open':''}><summary><span class="record-title">${esc(group.label)}</span><span class="record-meta"><small>${group.facts.length} 项</small>${disclosureAction()}</span></summary>${group.facts.map(f=>`<div class="fact"><div class="fact-name">${esc(f.label)}${f.manual?'<div class="hint">人工确认</div>':''}</div><div class="fact-value">${esc(f.value)}</div><button data-edit="${esc(f.key)}" aria-label="编辑${esc(f.label)}">编辑</button></div>`).join('')}</details>`).join(''):'<div class="empty"><strong>此口径没有匹配资料</strong><p>切换查看口径，或添加适用于此方向的字段。</p></div>';
  el('facts').querySelectorAll('.record').forEach(record=>record.addEventListener('toggle',()=>{if(!record.isConnected || el('search').value.trim())return;if(record.open)openRecords.add(record.dataset.record);else openRecords.delete(record.dataset.record);}));
  el('source').innerHTML=`<dl><dt>来源</dt><dd>${esc(currentPack.sourceName)}</dd><dt>更新</dt><dd>${esc(dateLabel(currentPack.savedAt))}</dd><dt>导入</dt><dd>${esc(dateLabel(currentPack.importedAt))}</dd><dt>版本</dt><dd>${esc(currentPack.sourceVersion.slice(0,12))}</dd><dt>资料</dt><dd>${currentPack.facts.length} 项 · 当前口径 ${currentPack.facts.filter(f=>f.profiles.includes(id)).length} 项</dd></dl>`;
  el('rules').innerHTML=currentPack.rules.length?'<ol>'+currentPack.rules.map(r=>`<li>${esc(r)}</li>`).join('')+'</ol>':'<p>尚未保存额外填写要求。</p>';
}
el('importFile').addEventListener('change',()=>action(async()=>{
  const file=el('importFile').files[0];if(!file)return;
  try {
    if(file.size>5*1024*1024)throw Error('资料包超过 5 MB，请仅保留结构化填写资料。');
    const candidate=JSON.parse(await file.text());
    if(currentPack && !confirm('导入会替换插件中的资料副本。请确认已经导出需要保留的本地修改。'))return;
    await save(candidate,true);notice(`资料已导入：${currentPack.facts.length} 项。请核对简历口径和填写规则，再回到招聘网页识别。`);
  } finally {el('importFile').value='';}
}));
el('export').addEventListener('click',()=>action(async()=>{
  const value=await send('profile-read');if(!value.pack)throw Error('没有可导出的资料。');
  const blob=new Blob([JSON.stringify(value.pack,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=url;anchor.download='TouDi-private-profile-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notice('私人资料包已导出。文件包含个人信息，请保存在自己的资料目录。');
}));
async function chooseProfile(value){
  if(saving || !['general','state','ai-product'].includes(value))return;
  await action(async()=>{const before=pref.profile;el('profile').value=value;render();try{pref=await send('preferences',{preferences:{profile:value}});}catch(e){el('profile').value=before;render();throw e;}});
}
document.querySelectorAll('[data-profile]').forEach(button=>button.addEventListener('click',()=>chooseProfile(button.dataset.profile)));
el('profile').addEventListener('change',()=>chooseProfile(el('profile').value));el('search').addEventListener('input',render);
let modelCatalog=[];
function renderAgentRoute(){
  const codex=el('agentMode').value==='codex';
  el('codexSettings').hidden=!codex;el('externalSettings').hidden=el('agentMode').value!=='external';
  el('autoAgent').disabled=!codex || !el('agentModel').value;
}
function syncAgentSettings(){
  el('agentMode').value=pref.agentMode;
  el('agentModel').replaceChildren(new Option('选择核对模型…',''));
  const models=[...modelCatalog];if(pref.agentModel && !models.some(m=>m.id===pref.agentModel))models.push({id:pref.agentModel,label:pref.agentModel+'（已保存，连接待检查）'});
  for(const model of models)el('agentModel').add(new Option(model.label+' · '+model.id,model.id));
  el('agentModel').value=pref.agentModel;el('autoAgent').checked=pref.autoAgent;
  el('agentSummary').textContent=pref.agentMode==='codex' ? '已保存：本机 Codex · '+(pref.agentModel || '模型待选择') : pref.agentMode==='external' ? '已保存：自己的 Agent · 复制任务与导入结果' : '尚未配置 Agent；本地识别与填写可用。';
  renderAgentRoute();
}
el('agentMode').addEventListener('change',renderAgentRoute);
el('agentModel').addEventListener('change',renderAgentRoute);
el('saveAgent').addEventListener('click',()=>action(async()=>{
  const agentMode=el('agentMode').value,agentModel=agentMode==='codex'?el('agentModel').value:'';
  if(agentMode==='codex' && !agentModel)throw Error('请检查连接并明确选择一个模型，再保存。');
  pref=await send('preferences',{preferences:{agentMode,agentModel,autoAgent:agentMode==='codex' && el('autoAgent').checked}});
  syncAgentSettings();notice('协作设置已保存。返回招聘网页重新识别后生效。');
}));
el('checkCodex').addEventListener('click',()=>action(async()=>{
  el('checkCodex').disabled=true;el('codexStatus').textContent='正在检查本机连接、ChatGPT 登录与模型目录…';
  try{
    const status=await send('codex-status');if(!status.available || status.auth!=='chatgpt')throw Error(status.message);
    modelCatalog=status.models;const selected=el('agentModel').value;
    el('agentModel').replaceChildren(new Option('选择核对模型…',''));
    for(const model of modelCatalog)el('agentModel').add(new Option(model.label+' · '+model.id,model.id));
    el('agentModel').value=modelCatalog.some(m=>m.id===selected)?selected:'';
    el('codexStatus').textContent='ChatGPT 登录已确认 · '+modelCatalog.length+' 个目录模型。请自行选择，实际调用是否可用以核对结果为准。';
    renderAgentRoute();notice('连接检查完成，没有发起模型生成。选择模型后保存。');
  }catch(e){el('codexStatus').textContent=e.message;throw e;}finally{el('checkCodex').disabled=false;}
}));
el('openWorkbench').addEventListener('click',()=>action(async()=>{await send('open-workbench');notice('投递中控台已打开。招聘网页的填写仍在插件内完成。');}));
window.addEventListener('hashchange',()=>selectTab(location.hash.slice(1)));
selectTab(location.hash.slice(1));
function openEditor(key=null) {
  editingKey=key;const fact=currentPack?.facts.find(f=>f.key===key);
  el('editForm').reset();el('matchingOptions').open=false;el('editor').querySelector('.dialog-body').scrollTop=0;el('editorError').hidden=true;el('editorTitle').textContent=fact?'编辑已确认资料':'添加已确认字段';
  el('factKey').value=key || '';el('factLabel').value=fact?.label || '';el('factValue').value=fact?.value ?? '';el('factModule').value=fact?.module || 'personal';el('factPrecision').value=fact?.precision || '';el('recordId').value=fact?.recordId || '';el('recordLabel').value=fact?.recordLabel || '';el('recordHint').value=fact?.recordHint || '';el('factAliases').value=(fact?.aliases || []).join('\n');el('factSensitive').checked=fact?.sensitive || false;el('factManual').checked=fact?.manual || false;el('gpaScale').value=fact?.gpaScale || '';
  el('dateFallback').value=fact?.dateFallback || '';syncDatePolicy();
  const profiles=fact?.profiles || (el('profile').value==='general'?['general','state','ai-product']:[el('profile').value]);
  document.querySelectorAll('[name=factProfiles]').forEach(n=>n.checked=profiles.includes(n.value));el('removeFact').hidden=!fact;el('editor').showModal();
}
el('addFact').addEventListener('click',()=>openEditor());el('facts').addEventListener('click',event=>{const button=event.target.closest('[data-edit]');if(button)openEditor(button.dataset.edit);});el('closeEditor').addEventListener('click',()=>el('editor').close());
function syncDatePolicy(){el('ongoingPolicy').hidden=!TouDiFillingCore.ongoingEnd({module:el('factModule').value,label:el('factLabel').value.trim(),value:el('factValue').value.trim()});}
for(const id of ['factModule','factLabel','factValue'])el(id).addEventListener('input',syncDatePolicy);
el('editForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const candidate=structuredClone(currentPack || emptyPack()), old=candidate.facts.find(f=>f.key===editingKey);
  const label=el('factLabel').value.trim(), mod=el('factModule').value;
  const fact={...old,key:editingKey || mod+'.manual-'+crypto.randomUUID(),label,value:el('factValue').value,module:mod,recordId:el('recordId').value.trim(),recordLabel:el('recordLabel').value.trim(),recordHint:el('recordHint').value.trim(),aliases:el('factAliases').value.split('\n').map(s=>s.trim()).filter(Boolean),profiles:[...document.querySelectorAll('[name=factProfiles]:checked')].map(n=>n.value),sensitive:el('factSensitive').checked,manual:el('factManual').checked,precision:el('factPrecision').value || null,gpaScale:el('gpaScale').value || null};
  delete fact.ongoing;delete fact.dateFallback;
  if(TouDiFillingCore.ongoingEnd(fact)){fact.ongoing=true;fact.precision=null;if(el('dateFallback').value)fact.dateFallback=el('dateFallback').value;}
  if(!fact.aliases.length)delete fact.aliases;
  if(['education','internship','project'].includes(mod) && (!fact.recordId || !fact.recordLabel))throw Error('经历资料需要填写标识和名称，才能正确区分不同记录。');
  if(old)candidate.facts[candidate.facts.indexOf(old)]=fact;else candidate.facts.push(fact);
  openRecords.add(fact.module+'|'+fact.recordId);
  try {await save(candidate);el('editor').close();notice('资料已保存，旧填写计划已失效。请重新识别网页。');}catch(e){el('editorError').hidden=false;el('editorError').textContent=e.message;throw e;}
});});
el('removeFact').addEventListener('click',()=>action(async()=>{if(!confirm('删除这个字段？其余资料保留。'))return;const candidate=structuredClone(currentPack);candidate.facts=candidate.facts.filter(f=>f.key!==editingKey);await save(candidate);el('editor').close();notice('字段已删除。');}));
el('editRules').addEventListener('click',()=>{el('rulesText').value=(currentPack?.rules || []).join('\n');el('rulesEditor').showModal();});el('closeRules').addEventListener('click',()=>el('rulesEditor').close());el('rulesForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const candidate=structuredClone(currentPack || emptyPack());candidate.rules=el('rulesText').value.split('\n').map(s=>s.trim()).filter(Boolean);await save(candidate);el('rulesEditor').close();notice('填写规则已保存。');});});
el('deleteProfile').addEventListener('click',()=>action(async()=>{if(!confirm('清除本浏览器的私人资料、字段匹配和最近核验？原始资料文件不会被修改。'))return;await send('profile-delete');await reload();el('source').innerHTML='<p>本地资料已清除。</p>';el('rules').innerHTML='<p>尚无填写规则。</p>';el('lastReport').innerHTML='<p>尚无核验记录。</p>';notice('插件资料已清除。');}));
action(async()=>{await reload();const value=await send('state');if(value.lastReport){const r=value.lastReport;el('lastReport').innerHTML=`<p>${esc(r.origin)}</p><p>${r.summary?.verified || 0} 项核验通过 · ${r.summary?.failed || 0} 项未通过</p><p class="hint">${esc(dateLabel(r.checkedAt))} · 网站保存未确认</p>`;}});
