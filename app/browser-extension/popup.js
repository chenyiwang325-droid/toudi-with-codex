const el = id => document.getElementById(id);
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const labels = {ready:'可填写',already:'已一致',conflict:'已有内容',manual:'人工核对',missing:'资料待补',ambiguous:'需选记录',unsupported:'需手动',verified:'核验通过',failed:'未通过'};
const reasons = {'option-not-unique':'存在多个同名选项，需要手动确认','menu-not-unique':'出现多个选项面板，未继续操作','menu-not-associated':'未能确定当前字段对应的选项面板','selector-layout-unsupported':'该选项面板结构暂不支持，请手动选择','multiple-selection-unsupported':'多选集合需手动核对，未改变已有选择','option-confirm-unavailable':'未找到可用的确认按钮，请手动核对','date-precision-required':'资料需要精确到日，未补造日期','date-control-unsupported':'此日期控件需手动选择','date-not-retained':'日期未被控件保留，请手动核对','invalid-date':'日期不符合日历规则','readback-matched':'写入后读回一致','value-not-retained':'网站未保留填写值，请手动检查','validation-failed':'网站字段校验未通过','field-disappeared':'字段已隐藏或移除，请重新识别','page-changed':'网页已切换，请重新识别','structure-changed':'表单结构已变化，请重新识别','value-changed':'你已修改此字段，保留当前值','existing-value':'已有内容未覆盖','field-changed':'字段内容或控件已变化','disabled-or-readonly':'字段只读或已停用','option-not-found':'页面没有该选项','option-disabled':'对应选项不可用','maxlength-exceeded':'内容超过网站长度限制','scan-required':'需要重新识别当前页面'};
let state, busy = false, agentBusy = false, hasProfile = false, profileSummary;
let pref = TouDiAgentConfig.normalize();
async function send(op, data = {}) {
  const result = await chrome.runtime.sendMessage({op,...data});
  if (result?.error) throw Error(result.error);
  return result.value;
}
function notice(text, error = false) {el('notice').hidden = !text; el('notice').textContent = text;el('notice').classList.toggle('error',error);}
async function task(fn, text) {
  if (busy) return;
  busy = true;document.querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = true);notice(text);
  try { await fn(); }
  catch (e) { notice(e.message, true); }
  finally {busy = false;document.querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = false);updateAgentControls();selection();}
}
function showSync(sync){const labels={pending:'资料已保存在本机，等待与中控台同步',conflict:'资料同步有冲突，请到资料与设置核对双方', 'workspace-changed':'中控台工作区已切换，请重新连接核对'};const text=labels[sync?.status] || '';el('workspaceSync').hidden=!text;el('workspaceSync').textContent=text;}
function sourceLabel(){if(profileSummary)el('sourceStatus').textContent=`资料更新 ${String(profileSummary.savedAt || '未注明').slice(0,10)} · 当前版本 ${profileSummary.profiles.find(p=>p.id===el('profile').value)?.count || 0} 项`;}
function available(value) {hasProfile=!!value;el('empty').hidden=hasProfile;el('controls').hidden=!hasProfile;}
function selection() {
  const selected = [...document.querySelectorAll('#review input[data-field]:checked')];
  const overwritten = selected.filter(input => input.dataset.overwrite === 'true').length;
  el('selectionCount').textContent = `选择 ${selected.length} 项` + (overwritten ? ` · 覆盖 ${overwritten} 项` : '');
  el('fill').disabled = busy || !selected.length;
}
function renderAgentFeedback() {
  const r=state?.agentReview,box=el('agentFeedback');box.hidden=!state?.plan;
  if(!state?.plan)return;
  const title={running:'Agent 正在核对',completed:'Agent 核对结果',failed:'Agent 核对未完成',skipped:'本次未调用 Agent',superseded:'Agent 结果未采用'}[r?.status] || 'Agent 核对';
  const summary=r?.status==='completed'?`已核对 ${r.requested} 项 · 采纳 ${r.accepted} 项 · 未采用 ${r.rejected} 项 · 未确认 ${r.unresolved} 项`:r?.message || (state.autoAgentPending?'等待调用所选模型核对歧义字段。':'尚未调用；可在下方发起语义核对。');
  box.innerHTML=`<h2>${escapeHtml(title)}</h2>${r?.model?`<p class="caption">${escapeHtml(r.model)}${Number.isFinite(r.seconds)?' · '+r.seconds.toFixed(1)+' 秒':''}</p>`:''}<p>${escapeHtml(summary)}</p>${r?.items?.length?`<details><summary>查看 ${r.items.length} 项核对明细</summary>${r.items.map(i=>`<div class="agent-item"><strong>${escapeHtml([i.groupLabel,i.label].filter(Boolean).join(' · '))}</strong><div>${escapeHtml(i.factLabel?'→ '+i.factLabel:'未确认对应资料')}</div><p class="reason">${escapeHtml(({matched:'已采纳匹配',rejected:'未采用建议',unresolved:'仍需核对'})[i.status])} · ${escapeHtml(i.reason)}</p></div>`).join('')}</details>`:''}`;
}
function renderStructureFeedback(){
  const r=state?.structureReview,box=el('structureFeedback');box.hidden=!state?.plan;
  if(!state?.plan)return;
  const platform=Array.isArray(state.platform)?state.platform.map(p=>p.label || p.id).join(' · '):typeof state.platform==='string'?state.platform:state.platform?.name || state.platform?.id || '通用识别';
  const title={running:'正在补充页面结构',completed:'页面结构辅助结果',cached:'已复用页面结构',failed:'页面结构辅助未完成',superseded:'结构结果未采用'}[r?.status] || '页面结构识别';
  const summary=r && ['completed','cached'].includes(r.status)?`应用 ${r.accepted || 0} 项 · 拒绝 ${r.rejected || 0} 项${Number.isFinite(r.unresolved)?' · 未确认 '+r.unresolved+' 项':''}`:r?.message || (state.structurePending?'存在未知标题或分组，可由 Agent 选择本页结构候选。':'当前字段已由通用或平台规则识别，无需结构模型调用。');
  box.innerHTML=`<h2>${escapeHtml(title)}</h2><p class="caption">${escapeHtml(platform)}${r?.model?' · '+escapeHtml(r.model):''}${Number.isFinite(r?.seconds)?' · '+r.seconds.toFixed(1)+' 秒':''}</p><p>${escapeHtml(summary)}</p>`;
}
function render() {
  const plan = state?.plan;
  renderAgentFeedback();renderStructureFeedback();
  el('review').hidden = !plan;el('agent').hidden = !plan;el('actions').hidden = !plan;el('result').hidden = !state?.report;
  if (plan) {
    const counts = plan.statusCounts || {};
    const pending = plan.rows.filter(row => !['ready','already'].includes(row.status)).length;
    const groups = new Map();
    for (const row of plan.rows) {const key = row.groupLabel || ({personal:'个人信息',education:'教育经历',work:'工作经历',projects:'项目经历'}[row.module] || '其他字段');if (!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    el('profile').value = plan.profileId;
    el('review').innerHTML = `<h2>核对本页填写计划</h2><div class="site">${escapeHtml(plan.origin + plan.path)}</div>${state.timings?`<p class="caption">引擎 ${escapeHtml(state.engineVersion || '未知')} · 页面扫描 ${(state.timings.scanMs/1000).toFixed(2)} 秒 · 本地计划 ${(state.timings.totalMs/1000).toFixed(2)} 秒</p>`:''}<div class="summary"><span><b>${plan.rows.length}</b>识别字段</span><span><b>${counts.ready || 0}</b>可填写</span><span><b>${counts.already || 0}</b>已有一致</span><span><b>${pending}</b>待核对</span></div>` + [...groups].map(([group, rows]) => `<h3>${escapeHtml(group)}</h3>` + rows.map(row => {
      const selectable = ['ready','conflict'].includes(row.status) && row.factKey;
      const choices = ['missing','ambiguous'].includes(row.status) ? `<select data-map="${escapeHtml(row.fieldId)}" aria-label="为${escapeHtml(row.label)}选择资料字段"><option value="">选择已确认资料…</option>${plan.choices.map(choice => `<option value="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</option>`).join('')}</select>` : '';
      const value = row.displayValue;
      return `<div class="field"><div class="field-top">${selectable ? `<input type="checkbox" data-field="${escapeHtml(row.fieldId)}" data-overwrite="${row.status === 'conflict'}" aria-label="${row.status === 'conflict' ? '覆盖已有' : '填写'}${escapeHtml(row.label)}" ${row.status === 'ready' ? 'checked' : ''}>` : ''}<button class="field-title" data-jump="${escapeHtml(row.fieldId)}" title="定位网页字段">${escapeHtml(row.label || '未命名字段')}</button><span class="state ${row.status}">${labels[row.status] || row.status}</span></div>${value ? `<div class="value">${escapeHtml(value)}</div>` : ''}<div class="reason">${escapeHtml(row.reason)}</div>${choices}</div>`;
    }).join('')).join('');
    if (document.querySelector('[data-map]')) el('review').insertAdjacentHTML('beforeend','<label class="check"><input id="rememberSelections" type="checkbox">记住本页所选匹配</label><button id="applyChoices">应用所选匹配并重新核对</button>');

    selection();
  }
  if (state?.report) {
    const report = state.report, count = report.summary || state.saved?.summary || {};
    el('result').innerHTML = `<div class="finish"><strong>${count.verified || 0} 项核验通过</strong><p>网站保存状态尚未确认。请在网页中核对、保存草稿，再由你决定提交。</p></div><h3>逐项核验</h3>` + report.results.map(row => {
      const field = state.labels?.[row.fieldId] || {};
      return `<div class="field"><div class="field-top"><strong>${escapeHtml(field.label || row.fieldId)}</strong><span class="state ${row.status}">${labels[row.status] || row.status}</span></div><div class="reason">${escapeHtml(reasons[row.reason] || row.reason || '')}</div></div>`;
    }).join('') + (state.pending?.length ? `<h3>仍需核对 · ${state.pending.length} 项</h3>` + state.pending.map(row => `<div class="field"><div class="field-top"><strong>${escapeHtml(row.label || '未命名字段')}</strong><span class="state ${row.status}">${labels[row.status] || row.status}</span></div><div class="reason">${escapeHtml(row.reason)}</div></div>`).join('') : '') + `<p class="caption">重新识别当前页面可以检查剩余字段，并保留已经填写的内容。</p>`;
    if (report.warnings?.length) notice(report.warnings.map(value=>value.message || value).join('；'));
    // Replacing a long plan with a shorter report must reveal the result summary.
    window.scrollTo(0,0);
  }
}
el('settings').addEventListener('click',()=>send('settings'));
el('importStart').addEventListener('click',()=>send('settings'));
function updateAgentControls(){
  const direct=pref.agentMode==='codex' && !!pref.agentModel;
  el('autoAgentRow').hidden=!direct;el('autoAgent').checked=pref.autoAgent;
  el('agentCli').hidden=pref.agentMode==='external';
  el('agentCli').textContent=direct?'用 '+pref.agentModel+' 核对':'配置 Agent 协作';
  el('agentCli').disabled=busy || agentBusy || state?.agentReview?.status==='running' || (direct && !state?.plan?.rows.some(row=>['missing','ambiguous'].includes(row.status)));
  el('structureCli').hidden=!direct;el('structureCli').textContent='用 '+pref.agentModel+' 补充结构';
  el('structureCli').disabled=busy || agentBusy || !state?.structurePending || state?.structureReview?.status==='running';
  el('structureCopy').disabled=busy || !state?.structurePending;el('structureImport').disabled=busy || agentBusy || !state?.structurePending;
  el('agentCheck').hidden=!direct;
  el('agentTransfer').open=pref.agentMode==='external';
  el('agentConnectionStatus').textContent=direct?'当前模型：'+pref.agentModel+' · 现有 Codex 额度。仅核对歧义，不自动替换模型。':pref.agentMode==='external'?'当前方式：自己的 Agent。复制任务后，导入返回的 JSON。':'尚未接入 Agent；明确字段和手动选择资料仍可使用。';
}
el('agentSettings').addEventListener('click',()=>send('settings',{section:'agent'}));
el('openWorkbench').addEventListener('click',()=>task(async()=>{await send('open-workbench');notice('投递中控台已打开。');},'正在打开中控台…'));
el('autoAgent').addEventListener('change',()=>task(async()=>{pref=await send('preferences',{preferences:{autoAgent:el('autoAgent').checked}});state=null;render();notice(pref.autoAgent?'自动核对已开启，使用你已选择的模型和 Codex 额度。':'自动核对已关闭。');},'正在保存偏好…'));
async function checkAgentPlan(){
  if(agentBusy || !state?.plan)return;
  const startedAt=state.startedAt;
  agentBusy=true;state.agentReview={status:'running',model:pref.agentModel,message:'正在核对字段含义与已有资料。'};renderAgentFeedback();updateAgentControls();notice('本地计划已显示；Agent 正在核对歧义字段，你可以先填写已确认的项目。');
  try{
    const next=await send('remap',{agent:true,startedAt});
    if(state?.startedAt!==startedAt || !state?.plan)return;
    // Preserve user checkbox/manual choices while the model was running.
    if(busy || document.querySelector('[data-map]:focus')){state.agentReview=next.agentReview;renderAgentFeedback();notice('核对反馈已更新；重新打开插件可查看新计划，当前选择保留。');return;}
    const selected=new Map([...document.querySelectorAll('[data-field]')].map(n=>[n.dataset.field,n.checked]));
    const choices=new Map([...document.querySelectorAll('[data-map]')].map(n=>[n.dataset.map,n.value]));
    state=next;render();
    document.querySelectorAll('[data-field]').forEach(n=>{if(selected.has(n.dataset.field))n.checked=selected.get(n.dataset.field);});
    document.querySelectorAll('[data-map]').forEach(n=>{if(choices.has(n.dataset.map))n.value=choices.get(n.dataset.map);});selection();
    notice(state.agentError || (state.agentReview?.status==='completed'?`Agent 核对完成：采纳 ${state.agentReview.accepted} 项，${state.agentReview.unresolved} 项仍未确认。`:'Agent 未完成匹配，请查看核对反馈。'),!!state.agentError);
  }catch(e){if(state?.startedAt===startedAt && state?.plan){state.agentReview={...state.agentReview,status:'failed',message:e.message};renderAgentFeedback();notice(e.message,true);}}
  finally{agentBusy=false;updateAgentControls();}
}
el('scan').addEventListener('click', async()=>{
  await task(async()=>{state=null;render();state=await send('scan',{profile:el('profile').value});showSync(state.sync);render();notice('本地计划已生成；已有内容默认保留。');},'正在识别当前页面…');
  if(state?.autoAgentPending){if(state.structurePending)await checkStructurePlan();if(state?.plan)checkAgentPlan();}
});
el('profile').addEventListener('change', () => task(async()=>{pref=await send('preferences',{preferences:{profile:el('profile').value}});state=null;sourceLabel();render();notice('已更改口径，请重新识别当前页面。');},'正在切换简历口径…'));
el('review').addEventListener('change', selection);
el('review').addEventListener('click', event => {
  const jump=event.target.closest('[data-jump]');
  if(jump)task(()=>send('highlight',{fieldId:jump.dataset.jump}),'正在定位网页字段…');
  if(event.target.id==='applyChoices')task(async()=>{const mappings=Object.fromEntries([...document.querySelectorAll('[data-map]')].filter(select=>select.value).map(select=>[select.dataset.map,select.value]));state=await send('remap',{mappings,remember:el('rememberSelections').checked});render();notice('匹配已应用，请再次核对计划。');},'正在核对所选资料…');
});
async function checkStructurePlan(){
  if(agentBusy || !state?.plan || !state.structurePending)return;
  const startedAt=state.startedAt;agentBusy=true;
  state.structureReview={status:'running',model:pref.agentModel,message:'正在补充字段标题与分组。'};renderStructureFeedback();updateAgentControls();
  try{
    const selected=new Map([...document.querySelectorAll('[data-field]')].map(n=>[n.dataset.field,n.checked]));
    const next=await send('adapt',{agent:true,startedAt});
    if(state?.startedAt!==startedAt || !state?.plan)return;
    if(busy || document.querySelector('[data-map]:focus')){state.structureReview=next.structureReview;renderStructureFeedback();return;}
    const choices=new Map([...document.querySelectorAll('[data-map]')].map(n=>[n.dataset.map,n.value]));
    state=next;render();document.querySelectorAll('[data-field]').forEach(n=>{if(selected.has(n.dataset.field))n.checked=selected.get(n.dataset.field)});document.querySelectorAll('[data-map]').forEach(n=>{if(choices.has(n.dataset.map))n.value=choices.get(n.dataset.map)});selection();
    notice(state.structureReview?.message || '结构核对完成。',state.structureReview?.status==='failed');
  }catch(e){if(state?.startedAt===startedAt && state?.plan){state.structureReview={status:'failed',message:e.message};renderStructureFeedback();notice(e.message,true);}}
  finally{agentBusy=false;updateAgentControls();}
}
el('structureCli').addEventListener('click',()=>checkStructurePlan());
el('structureCopy').addEventListener('click',()=>task(async()=>{const value=await send('structure-task');await navigator.clipboard.writeText(value.task);notice('结构任务已复制；只返回已有候选 ID，随后导入结构适配 JSON。');},'正在生成结构适配任务…'));
el('structureImport').addEventListener('click',()=>task(async()=>{state=await send('adapt',{hints:JSON.parse(el('agentResult').value),startedAt:state.startedAt});render();notice(state.structureReview?.message || '结构结果已验证。',state.structureReview?.status==='failed');},'正在验证结构适配…'));
el('agentCopy').addEventListener('click',()=>task(async()=>{const value=await send('agent-task');await navigator.clipboard.writeText(value.task);notice('匹配任务已复制；交给你正在使用的 Agent，再粘贴它返回的 JSON。');},'正在生成 Agent 匹配任务…'));
el('agentImport').addEventListener('click',()=>task(async()=>{const mappings=JSON.parse(el('agentResult').value);state=await send('remap',{mappings,remember:el('remember').checked});render();notice('Agent 匹配已导入；约束和已有内容保护仍生效。');},'正在验证 Agent 匹配…'));
async function checkCodex() {
  const value=await send('state');pref=value.preferences;updateAgentControls();
  if(pref.agentMode!=='codex' || !pref.agentModel)throw Error('请先打开协作设置，选择本机 Codex 与模型。');
  const provider=await send('codex-status');
  if(!provider.available || provider.auth!=='chatgpt')throw Error(provider.message);
  if(!provider.models.some(model=>model.id===pref.agentModel))throw Error('当前 Codex 目录未提供 '+pref.agentModel+'；请在协作设置重新检查和选择。原计划保留，不自动替换模型。');
  return provider;
}
el('agentCheck').addEventListener('click',()=>task(async()=>{await checkCodex();notice('登录与所选模型目录已确认，没有发起模型生成。');},'正在检查 Codex 连接…'));
el('agentCli').addEventListener('click',()=>{
  if(pref.agentMode!=='codex' || !pref.agentModel){send('settings',{section:'agent'});return;}
  checkAgentPlan();
});
el('fill').addEventListener('click',()=>task(async()=>{const inputs=[...document.querySelectorAll('#review input[data-field]:checked')];state=await send('fill',{selected:inputs.map(input=>input.dataset.field),overwrite:inputs.filter(input=>input.dataset.overwrite==='true').map(input=>input.dataset.field)});render();notice('所选字段已执行并读回核验，请查看逐项结果。');},'正在填写所选字段并读回核验…'));
task(async()=>{const value=await send('state');el('runtimeVersion').textContent='扩展 '+(value.extensionVersion || '未知版本')+' · 本地资料';showSync(value.sync);available(value.profile?.count);el('profile').value=value.preferences.profile;pref=value.preferences;updateAgentControls();profileSummary=value.profile;el('profile').replaceChildren(...(profileSummary?.profiles || [{id:'general',label:'默认资料'}]).map(p=>new Option(p.label,p.id)));el('profile').value=pref.profile;sourceLabel();state=value.state;render();notice(state?.agentError || '',!!state?.agentError);},'正在读取本地资料…');

// A popup can be closed while the worker continues; show its durable outcome on reopen.
const agentPoll=setInterval(async()=>{
  if(busy || agentBusy || (state?.agentReview?.status!=='running' && state?.structureReview?.status!=='running'))return;
  try{const next=(await send('state')).state;if(!next || next.startedAt!==state.startedAt)return;
    if(next.agentReview?.status==='running' || next.structureReview?.status==='running'){state.agentReview=next.agentReview;state.structureReview=next.structureReview;renderAgentFeedback();renderStructureFeedback();return;}
    const selected=new Map([...document.querySelectorAll('[data-field]')].map(n=>[n.dataset.field,n.checked]));
    const choices=new Map([...document.querySelectorAll('[data-map]')].map(n=>[n.dataset.map,n.value]));
    state=next;render();document.querySelectorAll('[data-field]').forEach(n=>{if(selected.has(n.dataset.field))n.checked=selected.get(n.dataset.field)});document.querySelectorAll('[data-map]').forEach(n=>{if(choices.has(n.dataset.map))n.value=choices.get(n.dataset.map)});selection();
  }catch(_){}
},1200);
window.addEventListener('unload',()=>clearInterval(agentPoll));
