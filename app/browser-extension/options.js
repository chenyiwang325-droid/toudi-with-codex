'use strict';
const el=id=>document.getElementById(id);
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const L=TouDiProfileLibrary,C=TouDiFillingCore;
const modules=Object.fromEntries(Object.entries(L.templates).map(([key,t])=>[key,t.label]));
let workspaceSync={status:"disconnected"};
let currentPack=null,pref=TouDiAgentConfig.normalize(),editingKey=null,recordDraft=null,saving=false,recordInitialProfiles=[];
const openRecords=new Set();let recordsInitialized=false;
const pack=()=>currentPack || L.emptyPack();
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

async function send(op,data={}){const result=await chrome.runtime.sendMessage({op,...data});if(result?.error)throw Error(result.error);return result.value;}
function notice(message,error=false){el('notice').hidden=!message;el('notice').textContent=message;el('notice').classList.toggle('error',error);}
async function action(fn){
  if(saving)return;saving=true;
  try{await fn();}catch(e){notice(e.message,true);for(const [dialog,id] of [['recordEditor','recordError'],['editor','editorError'],['versionsEditor','versionError']])if(el(dialog).open){el(id).hidden=false;el(id).textContent=e.message;}}
  finally{saving=false;}
}
function profileOptions(){
  const profiles=pack().profiles,selected=profiles.some(p=>p.id===pref.profile)?pref.profile:profiles[0].id;
  el('profile').replaceChildren(...profiles.map(p=>new Option(p.label,p.id)));el('profile').value=selected;
}
async function reload(){const value=await send('profile-read');currentPack=value.pack;workspaceSync=value.sync;renderSync();pref=value.preferences;profileOptions();syncAgentSettings();render();}
async function save(candidate,imported=false){await send('profile-save',{pack:candidate,base:currentPack?.sourceVersion || null,imported});await reload();}
function dateLabel(value){if(!value)return '未注明';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(date);}
function currentFacts(){return C.profile(pack(),el('profile').value).facts;}
function recordGroups(facts,mod){const groups=new Map();for(const f of facts.filter(f=>f.module===mod)){if(!groups.has(f.recordId))groups.set(f.recordId,[]);groups.get(f.recordId).push(f);}return [...groups.entries()];}
function recordRange(facts){const value=labels=>facts.find(f=>labels.includes(f.label))?.value;const start=value(['开始日期','开始']),end=value(['结束日期','结束']);return [start,end].filter(Boolean).map(esc).join(' — ');}
function renderRecord(mod,id,facts,find){
  const key=mod+'|'+id,title=facts[0].recordLabel || modules[mod],range=recordRange(facts);
  return `<details class="record" data-record="${esc(key)}" ${find || openRecords.has(key)?'open':''}><summary><span class="record-heading"><span class="record-title">${esc(title)}</span>${range?`<span class="record-range">${range}</span>`:''}</span><span class="record-meta"><small>${facts.length} 项</small>${disclosureAction()}</span></summary><div class="record-tools"><button data-record-edit="${esc(id)}" data-module="${mod}">编辑整段资料</button><button data-add-field="${esc(id)}" data-module="${mod}">补充自定义字段</button></div>${facts.map(f=>`<div class="fact"><div class="fact-name">${esc(f.label)}${f.manual?'<div class="hint">人工确认</div>':''}</div><div class="fact-value">${esc(f.value)}</div><button data-edit="${esc(f.key)}" aria-label="编辑${esc(f.label)}">编辑</button></div>`).join('')}</details>`;
}
function render(){
  const all=currentFacts(),find=el('search').value.trim().toLowerCase();
  const facts=all.filter(f=>!find || [f.label,f.value,f.recordLabel,f.recordHint,...f.aliases].join(' ').toLowerCase().includes(find));
  el('export').disabled=!currentPack;el('deleteProfile').disabled=!currentPack;el('editRules').disabled=false;
  if(!recordsInitialized && all.length){const first=all[0];openRecords.add(first.module+'|'+first.recordId);recordsInitialized=true;}
  el('factCount').textContent=`已填写 ${all.length} 项${find?' · 搜索结果 '+facts.length+' 项':''}`;
  el('facts').innerHTML=Object.entries(L.templates).map(([mod,t],index)=>{
    const groups=recordGroups(facts,mod),complete=recordGroups(all,mod);if(find && !groups.length)return '';
    const personal=mod==='personal' && complete.length,first=complete.find(([,fs])=>fs.some(f=>f.label==='姓名')) || complete[0];
    const button=personal?`data-record-edit="${esc(first[0])}"`:`data-add-record="${mod}"`;
    const preview=t.fields.filter(f=>!f.optional).slice(0,6).map(f=>f.label).join('、');
    return `<section class="module-section" aria-labelledby="module-${mod}"><div class="module-head"><div class="module-label"><span class="module-index">${String(index+1).padStart(2,'0')}</span><h3 id="module-${mod}">${esc(t.label)}</h3><span class="module-count">${complete.length ? complete.length+' 组资料':'未填写'}</span></div><button ${button} data-module="${mod}">${personal?'编辑个人信息':esc(t.action)}</button></div>${groups.length?groups.map(([id,fs])=>renderRecord(mod,id,fs,find)).join(''):`<p class="module-placeholder">${esc(preview)}${t.fields.length>6?'等':''}</p>`}</section>`;
  }).join('') || '<div class="empty"><strong>没有找到匹配资料</strong><p>调整关键词，或清空搜索查看所有模块。</p></div>';
  el('facts').querySelectorAll('.record').forEach(record=>record.addEventListener('toggle',()=>{if(!record.isConnected || el('search').value.trim())return;if(record.open)openRecords.add(record.dataset.record);else openRecords.delete(record.dataset.record);}));
  const p=currentPack;
  el('source').innerHTML=p?`<dl><dt>来源</dt><dd>${esc(p.sourceName)}</dd><dt>更新</dt><dd>${esc(dateLabel(p.savedAt))}</dd><dt>导入</dt><dd>${esc(dateLabel(p.importedAt))}</dd><dt>版本</dt><dd>${esc(p.sourceVersion.slice(0,12))}</dd><dt>资料</dt><dd>${p.facts.length} 项 · ${p.profiles.length} 个资料版本</dd></dl>`:'<p>尚未保存资料。填写任一模块后会保存在这个浏览器中。</p>';
  el('rules').innerHTML=p?.rules.length?'<ol>'+p.rules.map(r=>`<li>${esc(r)}</li>`).join('')+'</ol>':'<p>尚未保存额外填写要求。</p>';
}
el('importFile').addEventListener('change',()=>action(async()=>{
  const file=el('importFile').files[0];if(!file)return;
  try {
    if(file.size>5*1024*1024)throw Error('资料包超过 5 MB，请仅保留结构化填写资料。');
    const candidate=JSON.parse(await file.text());
    if(currentPack && !confirm('导入会替换插件中的资料副本。请确认已经导出需要保留的本地修改。'))return;
    await save(candidate,true);notice(`资料已导入：${currentPack.facts.length} 项。请核对资料内容和填写规则，再回到招聘网页识别。`);
  } finally {el('importFile').value='';}
}));
el('export').addEventListener('click',()=>action(async()=>{
  const value=await send('profile-read');if(!value.pack)throw Error('没有可导出的资料。');
  const blob=new Blob([JSON.stringify(value.pack,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=url;anchor.download='TouDi-private-profile-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notice('私人资料包已导出。文件包含个人信息，请保存在自己的资料目录。');
}));
async function chooseProfile(value){
  if(saving || !pack().profiles.some(p=>p.id===value))return;
  await action(async()=>{const before=pref.profile;try{pref=await send('preferences',{preferences:{profile:value}});el('profile').value=value;render();}catch(e){el('profile').value=before;throw e;}});
}
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
function checks(id,name,selected){el(id).innerHTML=pack().profiles.map(p=>`<label class="check"><input type="checkbox" name="${name}" value="${esc(p.id)}" ${selected.includes(p.id)?'checked':''}>${esc(p.label)}</label>`).join('');}
function checked(name){return [...document.querySelectorAll(`[name="${name}"]:checked`)].map(n=>n.value);}
function inputField(d){
  const id='recordField-'+d.id,value=String(d.value ?? '');let control;
  if(d.input==='choice'){
    const existing=value && !d.choices.includes(value)?`<option value="${esc(value)}">${esc(value)}</option>`:'';
    control=`<select id="${id}" data-choice="${d.id}"><option value="">未填写</option>${d.choices.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}${existing}<option value="__custom__">其他（自行填写）</option></select><input id="${id}-custom" class="custom-choice" hidden aria-label="${esc(d.label)}的自定义内容" maxlength="200">`;
  }else if(d.input==='date'){
    const m=value.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?月?$/),display=m?m[1]+'-'+m[2].padStart(2,'0')+(m[3]?'-'+m[3].padStart(2,'0'):''):'';
    const exact=m?.[3]?'day':'month',ongoing=d.ongoing && C.ongoingEnd({module:recordDraft.module,label:d.fact?.label || d.label,value});
    control=`<div class="date-inputs" ${ongoing?'hidden':''} data-date-inputs="${d.id}"><select id="${id}-precision" data-date-precision="${d.id}" aria-label="${esc(d.label)}精度"><option value="month">年月</option><option value="day" ${exact==='day'?'selected':''}>具体日期</option></select><input id="${id}" type="${exact==='day'?'date':'month'}" data-original-display="${esc(display)}" data-original-precision="${exact}" value="${esc(display)}" aria-label="${esc(d.label)}"></div>${d.ongoing?`<label class="check ongoing-check"><input type="checkbox" id="${id}-ongoing" data-ongoing="${d.id}" ${ongoing?'checked':''}>仍在进行（至今）</label>`:''}${value && !m && !ongoing?`<p class="hint">已有内容：${esc(value)}。未修改时保留。</p>`:''}`;
  }else if(d.input==='textarea')control=`<textarea id="${id}" rows="3" maxlength="24000">${esc(value)}</textarea>`;
  else control=`<input id="${id}" type="${d.input}" value="${esc(value)}" maxlength="1000">`;
  if(d.id==='gpa')control+=`<label for="recordGpaScale" class="hint">GPA 满分</label><select id="recordGpaScale"><option value="">未知／未填写</option><option value="4.0">4.0</option><option value="5.0">5.0</option></select>`;
  return `<div class="template-field ${d.input==='textarea'?'field-wide':''}"><label for="${id}">${esc(d.label)}</label>${control}</div>`;
}
function updateRecordDatePolicy(){el('recordDatePolicy').hidden=!recordDraft.fields.some(d=>d.ongoing && el('recordField-'+d.id+'-ongoing')?.checked);}
function openRecord(mod,id='',focusField=null){
  recordDraft=L.recordDraft(pack(),mod,id,el('profile').value);el('recordForm').reset();el('recordError').hidden=true;
  el('recordTitle').textContent=(id?'编辑':'填写')+' · '+modules[mod];
  el('recordFields').innerHTML=recordDraft.fields.filter(d=>!d.optional).map(inputField).join('');el('recordOptionalFields').innerHTML=recordDraft.fields.filter(d=>d.optional).map(inputField).join('');
  el('optionalFields').hidden=!recordDraft.fields.some(d=>d.optional);el('optionalFields').open=recordDraft.fields.some(d=>d.optional && String(d.value));
  for(const d of recordDraft.fields)if(d.input==='choice')el('recordField-'+d.id).value=d.value || '';
  if(el('recordGpaScale'))el('recordGpaScale').value=String(recordDraft.fields.find(d=>d.id==='gpa')?.fact?.gpaScale || '').replace(/^([45])$/,'$1.0');
  el('recordDateFallback').value=recordDraft.fields.find(d=>d.ongoing && d.fact?.ongoing)?.fact?.dateFallback || '';updateRecordDatePolicy();
  recordInitialProfiles=recordDraft.profiles.length?recordDraft.profiles:[el('profile').value];checks('recordProfiles','recordProfiles',recordInitialProfiles);
  el('recordVersionSection').hidden=pack().profiles.length===1;
  el('recordSharing').textContent=recordDraft.fields.some(d=>d.fact?.profiles.length>1)?'部分已有字段被多个版本共用，修改内容会影响共用它们的版本。需要独立内容时，在「管理版本」复制一个版本。':'新内容使用这里选定的版本。';
  const fs=L.group(pack(),mod,id).filter(f=>f.profiles.includes(el('profile').value));
  el('recordExtras').hidden=!fs.length;
  el('recordExtras').innerHTML=fs.length?`<details class="disclosure"><summary><span>补充字段与单项约束${recordDraft.extraFacts.length?' · '+recordDraft.extraFacts.length+' 个补充字段':''}</span>${disclosureAction()}</summary><div class="disclosure-body">${recordDraft.extraFacts.map(f=>`<div class="extra-fact"><span>${esc(f.label)}</span><button type="button" data-custom-edit="${esc(f.key)}">编辑</button></div>`).join('')}<label for="constraintField">日期精度、别名与人工确认等约束</label><div class="inline-input"><select id="constraintField">${fs.map(f=>`<option value="${esc(f.key)}">${esc(f.label)}</option>`).join('')}</select><button type="button" id="editConstraint">编辑约束</button></div><p class="hint">未在标准表单中出现的字段会保留。补充字段可在保存后添加。</p></div></details>`:'';
  el('removeRecord').hidden=!id;el('recordEditor').showModal();el('recordEditor').querySelector('.dialog-body').scrollTop=0;
  if(focusField){const d=recordDraft.fields.find(f=>f.id===focusField);if(d.optional)el('optionalFields').open=true;el('recordField-'+focusField).focus();}
}
el('closeRecord').addEventListener('click',()=>el('recordEditor').close());
el('recordForm').addEventListener('change',event=>{
  const n=event.target;
  if(n.dataset.choice){const custom=el('recordField-'+n.dataset.choice+'-custom');custom.hidden=n.value!=='__custom__';if(!custom.hidden)custom.focus();}
  if(n.dataset.datePrecision){const input=el('recordField-'+n.dataset.datePrecision),value=input.value;input.value='';input.type=n.value==='day'?'date':'month';if(n.value==='month')input.value=value.slice(0,7);else input.value=value.length===10?value:value.length===7 && input.dataset.originalPrecision==='day' && input.dataset.originalDisplay.slice(0,7)===value?input.dataset.originalDisplay:'';input.dataset.precisionChanged='true';}
  if(n.dataset.ongoing){el('recordForm').querySelector(`[data-date-inputs="${n.dataset.ongoing}"]`).hidden=n.checked;updateRecordDatePolicy();}
});
el('recordForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const values={};for(const d of recordDraft.fields){const n=el('recordField-'+d.id);
    let value=n.value;
    if(d.input==='choice' && value==='__custom__'){value=el(n.id+'-custom').value.trim();if(!value)throw Error('请填写'+d.label+'的自定义内容。');}
    if(d.input==='date'){
      const exact=el(n.id+'-precision').value,ongoing=el(n.id+'-ongoing')?.checked;
      if(ongoing)value=C.ongoingEnd({module:recordDraft.module,label:d.fact?.label || d.label,value:d.value})?d.value:'至今';
      else if(value===n.dataset.originalDisplay && exact===n.dataset.originalPrecision && !C.ongoingEnd({module:recordDraft.module,label:d.fact?.label || d.label,value:d.value}))value=d.value;
      else if(!value && exact==='day' && n.dataset.precisionChanged && d.value)throw Error(d.label+'需要已确认的具体日期，请补充日期或恢复原精度。');
    }
    values[d.id]=value;
  }
  const profiles=checked('recordProfiles'),options={profiles,profileId:el('profile').value,changeProfiles:JSON.stringify([...profiles].sort())!==JSON.stringify([...recordInitialProfiles].sort())};
  if(recordDraft.fields.some(d=>d.ongoing && el('recordField-'+d.id+'-ongoing')?.checked))options.dateFallback=el('recordDateFallback').value;
  if(el('recordGpaScale'))options.gpaScale=el('recordGpaScale').value;
  const candidate=L.saveRecord(pack(),recordDraft.module,recordDraft.recordId,values,options),saved=candidate.facts.find(f=>f.module===recordDraft.module && (!recordDraft.recordId || f.recordId===recordDraft.recordId) && f.profiles.includes(profiles[0]) && (!currentPack || !currentPack.facts.some(old=>old.key===f.key)));
  openRecords.add(recordDraft.module+'|'+(recordDraft.recordId || saved?.recordId));
  await save(candidate);el('recordEditor').close();notice('资料已保存。回到招聘网页重新识别，即可使用更新后的内容。');
});});
el('removeRecord').addEventListener('click',()=>action(async()=>{
  if(!confirm('从当前资料版本删除这段资料？其他版本保留。'))return;
  const candidate=structuredClone(pack()),pid=el('profile').value;candidate.facts=candidate.facts.flatMap(f=>{if(f.module!==recordDraft.module || f.recordId!==recordDraft.recordId || !f.profiles.includes(pid))return [f];f.profiles=f.profiles.filter(id=>id!==pid);return f.profiles.length?[f]:[];});
  await save(candidate);el('recordEditor').close();notice('这段资料已从当前版本删除。');
}));
el('recordExtras').addEventListener('click',event=>{const button=event.target.closest('[data-custom-edit],#editConstraint');if(!button)return;const key=button.dataset.customEdit || el('constraintField').value;el('recordEditor').close();openEditor(key);});
function recordChoices(mod,selected=''){
  const groups=recordGroups(currentFacts(),mod);el('factRecord').replaceChildren(...groups.map(([id,fs])=>new Option(fs[0].recordLabel || modules[mod],id)));
  if(!groups.length)el('factRecord').add(new Option(mod==='personal'?'个人信息':'先添加一段'+modules[mod],''));
  if(groups.some(([id])=>id===selected))el('factRecord').value=selected;
  el('factContext').textContent=mod!=='personal' && !groups.length?'请先使用模块中的添加按钮建立整段经历，再补充自定义字段。':'字段会归入这段资料，无需填写经历标识。';
  el('editForm').querySelector('[type=submit]').disabled=mod!=='personal' && !groups.length;
}
function openEditor(key=null,context={}){
  editingKey=key;const fact=currentPack?.facts.find(f=>f.key===key);el('editForm').reset();el('editorError').hidden=true;el('matchingOptions').open=false;
  el('editorTitle').textContent=fact?'编辑字段与约束':'补充自定义字段';el('factKey').value=key || '';el('factLabel').value=fact?.label || '';el('factValue').value=fact?.value ?? '';
  el('factModule').value=fact?.module || context.module || 'personal';recordChoices(el('factModule').value,fact?.recordId ?? context.recordId);
  el('factModule').disabled=!!fact;el('factRecord').disabled=!!fact;
  el('factPrecision').value=fact?.precision || '';el('factAliases').value=(fact?.aliases || []).join('\n');el('factSensitive').checked=fact?.sensitive || false;el('factManual').checked=fact?.manual || false;el('gpaScale').value=String(fact?.gpaScale || '').replace(/^([45])$/,'$1.0');
  el('dateFallback').value=fact?.dateFallback || '';syncDatePolicy();checks('factProfiles','factProfiles',fact?.profiles || [el('profile').value]);el('factVersionSection').hidden=pack().profiles.length===1;
  el('removeFact').hidden=!fact;el('editor').showModal();el('editor').querySelector('.dialog-body').scrollTop=0;
}
el('factModule').addEventListener('change',()=>recordChoices(el('factModule').value));
el('addFact').addEventListener('click',()=>openEditor());el('closeEditor').addEventListener('click',()=>el('editor').close());
el('facts').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-add-record'))openRecord(button.dataset.addRecord);
  else if(button.hasAttribute('data-record-edit'))openRecord(button.dataset.module,button.dataset.recordEdit);
  else if(button.hasAttribute('data-add-field'))openEditor(null,{module:button.dataset.module,recordId:button.dataset.addField});
  else if(button.dataset.edit){const f=currentPack.facts.find(f=>f.key===button.dataset.edit),d=L.templates[f.module].fields.find(d=>d.label===f.label || d.labels?.includes(f.label));if(d)openRecord(f.module,f.recordId,d.id);else openEditor(f.key);}
});
function syncDatePolicy(){el('ongoingPolicy').hidden=!C.ongoingEnd({module:el('factModule').value,label:el('factLabel').value.trim(),value:el('factValue').value.trim()});}
for(const id of ['factModule','factLabel','factValue'])el(id).addEventListener('input',syncDatePolicy);
el('editForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  let candidate=structuredClone(pack());const old=candidate.facts.find(f=>f.key===editingKey),label=el('factLabel').value.trim(),mod=el('factModule').value,id=el('factRecord').value;
  const value={...old,label,value:el('factValue').value.trim(),aliases:el('factAliases').value.split('\n').map(s=>s.trim()).filter(Boolean),profiles:checked('factProfiles'),sensitive:el('factSensitive').checked,manual:el('factManual').checked,precision:el('factPrecision').value || null,gpaScale:el('gpaScale').value || null};
  delete value.ongoing;delete value.dateFallback;if(C.ongoingEnd({...value,module:mod})){value.ongoing=true;value.precision=null;if(el('dateFallback').value)value.dateFallback=el('dateFallback').value;}
  if(!value.aliases.length)delete value.aliases;if(!value.value)throw Error('请填写已确认的内容。');
  if(old){if(candidate.facts.some(f=>f.key!==old.key && f.module===mod && f.recordId===old.recordId && C.normal(f.label)===C.normal(label) && f.profiles.some(p=>value.profiles.includes(p))))throw Error('这段资料已有同名字段，请直接编辑。');candidate.facts[candidate.facts.indexOf(old)]=value;candidate=C.validatePack(candidate);}
  else candidate=L.addField(candidate,{module:mod,recordId:id},value);
  openRecords.add(mod+'|'+(id || 'personal'));await save(candidate);el('editor').close();notice('字段已保存。回到招聘网页重新识别后生效。');
});});
el('removeFact').addEventListener('click',()=>action(async()=>{if(!confirm('删除这个字段？其余资料保留。'))return;const candidate=structuredClone(pack());candidate.facts=candidate.facts.filter(f=>f.key!==editingKey);await save(candidate);el('editor').close();notice('字段已删除。');}));
function renderVersions(){el('versionList').innerHTML=pack().profiles.map(p=>`<form class="version-row" data-version="${esc(p.id)}"><label for="version-${esc(p.id)}">${p.id===el('profile').value?'当前版本':'版本名称'}</label><div class="inline-input"><input id="version-${esc(p.id)}" value="${esc(p.label)}" required maxlength="80"><button type="submit">保存名称</button>${pack().profiles.length>1?`<button type="button" class="danger" data-remove-version="${esc(p.id)}">删除</button>`:''}</div></form>`).join('');}
el('manageVersions').addEventListener('click',()=>{renderVersions();el('versionName').value='';el('versionError').hidden=true;el('versionsEditor').showModal();});el('closeVersions').addEventListener('click',()=>el('versionsEditor').close());
el('versionList').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const form=event.target,id=form.dataset.version,name=form.querySelector('input').value.trim();if(!name)throw Error('版本名称不能为空。');if(pack().profiles.some(p=>p.id!==id && p.label===name))throw Error('已有同名资料版本。');const candidate=structuredClone(pack());candidate.profiles.find(p=>p.id===id).label=name;await save(candidate);renderVersions();notice('版本名称已保存。');});});
el('versionList').addEventListener('click',event=>{const button=event.target.closest('[data-remove-version]');if(!button)return;action(async()=>{const id=button.dataset.removeVersion,name=pack().profiles.find(p=>p.id===id).label;if(!confirm('删除「'+name+'」及仅属于它的资料？其他版本保留。'))return;await save(L.removeVersion(pack(),id));renderVersions();notice('资料版本已删除，其他版本保留。');});});
el('newVersionForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const result=L.addVersion(pack(),el('versionName').value,el('profile').value);await save(result.pack);pref=await send('preferences',{preferences:{profile:result.id}});profileOptions();render();renderVersions();el('versionName').value='';notice('已复制为独立资料版本。编辑这个版本不会改动原版本。');});});
el('editRules').addEventListener('click',()=>{el('rulesText').value=(currentPack?.rules || []).join('\n');el('rulesEditor').showModal();});el('closeRules').addEventListener('click',()=>el('rulesEditor').close());el('rulesForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const candidate=structuredClone(pack());candidate.rules=el('rulesText').value.split('\n').map(s=>s.trim()).filter(Boolean);await save(candidate);el('rulesEditor').close();notice('填写规则已保存。');});});
el('deleteProfile').addEventListener('click',()=>action(async()=>{if(!confirm('清除本浏览器的私人资料、字段匹配和最近核验？原始资料文件不会被修改。'))return;await send('profile-delete');openRecords.clear();recordsInitialized=false;await reload();el('lastReport').innerHTML='<p>尚无核验记录。</p>';notice('插件资料已清除。');}));
action(async()=>{await reload();const value=await send('state');if(value.lastReport){const r=value.lastReport;el('lastReport').innerHTML=`<p>${esc(r.origin)}</p><p>${r.summary?.verified || 0} 项核验通过 · ${r.summary?.failed || 0} 项未通过</p><p class="hint">${esc(dateLabel(r.checkedAt))} · 网站保存未确认</p>`;}});

function renderSync(){
  const status=workspaceSync || {},labels={disconnected:'尚未连接工作区',synced:'已同步到当前工作区',pending:'本机资料已保存，等待同步',conflict:'双方资料不同，需要核对', 'workspace-changed':'工作区已切换，需要重新连接'};
  el('workspaceSync').textContent=(labels[status.status] || '等待连接')+(status.lastSync?' · 最近同步 '+dateLabel(status.lastSync):'')+(status.error?' · '+status.error:'');
  el('connectWorkspace').textContent=status.workspaceKey?'重新连接当前工作区':'连接当前工作区';el('disconnectWorkspace').disabled=!status.enabled;el('syncWorkspace').disabled=!status.enabled;
  el('syncReview').hidden=!status.review;el('syncLocal').textContent=status.review?JSON.stringify(status.review.local,null,2):'';el('syncRemote').textContent=status.review?JSON.stringify(status.review.remote,null,2):'';
  if(status.enabled && status.status!=='synced')notice(labels[status.status]+'。'+(status.error || '请到「资料管理」核对同步状态。'),true);
}
for(const [id,op] of [['connectWorkspace','profile-connect'],['syncWorkspace','profile-sync'],['disconnectWorkspace','profile-disconnect']])el(id).addEventListener('click',()=>action(async()=>{workspaceSync=await send(op);await reload();}));
for(const button of document.querySelectorAll('[data-sync-choice]'))button.addEventListener('click',()=>action(async()=>{
  const review=workspaceSync.review;if(!review)return;
  if(!confirm('将所选资料保存为浏览器与当前工作区的共同资料？请确认已审阅双方，并按需下载备份。'))return;
  await send('profile-resolve',{choice:button.dataset.syncChoice,workspaceKey:review.workspaceKey,reviewVersion:review.version,localVersion:review.localVersion});await reload();
}));
function downloadCandidate(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el('backupSyncLocal').addEventListener('click',()=>downloadCandidate(workspaceSync.review?.local,'TouDi-browser-candidate.json'));
el('backupSyncRemote').addEventListener('click',()=>downloadCandidate(workspaceSync.review?.remote,'TouDi-workspace-candidate.json'));
