// A model is selected by the user, never inferred from the CLI default.
((root) => {
  const validModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value);
  function normalize(value = {}) {
    // Preserve only an explicitly enabled legacy choice. New installations stay unconfigured.
    const legacy = !Object.hasOwn(value,'agentMode') && value.autoLuna === true;
    const agentMode = ['codex','external'].includes(value.agentMode) ? value.agentMode : legacy ? 'codex' : '';
    const agentModel = validModel(value.agentModel) ? value.agentModel : legacy ? 'gpt-6-luna' : '';
    return {profile:typeof value.profile==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.profile) ? value.profile : 'general',
      agentMode,agentModel:agentMode === 'codex' ? agentModel : '',
      autoAgent:agentMode === 'codex' && !!agentModel && (value.autoAgent === true || legacy)};
  }
  root.TouDiAgentConfig = {normalize,validModel};
})(globalThis);
