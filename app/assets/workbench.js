// Complete workspace management uses the same service and version contract as Agent tools.
const managementLabels = {
  records: '招聘记录',
  preps: '公司准备',
  prospects: '探查报告',
  reviews: '面试复盘',
  qbank: '通用题库',
  schedule: '日程'
};
let management = null, managementPreviewGeneration = 0,
  managementDraftTimer = null,
  settingsState = null,
  persistQueue = Promise.resolve(),
  workspaceDraftsReady = false;
function managementWritable() {
  return !window.__SNAPSHOT__ && serverMode;
}
async function managementRequest(module, body) {
  const response = await fetch((apiBase || '') + '/api/manage' + (body ? '' : '?module=' + encodeURIComponent(module)), body ? {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      module,
      workspaceKey: toudiWorkspaceStorage.id,
      ...body
    })
  } : {});
  let result;
  try {
    result = await response.json();
  } catch (e) {
    throw Error('服务返回无效内容，草稿未提交');
  }
  if (!response.ok) throw Error(response.status === 409 ? '版本冲突：草稿已保留，请导出草稿并与最新资料对账。' : result.error || '未保存：服务暂不可用');
  return result;
}
function managementStyle() {
  const nonce = document.querySelector('style[nonce]')?.nonce;
  document.head.insertAdjacentHTML('beforeend', `<style${nonce ? ' nonce="' + nonce + '"' : ''}>.management-dialog{width:min(1060px,94vw);max-height:90vh;display:flex;flex-direction:column;background:var(--card);border-radius:10px;padding:22px;gap:14px}.management-body{overflow:auto;min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px}.management-list{border-right:1px solid var(--border);padding-right:14px;overflow:auto}.management-list button{width:100%;text-align:left;margin-bottom:5px;white-space:normal}.management-form label{display:grid;gap:6px;font-size:12px;color:var(--text2);margin-bottom:12px}.management-form input,.management-form textarea,.management-form select{width:100%;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border);padding:10px;border-radius:5px;font:inherit}.management-form textarea{min-height:220px;resize:vertical;line-height:1.65}.management-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 12px;align-items:start}.management-fields textarea{height:90px;min-height:90px}.management-form details{margin:12px 0}.management-form details>summary{cursor:pointer;margin-bottom:10px}.management-preview{padding:15px;background:var(--bg);border:1px solid var(--border);max-height:360px;overflow:auto}.management-actions{display:flex;gap:8px;flex-wrap:wrap}.management-message{color:var(--text3);font-size:12px;line-height:1.6;white-space:pre-wrap}.management-status{min-height:20px;color:var(--text2);font-size:13px}.management-dialog h2{margin:0;font-size:19px}@media(max-width:700px){.management-body{grid-template-columns:1fr}.management-list{max-height:130px;border-right:0;border-bottom:1px solid var(--border)}.management-fields{grid-template-columns:1fr}.management-dialog{padding:14px}}</style>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="managementOverlay" class="modal-overlay" style="display:none"><section class="management-dialog" role="dialog" aria-modal="true" aria-labelledby="managementTitle"><div class="filter-dialog-head"><h2 id="managementTitle">管理资料</h2><button class="btn" onclick="closeManagement()">关闭</button></div><div id="managementTools" class="management-actions"></div><div id="managementBody" class="management-body"></div><div id="managementStatus" class="management-status" role="status"></div><div id="managementActions" class="management-actions"></div></section></div>`);
}
let managementPreviousFocus = null;
function showManagementDialog() {
  const overlay=document.getElementById('managementOverlay');
  if(overlay.style.display!=='flex')managementPreviousFocus=document.activeElement;
  overlay.style.display='flex';
  overlay.querySelector('.filter-dialog-head .btn').focus();
}
function closeManagement() {
  document.getElementById('managementOverlay').style.display = 'none';
  if(managementPreviousFocus?.isConnected)managementPreviousFocus.focus();
}
document.addEventListener('keydown',event=>{
  const overlay=document.getElementById('managementOverlay');
  if(!overlay||overlay.style.display!=='flex')return;
  if(event.key==='Escape'){event.preventDefault();closeManagement();return;}
  if(event.key!=='Tab')return;
  const elements=[...overlay.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
  const first=elements[0],last=elements.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!overlay.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!overlay.contains(document.activeElement))){event.preventDefault();first?.focus();}
});
function managementItems() {
  const d = management.data;
  if (management.module === 'records') return Array.isArray(d) ? d : d.records || [];
  if (management.module === 'preps') return Array.isArray(d) ? d : d.preps || [];
  if (management.module === 'prospects') return Array.isArray(d) ? d : d.companies || d.prospects || [];
  if (management.module === 'reviews') return d.sessions || [];
  return d.categories || [];
}
function managementName(item) {
  return item.company || item['名称'] || item.record?.['名称'] || item.name || item.title || item.id;
}
async function openManagement(module) {
  if (!managementWritable()) {
    showToast('当前为只读页面，写入需要连接工作区服务');
    return;
  }
  try {
    const result = await managementRequest(module);
    document.getElementById('managementBody').classList.remove('recovery-body');
    management = {
      module,
      version: result.version,
      data: result.data,
      keys: result.keys,
      index: -1,
      importing: false
    };
    document.getElementById('managementTitle').textContent = (module === 'qbank' ? '高级导入与导出：' : '管理') + managementLabels[module];
    showManagementDialog();
    managementRender();
  } catch (e) {
    showToast(e.message);
  }
}
function managementRender() {
  const m = management;
  const legacyDraft=JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDraft') || 'null');
  const draft = JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts') || '{}')[m.module] || (legacyDraft?.module === m.module ? legacyDraft : null);
  document.getElementById('managementTools').innerHTML = (draft ? `<button class="btn" onclick="resumeManagementDraft('${m.module}')">继续未保存编辑</button>` : '') + `${m.module === 'qbank' ? '<button class="btn btn-primary" onclick="closeManagement();startWorkspaceContent(\'qbank\')">添加准备条目</button>' : '<button class="btn btn-primary" onclick="managementSelect(-1)">新增</button>'}<label class="btn">选择导入文件<input hidden type="file" accept=".json,.md,.markdown" onchange="managementImport(event)"></label><button class="btn" onclick="managementExport()">导出完整规范资料</button><button class="btn" onclick="managementExportDraft()">导出当前草稿</button><button class="btn" onclick="copyAgentBootstrap('${m.module}')">交给 Agent</button>`;
  document.getElementById('managementBody').innerHTML = `<aside class="management-list">${managementItems().map((item, i) => `<button class="btn btn-sm" onclick="managementSelect(${i})">${esc(managementName(item))}</button>`).join('') || '<p class="management-message">尚无资料，可新增或导入。</p>'}</aside><div id="managementForm" class="management-form"></div>`;
  managementSelect(m.index);
}
function managementSelect(index) {
  const m = management;
  managementPreviewGeneration++;
  m.checked = null;
  m.index = index;
  m.importing = false;
  m.original = index < 0 ? null : structuredClone(managementItems()[index]);
  m.item = m.original ? structuredClone(m.original) : {};
  if (m.module === 'preps' && !m.item.attachments) {
    m.item.attachments = [...(m.item.markdown || '').matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].filter(x => !/^https?:|^mailto:|^#/.test(x[2])).map(x => ({
      label: x[1],
      file: x[2]
    }));
  }
  m.recordKey = m.module === 'records' && index >= 0 ? m.keys?.[index] : null;
  const fieldNames = {id: '资料标识', companyKey: '关联投递记录（可留空）', company: '公司（必填）', position: '岗位', researchedAt: '调研日期', file: '报告文件路径（自动生成，可留空）', markdown: '正文（Markdown）', prepBody: '准备内容（可选，支持 Markdown）'};
  const label = (key, value, area = false) => `<label>${esc(fieldNames[key] || key)}${area ? `<textarea data-mfield="${esc(key)}">${esc(value || '')}</textarea>` : `<input data-mfield="${esc(key)}" value="${esc(value || '')}">`}</label>`;
  let form = '';
  if (m.module === 'records') {
    const r = m.item.record || m.item;
    form = '<div class="management-fields">' + ['名称', '校招类型', '行业', '性质', '录入时间', '截止时间', '岗位', '地点', '应届生', '学历要求', '公告链接', '网申链接/邮箱'].map(k => label(k, r[k], ['岗位', '公告链接', '网申链接/邮箱'].includes(k))).join('') + '</div>';
    if (r['归并来源']) form += '<p class="management-message">已有归并来源会原样保留；修改主体身份时由服务核对关联。</p>';
  } else if (['preps', 'prospects'].includes(m.module)) {
    if (!m.item.id) m.item.id = m.module + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
    form = '';
    if (m.module === 'preps') form += label('company', m.item.company) + label('position', m.item.position);
    if (m.module === 'prospects') form += label('company', m.item.company) + label('researchedAt', m.item.researchedAt) + label('file', m.item.file || m.item.filename);
    form += label(m.module === 'preps' && !m.original ? 'prepBody' : 'markdown', m.item.markdown || m.item.content || '', true);
    if(m.module === 'preps' && !m.original) form += '<p class="management-message">填写公司即可建立空白准备；正文可稍后补充。系统自动组织标题和章节，支持 Markdown。</p>';
    form += '<details><summary>关联与资料标识</summary>' + label('companyKey', m.item.companyKey) + label('id', m.item.id) + '<p class="management-message">资料标识自动生成。已有资料请保留原标识，便于持续更新。</p></details>';
    form += '<div class="management-actions"><label class="btn">添加附件<input type="file" hidden multiple onchange="managementAttachments(event)"></label></div><div id="managementAttachments"></div>';
  } else if (m.module === 'reviews') {
    form = managementReviewForm();
  } else {
    form = label('题库 JSON', JSON.stringify(m.data, null, 2), true) + '<p class="management-message">JSON 仅用于高级批量导入；日常新增和编辑请使用通用准备中的分类与条目表单。规范格式为 {categories:[{id,name,items:[{id,title,body}]}]}。保留已有 id 和其他字段。</p>';
  }
  form += '<p class="management-message">先检查范围和预览，再提交。只有服务确认后才显示已保存；错误和冲突保留当前草稿。</p><div id="managementPreview" class="management-preview" hidden></div>';
  document.getElementById('managementForm').innerHTML = form;
  document.getElementById('managementActions').innerHTML = `<button class="btn" onclick="managementPreview()">检查与预览</button><button id="managementSubmit" class="btn btn-primary" disabled onclick="managementCommit()">提交保存</button>${m.original ? '<button class="btn" onclick="managementDeletePreview()">删除此条</button>' : ''}`;
  document.getElementById('managementStatus').textContent = '正在编辑草稿；尚未提交。';
  document.getElementById('managementForm').oninput = () => {
    m.checked = null;
    managementPreviewGeneration++;
    document.getElementById('managementSubmit').disabled = true;
    managementRemember();
  };
  managementAttachmentList();
}
// Review creation captures the real session without asking the user to author JSON.
// Existing fields and question diagnostics survive a metadata or original-answer edit.
function managementReviewForm() {
  const item = management.item;
  if (!item.id) item.id = 'review-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
  item.questions = item.questions || [];
  const field = (key, title, value, type = 'text') => `<label>${title}<input data-mfield="${key}" type="${type}" value="${esc(value || '')}"></label>`;
  return '<div class="management-fields">' + field('company', '公司', item.company) + field('position', '岗位', item.position) + field('round', '轮次', item.round) + field('date', '日期', item.date, 'date') + field('companyKey', '关联投递记录（公司键，可留空）', item.companyKey) + '</div><label>本场总结（支持 Markdown）<textarea data-mfield="summaryRaw">' + esc(item.summary?.raw || '') + '</textarea></label>' + '<p class="management-message">记录实际题目和当时的回答。保存后可在原复盘页面继续填写诊断、追问与必要的改进回答。</p>' + '<div id="managementReviewQuestions">' + managementReviewQuestionsMarkup() + '</div>' + '<button type="button" class="btn btn-sm" onclick="managementAddReviewQuestion()">添加题目</button>' + '<details style="margin-top:14px"><summary>高级导入与标识</summary><p class="management-message">场次标识：' + esc(item.id) + '。顶部“选择导入文件”支持标准复盘 Markdown 或完整 JSON，已有标识和其他字段会保留。</p></details>';
}
function managementReviewQuestionsMarkup() {
  return management.item.questions.map((question, index) => '<fieldset style="border:1px solid var(--border);padding:12px;margin-bottom:12px"><legend>Q' + esc(question.n || index + 1) + '</legend>' + '<label>题目<input data-review-question="' + index + '" value="' + esc(question.question || '') + '"></label>' + '<label>当时的回答<textarea data-review-answer="' + index + '">' + esc(question.originalAnswer || '') + '</textarea></label>' + '<button type="button" class="btn btn-sm" onclick="managementRemoveReviewQuestion(' + index + ')">移除此题</button></fieldset>').join('');
}
function managementReadReviewQuestions() {
  return management.item.questions.map((question, index) => ({
    ...question,
    n: question.n || index + 1,
    question: document.querySelector('[data-review-question="' + index + '"]')?.value || '',
    originalAnswer: document.querySelector('[data-review-answer="' + index + '"]')?.value || ''
  }));
}
function managementAddReviewQuestion() {
  management.item.questions = managementReadReviewQuestions();
  const next = Math.max(0, ...management.item.questions.map(question => Number(question.n) || 0)) + 1;
  management.item.questions.push({
    n: next,
    question: '',
    originalAnswer: ''
  });
  managementReviewQuestionsChanged();
}
function managementRemoveReviewQuestion(index) {
  management.item.questions = managementReadReviewQuestions();
  management.item.questions.splice(index, 1);
  managementReviewQuestionsChanged();
}
function managementReviewQuestionsChanged() {
  document.getElementById('managementReviewQuestions').innerHTML = managementReviewQuestionsMarkup();
  management.checked = null;
  managementPreviewGeneration++;
  document.getElementById('managementSubmit').disabled = true;
  managementRemember();
}
function managementCandidate() {
  const m = management;
  if (m.importing) return m.importPayload;
  const fields = Object.fromEntries([...document.querySelectorAll('[data-mfield]')].map(e => [e.dataset.mfield, e.value]));
  if (m.module === 'records') {
    if (!fields['名称'].trim()) throw Error('名称不能为空');
    return {
      action: 'upsert',
      item: {
        id: m.recordKey || m.original?.id || m.original?._key || '',
        record: {
          ...(m.original?.record || m.original || {}),
          ...fields
        }
      }
    };
  }
  if (['preps', 'prospects'].includes(m.module)) {
    if (!fields.id.trim()) throw Error('请填写稳定的 id');
    if(m.module === 'preps' && !m.original) {
      if(!fields.company?.trim()) throw Error('请填写公司');
      fields.markdown = '## 准备内容\n' + (fields.prepBody || '');
      fields.structured = true;
      delete fields.prepBody;
    }
    if (!fields.markdown.trim()) throw Error('Markdown 正文不能为空');
    return {
      action: 'upsert',
      item: {
        ...Object.fromEntries(Object.entries(m.item).filter(([key]) => key !== 'deletedAttachments')),
        ...fields
      },
      ...(m.module === 'preps' ? {
        files: [...(m.item.attachments || []).filter(a => a.contentBase64).map(a => ({
          path: (m.item.mdPath || '面试准备/' + fields.id + '.md').replace(/[^/]+$/, '') + a.file,
          contentBase64: a.contentBase64
        })), ...(m.item.deletedAttachments || []).map(file => ({
          path: (m.item.mdPath || '面试准备/' + fields.id + '.md').replace(/[^/]+$/, '') + file,
          delete: true
        }))]
      } : {})
    };
  }
  if (m.module === 'reviews') {
    if (!fields.company?.trim()) throw Error('请填写公司');
    if (!fields.date) throw Error('请选择本场日期');
    const {
      summaryRaw,
      ...metadata
    } = fields;
    return {
      action: 'upsert',
      item: {
        ...m.item,
        ...metadata,
        summary: {
          ...(m.item.summary || {}),
          raw: summaryRaw
        },
        questions: managementReadReviewQuestions()
      }
    };
  }
  const parsed = JSON.parse(Object.values(fields)[0]);
  if (m.module === 'qbank') {
    if (!Array.isArray(parsed.categories)) throw Error('题库必须包含 categories 数组');
    return {
      action: 'replace',
      data: parsed
    };
  }
  if (!parsed.id) throw Error('场次 id 不能为空');
  return {
    action: 'upsert',
    item: parsed
  };
}
function managementReviewPreview(item) {
  return '<p><strong>' + esc(item.company) + '</strong> · ' + esc(item.position || '') + ' · ' + esc(item.round || '') + ' · ' + esc(item.date) + '</p>' + renderMd(item.summary?.raw || '') + item.questions.map(question => '<h3>Q' + esc(question.n) + ' ' + esc(question.question) + '</h3>' + renderMd(question.originalAnswer || '')).join('');
}
async function managementPreview() {
  const current=management, generation=++managementPreviewGeneration;
  current.checked=null;
  document.getElementById('managementSubmit').disabled=true;
  try {
    const payload = managementCandidate();
    document.getElementById('managementStatus').textContent='正在校验格式和版本…';
    await managementRequest(current.module,{base:current.version,...payload,dryRun:true});
    if(management!==current || generation!==managementPreviewGeneration)return;
    management.checked = payload;
    const box = document.getElementById('managementPreview');
    box.hidden = false;
    box.innerHTML = '<p><strong>提交范围：</strong>' + esc(managementLabels[management.module]) + '；' + esc(payload.action === 'replace' ? '替换所预览的规范集合' : payload.action === 'import' ? '导入文件中的条目' : '仅当前条目') + '</p>' + (management.module === 'reviews' && payload.item?.questions ? managementReviewPreview(payload.item) : payload.item?.markdown || payload.markdown ? renderMd(payload.item?.markdown || payload.markdown) : '<pre style="white-space:pre-wrap">' + esc(JSON.stringify(payload.item || payload.data, null, 2)) + '</pre>');
    document.getElementById('managementSubmit').disabled = false;
    document.getElementById('managementStatus').textContent = '服务已校验格式和当前版本。请核对预览后提交；尚未保存。';
  } catch (e) {
    if(management!==current || generation!==managementPreviewGeneration)return;
    document.getElementById('managementStatus').textContent = '检查未通过：' + e.message;
  }
}
function managementDeletePreview() {
  managementPreviewGeneration++;
  management.checked = {
    action: 'delete',
    id: management.recordKey || management.original.id || management.original._key
  };
  if (management.module === 'records' && !management.checked.id) {
    const r = management.original.record || management.original;
    management.checked.id = r['名称'];
  }
  const box = document.getElementById('managementPreview');
  box.hidden = false;
  box.textContent = '将删除 ' + managementName(management.original) + '。服务会保留恢复副本；关联标记不会被无声丢弃。';
  document.getElementById('managementSubmit').disabled = false;
  document.getElementById('managementSubmit').textContent = '确认可恢复删除';
}
async function managementCommit() {
  const m = management;
  if (!m.checked) return;
  const button = document.getElementById('managementSubmit');
  button.disabled = true;
  try {
    clearTimeout(managementDraftTimer);
    const result = await managementRequest(m.module, {
      base: m.version,
      ...m.checked
    });
    const latest = await managementRequest(m.module);
    m.version = latest.version;
    m.data = latest.data;
    m.keys = latest.keys || m.keys;
    toudiWorkspaceStorage.removeItem('toudiManagementDraft');
    const remaining = JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts') || '{}');
    delete remaining[m.module];
    toudiWorkspaceStorage.setItem('toudiManagementDrafts', JSON.stringify(remaining));
    try {
      await managementClearRemoteDraft();
    } catch (e) {}
    showToast('服务已确认保存');
    await managementRefresh(m.module);
    m.index = -1;
    managementRender();
    document.getElementById('managementStatus').textContent = '已保存到工作区。' + (result.recovery ? '已保留恢复副本。' : '');
  } catch (e) {
    document.getElementById('managementStatus').textContent = e.message + ' 当前草稿仍保留。';
    button.disabled = false;
  }
}
async function managementRefresh(module) {
  if (module === 'records') {
    const result = await managementRequest('records');
    const rows = Array.isArray(result.data) ? result.data : result.data.records;
    initData(rows.map(r => r.record || r));
    render();
  } else await ensureViewData(module === 'reviews' ? 'review' : module === 'prospects' ? 'prospect' : 'qbank', true);
}
function managementExport() {
  downloadBlob(new Blob([JSON.stringify(management.data, null, 2)], {
    type: 'application/json'
  }), management.module + '.json');
}
function managementExportDraft() {
  let payload;
  try {
    payload = managementCandidate();
  } catch (e) {
    payload = {
      raw: document.getElementById('managementForm').innerText,
      fields: [...document.querySelectorAll('[data-mfield]')].map(el => ({
        key: el.dataset.mfield,
        value: el.value
      }))
    };
  }
  downloadBlob(new Blob([JSON.stringify({
    workspaceKey: toudiWorkspaceStorage.id,
    module: management.module,
    base: management.version,
    ...payload
  }, null, 2)], {
    type: 'application/json'
  }), 'toudi-draft.json');
}
async function managementImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw Error('文件超过20MB');
    const text = await file.text();
    const markdown = /\.(md|markdown)$/i.test(file.name);
    let payload;
    if (markdown) {
      if (!['preps', 'prospects', 'reviews'].includes(management.module)) throw Error('本模块请使用规范 JSON');
      payload = {
        action: 'import',
        item: {
          id: file.name.replace(/\.[^.]+$/, ''),
          markdown: text
        }
      };
      if (management.module === 'prospects') throw Error('探查 Markdown 请先新增报告，填写公司和日期，再粘贴正文或使用规范 JSON 导入');
    } else {
      const data = JSON.parse(text);
      payload = {
        action: 'import',
        data
      };
    }
    management.importing = true;
    management.importPayload = payload;
    management.checked = null;
  managementPreviewGeneration++;
    document.getElementById('managementForm').innerHTML = '<p class="management-message">已选择 ' + esc(file.name) + '（' + file.size + ' 字节）。检查预览不会写入工作区。</p><div id="managementPreview" class="management-preview" hidden></div>';
    document.getElementById('managementSubmit').disabled = true;
    managementPreview();
    await managementRemember();
  } catch (e) {
    document.getElementById('managementStatus').textContent = '导入未提交：' + e.message;
  }
  event.target.value = '';
}
async function managementAttachments(event) {
  const files = [...event.target.files];
  try {
    management.item.attachments = management.item.attachments || [];
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) throw Error('附件超过20MB');
      const attachment = {
        file: file.name,
        label: file.name
      };
      if (management.module === 'prospects') {
        if (!/\.md$/i.test(file.name)) throw Error('探查附件仅支持 Markdown');
        attachment.markdown = await file.text();
      } else {
        attachment.contentBase64 = await fileBase64(file);
        const body = document.querySelector('[data-mfield=markdown],[data-mfield=prepBody]');
        body.value += '\n\n[' + file.name + '](' + file.name + ')';
      }
      management.item.attachments.push(attachment);
    }
    managementAttachmentList();
    management.checked = null;
  managementPreviewGeneration++;
    document.getElementById('managementSubmit').disabled = true;
    managementRemember();
  } catch (e) {
    document.getElementById('managementStatus').textContent = e.message;
  }
  event.target.value = '';
}
function managementAttachmentList() {
  const box = document.getElementById('managementAttachments');
  if (!box) return;
  box.innerHTML = (management.item.attachments || []).map((a, i) => '<p>' + esc(a.label || a.file) + ' <button class="btn btn-sm" onclick="managementRemoveAttachment(' + i + ')">移除附件</button></p>').join('');
}
function managementRemoveAttachment(index) {
  const attachment = management.item.attachments[index];
  management.item.deletedAttachments = management.item.deletedAttachments || [];
  management.item.deletedAttachments.push(attachment.file);
  const body = document.querySelector('[data-mfield=markdown],[data-mfield=prepBody]');
  if (body) body.value = body.value.replace(new RegExp('\\[[^\\]]*\\]\\(' + attachment.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)', 'g'), '');
  management.item.attachments.splice(index, 1);
  management.checked = null;
  managementPreviewGeneration++;
  document.getElementById('managementSubmit').disabled = true;
  managementAttachmentList();
  managementRemember();
}
async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 32768) encoded += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(encoded);
}
async function managementRemember() {
  if (!management) return;
  let candidate;
  try {
    candidate = managementCandidate();
  } catch (e) {
    candidate = {
      fields: [...document.querySelectorAll('[data-mfield]')].map(el => ({
        key: el.dataset.mfield,
        value: el.value
      }))
    };
  }
  const draft = {
    workspaceKey: toudiWorkspaceStorage.id,
    module: management.module,
    base: management.version,
    candidate,
    savedAt: new Date().toISOString()
  };
  toudiWorkspaceStorage.setItem('toudiManagementDraft', JSON.stringify(draft));
  const all = JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts') || '{}');
  all[draft.module] = draft;
  toudiWorkspaceStorage.setItem('toudiManagementDrafts', JSON.stringify(all));
  scheduleDraftMirror();
}
async function managementClearRemoteDraft() {
  clearTimeout(managementDraftTimer);
  await persistDrafts();
}
async function persistDrafts() {
  if (!workspaceDraftsReady || !managementWritable() || window.__TOUDI_DESKTOP__?.diagnostic) return;
  return enqueuePersist('drafts', latest => ({
    legacyDrafts: [
      ...(latest.legacyDrafts||[]).filter(entry=>{
        const draft=parseDraft(JSON.stringify(entry.draft));
        if(draft)return draft.sessionId!==draftSessionId&&confirmedDrafts.get(entry.key)!==JSON.stringify(canonicalJson(draft));
        return !(unscopedRemoteDrafts?.legacyDrafts||[]).some(old=>JSON.stringify(canonicalJson(old))===JSON.stringify(canonicalJson(entry)));
      }),
      ...listUnsavedDrafts().filter(entry=>entry.draft.sessionId===draftSessionId)
    ],
    management: JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDraft') || 'null'),
    managementDrafts: JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts') || '{}'),
    unscopedRecovery: unscopedRemoteDrafts
  }));
}
function enqueuePersist(module, dataFn) {
  const job = async () => {
    const latest = await managementRequest(module);
    const data={...latest.data,...dataFn(latest.data)};
    if(JSON.stringify(canonicalJson(data))===JSON.stringify(canonicalJson(latest.data)))return latest;
    return managementRequest(module, {base:latest.version,action:'replace',data});
  };
  const next = persistQueue.then(job, job);
  persistQueue = next.catch(() => {});
  return next;
}
function scheduleDraftMirror(){clearTimeout(managementDraftTimer);managementDraftTimer=setTimeout(()=>persistDrafts().catch(()=>{}),350);}
const localWriteDraft = writeDraft;
writeDraft = function (...args) {
  const result = localWriteDraft(...args);
  scheduleDraftMirror();
  return result;
};
// Acknowledged saves and rebased in-flight drafts must update the disk mirror too.
const localClearOwnDraft = clearOwnDraft;
clearOwnDraft = function (...args) {
  localClearOwnDraft(...args);
  scheduleDraftMirror();
};
const localAdvanceOwnDraftBase = advanceOwnDraftBase;
advanceOwnDraftBase = function (...args) {
  const changed = localAdvanceOwnDraftBase(...args);
  if (changed) {
    scheduleDraftMirror();
  }
  return changed;
};
saveWorkspace = async function () {
  if (window.__TOUDI_DESKTOP__?.diagnostic) return;
  pageSize = Number(workspace.pageSize) || 50;
  toudiWorkspaceStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  applyWorkspace();
  if (!managementWritable()) {
    showToast('显示偏好已保存到本设备');
    return;
  }
  try {
    if (!settingsState) settingsState = await managementRequest('settings');
    const result = await managementRequest('settings', {
      base: settingsState.version,
      action: 'replace',
      data: {
        ...settingsState.data,
        display: workspace
      }
    });
    settingsState = result;
    toudiWorkspaceStorage.removeItem('toudiPendingSettings');
    showToast('显示偏好已保存到工作区');
  } catch (e) {
    toudiWorkspaceStorage.setItem('toudiPendingSettings', JSON.stringify(workspace));
    showToast('配置未提交，已保留本设备草稿：' + e.message);
  }
};
async function managementInit() {
  managementStyle();
  document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend', '<button id="managementEntry" class="btn btn-sm" onclick="managementForView()">管理资料</button>');
  document.getElementById('managementEntry').hidden = view === 'settings';
  if (window.__SNAPSHOT__) {
    document.getElementById('managementEntry').disabled = true;
    return;
  }
  await initServerStorage();
  if (!serverMode) return;
  try {
    settingsState = await managementRequest('settings');
    sourcePreferenceRules = settingsState.data.preferenceRules || null;
    renderQuickViews();
    if (view === 'settings') renderSettings();
    else if (['table','kanban','charts'].includes(view)) render();
    const saved = settingsState.data.display;
    if (saved) {
      const pending = JSON.parse(toudiWorkspaceStorage.getItem('toudiPendingSettings') || 'null');
      workspace = {
        ...WORKSPACE_DEFAULT,
        ...(pending || saved)
      };
      toudiWorkspaceStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
      applyWorkspace();
      if (workspace.defaultView && workspace.defaultView !== view) switchView(workspace.defaultView);
      else if (view === 'settings') renderSettings();
    } else if (!window.__TOUDI_DESKTOP__?.diagnostic && toudiWorkspaceStorage.getItem(WORKSPACE_KEY)) {
      await saveWorkspace();
    }
    const remote = await managementRequest('drafts');
    // Old drafts did not record a workspace. Preserve them for export, without auto-applying.
    unscopedRemoteDrafts=remote.data.unscopedRecovery||null;
    const unknown={};
    for(const entry of remote.data.legacyDrafts||[]){
      const draft=parseDraft(JSON.stringify(entry.draft));
      if(draft&&DRAFT_PREFIX[draft.domain]){
        const key=DRAFT_PREFIX[draft.domain]+draft.workspaceKey+':'+draft.sessionId;
        if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(draft));
      }else (unknown.legacyDrafts ||= []).push(entry);
    }
    const current=JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts')||'{}');
    for(const [module,draft] of Object.entries(remote.data.managementDrafts||{})){
      if(draft?.workspaceKey===toudiWorkspaceStorage.id){if(!current[module])current[module]=draft;}
      else (unknown.managementDrafts ||= {})[module]=draft;
    }
    toudiWorkspaceStorage.setItem('toudiManagementDrafts',JSON.stringify(current));
    if(remote.data.management){
      if(remote.data.management.workspaceKey===toudiWorkspaceStorage.id){if(!toudiWorkspaceStorage.getItem('toudiManagementDraft'))toudiWorkspaceStorage.setItem('toudiManagementDraft',JSON.stringify(remote.data.management));}
      else unknown.management=remote.data.management;
    }
    if(Object.keys(unknown).length)unscopedRemoteDrafts={...(unscopedRemoteDrafts||{}),...unknown};
    workspaceDraftsReady=true;
    await persistDrafts();
  } catch (e) {
    showToast('工作区配置读取失败：' + e.message);
  }
}
function managementForView() {
  if (view === 'settings') return;
  openManagement(view === 'qbank' ? qbMode === 'company' ? 'preps' : 'qbank' : view === 'review' ? 'reviews' : view === 'prospect' ? 'prospects' : 'records');
}
const baseRenderSettings = renderSettings;
renderSettings = function () {
  baseRenderSettings();
  document.querySelectorAll('#settingsView .settings-note').forEach(el => {
    if (el.textContent.includes('仅保存在本浏览器')) el.textContent = managementWritable() ? '外观与阅读偏好保存到工作区；保存失败时保留本设备草稿。' : '当前只读页面：显示偏好仅保存到本设备。';
  });
  const host = document.getElementById('workspaceDataRows');
  const writable = managementWritable(), disabled = writable ? '' : 'disabled';
  host.innerHTML = (window.toudiDesktop ? settingsRow('当前资料','App 和 Agent 共用当前工作区，更新 App 不会更换资料。','<button class="btn" onclick="openDesktopWorkspace()">打开资料目录</button>') +
    settingsRow('切换资料','使用另一份已有工作区，先检查，再切换。','<button class="btn" onclick="selectDesktopWorkspace()">选择已有工作区</button>') : '') +
    settingsRow('备份全部资料','换机或重要改动前保存，包含记录、正文、附件与设置。',`<button class="btn" ${disabled} onclick="exportFullBackup()">保存备份文件</button>`) +
    settingsRow('从备份恢复','用于换机迁移或整体回退；先核对范围，再确认替换。',`<label class="btn backup-file-control" role="button" tabindex="${writable?0:-1}" ${writable?'':'aria-disabled="true"'}>选择备份文件<input type="file" accept=".zip" hidden ${disabled} onchange="previewBackup(event)"></label>`) +
    settingsRow('恢复历史修改','误删或改错时，选择一次修改并还原它涉及的资料。',`<button class="btn" ${disabled} onclick="openRecovery()">查看历史修改</button>`) +
    '<p class="settings-note">备份文件用于 TouDi 恢复，不能作为部署网站直接打开。日常保存与更新不需要导出。</p>';
  if(window.toudiDesktop) host.insertAdjacentHTML('beforeend', `<details class="settings-disclosure"><summary><span class="disclosure-title">查看本机资料位置</span>${disclosureAction()}</summary><div class="setting-detail"><p class="connection-path">${esc(window.__TOUDI_DESKTOP__.workspace)}</p></div></details>`);
};
async function openDesktopWorkspace() {
  try { await window.toudiDesktop.showWorkspace(); }
  catch (e) { showToast('资料目录未能打开：' + e); }
}
async function exportFullBackup() {
  try {
    const response = await fetch((apiBase || '') + '/api/backup');
    if (!response.ok) throw Error('完整备份下载失败');
    const blob = await response.blob();
    if (window.toudiDesktop) {
      if (!await window.toudiDesktop.saveBlob(blob, 'toudi-backup-' + today() + '.zip')) { showToast('已取消导出'); return; }
    } else downloadBlob(blob, 'toudi-backup-' + today() + '.zip');
    showToast('完整备份已导出');
  } catch (e) {
    showToast(e.message);
  }
}
let backupCandidate = null;
async function previewBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  backupCandidate = null;
  try {
    const state = await managementRequest('workspace');
    backupCandidate = {
      base: state.version,
      contentBase64: await fileBase64(file)
    };
    const response = await fetch((apiBase || '') + '/api/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...backupCandidate,
        action: 'preview'
      })
    });
    const preview = await response.json();
    if (!response.ok) throw Error(preview.error || '备份检查失败');
    backupCandidate.base = preview.base;
    prepareRecoveryDialog('从备份恢复');
    const files = preview.files || [];
    const preserved = preview.preserved || [];
    document.getElementById('managementBody').innerHTML = `<div class="recovery-summary"><strong>${esc(file.name)}</strong><p>备份包含 ${files.length} 个文件：${esc(backupScopeLabel(files))}。</p><p>确认后将完整业务资料与设置恢复到这份备份；备份中没有的现有业务文件也会移除。${preserved.length ? '这份旧备份未包含填报资料，以下现有文件会保留：'+preserved.map(esc).join('、')+'。' : ''}当前内容会自动保留为恢复副本；如只需撤销一次改动，请使用“恢复历史修改”。</p><details class="settings-disclosure"><summary><span class="disclosure-title">查看备份中的文件</span>${disclosureAction()}</summary><ul class="recovery-files">${files.map(entry=>'<li>'+esc(entry.path)+'</li>').join('')}</ul></details></div>`;
    document.getElementById('managementActions').innerHTML='<button class="btn" onclick="closeManagement()">取消</button><button class="btn btn-primary" id="backupCommit" onclick="commitBackup()">确认恢复全部资料</button>';
  } catch (e) {
    showToast(e.message);
  }
  event.target.value = '';
}
async function commitBackup() {
  if (!backupCandidate) return;
  const button=document.getElementById('backupCommit');if(button)button.disabled=true;
  try {
    const response = await fetch((apiBase || '') + '/api/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(backupCandidate)
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '恢复失败');
    showToast('完整备份已恢复，重新读取资料');
    location.reload();
  } catch (e) {
    if(button)button.disabled=false;
    document.getElementById('managementStatus').textContent=e.message + '，备份候选仍保留；版本冲突时请重新选择文件并检查范围。';
  }
}
async function resumeManagementDraft(module) {
  const all = JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts') || '{}');
  if (!module && Object.keys(all).length > 1) {
    showManagementDialog();
    document.getElementById('managementTitle').textContent = '选择管理草稿';
    document.getElementById('managementTools').innerHTML = '';
    document.getElementById('managementActions').innerHTML = '';
    document.getElementById('managementBody').innerHTML = '<div>' + Object.keys(all).filter(k => managementLabels[k]).map(k => '<p><button class="btn" onclick="resumeManagementDraft(\'' + k + '\')">' + esc(managementLabels[k]) + '</button> ' + esc(all[k].savedAt) + '</p>').join('') + '</div>';
    return;
  }
  const legacy=JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDraft') || 'null');
  const draft = module ? all[module] || (legacy?.module === module ? legacy : null) : Object.values(all)[0] || legacy;
  if (!draft) {
    showToast('没有管理草稿');
    return;
  }
  await openManagement(draft.module);
  if (!management) return;
  management.version = draft.base;
  if (draft.candidate.fields) {
    draft.candidate.fields.forEach(f => {
      const el = [...document.querySelectorAll('[data-mfield]')].find(e => e.dataset.mfield === f.key);
      if (el) el.value = f.value;
    });
  } else {
    management.importing = true;
    management.importPayload = draft.candidate;
  }
  document.getElementById('managementStatus').textContent = '已恢复草稿及原版本；请检查预览，冲突时保留候选并对账。';
}
function backupScopeLabel(files){
  const known={'投递数据/投递记录.json':'招聘记录','投递数据/用户编辑数据.json':'个人标记与偏好','投递数据/逐字稿数据.json':'通用题库','投递数据/面试准备数据.json':'公司准备','投递数据/面试复盘数据.json':'面试复盘','岗位探查/探查目录.json':'岗位探查','投递数据/工作区配置.json':'设置','投递数据/草稿数据.json':'编辑草稿','填报资料/资料.json':'填报资料','网申信息库.json':'原始填报资料'};
  const labels=[...new Set(files.map(file=>known[file.path]||'正文与附件'))];
  return labels.join('、')||'无业务文件';
}
let recoveryChoices=[];
function recoveryModuleLabel(module){return managementLabels[module]||{edits:'个人标记与偏好',settings:'设置',drafts:'编辑草稿',profile:'填报资料'}[module]||'关联资料';}
function recoveryDate(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'历史修改':date.toLocaleString('zh-CN',{hour12:false});}
function prepareRecoveryDialog(title){
  showManagementDialog();
  document.getElementById('managementTitle').textContent=title;
  document.getElementById('managementTools').innerHTML='';
  document.getElementById('managementActions').innerHTML='';
  document.getElementById('managementStatus').textContent='';
  document.getElementById('managementBody').classList.add('recovery-body');
}
async function openRecovery(){
  try{
    const state=await managementRequest('trash');recoveryChoices=state.data?.transactions||[];
    prepareRecoveryDialog('恢复历史修改');
    document.getElementById('managementStatus').textContent='选择一次修改，先查看影响范围，再确认恢复。';
    document.getElementById('managementBody').innerHTML=recoveryChoices.length?
      '<p class="recovery-intro">还原所选修改涉及的整个资料文件，覆盖这些文件中更晚的改动。恢复前会自动保存当前内容。</p><div class="recovery-list">'+recoveryChoices.slice().reverse().map(item=>`<div class="recovery-choice"><div><strong>${esc(recoveryDate(item.createdAt))}</strong><p>${esc((item.modules||[]).map(recoveryModuleLabel).join('、')||'业务资料')} · ${(item.files||[]).length} 个文件</p></div><button class="btn" data-recovery="${esc(item.id)}">查看恢复范围</button></div>`).join('')+'</div>':
      '<div class="recovery-empty"><strong>暂无可恢复的修改</strong><p>通过 App 或资料工具保存的业务修改会在这里保留恢复副本。</p></div>';
    document.querySelectorAll('[data-recovery]').forEach(button=>button.onclick=()=>recoveryPreview(button.dataset.recovery));
  }catch(error){showToast(error.message);}
}
async function recoveryPreview(id){
  const state=await managementRequest('trash'),item=state.data.transactions.find(row=>row.id===id);
  if(!item){showToast('这份修改副本已不可用，请重新读取历史。');return;}
  prepareRecoveryDialog('确认恢复范围');
  document.getElementById('managementBody').innerHTML=`<div class="recovery-summary"><strong>${esc(recoveryDate(item.createdAt))} 修改前的资料</strong><p>涉及：${esc(item.modules.map(recoveryModuleLabel).join('、')||'关联资料')}。</p><p>将还原下列 ${item.files.length} 个完整文件，覆盖其中更晚的改动；其他资料不变。当前内容会自动保留为恢复副本。</p><ul class="recovery-files">${item.files.map(file=>'<li>'+esc(file)+'</li>').join('')}</ul></div>`;
  document.getElementById('managementActions').innerHTML='<button class="btn" onclick="openRecovery()">返回历史修改</button><button class="btn btn-primary" id="recoveryCommit">确认恢复</button>';
  document.getElementById('recoveryCommit').onclick=async function(){
    this.disabled=true;
    try{await managementRequest('trash',{action:'restore',id,base:state.version});showToast('恢复已保存');location.reload();}
    catch(error){document.getElementById('managementStatus').textContent=error.message;this.disabled=false;}
  };
}
if (window.__TOUDI_DESKTOP_READY__) {
  window.__TOUDI_DESKTOP_READY__.then(managementInit).catch(() => {});
} else {
  managementInit();
}

// Empty-state actions and refresh share the existing management and save contracts.
async function startWorkspaceContent(module, importing = false) {
  if(module === 'qbank' && !importing) {
    if(!qbankMutationAllowed())return;
    qbMode = 'general';
    if(!qbData.categories.length) { await qbAddCategory(); }
    const category=qbData.categories.find(c=>c.id===currentQbCat)||qbData.categories[0];
    if(category){currentQbCat=category.id;qbAddItem(category.id);}
    return;
  }
  await openManagement(module);
  if (importing && document.getElementById('managementOverlay').style.display === 'flex') {
    document.querySelector('#managementTools input[type=file]')?.click();
  }
}
copyAgentBootstrap = async function (module) {
  const isTask = ['records','qbank','preps','prospects','reviews'].includes(module);
  const text = isTask ? agentTaskText(module) : agentBootstrapText();
  try {
    await navigator.clipboard.writeText(text);
    showToast(isTask ? '任务消息已复制，请补充材料和范围后发送' : '接入消息已复制，请补充本次任务后发送');
  } catch (error) {
    const field = document.createElement('textarea');
    field.value = text;
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    showToast(copied ? '启动消息已复制，请补充后发送' : '复制未完成，请展开并选择启动消息');
  }
};
const workspaceRefreshSnapshots = new Map();
const workspacePendingUpdates = new Set();
let workspaceRefreshRunning = false;
let workspaceRefreshTask = null;
let workspaceRefreshManual = false;
let workspaceRefreshManifestRead = false;
let workspaceRefreshAgain = false;
function setWorkspaceRefreshBusy(busy) {
  const button = document.getElementById('workspaceRefreshButton');
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.textContent = busy ? '正在刷新…' : '刷新资料';
}
function workspaceDetailDraftExists() {
  const fieldsByRecord = new Map(detailInputMemory);
  if(document.getElementById('detailModal')?.style.display==='flex' && detailIdx!==null) {
    fieldsByRecord.set(detailIdx,[...document.querySelectorAll('#detailContent input,#detailContent textarea')].map(field=>({id:field.id,value:field.value})));
  }
  return [...fieldsByRecord.entries()].some(([index, fields]) => {
    const row = byId(index);
    return fields.some(field => {
      const expected = field.id === 'researchNote' ? row?._researchNote || '' : field.id.startsWith('fe_') ? row?.[field.id.slice(3)] || '' : field.value;
      // Textareas normalize CRLF/CR to LF while parsing. Compare the same
      // browser representation without rewriting the full source note.
      const normalized = value => String(value ?? '').replace(/\r\n?/g, '\n');
      return normalized(field.value) !== normalized(expected);
    });
  });
}
function workspaceHasDraft(module) {
  if(module==='schedule' && window.toudiSchedule?.hasDraft())return true;
  const domain = module === 'records' ? 'edits' : module;
  let stored;
  try { stored = JSON.parse(toudiWorkspaceStorage.getItem('toudiManagementDrafts') || '{}'); } catch (error) { return true; }
  const managerOpen = document.getElementById('managementOverlay')?.style.display === 'flex';
  if ((managerOpen && management?.module === module) || stored[module] || listUnsavedDrafts().some(item => item.domain === domain)) return true;
  if (module === 'profile') return document.querySelector('#fillingDialog iframe')?.contentWindow?.toudiProfileEditor?.hasDraft() || false;
  if (module === 'records' || module === 'edits') {
    return workspaceDetailDraftExists() || editsDirty || editsConflict || editsSaveInFlight || (fieldEditIdx!==null && document.getElementById('detailModal')?.style.display==='flex') || document.getElementById('noteModal')?.style.display === 'flex';
  }
  if (module === 'qbank') return qbankDirty || qbankConflict || qbankSaveInFlight || qbankFormEditing() || qbFormDrafts.size > 0 || qbCategoryEditing.size > 0;
  if (module === 'reviews') return reviewDirty || reviewConflict || reviewSaveInFlight || reviewFormEditing();
  return false;
}
function showWorkspaceRefreshNotice(message, state = 'pending') {
  const notice = document.getElementById('workspaceRefreshNotice');
  const button = document.getElementById('workspaceUpdatesButton');
  if (!notice || !button) return;
  const text = message || '资料已是最新。后台会自动检查更新，你也可以主动刷新。';
  if (notice.querySelector('span').textContent !== text) notice.querySelector('span').textContent = text;
  button.dataset.state = message ? state : 'idle';
  button.querySelector('.workspace-update-dot').hidden = !message;
  button.title = message ? (state === 'error' ? '资料读取失败，点击查看' : '有资料更新待显示，点击查看') : '查看资料更新状态';
  button.setAttribute('aria-label', button.title);
}
function toggleWorkspaceUpdates() {
  const notice = document.getElementById('workspaceRefreshNotice');
  const button = document.getElementById('workspaceUpdatesButton');
  notice.hidden = !notice.hidden;
  button.setAttribute('aria-expanded', String(!notice.hidden));
}
function closeWorkspaceUpdates() {
  const notice = document.getElementById('workspaceRefreshNotice');
  if (notice) notice.hidden = true;
  document.getElementById('workspaceUpdatesButton')?.setAttribute('aria-expanded', 'false');
}
function repaintWorkspaceEmptySurfaces() {
  const activeModule = view === 'qbank' ? (qbMode === 'company' ? 'preps' : 'qbank') : view === 'review' ? 'reviews' : view === 'prospect' ? 'prospects' : 'records';
  if (workspaceHasDraft(activeModule)) return;
  if (['table', 'kanban', 'charts'].includes(view)) render();
  else if (view === 'qbank' && !qbankFormEditing()) renderQbank();
  else if (view === 'review' && !reviewFormEditing()) renderReview();
  else if (view === 'prospect') renderProspect();
  else if (view === 'schedule') window.toudiSchedule?.update();
}
async function refreshWorkspaceData(manual = false) {
  if (window.__SNAPSHOT__) return;
  if (workspaceRefreshTask) {
    if (manual) {
      if (!workspaceRefreshManual) {workspaceRefreshManual = true;setWorkspaceRefreshBusy(true);}
      // A manifest received before this click may miss files committed while
      // its readers were running. Join the read, then check a fresh manifest.
      // If the manifest is still in flight, its response covers this click.
      if (workspaceRefreshManifestRead) workspaceRefreshAgain = true;
    }
    return workspaceRefreshTask;
  }
  workspaceRefreshRunning = true;
  workspaceRefreshManual = manual;
  if (manual) setWorkspaceRefreshBusy(true);
  workspaceRefreshTask = (async () => {
    let changed = false;
    do {
      workspaceRefreshAgain = false;
      workspaceRefreshManifestRead = false;
      changed = !!await readWorkspaceUpdates() || changed;
    } while (workspaceRefreshAgain);
    if (workspaceRefreshManual && !workspacePendingUpdates.size && document.getElementById('workspaceUpdatesButton')?.dataset.state !== 'error') {
      showToast(changed ? '已读取工作区最新资料' : '资料没有变化');
    }
  })().finally(() => {
    workspaceRefreshRunning = false;
    if (workspaceRefreshManual) setWorkspaceRefreshBusy(false);
    workspaceRefreshManual = false;
    workspaceRefreshTask = null;
  });
  return workspaceRefreshTask;
}
async function readWorkspaceUpdates() {
  const originalFocus = document.activeElement;
  const focusState = originalFocus?.id ? {id: originalFocus.id, start: originalFocus.selectionStart, end: originalFocus.selectionEnd} : null;
  const allModules = ['settings', 'edits', 'records', 'qbank', 'preps', 'prospects', 'reviews', 'profile', 'schedule'];
  try {
    if (!serverMode || apiBase === null) await initServerStorage();
    if (!serverMode || apiBase === null) {showWorkspaceRefreshNotice('工作区服务未连接，请检查后重新读取。', 'error');return;}
    const response = await fetch((apiBase || '') + '/api/workspace-changes', {cache:'no-store'});
    if (!response.ok) throw Error('工作区更新状态暂时无法读取');
    const snapshot = await response.json();
    workspaceRefreshManifestRead = true;
    if (snapshot.workspaceKey !== toudiWorkspaceStorage.id || !snapshot.revisions) throw Error('工作区连接已变化，请重新确认资料目录');
    // A manual check also compares revisions. Re-reading unchanged modules
    // rebuilds readers/forms for no benefit; failed reads still retry explicitly.
    const modules = allModules.filter(module => snapshot.revisions[module] && (workspaceReadStates[module] === 'error' || workspacePendingUpdates.has(module) || workspaceRefreshSnapshots.get(module) !== snapshot.revisions[module]));
    // Reader APIs already return current contents and their collection bases.
    // Avoid downloading the same report twice or hashing every attachment just
    // to detect changes; full business versions remain in the write contract.
    const results = await Promise.allSettled(modules.map(module => ['settings','records'].includes(module) ? managementRequest(module) : Promise.resolve(null)));
    let changed = false;
    let emptyStateChanged = false;
    const updatedModules = new Set();
    const failures = [];
    for (let index = 0; index < modules.length; index++) {
      const module = modules[index], result = results[index];
      if (result.status !== 'fulfilled') {
        emptyStateChanged ||= workspaceReadStates[module] !== 'error';
        workspaceReadStates[module] = 'error';
        failures.push(managementLabels[module] || (module === 'settings' ? '工作区设置' : '个人标记'));
        continue;
      }
      emptyStateChanged ||= workspaceReadStates[module] !== 'ready';
      workspaceReadStates[module] = 'ready';
      const fingerprint = snapshot.revisions[module];
      if ((module === 'settings' && (workspaceSettingsSaving || toudiWorkspaceStorage.getItem('toudiPendingSettings'))) || workspaceHasDraft(module) || (module === 'records' && workspaceHasDraft('edits'))) {
        workspacePendingUpdates.add(module);
        continue;
      }
      // Protect forms opened while the read was in flight. Never advance their save base.
      let readComplete = true;
      if (module === 'settings') {
        settingsState = result.value;
        sourcePreferenceRules = settingsState.data.preferenceRules || null;
        if (settingsState.data.display) {
          workspace = {...WORKSPACE_DEFAULT,...settingsState.data.display};
          toudiWorkspaceStorage.setItem(WORKSPACE_KEY,JSON.stringify(workspace));
          applyWorkspace();
        }
        renderQuickViews();
        if(view === 'settings') renderSettings();
        else if(['table','kanban','charts'].includes(view)) render();
      } else if (module === 'profile') {
        const editor = document.querySelector('#fillingDialog iframe')?.contentWindow?.toudiProfileEditor;
        if (editor && !await editor.refresh()) {workspacePendingUpdates.add(module);continue;}
      } else if (module === 'schedule') {if(window.toudiSchedule && !await window.toudiSchedule.refresh()) {workspacePendingUpdates.add(module);continue;}}
      else if (module === 'edits') readComplete = await initServerStorage();
      else if (module === 'records') {
        const keys = new Set(data.filter(row => selected.has(row._idx)).map(row => row._key));
        const detailKey=document.getElementById('detailModal')?.style.display==='flex'?byId(detailIdx)?._key:null;
        detailInputMemory.clear();
        initData(result.value.data);
        selected = new Set(data.filter(row => keys.has(row._key)).map(row => row._idx));
        render();
        refreshRecruitmentDetail(detailKey);
      } else if (module === 'qbank') readComplete = await initQbankStorage();
      else if (module === 'preps') readComplete = await initPrepsStorage();
      else if (module === 'prospects') readComplete = await initProspectsStorage();
      else if (module === 'reviews') readComplete = await initReviewsStorage();
      if (workspaceHasDraft(module)) {workspacePendingUpdates.add(module);continue;}
      const readFailed = readComplete === false || (module==='schedule' && window.toudiSchedule?.hasError()) || SAVE_DOMAINS[module]?.readFailed || (module === 'preps' && workspaceReadStates.preps === 'error') || (module === 'prospects' && !!prospectLoadError);
      if (readFailed) {workspaceReadStates[module]='error';failures.push(managementLabels[module]||(module==='settings'?'工作区设置':'个人标记'));emptyStateChanged=true;continue;}
      workspaceRefreshSnapshots.set(module, fingerprint);
      workspacePendingUpdates.delete(module);
      changed = true;
      updatedModules.add(module);
    }
    if (failures.length) showWorkspaceRefreshNotice(failures.join('、') + '读取失败，当前内容保留。可检查连接后重新读取。', 'error');
    else if (workspacePendingUpdates.size) showWorkspaceRefreshNotice([...workspacePendingUpdates].map(module=>managementLabels[module] || (module==='profile'?'填报资料':module==='settings'?'设置':'个人标记')).join('、') + '有更新；当前编辑已保留，结束编辑后自动读取。版本冲突时先保留草稿核对。');
    else {
      showWorkspaceRefreshNotice('');
    }
    if(['records','edits'].some(module=>updatedModules.has(module)) && view==='schedule')window.toudiSchedule?.update();
    if(view==='settings'&&['settings','edits','records'].some(module=>updatedModules.has(module)))renderSettings();
    // Unchanged content never redraws, so focus, selection and reader scroll remain intact.
    const visibleModules = view === 'qbank' ? ['qbank','preps'] : view === 'review' ? ['reviews'] : view === 'prospect' ? ['prospects'] : view === 'schedule' ? ['schedule','records','edits'] : ['records','edits'];
    if (emptyStateChanged || visibleModules.some(module=>updatedModules.has(module))) repaintWorkspaceEmptySurfaces();
    return changed;
  } catch (error) {
    showWorkspaceRefreshNotice(error.message + '，当前内容保留，连接恢复后自动重试。', 'error');
  } finally {
    if (focusState && (document.activeElement === document.body || document.activeElement === originalFocus)) {
      const current = document.getElementById(focusState.id);
      if (current && current !== originalFocus) {current.focus({preventScroll:true});try {current.setSelectionRange(focusState.start,focusState.end);} catch(error) {}}
    }
  }
}
function installWorkspaceRefresh() {
  document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend', '<div id="workspaceRefreshControl" class="workspace-refresh-control"><button id="workspaceRefreshButton" class="btn btn-sm" onclick="refreshWorkspaceData(true)">刷新资料</button><button id="workspaceUpdatesButton" type="button" class="btn btn-sm workspace-update-button" data-state="idle" aria-label="查看资料更新状态" aria-controls="workspaceRefreshNotice" aria-expanded="false" onclick="toggleWorkspaceUpdates()" title="查看资料更新状态"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg><i class="workspace-update-dot" hidden></i></button><div id="workspaceRefreshNotice" class="workspace-refresh-note" hidden><strong>资料更新</strong><span></span></div></div>');
  showWorkspaceRefreshNotice('');
  document.addEventListener('click', event => { if (!event.target.closest('#workspaceRefreshControl')) closeWorkspaceUpdates(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { const open = !document.getElementById('workspaceRefreshNotice').hidden; closeWorkspaceUpdates(); if (open) document.getElementById('workspaceUpdatesButton').focus(); } });
  if (window.__SNAPSHOT__) {
    document.getElementById('workspaceRefreshButton').disabled = true;
    return;
  }
  window.addEventListener('focus', () => refreshWorkspaceData());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshWorkspaceData(); });
  // A focused App can stay open while the Agent publishes files. Poll only
  // small revision signals; unchanged modules do not download or redraw.
  const timer=setInterval(() => {if(document.visibilityState==='visible')refreshWorkspaceData();},4000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  // Initialization may restore drafts before the first remote read.
  const ready = setInterval(() => {
    if (!serverMode) return;
    clearInterval(ready);
    refreshWorkspaceData();
  }, 200);
  setTimeout(() => {clearInterval(ready);if(!serverMode){for(const module of ['records','qbank','preps','prospects','reviews'])workspaceReadStates[module]='error';repaintWorkspaceEmptySurfaces();}}, 6000);
}
const workspaceBaseKanban = renderKanban;
renderKanban = function (...args) {
  document.querySelectorAll('#kanbanView>.workspace-empty').forEach(node=>node.remove());
  workspaceBaseKanban(...args);
  if (!data.length) document.getElementById('kanbanBoard').insertAdjacentHTML('beforebegin', workspaceEmptyState('records'));
};
const workspaceBaseCharts = renderCharts;
renderCharts = function (...args) {
  document.querySelectorAll('#chartsView>.workspace-empty').forEach(node=>node.remove());
  workspaceBaseCharts(...args);
  if (!data.length) document.getElementById('chartsGrid').insertAdjacentHTML('beforebegin', workspaceEmptyState('records'));
};
const workspaceBaseRender = render;
render = function (...args) {
  document.querySelectorAll('#kanbanView>.workspace-empty,#chartsView>.workspace-empty').forEach(node => node.remove());
  workspaceBaseRender(...args);
};
installWorkspaceRefresh();

async function selectDesktopWorkspace() {
  if (['records','edits','qbank','preps','prospects','reviews','profile'].some(workspaceHasDraft) || workspaceSettingsSaving || toudiWorkspaceStorage.getItem('toudiPendingSettings')) {
    showToast('请先保存或导出未提交草稿，再切换工作区');
    return;
  }
  try {
    const selected = await window.toudiDesktop.selectWorkspace();
    if (selected) location.reload();
  } catch (error) {
    showToast('工作区未切换：' + error);
  }
}

let workspaceSettingsSaving = 0;
const workspaceOriginalSaveSettings = saveWorkspace;
saveWorkspace = async function (...args) {
  workspaceSettingsSaving++;
  try { return await workspaceOriginalSaveSettings(...args); }
  finally { workspaceSettingsSaving--; }
};

function trackWorkspaceReader(module, load, isEmpty, failed) {
  return async function (...args) {
    const loadingEmpty = isEmpty() && !workspaceHasDraft(module);
    if (loadingEmpty) workspaceReadStates[module] = 'loading';
    try {
      const result = await load(...args);
      workspaceReadStates[module] = result === false || failed() ? 'error' : 'ready';
      return result;
    } finally {
      const visibleLoading = document.querySelector('.workspace-empty[data-empty-module="' + module + '"][data-empty-state="loading"]');
      if (visibleLoading) repaintWorkspaceEmptySurfaces();
    }
  };
}
initQbankStorage = trackWorkspaceReader('qbank', initQbankStorage, () => !qbData.categories.length, () => SAVE_DOMAINS.qbank.readFailed);
initPrepsStorage = trackWorkspaceReader('preps', initPrepsStorage, () => !prepData.preps.length, () => workspaceReadStates.preps === 'error');
initReviewsStorage = trackWorkspaceReader('reviews', initReviewsStorage, () => !reviewData.sessions.length, () => SAVE_DOMAINS.reviews.readFailed);
initProspectsStorage = trackWorkspaceReader('prospects', initProspectsStorage, () => !prospectData.prospects.length, () => !!prospectLoadError);
