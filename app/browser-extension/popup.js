const el = id => document.getElementById(id);
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const labels = {ready:'可填写',already:'已一致',conflict:'已有内容',manual:'人工核对',missing:'资料待补',ambiguous:'需选记录',unsupported:'需手动',verified:'核验通过',failed:'未通过'};
const reasons = {'readback-matched':'写入后读回一致','value-not-retained':'网站未保留填写值，请手动检查','validation-failed':'网站字段校验未通过','field-disappeared':'字段已隐藏或移除，请重新识别','page-changed':'网页已切换，请重新识别','structure-changed':'表单结构已变化，请重新识别','value-changed':'你已修改此字段，保留当前值','existing-value':'已有内容未覆盖','field-changed':'字段内容或控件已变化','disabled-or-readonly':'字段只读或已停用','option-not-found':'页面没有该选项','option-disabled':'对应选项不可用','maxlength-exceeded':'内容超过网站长度限制','scan-required':'需要重新识别当前页面'};
let state, busy = false, hasProfile = false, profileSummary;
const MODEL = 'gpt-6-luna';
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
  finally {busy = false;document.querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = false);el('agentCli').disabled=!(state?.plan?.rows.some(row=>['missing','ambiguous'].includes(row.status)));selection();}
}
function sourceLabel(){if(profileSummary)el('sourceStatus').textContent=`资料更新 ${String(profileSummary.savedAt || '未注明').slice(0,10)} · 当前口径 ${profileSummary.profiles.find(p=>p.id===el('profile').value)?.count || 0} 项`;}
function available(value) {hasProfile=!!value;el('empty').hidden=hasProfile;el('controls').hidden=!hasProfile;}
function selection() {
  const selected = [...document.querySelectorAll('#review input[data-field]:checked')];
  const overwritten = selected.filter(input => input.dataset.overwrite === 'true').length;
  el('selectionCount').textContent = `选择 ${selected.length} 项` + (overwritten ? ` · 覆盖 ${overwritten} 项` : '');
  el('fill').disabled = busy || !selected.length;
}
function render() {
  const plan = state?.plan;
  el('review').hidden = !plan;el('agent').hidden = !plan;el('actions').hidden = !plan;el('result').hidden = !state?.report;
  if (plan) {
    const counts = plan.statusCounts || {};
    const pending = plan.rows.filter(row => !['ready','already'].includes(row.status)).length;
    const groups = new Map();
    for (const row of plan.rows) {const key = row.groupLabel || ({personal:'个人信息',education:'教育经历',work:'工作经历',projects:'项目经历'}[row.module] || '其他字段');if (!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    el('profile').value = plan.profileId;
    el('review').innerHTML = `<h2>核对本页填写计划</h2><div class="site">${escapeHtml(plan.origin + plan.path)}</div><div class="summary"><span><b>${plan.rows.length}</b>识别字段</span><span><b>${counts.ready || 0}</b>可填写</span><span><b>${counts.already || 0}</b>已有一致</span><span><b>${pending}</b>待核对</span></div>` + [...groups].map(([group, rows]) => `<h3>${escapeHtml(group)}</h3>` + rows.map(row => {
      const selectable = ['ready','conflict'].includes(row.status) && row.factKey;
      const choices = ['missing','ambiguous'].includes(row.status) ? `<select data-map="${escapeHtml(row.fieldId)}" aria-label="为${escapeHtml(row.label)}选择资料字段"><option value="">选择已确认资料…</option>${plan.choices.map(choice => `<option value="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</option>`).join('')}</select>` : '';
      const value = row.displayValue;
      return `<div class="field"><div class="field-top">${selectable ? `<input type="checkbox" data-field="${escapeHtml(row.fieldId)}" data-overwrite="${row.status === 'conflict'}" aria-label="${row.status === 'conflict' ? '覆盖已有' : '填写'}${escapeHtml(row.label)}" ${row.status === 'ready' ? 'checked' : ''}>` : ''}<button class="field-title" data-jump="${escapeHtml(row.fieldId)}" title="定位网页字段">${escapeHtml(row.label || '未命名字段')}</button><span class="state ${row.status}">${labels[row.status] || row.status}</span></div>${value ? `<div class="value">${escapeHtml(value)}</div>` : ''}<div class="reason">${escapeHtml(row.reason)}</div>${choices}</div>`;
    }).join('')).join('');
    if (document.querySelector('[data-map]')) el('review').insertAdjacentHTML('beforeend','<label class="check"><input id="rememberSelections" type="checkbox">记住本页所选匹配</label><button id="applyChoices">应用所选匹配并重新核对</button>');
    if (plan.provider?.called) notice(`Agent 已匹配 ${plan.provider.mapped || 0} 个字段；请核对更新后的计划。`);
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
el('autoLuna').addEventListener('change',()=>task(async()=>{await send('preferences',{preferences:{autoLuna:el('autoLuna').checked}});state=null;render();notice(el('autoLuna').checked?'已启用自动核对；仅对歧义字段调用 Luna，消耗现有 Codex 额度。':'已关闭自动核对；本地识别和填写继续可用。');},'正在保存偏好…'));
el('scan').addEventListener('click', () => task(async () => {state=await send('scan',{profile:el('profile').value});render();notice(state.lunaError || '计划已生成；勾选的字段会填写，已有内容默认保留。',!!state.lunaError);},'正在识别字段并核对资料…'));
el('profile').addEventListener('change', () => task(async()=>{await send('preferences',{preferences:{profile:el('profile').value}});state=null;sourceLabel();render();notice('已更改口径，请重新识别当前页面。');},'正在切换简历口径…'));
el('review').addEventListener('change', selection);
el('review').addEventListener('click', event => {
  const jump=event.target.closest('[data-jump]');
  if(jump)task(()=>send('highlight',{fieldId:jump.dataset.jump}),'正在定位网页字段…');
  if(event.target.id==='applyChoices')task(async()=>{const mappings=Object.fromEntries([...document.querySelectorAll('[data-map]')].filter(select=>select.value).map(select=>[select.dataset.map,select.value]));state=await send('remap',{mappings,remember:el('rememberSelections').checked});render();notice('匹配已应用，请再次核对计划。');},'正在核对所选资料…');
});
el('agentCopy').addEventListener('click',()=>task(async()=>{const value=await send('agent-task');await navigator.clipboard.writeText(value.task);notice('匹配任务已复制；交给你正在使用的 Agent，再粘贴它返回的 JSON。');},'正在生成 Agent 匹配任务…'));
el('agentImport').addEventListener('click',()=>task(async()=>{const mappings=JSON.parse(el('agentResult').value);state=await send('remap',{mappings,remember:el('remember').checked});render();notice('Agent 匹配已导入；约束和已有内容保护仍生效。');},'正在验证 Agent 匹配…'));
async function checkCodex() {
  const provider=await send('codex-status');
  if(!provider.available||provider.auth!=='chatgpt')throw Error(provider.message);
  if(!provider.models.some(model=>model.id===MODEL))throw Error('当前 Codex 未提供 GPT-6 Luna；请更新 Codex 桌面端。原计划保留，不会换用其他模型。');
  el('agentConnectionStatus').textContent='GPT-6 Luna 已连接 · 使用现有 Codex 额度。';
  return provider;
}
el('agentCheck').addEventListener('click',()=>task(async()=>{await checkCodex();notice('ChatGPT 登录与 Luna 目录已确认，检查没有发起模型生成。');},'正在检查 Codex 连接…'));
el('agentCli').addEventListener('click',()=>task(async()=>{await checkCodex();state=await send('remap',{agent:true,model:MODEL});render();notice('Luna 已返回匹配，请核对计划后填写。');},'Luna 正在核对歧义字段；明确字段不会重复调用模型…'));
el('fill').addEventListener('click',()=>task(async()=>{const inputs=[...document.querySelectorAll('#review input[data-field]:checked')];state=await send('fill',{selected:inputs.map(input=>input.dataset.field),overwrite:inputs.filter(input=>input.dataset.overwrite==='true').map(input=>input.dataset.field)});render();notice('所选字段已执行并读回核验，请查看逐项结果。');},'正在填写所选字段并读回核验…'));
task(async()=>{const value=await send('state');available(value.profile?.count);el('profile').value=value.preferences.profile;el('autoLuna').checked=value.preferences.autoLuna;profileSummary=value.profile;sourceLabel();state=value.state;render();notice(state?.lunaError || '',!!state?.lunaError);},'正在读取本地资料…');
