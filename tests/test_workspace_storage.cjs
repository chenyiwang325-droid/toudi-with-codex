/* Exercise workspace isolation, failure fallback and acknowledged draft removal with synthetic state. */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/投递管理.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'app/assets/workbench.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'app/assets/workspace-storage.js'), 'utf8');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const values = new Map([
  ['toudiEdits', JSON.stringify({foreign: {note: 'old cache'}})],
  ['toudiQBank', JSON.stringify({categories: [{id: 'foreign'}]})],
  ['jobEditsDraft:session', JSON.stringify({format: 'toudi-unsaved-draft', version: 2, base: '0', revision: 1, data: {edits: {foreign: {}}, pref: {}}})],
  ['jobEditsDraft', JSON.stringify({format: 'toudi-unsaved-draft', base: '0', data: {edits: {legacy: {}}, pref: {}}})]
]);
const original = new Map(values);
const localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
  key: index => [...values.keys()][index],
  get length() { return values.size; }
};
const timers = new Map(); let timerId = 0;
const window = {__TOUDI_WORKSPACE_KEY__: A};
const context = vm.createContext({window, localStorage, sessionStorage: {getItem: () => 'session'}, crypto: {},
  userEdits: {}, preferences: {}, DEFAULT_PREF: {}, updateStorageBadge() {}, showToast() {},
  setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
  clearTimeout: id => timers.delete(id), console,
  document: {querySelector: () => ({insertAdjacentHTML() {}}), getElementById: () => ({hidden: false})}
});
vm.runInContext(storage, context);
context.toudiWorkspaceStorage = window.toudiWorkspaceStorage;
vm.runInContext(html.slice(html.indexOf('function cachedData('), html.indexOf('function personalMutationAllowed(')), context);
assert.equal(vm.runInContext("cachedData('toudiEdits')", context), null);
assert.equal(vm.runInContext("readOwnDraft('edits')", context), null);
assert.equal(vm.runInContext('listUnsavedDrafts().length', context), 0);
assert.equal(vm.runInContext('listUnsavedDrafts(true).length', context), 2);
vm.runInContext("writeDraft('edits','0',{edits:{local:{}},pref:{}});toudiWorkspaceStorage.setItem('toudiPendingSettings','{\"density\":\"compact\"}')", context);
window.__TOUDI_WORKSPACE_KEY__ = B;
assert.equal(vm.runInContext("readOwnDraft('edits')", context), null);
assert.equal(window.toudiWorkspaceStorage.getItem('toudiPendingSettings'), null);
vm.runInContext("writeDraft('edits','0',{edits:{second:{}},pref:{}})", context);
window.__TOUDI_WORKSPACE_KEY__ = A;
assert.equal(vm.runInContext("readOwnDraft('edits').data.edits.local !== undefined", context), true);
vm.runInContext("writeDraft('edits','0',{edits:{newer:{}},pref:{}});clearOwnDraft('edits',1)", context);
assert.equal(vm.runInContext("readOwnDraft('edits').revision", context), 2);
assert.equal(vm.runInContext("advanceOwnDraftBase('edits',1,'confirmed-version')", context), true);
assert.equal(vm.runInContext("readOwnDraft('edits').base", context), 'confirmed-version');
for (const [key, raw] of original) assert.equal(values.get(key), raw, 'Unverified old data must remain recoverable');
window.__SNAPSHOT_SEED__ = {toudiEdits: {snapshot: {starred: true}}};
assert.equal(vm.runInContext("cachedData('toudiEdits').snapshot.starred", context), true);
delete window.__SNAPSHOT_SEED__;
console.log('PASS identical versions in two workspaces stay isolated; old caches/drafts remain inert and preserved; newer revisions survive earlier acknowledgements');

(async () => {
  let diskDrafts = {legacyDrafts: []};
  let version = 0;
  Object.assign(context, {serverMode: true, managementDraftTimer: null, persistQueue: Promise.resolve(), workspaceDraftsReady: true,
    managementWritable: () => true,
    managementRequest: async (module, body) => {
      if (module === 'settings') return {version: '0', data: {display: {theme: 'system'}}};
      if (body) { assert.equal(body.base, String(version)); diskDrafts = body.data; version++; }
      return {version: String(version), data: structuredClone(diskDrafts)};
    }
  });
  vm.runInContext(manager.slice(manager.indexOf('async function persistDrafts('), manager.indexOf('saveWorkspace = async function')), context);
  async function flushTimers() {
    const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
    await new Promise(resolve => setImmediate(resolve));
    await vm.runInContext('persistQueue', context);
  }
  vm.runInContext("writeDraft('qbank','0',{categories:[{id:'synthetic'}]})", context);
  await flushTimers();
  assert.equal(diskDrafts.legacyDrafts.some(x => x.domain === 'qbank'), true);
  vm.runInContext("clearOwnDraft('qbank',1)", context);
  await flushTimers();
  assert.equal(diskDrafts.legacyDrafts.some(x => x.domain === 'qbank'), false);
  const confirmedVersion=version;
  await vm.runInContext('persistDrafts()',context);
  assert.equal(version,confirmedVersion,'Unchanged mirrors must not create redundant versions or transactions');
  vm.runInContext("writeDraft('reviews','old-base',{sessions:[{id:'saved',summary:{b:2,a:1}}]});discardConfirmedDrafts('reviews',{sessions:[{summary:{a:1,b:2},id:'saved'}]})",context);
  assert.equal(vm.runInContext("readOwnDraft('reviews')",context),null);
  await flushTimers();
  console.log('PASS acknowledged draft removal clears the disk mirror, preventing ghost recovery after restart');

  // Old disk draft mirrors were populated from unscoped browser storage. Retain without applying them.
  diskDrafts = {legacyDrafts: [{key: 'jobEditsDraft:old', domain: 'edits', draft: JSON.parse(original.get('jobEditsDraft:session'))}],
    management: {module: 'preps', base: '0', candidate: {private: 'synthetic'}},
    managementDrafts: {reviews: {module: 'reviews', base: '0', candidate: {private: 'synthetic'}}}};
  Object.assign(context, {view: 'table', managementStyle() {}, initServerStorage: async () => {},
    renderQuickViews() {}, renderSettings() {}, render() {}, applyWorkspace() {}, switchView() {},
    WORKSPACE_DEFAULT: {}, WORKSPACE_KEY: 'toudiPublicWorkspace_v1', saveWorkspace: async () => {}, workspace: {}});
  vm.runInContext('let settingsState=null;', context);
  vm.runInContext(manager.slice(manager.indexOf('async function managementInit('), manager.indexOf('function managementForView(')), context);
  await vm.runInContext('managementInit()', context);
  assert.equal(window.toudiWorkspaceStorage.getItem('toudiManagementDraft'), null);
  assert.deepEqual(JSON.parse(window.toudiWorkspaceStorage.getItem('toudiManagementDrafts')), {});
  assert.equal(diskDrafts.unscopedRecovery.management.candidate.private, 'synthetic');
  assert.equal(diskDrafts.unscopedRecovery.legacyDrafts[0].draft.version, 2);
  const other={format:'toudi-unsaved-draft',version:3,workspaceKey:A,domain:'reviews',sessionId:'other-tab',revision:1,base:'0',data:{sessions:[{id:'other-unsaved'}]}};
  diskDrafts.legacyDrafts.push({key:'jobReviewsDraft:'+A+':other-tab',domain:'reviews',draft:other});
  await vm.runInContext('persistDrafts()',context);
  assert.equal(diskDrafts.legacyDrafts.some(entry=>entry.draft.sessionId==='other-tab'),true,'Do not overwrite another client session with a freshly read base');
  console.log('PASS old management mirrors are preserved for export and never auto-applied to an empty current workspace');
})().catch(error => { console.error(error); process.exitCode = 1; });
