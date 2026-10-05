/* Isolated review form preservation checks; no running service or user data. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../app/assets/workbench.js'), 'utf8');
new vm.Script(source);
const fields = {company: '隔离公司', position: '岗位', round: '一面', date: '2026-10-03', companyKey: '', summaryRaw: '本场总结'};
const context = vm.createContext({
  management: {module: 'reviews', item: {
    id: 'stable-session', customField: 'preserve',
    summary: {hotspots: '保留热点'},
    questions: [{n: 3, question: '旧题目', originalAnswer: '旧回答', diagnosis: {结构化: '保留诊断'}, followups: ['保留追问']}]
  }},
  document: {
    querySelectorAll: () => Object.entries(fields).map(([key, value]) => ({dataset: {mfield: key}, value})),
    querySelector: selector => ({value: selector.includes('question') ? '新题目' : '新原回答'})
  }
});
for (const name of ['managementReadReviewQuestions', 'managementCandidate']) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), context);
}
const candidate = vm.runInContext('managementCandidate()', context);
assert.equal(candidate.item.id, 'stable-session');
assert.equal(candidate.item.customField, 'preserve');
assert.equal(candidate.item.summary.raw, '本场总结');
assert.equal(candidate.item.summary.hotspots, '保留热点');
assert.equal(candidate.item.questions[0].n, 3);
assert.equal(candidate.item.questions[0].question, '新题目');
assert.equal(candidate.item.questions[0].originalAnswer, '新原回答');
assert.equal(candidate.item.questions[0].diagnosis.结构化, '保留诊断');
assert.equal(candidate.item.questions[0].followups[0], '保留追问');
console.log('PASS workbench syntax and review form preserves stable identity, diagnostics, followups and unknown fields');

const refreshContext = vm.createContext({
  document: {getElementById: () => ({style: {display: 'none'}})},
  toudiWorkspaceStorage: {getItem: () => '{}'},
  listUnsavedDrafts: () => [],
  detailInputMemory: new Map(),
  byId: () => ({_researchNote: 'saved', 岗位: '岗位'}),
  editsDirty: false, editsConflict: false, editsSaveInFlight: false,
  qbankDirty: false, qbankConflict: false, qbankSaveInFlight: false,
  qbankFormEditing: () => false, qbFormDrafts: new Map(), qbCategoryEditing: new Map(),
  reviewDirty: false, reviewConflict: false, reviewSaveInFlight: false,
  reviewFormEditing: () => false
});
for (const name of ['workspaceDetailDraftExists', 'workspaceHasDraft']) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), refreshContext);
}
assert.equal(vm.runInContext("workspaceHasDraft('records')", refreshContext), false);
vm.runInContext("detailInputMemory.set(0,[{id:'researchNote',value:'saved'}])", refreshContext);
assert.equal(vm.runInContext("workspaceHasDraft('records')", refreshContext), false);
vm.runInContext("detailInputMemory.set(0,[{id:'researchNote',value:'unsaved'}])", refreshContext);
assert.equal(vm.runInContext("workspaceHasDraft('records')", refreshContext), true);
vm.runInContext('reviewDirty = true', refreshContext);
assert.equal(vm.runInContext("workspaceHasDraft('reviews')", refreshContext), true);
vm.runInContext("toudiWorkspaceStorage.getItem = () => JSON.stringify({preps:{base:'original'}})", refreshContext);
assert.equal(vm.runInContext("workspaceHasDraft('preps')", refreshContext), true);
console.log('PASS refresh protects stored drafts, dirty reviews and unsaved detail fields');
