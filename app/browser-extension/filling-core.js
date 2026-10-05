(function (root, factory) {
  const vocabulary = typeof module === 'object' && module.exports ? require('./filling-aliases.js') : root.TouDiFillingVocabulary;
  const core = factory(vocabulary);
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.TouDiFillingCore = core;
})(globalThis, function (V) {
  'use strict';
  const modules = ['personal','education','internship','project','language'];
  const profileIds = V.profiles.map(p=>p.id);
  const normal = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const manual = label => V.manualTerms.some(term=>String(label).toLowerCase().includes(term));
  const sensitive = label => V.sensitiveTerms.some(term=>String(label).toLowerCase().includes(term));
  const qualifiers = value => String(value).match(/博士研究生|硕士研究生|博士|硕士|本科|专科/g) || [];
  const text = (value, cap=1000) => typeof value==='string' && value.length<=cap;
  const precision = value => /^\d{4}[-/.年]\d{1,2}月?$/.test(String(value)) ? 'month' : /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(String(value)) ? 'day' : null;
  function validatePack(input) {
    if (!input || input.schemaVersion!==1 || !Array.isArray(input.facts) || input.facts.length>1500 || !Array.isArray(input.rules || []) || (input.rules || []).some(r=>!text(r,12000))) throw Error('资料包格式无效：需要 schemaVersion 1、facts 和 rules。');
    const seen = new Set();
    const facts=input.facts.map(original=>{
      const f=structuredClone(original);
      if (!f || !text(f.key,300) || !f.key || seen.has(f.key) || !text(f.label) || !f.label || !modules.includes(f.module) || !['string','number'].includes(typeof f.value) || (typeof f.value==='number' && !Number.isFinite(f.value)) || String(f.value).length>24000) throw Error('资料字段有重复键、缺失内容或不支持的类型。');
      seen.add(f.key);
      f.profiles=f.profiles || profileIds.slice();
      if (!Array.isArray(f.profiles) || !f.profiles.length || f.profiles.some(p=>!profileIds.includes(p)) || (f.module==='internship' && f.profiles.includes('general'))) throw Error('实习资料需要明确简历口径，不能混入通用口径。');
      for (const k of ['recordId','recordLabel','recordHint']) { f[k]=f[k] || ''; if(!text(f[k]))throw Error('经历记录标识无效。'); }
      f.aliases=f.aliases || V.aliases[f.label] || [f.label];
      if(!Array.isArray(f.aliases) || f.aliases.length>80 || f.aliases.some(a=>!text(a) || !a.trim()))throw Error('字段别名无效。');
      f.sensitive=!!(f.sensitive || sensitive(f.label));
      f.manual=!!(f.manual || manual(f.label) || f.companyScope || f._专属 || f.label.startsWith('_专属'));
      f.precision=f.precision || precision(f.value);
      if(f.precision && !['month','day'].includes(f.precision))throw Error('日期精度只能为 month 或 day。');
      if(f.gpaScale && !['4','4.0','5','5.0'].includes(String(f.gpaScale)))throw Error('GPA 满分口径无效。');
      return f;
    });
    return {schemaVersion:1,kind:'toudi-filling-profile',name:text(input.name,200)?input.name:'个人填报资料',savedAt:text(input.savedAt,80)?input.savedAt:null,sourceName:text(input.sourceName,300)?input.sourceName:'导入资料包',sourceVersion:text(input.sourceVersion,150)?input.sourceVersion:'',profiles:structuredClone(V.profiles),facts,rules:(input.rules || []).slice(),warnings:Array.isArray(input.warnings)?input.warnings.filter(w=>text(w,2000)).slice(0,100):[],supplements:Array.isArray(input.supplements)?input.supplements.filter(s=>s&&text(s.label)).map(s=>({label:s.label,module:s.module})):[]};
  }
  function profile(pack, id='general') {
    if(!profileIds.includes(id))throw Error('请选择有效的简历口径。');
    return {...pack,profileId:id,facts:pack.facts.filter(f=>f.profiles.includes(id))};
  }
  function moduleHint(field) { const value=String(field.module || '').toLowerCase(); return Object.entries(V.modules).find(([alias])=>value.includes(alias))?.[1] || ''; }
  function semantic(field) { return normal(String(field.label || '').replace(/博士研究生|硕士研究生|博士|硕士|本科|专科/g,'')); }
  function recordMatches(fact,field) {
    const qs=qualifiers([field.label,field.groupLabel,field.recordHint].join(' '));
    const hint=normal(fact.recordLabel+' '+fact.recordHint);
    return fact.module!=='education' || qs.every(q=>hint.includes(normal(q.replace('研究生',''))));
  }
  function labelMatches(fact,field) {
    const label=semantic(field), aliases=[fact.label,...fact.aliases];
    return aliases.some(a=>normal(a)===label) || (fact.label==='GPA' && V.aliases.GPA.some(a=>label.startsWith(normal(a))) && /4[.．]0|5[.．]0|满分|scale/i.test(field.label));
  }
  function candidates(p,field) {
    const mod=moduleHint(field);
    let result=p.facts.filter(f=>(!mod || f.module===mod || (mod==='education' && f.label.startsWith('最高'))) && labelMatches(f,field) && recordMatches(f,field));
    const hint=normal([field.groupLabel,field.recordHint].join(' '));
    if(hint && new Set(result.map(f=>f.recordId)).size>1) {
      const selected=result.filter(f=>[f.recordLabel,f.recordHint,...qualifiers(f.recordHint)].some(t=>normal(t) && (hint.includes(normal(t)) || normal(t).includes(hint))));
      if(selected.length)result=selected;
    }
    return result;
  }
  function mappingMatches(p,field,fact) {
    const mod=moduleHint(field);
    if((mod && fact.module!==mod && !(mod==='education' && fact.label.startsWith('最高'))) || !recordMatches(fact,field))return false;
    const known=p.facts.some(f=>labelMatches(f,field)) || Object.values(V.aliases).flat().some(a=>normal(a)===semantic(field));
    if(known && !labelMatches(fact,field))return false;
    const eligible=candidates(p,field);
    return !eligible.length || eligible.some(f=>f.key===fact.key);
  }
  function optionEquivalent(value,label) {
    const n=normal(value);
    const map=['学历','最高学历'].includes(label)?{'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}:['学位','最高学位'].includes(label)?{'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士','文学学士':'学士','工学硕士':'硕士','理学硕士':'硕士','文学硕士':'硕士'}:{};
    return map[n] || n;
  }
  function mask(value,label) {
    const s=String(value);
    if(/邮箱|email/i.test(label))return s.includes('@')?s.slice(0,1)+'***@***':'***';
    if(/手机|电话/.test(label) && s.length>7)return s.slice(0,3)+'****'+s.slice(-4);
    if(/姓名|name/i.test(label))return s.slice(0,1)+'***';
    return '***';
  }
  function scanValid(scan) {
    let url;try{url=new URL(scan?.origin);}catch(_){throw Error('表单来源无效。');}
    if(scan.protocol!==1 || !['http:','https:'].includes(url.protocol) || url.origin!==scan.origin || !text(scan.path,1000) || !scan.path.startsWith('/') || /[?#]/.test(scan.path) || !text(scan.fingerprint,150) || !Array.isArray(scan.fields) || scan.fields.length>500)throw Error('当前页面快照无效或字段过多。');
    const seen=new Set();
    for(const f of scan.fields) {
      if(!f || !text(f.id,300) || !f.id || seen.has(f.id) || ['password','hidden'].includes(f.type) || JSON.stringify(f).length>24000)throw Error('网页字段结构无效。');
      for(const k of ['label','groupLabel','recordHint'])if(!text(f[k] || ''))throw Error('网页字段说明过长。');
      if(f.options && (!Array.isArray(f.options) || f.options.length>1000 || f.options.some(o=>!o || !text(o.text) || !text(o.value,2000))))throw Error('网页选项结构无效。');
      seen.add(f.id);
    }
    return scan;
  }
  function plan(p,scan,mappings={}) {
    scanValid(scan);
    const facts=new Map(p.facts.map(f=>[f.key,f]));
    if(!mappings || typeof mappings!=='object' || Array.isArray(mappings) || Object.entries(mappings).some(([id,key])=>!scan.fields.some(f=>f.id===id) || !facts.has(key)))throw Error('匹配必须使用本页字段和当前口径的资料键。');
    const rows=scan.fields.map(field=>{
      const row={fieldId:field.id,label:field.label || '',module:field.module || '',groupLabel:field.groupLabel || '',status:'missing',reason:'资料中没有可确认的对应字段。',expectedValue:field.value ?? ''};
      const kind=field.type || 'text';
      if(field.unsupported || !['text','textarea','email','tel','date','month','number','select','radio','checkbox','combobox','file'].includes(kind))return {...row,status:'unsupported',reason:'控件尚不支持可靠填入。'};
      if(['file','checkbox'].includes(kind) || (kind==='combobox' && !field.options?.length) || manual(row.label))return {...row,status:'manual',reason:'上传、协议、家庭/联系人或复杂控件需要人工操作。'};
      const list=Object.hasOwn(mappings,field.id)?[facts.get(mappings[field.id])]:candidates(p,field);
      if(list.length>1)return {...row,status:'ambiguous',reason:'有多个资料记录，分组或记录提示无法唯一确认，请选择事实。'};
      if(!list.length)return row;
      const fact=list[0];let value=String(fact.value), reason='';
      Object.assign(row,{factKey:fact.key,value,displayValue:fact.sensitive?mask(value,row.label):value,sensitive:fact.sensitive});
      if(Object.hasOwn(mappings,field.id) && !mappingMatches(p,field,fact))reason='映射与字段的明确含义、模块或记录不符，不能跨记录填入。';
      if(!reason && fact.manual)reason='此项资料必须人工确认，不使用自动填入。';
      const constraints=field.constraints || {};
      if(!reason && fact.label==='GPA') {
        const demanded=/4[.．]0|四分/.test(row.label)?4:/5[.．]0|五分/.test(row.label)?5:kind==='number' && ['4','4.0','5','5.0'].includes(constraints.max)?Number(constraints.max):0;
        if(demanded && Number(fact.gpaScale)!==demanded)reason='GPA 未注明相同满分口径，需人工确认。';
      }
      if(!reason && /至今|待确认|冲突|不确定/.test(value))reason='资料包含至今或待确认的时间/事实表述，需要人工确认。';
      if(!reason && kind==='date' && fact.precision!=='day')reason='资料没有精确到日，不能自行补为每月一号。';
      if(!reason && kind==='month' && !['month','day'].includes(fact.precision))reason='资料年月精度不明确。';
      if(!reason && kind==='number') {
        if(!/^-?\d+(?:\.\d+)?$/.test(value))reason='资料不是该数值控件所需的纯数值。';
        else if((constraints.min!==undefined && constraints.min!=='' && Number(value)<Number(constraints.min)) || (constraints.max!==undefined && constraints.max!=='' && Number(value)>Number(constraints.max)))reason='数值超出字段明确范围，需人工核对；未截断或修正资料。';
      }
      if(!reason && ['date','month'].includes(kind)) {
        const parts=value.match(/\d+/g) || [], year=Number(parts[0]), month=Number(parts[1]), day=kind==='date'?Number(parts[2]):1;
        const check=new Date(Date.UTC(year,month-1,day));
        if(year<100 || check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day)reason='来源日期不符合日历规则，需要人工核对。';
        else {value=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+(kind==='date'?'-'+String(day).padStart(2,'0'):'');row.value=value;row.displayValue=value;}
      }
      if(!reason && Number.isInteger(field.maxLength) && field.maxLength>=0 && value.length>field.maxLength)reason='内容超过字段长度限制，需人工整理；未截断原文。';
      if(!reason && ['select','radio','combobox'].includes(kind)) {
        const matches=(field.options || []).filter(o=>optionEquivalent(o.text,fact.label)===optionEquivalent(value,fact.label) || String(o.value)===value);
        if(matches.length!==1)reason='没有唯一等价选项，需要人工选择。';
        else row.optionValue=matches[0].value;
      }
      if(reason)return {...row,status:'manual',reason};
      const existing=String(field.value ?? ''), proposed=String(row.optionValue ?? value);
      if(existing && (existing===proposed || existing===value))return {...row,status:'already',reason:'已有值与资料相同。'};
      if(existing)return {...row,status:'conflict',reason:'已有值与资料不同，保留现值，需明确选择覆盖。'};
      return {...row,status:'ready',reason:'事实、记录及控件约束已确认。'};
    });
    const statusCounts={};for(const row of rows)statusCounts[row.status]=(statusCounts[row.status] || 0)+1;
    return {protocol:1,sourceVersion:p.sourceVersion,profileId:p.profileId,origin:scan.origin,path:scan.path,fingerprint:scan.fingerprint,rows,statusCounts,warnings:[...p.warnings,...(scan.warnings || [])],choices:p.facts.filter(f=>!f.manual).map(f=>({key:f.key,label:[f.recordLabel,f.label].filter(Boolean).join(' · ')}))};
  }
  function review(plan,revealValues=false) {return {...plan,rows:plan.rows.map(({value,expectedValue,...row})=>revealValues && value!==undefined?{...row,displayValue:value}:row)};}
  function confirm(plan,selected,overwrite=[]) {
    if(!Array.isArray(selected) || !Array.isArray(overwrite) || new Set(selected).size!==selected.length)throw Error('所选字段格式无效。');
    const actions=selected.map(id=>{
      const row=plan.rows.find(r=>r.fieldId===id);
      if(!row || !['ready','conflict'].includes(row.status) || !row.factKey)throw Error('所选字段需要先核对资料。');
      if(row.status==='conflict' && !overwrite.includes(id))throw Error('已有内容需要明确选择覆盖。');
      return {fieldId:id,value:row.value,expectedValue:row.expectedValue,overwrite:row.status==='conflict',...(Object.hasOwn(row,'optionValue')?{optionValue:row.optionValue}:{})};
    });
    return {protocol:1,origin:plan.origin,path:plan.path,fingerprint:plan.fingerprint,actions,submitted:false};
  }
  function agentRequest(p,scan,plan,model='') {
    const pending=new Set(plan.rows.filter(r=>['missing','ambiguous'].includes(r.status)).map(r=>r.fieldId));
    const pick=(item,keys)=>Object.fromEntries(keys.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
    return {protocol:1,op:'map',model,fields:scan.fields.filter(f=>pending.has(f.id)).map(f=>pick(f,['id','label','module','groupLabel','recordHint','type','options'])),allowedFacts:p.facts.filter(f=>!f.manual).map(f=>pick(f,['key','label','module','recordId','recordLabel','recordHint','aliases']))};
  }
  function safeAgentMappings(p,scan,mappings) {
    const accepted={}, rejected=[];
    for(const [id,key] of Object.entries(mappings)) {
      const field=scan.fields.find(f=>f.id===id), fact=p.facts.find(f=>f.key===key);
      if(!field || !fact || !mappingMatches(p,field,fact)) {rejected.push(id);continue;}
      // A model may not choose the first repeated education/work card by guesswork.
      const related=p.facts.filter(f=>f.module===fact.module && f.label===fact.label && recordMatches(f,field));
      if(['education','internship','project'].includes(fact.module) && new Set(related.map(f=>f.recordId)).size>1) {
        const hint=normal([field.label,field.groupLabel,field.recordHint].join(' '));
        const matching=related.filter(f=>[f.recordLabel,f.recordHint,...qualifiers(f.recordHint)].some(t=>normal(t) && hint.includes(normal(t))));
        if(new Set(matching.map(f=>f.recordId)).size!==1 || !matching.some(f=>f.key===key)) {rejected.push(id);continue;}
      }
      accepted[id]=key;
    }
    return {accepted,rejected};
  }
  return {validatePack,profile,scanValid,plan,review,confirm,agentRequest,safeAgentMappings,normal,profileIds};
});
