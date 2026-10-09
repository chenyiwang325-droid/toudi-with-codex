/* Continuation and verified repair metadata; matching remains in filling-core. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TouDiFillingWorkflow=api;})(globalThis,function(){
'use strict';
const canonicalModule=value=>({work:'internship',projects:'project'}[value] || value || 'other');
function signature(f){return JSON.stringify([canonicalModule(f.module),String(f.label || '').normalize('NFKC').trim(),f.type,f.adapter || '',f.datePart || '',f.dateFormat || '',f.regionDepth || '']);}
function key(field,bindings={}){return JSON.stringify([signature(field),bindings[field.groupId] || '',field.groupId && !bindings[field.groupId]?field.groupId:'']);}
function attemptKey(row,field,bindings={}){return JSON.stringify([key(field,bindings),bindings[field.groupId]?'':field.id,row.factKey,row.optionValue ?? row.value,field.options || [],field.constraints || {},field.required || false,field.unsupported || '']);}
function restore(p,scan,bindings,cached,optionKeys={}){
  const mappings={},optionDecisions={};
  if(cached?.schemaVersion!==2 || !Array.isArray(cached.repairs) || cached.repairs.length>500)return {mappings,optionDecisions};
  for(const f of scan.fields){
    const matches=cached.repairs.filter(r=>r && r.signature===signature(f) && typeof r.factKey==='string' && (!r.recordId || bindings[f.groupId]===r.recordId) && p.facts.some(fact=>fact.key===r.factKey && canonicalModule(f.module)===fact.module));
    if(matches.length!==1)continue;
    const r=matches[0];mappings[f.id]=r.factKey;
    // A choice is restored only from the complete, freshly read options array.
    if(r.choice && r.choice.options && r.choice.options===optionKeys[f.id] && f.options[r.choice.index])optionDecisions[f.id]={factKey:r.factKey,optionValue:f.options[r.choice.index].value,sourceKeys:r.choice.sourceKeys,reason:'上次填写读回通过的选项对应关系。'};
  }
  return {mappings,optionDecisions};
}
function repairs(state,report,optionKeys={}){
  return (report.results || []).filter(r=>r.status==='verified' && r.reason==='readback-matched').flatMap(r=>{
    const factKey=state.mappings?.[r.fieldId],f=state.scan.fields.find(f=>f.id===r.fieldId);
    if(!factKey || !f)return [];
    const d=state.optionDecisions?.[f.id],index=d?(f.options || []).findIndex(o=>o.value===d.optionValue):-1;
    return [{signature:signature(f),factKey,recordId:state.recordBindings?.[f.groupId] || '',...(index>=0 && optionKeys[f.id]?{choice:{index,options:optionKeys[f.id],sourceKeys:d.sourceKeys}}:{})}];
  });
}
const explanations={
  'option-not-found':['选项','网站没有与资料对应的选项；可用 Agent 核对实际候选。'],
  'option-not-unique':['选项','有多个可能选项；可用 Agent 核对，或在网页选择后再次识别。'],
  'option-unavailable':['控件','未能读取此控件的选项；在网页选择或从我的资料复制。'],
  'options-unavailable':['控件','未能读取此控件的选项；在网页选择或从我的资料复制。'],
  'option-not-selected':['控件','网站没有接受选择；请在网页确认该选项。'],
  'option-confirm-unavailable':['控件','未找到可确认的控件按钮；请在网页完成选择。'],
  'value-not-retained':['读回','网站未保留写入值；请检查网页中的字段或校验提示。'],
  'validation-failed':['读回','网站校验未通过；请查看该字段的提示后修正。'],
  'field-changed':['页面变化','页面改变了字段位置或归属；重新识别后再填写。'],
  'field-disappeared':['页面变化','字段在联动后消失；请检查当前模块并重新识别。'],
  'page-changed':['页面变化','页面已经切换；请在当前表单重新识别。'],
  'structure-changed':['页面变化','页面结构已变化；重新识别后再填写。'],
  'value-changed':['已有内容','填写期间原值发生变化，已保留网页中的内容。'],
  'existing-value':['已有内容','此项已有内容；选择填写全部，或在网页修改。'],
  'disabled-or-readonly':['控件','网站锁定了此字段；请先打开对应的编辑区域。'],
  'add-no-new-record':['新增记录','点击新增后没有出现新记录；请检查是否须先保存当前记录。'],
  'add-disabled':['新增记录','网站新增入口停用或达到上限。'],
  'add-ambiguous':['新增记录','新增入口不唯一；请在网页打开对应模块后重试。'],
  'add-unavailable':['新增记录','未找到新增入口；请在网页添加对应记录后重试。'],
  'existing-record-changed':['记录归属','网站改变了已有记录，已停止新增；核对记录后重新识别。'],
  'new-record-not-unique':['记录归属','新增记录无法唯一确认，已停止；核对整段记录后重新识别。'],
  'continuation-limit':['页面变化','页面持续变化，本轮已停止；检查当前内容后重新识别。'],
  'record-not-bound':['记录归属','无法确认整段经历对应的资料，已保留原值；请先确认记录名称。'],
  'saved-records-closed':['记录归属','此模块有已保存或锁定的记录；请先在网页打开编辑，避免重复添加。'],
  'save-required':['保存','请先在网页保存当前记录，再运行填写；TouDi 不代点网站保存。'],
  'file-upload':['附件','附件需要在网页选择并上传。'],
  'verification-code':['验证','验证码需要在网页完成。'],
  'consent':['确认','协议或声明需要本人确认。']
};
function explain(reason,status){const known=explanations[reason];return known?{stage:known[0],message:known[1]}:{stage:status==='missing'?'资料':status==='ambiguous'?'记录归属':'填写',message:/[\u3400-\u9fff]/.test(reason || '')?reason:'此字段尚不能可靠写入，可在网页填写或从我的资料复制。'};}
function diagnostic(state,report){return {protocol:2,checkedAt:new Date().toISOString(),extensionVersion:state.extensionVersion,engineVersion:state.scan.engineVersion,origin:state.origin,profileId:state.plan.profileId,sourceVersion:state.sourceVersion,summary:report.summary,passes:report.passes || 1,results:report.results.map(r=>{const f=state.scan.fields.find(f=>f.id===r.fieldId);return {fieldId:r.fieldId,module:canonicalModule(f?.module),type:f?.type || 'unknown',adapter:f?.adapter || 'generic',status:r.status,stage:explain(r.reason,r.status).stage,reason:Object.hasOwn(explanations,r.reason) || /^(readback-matched|invalid-value|required-empty|option-disabled)$/.test(r.reason || '')?r.reason:'unresolved'};}),submitted:false,saveState:'unconfirmed'};}
return {signature,key,attemptKey,restore,repairs,explain,diagnostic};
});
