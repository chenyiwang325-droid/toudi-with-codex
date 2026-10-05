/* Browser drafts belong to a verified workspace; disk/API data remains authoritative. */
window.toudiWorkspaceStorage = (() => {
  const id = () => /^[a-f0-9]{64}$/.test(window.__TOUDI_WORKSPACE_KEY__ || '') ? window.__TOUDI_WORKSPACE_KEY__ : '';
  const key = name => id() ? 'toudiWorkspace:' + id() + ':' + name : name === 'toudiPublicWorkspace_v1' ? 'toudiDevice:' + name : null;
  return {
    get id() { return id(); },
    getItem(name) { const scoped = key(name); return scoped ? localStorage.getItem(scoped) : null; },
    setItem(name, value) {
      const scoped = key(name);
      if (!scoped) throw Error('工作区尚未确认，未写入浏览器草稿');
      localStorage.setItem(scoped, value);
    },
    removeItem(name) { const scoped = key(name); if (scoped) localStorage.removeItem(scoped); }
  };
})();
