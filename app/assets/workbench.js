// Complete workspace management uses the same service and version contract as Agent tools.
const managementLabels = {
  records: '招聘记录',
  preps: '公司准备',
  prospects: '探查报告',
  reviews: '面试复盘',
  qbank: '通用题库'
};
let management = null,
  managementDraftTimer = null,
  settingsState = null,
  persistQueue = Promise.resolve();
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
function closeManagement() {
  document.getElementById('managementOverlay').style.display = 'none';
}
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
    management = {
      module,
      version: result.version,
      data: result.data,
      keys: result.keys,
      index: -1,
      importing: false
    };
    document.getElementById('managementTitle').textContent = '管理' + managementLabels[module];
    document.getElementById('managementOverlay').style.display = 'flex';
    managementRender();
  } catch (e) {
    showToast(e.message);
  }
}
function managementRender() {
  const m = management;
  document.getElementById('managementTools').innerHTML = `<button class="btn" onclick="managementSelect(-1)">新增</button><label class="btn">选择导入文件<input hidden type="file" accept=".json,.md,.markdown" onchange="managementImport(event)"></label><button class="btn" onclick="managementExport()">导出完整规范资料</button><button class="btn" onclick="managementExportDraft()">导出当前草稿</button>`;
  document.getElementById('managementBody').innerHTML = `<aside class="management-list">${managementItems().map((item, i) => `<button class="btn btn-sm" onclick="managementSelect(${i})">${esc(managementName(item))}</button>`).join('') || '<p class="management-message">尚无资料，可新增或导入。</p>'}</aside><div id="managementForm" class="management-form"></div>`;
  managementSelect(m.index);
}
function managementSelect(index) {
  const m = management;
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
  const fieldNames = {id: '资料标识', companyKey: '关联投递记录（可留空）', company: '公司', position: '岗位', researchedAt: '调研日期', file: '报告文件路径（自动生成，可留空）', markdown: '正文（Markdown）'};
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
    form += label('markdown', m.item.markdown || m.item.content || '', true);
    form += '<details><summary>关联与资料标识</summary>' + label('companyKey', m.item.companyKey) + label('id', m.item.id) + '<p class="management-message">资料标识自动生成。已有资料请保留原标识，便于持续更新。</p></details>';
    form += '<div class="management-actions"><label class="btn">添加附件<input type="file" hidden multiple onchange="managementAttachments(event)"></label></div><div id="managementAttachments"></div>';
  } else if (m.module === 'reviews') {
    form = managementReviewForm();
  } else {
    form = label('题库 JSON', JSON.stringify(m.data, null, 2), true) + '<p class="management-message">规范格式为 {categories:[{id,name,items:[{id,title,body}]}]}。保留已有 id 和其他字段。</p>';
  }
  form += '<p class="management-message">先检查范围和预览，再提交。只有服务确认后才显示已保存；错误和冲突保留当前草稿。</p><div id="managementPreview" class="management-preview" hidden></div>';
  document.getElementById('managementForm').innerHTML = form;
  document.getElementById('managementActions').innerHTML = `<button class="btn" onclick="managementPreview()">检查与预览</button><button id="managementSubmit" class="btn btn-primary" disabled onclick="managementCommit()">提交保存</button>${m.original ? '<button class="btn" onclick="managementDeletePreview()">删除此条</button>' : ''}`;
  document.getElementById('managementStatus').textContent = '正在编辑草稿；尚未提交。';
  document.getElementById('managementForm').oninput = () => {
    m.checked = null;
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
function managementPreview() {
  try {
    const payload = managementCandidate();
    management.checked = payload;
    const box = document.getElementById('managementPreview');
    box.hidden = false;
    box.innerHTML = '<p><strong>提交范围：</strong>' + esc(managementLabels[management.module]) + '；' + esc(payload.action === 'replace' ? '替换所预览的规范集合' : payload.action === 'import' ? '导入文件中的条目' : '仅当前条目') + '</p>' + (management.module === 'reviews' && payload.item?.questions ? managementReviewPreview(payload.item) : payload.item?.markdown || payload.markdown ? renderMd(payload.item?.markdown || payload.markdown) : '<pre style="white-space:pre-wrap">' + esc(JSON.stringify(payload.item || payload.data, null, 2)) + '</pre>');
    document.getElementById('managementSubmit').disabled = false;
    document.getElementById('managementStatus').textContent = '格式已检查，预览中的内容将在当前版本基础上提交。';
  } catch (e) {
    document.getElementById('managementStatus').textContent = '检查未通过：' + e.message;
  }
}
function managementDeletePreview() {
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
    localStorage.removeItem('toudiManagementDraft');
    const remaining = JSON.parse(localStorage.getItem('toudiManagementDrafts') || '{}');
    delete remaining[m.module];
    localStorage.setItem('toudiManagementDrafts', JSON.stringify(remaining));
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
        const body = document.querySelector('[data-mfield=markdown]');
        body.value += '\n\n[' + file.name + '](' + file.name + ')';
      }
      management.item.attachments.push(attachment);
    }
    managementAttachmentList();
    management.checked = null;
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
  const body = document.querySelector('[data-mfield=markdown]');
  if (body) body.value = body.value.replace(new RegExp('\\[[^\\]]*\\]\\(' + attachment.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)', 'g'), '');
  management.item.attachments.splice(index, 1);
  management.checked = null;
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
    module: management.module,
    base: management.version,
    candidate,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem('toudiManagementDraft', JSON.stringify(draft));
  const all = JSON.parse(localStorage.getItem('toudiManagementDrafts') || '{}');
  all[draft.module] = draft;
  localStorage.setItem('toudiManagementDrafts', JSON.stringify(all));
  clearTimeout(managementDraftTimer);
  managementDraftTimer = setTimeout(() => persistDrafts().catch(() => {}), 350);
}
async function managementClearRemoteDraft() {
  clearTimeout(managementDraftTimer);
  await persistDrafts();
}
async function persistDrafts() {
  if (!managementWritable() || window.__TOUDI_DESKTOP__?.diagnostic) return;
  return enqueuePersist('drafts', () => ({
    legacyDrafts: listUnsavedDrafts(),
    management: JSON.parse(localStorage.getItem('toudiManagementDraft') || 'null'),
    managementDrafts: JSON.parse(localStorage.getItem('toudiManagementDrafts') || '{}')
  }));
}
function enqueuePersist(module, dataFn) {
  const job = async () => {
    const latest = await managementRequest(module);
    await managementRequest(module, {
      base: latest.version,
      action: 'replace',
      data: {
        ...latest.data,
        ...dataFn()
      }
    });
  };
  const next = persistQueue.then(job, job);
  persistQueue = next.catch(() => {});
  return next;
}
const localWriteDraft = writeDraft;
writeDraft = function (...args) {
  const result = localWriteDraft(...args);
  clearTimeout(managementDraftTimer);
  managementDraftTimer = setTimeout(() => persistDrafts().catch(() => {}), 350);
  return result;
};
const browserSaveWorkspace = saveWorkspace;
saveWorkspace = async function () {
  if (window.__TOUDI_DESKTOP__?.diagnostic) return;
  pageSize = Number(workspace.pageSize) || 50;
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
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
    localStorage.removeItem('toudiPendingSettings');
    showToast('显示偏好已保存到工作区');
  } catch (e) {
    localStorage.setItem('toudiPendingSettings', JSON.stringify(workspace));
    showToast('配置未提交，已保留本设备草稿：' + e.message);
  }
};
async function managementInit() {
  managementStyle();
  document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend', '<button id="managementEntry" class="btn btn-sm" onclick="managementForView()">管理资料</button>');
  if (window.__SNAPSHOT__) {
    document.getElementById('managementEntry').disabled = true;
    return;
  }
  await initServerStorage();
  if (!serverMode) return;
  try {
    settingsState = await managementRequest('settings');
    const saved = settingsState.data.display;
    if (saved) {
      const pending = JSON.parse(localStorage.getItem('toudiPendingSettings') || 'null');
      workspace = {
        ...WORKSPACE_DEFAULT,
        ...(pending || saved)
      };
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
      applyWorkspace();
      if (workspace.defaultView && workspace.defaultView !== view) switchView(workspace.defaultView);
      else if (view === 'settings') renderSettings();
    } else if (!window.__TOUDI_DESKTOP__?.diagnostic && localStorage.getItem(WORKSPACE_KEY)) {
      await saveWorkspace();
    }
    const remote = await managementRequest('drafts');
    for (const entry of remote.data.legacyDrafts || []) {
      if (entry.key && !localStorage.getItem(entry.key)) localStorage.setItem(entry.key, JSON.stringify(entry.draft));
    }
    if (remote.data.managementDrafts) {
      const current = JSON.parse(localStorage.getItem('toudiManagementDrafts') || '{}');
      localStorage.setItem('toudiManagementDrafts', JSON.stringify({
        ...remote.data.managementDrafts,
        ...current
      }));
    }
    if (remote.data.management && !localStorage.getItem('toudiManagementDraft')) localStorage.setItem('toudiManagementDraft', JSON.stringify(remote.data.management));
    await persistDrafts();
  } catch (e) {
    showToast('工作区配置读取失败：' + e.message);
  }
}
function managementForView() {
  if (view === 'settings') {
    openRecovery();
    return;
  }
  openManagement(view === 'qbank' ? qbMode === 'company' ? 'preps' : 'qbank' : view === 'review' ? 'reviews' : view === 'prospect' ? 'prospects' : 'records');
}
const baseRenderSettings = renderSettings;
renderSettings = function () {
  baseRenderSettings();
  document.querySelectorAll('#settingsView .settings-note').forEach(el => {
    if (el.textContent.includes('仅保存在本浏览器')) el.textContent = managementWritable() ? '外观与阅读偏好保存到工作区；保存失败时保留本设备草稿。' : '当前只读页面：显示偏好仅保存到本设备。';
  });
  const dataPanel = document.getElementById('settings-panel-data');
  dataPanel.querySelector('.settings-section').insertAdjacentHTML('beforeend', `<div class="setting-row"><div class="setting-label"><strong>完整工作区</strong><p>业务正文、配置及登记附件。恢复前先检查范围，并保留恢复前副本。</p></div><div class="setting-control"><button class="btn" ${managementWritable() ? '' : 'disabled'} onclick="exportFullBackup()">下载完整备份</button><label class="btn">选择备份恢复<input type="file" accept=".zip" hidden ${managementWritable() ? '' : 'disabled'} onchange="previewBackup(event)"></label></div></div><details class="settings-disclosure"><summary><span class="disclosure-title"><strong>恢复删除、旧版本与管理草稿</strong></span>${disclosureAction()}</summary><div class="settings-section"><p class="settings-help">先查看可恢复内容，再选择需要恢复的版本。</p><div class="settings-actions"><button class="btn" ${managementWritable() ? '' : 'disabled'} onclick="openRecovery()">恢复删除与旧版本</button><button class="btn" ${managementWritable() ? '' : 'disabled'} onclick="resumeManagementDraft()">恢复管理草稿</button></div></div></details><div id="backupPreview"></div>`);
  if (window.toudiDesktop) {
    dataPanel.insertAdjacentHTML('afterbegin', `<section class="settings-section"><h3>桌面资料与查阅</h3><p class="settings-help">资料保存在安装目录外，加密查阅版用于其他设备阅读。</p><div class="setting-row"><div class="setting-label"><strong>当前工作区</strong><p>已连接个人资料目录。</p><details><summary>查看本机位置</summary><p class="connection-path">${esc(window.__TOUDI_DESKTOP__.workspace)}</p></details></div><div class="setting-control"><button class="btn" onclick="openDesktopWorkspace()">打开资料目录</button></div></div><div class="setting-row"><div class="setting-label"><strong>加密查阅版</strong><p>导出后按部署文档发布，在其他设备打开查阅。</p></div><div class="setting-control"><button class="btn" onclick="exportDesktopReading()">导出加密查阅版</button></div></div><details class="settings-disclosure"><summary><span class="disclosure-title"><strong>切换已有工作区</strong><small>使用另一份资料前先检查目录</small></span>${disclosureAction()}</summary><div class="settings-section"><p class="settings-help">选择已有资料目录，经过检查后重新绑定。</p><div class="settings-actions"><button class="btn" onclick="selectDesktopWorkspace()">使用已有工作区</button></div></div></details><div id="desktopReadingStatus" role="status"></div></section>`);
  }
};
async function openDesktopWorkspace() {
  try { await window.toudiDesktop.showWorkspace(); }
  catch (e) { showToast('资料目录未能打开：' + e); }
}
async function exportDesktopReading() {
  const status = document.getElementById('desktopReadingStatus');
  status.textContent = '正在生成加密查阅版…';
  try {
    const result = await window.toudiDesktop.exportReading();
    if (result.cancelled) { status.textContent = '已取消导出'; return; }
    status.innerHTML = '<p>加密查阅版已导出；解压后的文件可按部署文档上传。口令保存在本机，请另行妥善保管。</p><p class="connection-path">导出：' + esc(result.output) + '</p><p class="connection-path">口令文件：' + esc(result.passcodeFile) + '</p>';
  } catch (e) { status.textContent = '导出未完成：' + e; }
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
    document.getElementById('backupPreview').innerHTML = '<pre class="management-message">' + esc((preview.files || []).map(f => f.path + ' · ' + f.size + ' 字节').join('\n')) + '</pre>' + '<p class="management-message">已选择 ' + esc(file.name) + '，' + file.size + ' 字节。恢复范围：完整业务资料、配置与附件；当前工作区版本 ' + esc(state.version) + '。提交后由服务校验 ZIP 与关联，提交前保留恢复副本。</p><button class="btn" onclick="commitBackup()">确认恢复此完整备份</button>';
  } catch (e) {
    showToast(e.message);
  }
  event.target.value = '';
}
async function commitBackup() {
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
    showToast(e.message + '，备份候选仍保留');
  }
}
async function resumeManagementDraft(module) {
  const all = JSON.parse(localStorage.getItem('toudiManagementDrafts') || '{}');
  if (!module && Object.keys(all).length > 1) {
    document.getElementById('managementOverlay').style.display = 'flex';
    document.getElementById('managementTitle').textContent = '选择管理草稿';
    document.getElementById('managementTools').innerHTML = '';
    document.getElementById('managementActions').innerHTML = '';
    document.getElementById('managementBody').innerHTML = '<div>' + Object.keys(all).filter(k => managementLabels[k]).map(k => '<p><button class="btn" onclick="resumeManagementDraft(\'' + k + '\')">' + esc(managementLabels[k]) + '</button> ' + esc(all[k].savedAt) + '</p>').join('') + '</div>';
    return;
  }
  const draft = module ? all[module] : Object.values(all)[0] || JSON.parse(localStorage.getItem('toudiManagementDraft') || 'null');
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
async function openRecovery() {
  try {
    const response = await fetch((apiBase || '') + '/api/manage?module=trash');
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '恢复目录读取失败');
    document.getElementById('managementOverlay').style.display = 'flex';
    document.getElementById('managementTitle').textContent = '恢复删除与旧版本';
    document.getElementById('managementTools').innerHTML = '';
    document.getElementById('managementActions').innerHTML = '';
    document.getElementById('managementStatus').textContent = '恢复前会核对当前版本，并保留恢复前副本。';
    document.getElementById('managementBody').innerHTML = '<div class="management-form" style="grid-column:1/-1">' + (result.data?.transactions || []).slice().reverse().map(item => '<p>' + esc(item.label || item.id) + ' · ' + esc((item.files || []).join('、')) + ' <button class="btn" data-recovery="' + esc(item.id) + '">预览恢复</button></p>').join('') + '</div>';
    document.querySelectorAll('[data-recovery]').forEach(button => button.onclick = () => recoveryPreview(button.dataset.recovery));
  } catch (e) {
    showToast(e.message);
  }
}
async function recoveryPreview(id) {
  const state = await managementRequest('trash');
  document.getElementById('managementStatus').textContent = '恢复对象 ' + id + '；当前版本 ' + state.version + '。恢复将覆盖该副本涉及的资料，先保留现状。';
  document.getElementById('managementActions').innerHTML = '<button class="btn" id="recoveryCommit">确认恢复所选副本</button>';
  document.getElementById('recoveryCommit').onclick = async () => {
    try {
      const response = await fetch((apiBase || '') + '/api/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          module: 'trash',
          action: 'restore',
          id,
          base: state.version
        })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '恢复未提交');
      showToast('恢复已保存');
      location.reload();
    } catch (e) {
      document.getElementById('managementStatus').textContent = e.message;
    }
  };
}
const basicAgentBootstrap = agentBootstrapText;
function desktopAgentBootstrapText(includeLocalPaths = false) {
  const desktop = window.__TOUDI_DESKTOP__;
  if (!desktop) return basicAgentBootstrap();
  const location = includeLocalPaths ? desktop : {workspace:'{用户指定的正式工作区}',agentTool:'{用户提供的资料工具}',guideRoot:'{随工具提供的通用流程文档目录}'};
  return '请协助我使用 TouDi 管理求职资料。\n\n正式工作区：' + location.workspace + '\n资料工具：' + location.agentTool + '\n流程文档目录：' + location.guideRoot + '\n\n先读取正式工作区已有的 AGENTS.md、投递数据/AGENTS.md 或信源流程说明（如有），保留现有标准流程和命令入口。然后读取文档目录下的 AGENTS.md、docs/Agent接入.md、docs/流程协作.md 和 docs/内容与渲染契约.md。使用上述资料工具的 --workspace 参数指向正式工作区；先运行 --help 和 read，读取最新内容及对应版本。\n\n招聘信源、个人材料与本次任务由我提供。只处理本次目标，保留已有标记和无关内容；候选先 validate，再 commit，最后 read 读回核对。版本冲突保留候选，重新对账；不猜测信源、经历或日期。App 与工具共用同一母本，完成后核对正文、关联和附件。未获得相应任务授权时，不网申、不对外沟通、不发布个人资料。';
}
agentBootstrapText = function () { return desktopAgentBootstrapText(); };
if (window.__TOUDI_DESKTOP_READY__) {
  window.__TOUDI_DESKTOP_READY__.then(managementInit).catch(() => {});
} else {
  managementInit();
}

// Empty-state actions and refresh share the existing management and save contracts.
async function startWorkspaceContent(module, importing = false) {
  await openManagement(module);
  if (importing && document.getElementById('managementOverlay').style.display === 'flex') {
    document.querySelector('#managementTools input[type=file]')?.click();
  }
}
copyAgentBootstrap = async function (includeLocalPaths = false) {
  const text = includeLocalPaths === true ? desktopAgentBootstrapText(true) : agentBootstrapText();
  try {
    await navigator.clipboard.writeText(text);
    showToast(includeLocalPaths === true ? '本机接入说明已复制，包含当前目录' : '通用接入说明已复制');
  } catch (error) {
    const field = document.createElement('textarea');
    field.value = text;
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    showToast(copied ? '接入说明已复制' : '复制未完成，请在设置中选择接入说明');
  }
};
const workspaceRefreshSnapshots = new Map();
const workspacePendingUpdates = new Set();
let workspaceRefreshRunning = false;
function workspaceDetailDraftExists() {
  return [...detailInputMemory.entries()].some(([index, fields]) => {
    const row = byId(index);
    return fields.some(field => {
      const expected = field.id === 'researchNote' ? row?._researchNote || '' : field.id.startsWith('fe_') ? row?.[field.id.slice(3)] || '' : field.value;
      return field.value !== expected;
    });
  });
}
function workspaceHasDraft(module) {
  const domain = module === 'records' ? 'edits' : module;
  let stored;
  try { stored = JSON.parse(localStorage.getItem('toudiManagementDrafts') || '{}'); } catch (error) { return true; }
  const managerOpen = document.getElementById('managementOverlay')?.style.display === 'flex';
  if (managerOpen || stored[module] || listUnsavedDrafts().some(item => item.domain === domain)) return true;
  if (module === 'records' || module === 'edits') {
    return workspaceDetailDraftExists() || editsDirty || editsConflict || editsSaveInFlight || document.getElementById('detailModal')?.style.display === 'flex' || document.getElementById('noteModal')?.style.display === 'flex';
  }
  if (module === 'qbank' || module === 'preps') return qbankDirty || qbankConflict || qbankSaveInFlight || qbankFormEditing() || qbFormDrafts.size > 0 || qbCategoryEditing.size > 0;
  if (module === 'reviews') return reviewDirty || reviewConflict || reviewSaveInFlight || reviewFormEditing();
  return false;
}
function showWorkspaceRefreshNotice(message) {
  const notice = document.getElementById('workspaceRefreshNotice');
  if (!notice) return;
  notice.hidden = !message;
  notice.querySelector('span').textContent = message;
}
function repaintWorkspaceEmptySurfaces() {
  const activeModule = view === 'qbank' ? (qbMode === 'company' ? 'preps' : 'qbank') : view === 'review' ? 'reviews' : view === 'prospect' ? 'prospects' : 'records';
  if (workspaceHasDraft(activeModule)) return;
  if (['table', 'kanban', 'charts'].includes(view)) render();
  else if (view === 'qbank' && !qbankFormEditing()) renderQbank();
  else if (view === 'review' && !reviewFormEditing()) renderReview();
  else if (view === 'prospect') renderProspect();
}
async function refreshWorkspaceData(manual = false) {
  if (window.__SNAPSHOT__ || workspaceRefreshRunning) return;
  if (manual && (!serverMode || apiBase === null)) await initServerStorage();
  if (!serverMode || apiBase === null) {showWorkspaceRefreshNotice('工作区服务未连接，请检查后重新读取。');return;}
  workspaceRefreshRunning = true;
  const originalFocus = document.activeElement;
  const focusState = originalFocus?.id ? {id: originalFocus.id, start: originalFocus.selectionStart, end: originalFocus.selectionEnd} : null;
  const button = document.getElementById('workspaceRefreshButton');
  if (button) { button.disabled = true; button.textContent = '正在检查…'; }
  const modules = ['edits', 'records', 'qbank', 'preps', 'prospects', 'reviews'];
  try {
    const results = await Promise.allSettled(modules.map(module => managementRequest(module)));
    let changed = false;
    let emptyStateChanged = false;
    const updatedModules = new Set();
    const failures = [];
    for (let index = 0; index < modules.length; index++) {
      const module = modules[index], result = results[index];
      if (result.status !== 'fulfilled') {
        emptyStateChanged ||= workspaceReadStates[module] !== 'error';
        workspaceReadStates[module] = 'error';
        failures.push(managementLabels[module] || '个人标记');
        continue;
      }
      emptyStateChanged ||= workspaceReadStates[module] !== 'ready';
      workspaceReadStates[module] = 'ready';
      const fingerprint = JSON.stringify(result.value.data);
      if (workspaceRefreshSnapshots.get(module) === fingerprint) continue;
      if (workspaceHasDraft(module) || (module === 'records' && workspaceHasDraft('edits'))) {
        workspacePendingUpdates.add(module);
        continue;
      }
      // Protect forms opened while the read was in flight. Never advance their save base.
      if (module === 'edits') await initServerStorage();
      else if (module === 'records') {
        const keys = new Set(data.filter(row => selected.has(row._idx)).map(row => row._key));
        detailInputMemory.clear();
        initData(result.value.data);
        selected = new Set(data.filter(row => keys.has(row._key)).map(row => row._idx));
        render();
      } else if (module === 'qbank') await initQbankStorage();
      else if (module === 'preps') await initPrepsStorage();
      else if (module === 'prospects') await initProspectsStorage();
      else if (module === 'reviews') await initReviewsStorage();
      const readFailed = SAVE_DOMAINS[module]?.readFailed || (module === 'preps' && workspaceReadStates.preps === 'error') || (module === 'prospects' && !!prospectLoadError);
      if (readFailed) {workspaceReadStates[module]='error';failures.push(managementLabels[module]||'个人标记');emptyStateChanged=true;continue;}
      workspaceRefreshSnapshots.set(module, fingerprint);
      workspacePendingUpdates.delete(module);
      changed = true;
      updatedModules.add(module);
    }
    if (failures.length) showWorkspaceRefreshNotice(failures.join('、') + '读取失败，当前内容保留。可检查连接后重新读取。');
    else if (workspacePendingUpdates.size) showWorkspaceRefreshNotice('检测到新资料；当前编辑和草稿已保留。请先保存后刷新；如遇冲突，可先导出草稿进行对账。');
    else {
      showWorkspaceRefreshNotice('');
      if (manual) showToast(changed ? '已读取工作区最新资料' : '资料没有变化');
    }
    // Unchanged content never redraws, so focus, selection and reader scroll remain intact.
    const visibleModules = view === 'qbank' ? ['qbank','preps'] : view === 'review' ? ['reviews'] : view === 'prospect' ? ['prospects'] : ['records','edits'];
    if (emptyStateChanged || visibleModules.some(module=>updatedModules.has(module))) repaintWorkspaceEmptySurfaces();
  } finally {
    workspaceRefreshRunning = false;
    if (focusState && (document.activeElement === document.body || document.activeElement === originalFocus)) {
      const current = document.getElementById(focusState.id);
      if (current && current !== originalFocus) {current.focus({preventScroll:true});try {current.setSelectionRange(focusState.start,focusState.end);} catch(error) {}}
    }
    if (button) { button.disabled = false; button.textContent = '刷新资料'; }
  }
}
function installWorkspaceRefresh() {
  document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend', '<button id="workspaceRefreshButton" class="btn btn-sm" onclick="refreshWorkspaceData(true)">刷新资料</button>');
  document.querySelector('.topbar').insertAdjacentHTML('afterend', '<div id="workspaceRefreshNotice" class="workspace-refresh-note" role="status" hidden><span></span></div>');
  if (window.__SNAPSHOT__) {
    document.getElementById('workspaceRefreshButton').disabled = true;
    return;
  }
  window.addEventListener('focus', () => refreshWorkspaceData());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshWorkspaceData(); });
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
  if (['records','edits','qbank','preps','prospects','reviews'].some(workspaceHasDraft) || workspaceSettingsSaving || localStorage.getItem('toudiPendingSettings')) {
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
      workspaceReadStates[module] = failed() ? 'error' : 'ready';
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
