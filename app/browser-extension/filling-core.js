(function (root, factory) {
  const vocabulary = typeof module === 'object' && module.exports ? require('./filling-aliases.js') : root.TouDiFillingVocabulary;
  const core = factory(vocabulary);
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.TouDiFillingCore = core;
})(globalThis, function (V) {
  'use strict';
  const modules = ['personal','education','internship','project','language','campus-role','awards','publications'];
  const profileIds = V.profiles.map(p=>p.id);
  const normal = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const manual = label => V.manualTerms.some(term=>String(label).toLowerCase().includes(term));
  const sensitive = label => V.sensitiveTerms.some(term=>String(label).toLowerCase().includes(term));
  const qualifiers = value => String(value).match(/博士研究生|硕士研究生|博士|硕士|本科|专科/g) || [];
  const text = (value, cap=1000) => typeof value==='string' && value.length<=cap;
  const precision = value => /^\d{4}[-/.年]\d{1,2}月?$/.test(String(value)) ? 'month' : /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(String(value)) ? 'day' : null;
  const ongoingEnd = f => ['project','internship','campus-role'].includes(f.module) && ['结束','结束日期'].includes(f.label) && ['至今','present','ongoing','current'].includes(normal(f.value));
  const localToday = (now=new Date()) => [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const dateFormats = ['YYYY-MM-DD','YYYY/MM/DD','YYYY.MM.DD','YYYY-MM','YYYY/MM','YYYY.MM'];
  function sortFacts(facts) {
    const groups=new Map();
    for(const f of facts){const key=f.module+'|'+f.recordId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
    const start=group=>{
      for(const label of ['开始日期','开始','时间','获奖日期','发表日期','取得日期']) {
        const m=String(group.find(f=>f.label===label)?.value || '').match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})(?!\d))?/);
        if(m){const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3] || 1),check=new Date(Date.UTC(y,mo-1,d));if(y>=100 && check.getUTCFullYear()===y && check.getUTCMonth()===mo-1 && check.getUTCDate()===d)return y*10000+mo*100+d;}
      }
      return 0;
    };
    return [...groups.values()].sort((a,b)=>modules.indexOf(a[0].module)-modules.indexOf(b[0].module) || start(b)-start(a)).flat();
  }
  function validatePack(input) {
    function jsonValue(value){
      if(value===null || ['string','boolean'].includes(typeof value))return;
      if(typeof value==='number' && Number.isFinite(value))return;
      if(Array.isArray(value)){value.forEach(jsonValue);return;}
      if(value && typeof value==='object' && Object.prototype.toString.call(value)==='[object Object]'){Object.values(value).forEach(jsonValue);return;}
      throw Error('资料包只能包含合法 JSON 内容。');
    }
    jsonValue(input);
    if(new TextEncoder().encode(JSON.stringify(input)).length>450*1024)throw Error('资料包超过 450 KB，请减少重复内容；附件单独保留。');
    if(input && ((!Array.isArray(input.warnings ?? []) || (input.warnings || []).some(w=>typeof w!=='string')) || (!Array.isArray(input.supplements ?? []) || (input.supplements || []).some(s=>!s || typeof s!=='object' || Array.isArray(s)))))throw Error('资料补充信息格式无效。');
    if (!input || input.schemaVersion!==1 || !Array.isArray(input.facts) || input.facts.length>1500 || !Array.isArray(input.rules || []) || (input.rules || []).some(r=>!text(r,12000))) throw Error('资料包格式无效：需要 schemaVersion 1、facts 和 rules。');
    const inferred=[...new Set(['general',...input.facts.flatMap(f=>Array.isArray(f?.profiles)?f.profiles:[])])];
    const profiles=structuredClone(input.profiles ?? inferred.map((id,i)=>({id,label:id==='general'?'默认资料':'导入资料 '+i}))),ids=new Set();
    if(!Array.isArray(profiles) || !profiles.length || profiles.length>20)throw Error('资料版本需要为 1 到 20 项。');
    for(const p of profiles){
      if(!p || typeof p.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(p.id) || ids.has(p.id) || !text(p.label,80) || !p.label.trim())throw Error('资料版本标识或名称无效。');
      ids.add(p.id);
    }
    const seen = new Set();
    const facts=input.facts.map(original=>{
      const f=structuredClone(original);
      if (!f || !text(f.key,300) || !f.key || seen.has(f.key) || !text(f.label) || !f.label || !modules.includes(f.module) || !['string','number'].includes(typeof f.value) || (typeof f.value==='number' && !Number.isFinite(f.value)) || String(f.value).length>24000) throw Error('资料字段有重复键、缺失内容或不支持的类型。');
      seen.add(f.key);
      f.profiles=f.profiles || [...ids];
      if (!Array.isArray(f.profiles) || !f.profiles.length || f.profiles.some(p=>!ids.has(p))) throw Error('字段需要至少归属一个已有资料版本。');
      for (const k of ['recordId','recordLabel','recordHint']) { f[k]=f[k] || ''; if(!text(f[k]))throw Error('经历记录标识无效。'); }
      f.aliases=f.aliases || V.aliases[f.label] || [f.label];
      if(!Array.isArray(f.aliases) || f.aliases.length>80 || f.aliases.some(a=>!text(a) || !a.trim()))throw Error('字段别名无效。');
      f.sensitive=!!(f.sensitive || sensitive(f.label));
      f.manual=!!(f.manual || manual(f.label) || f.companyScope || f._专属 || f.label.startsWith('_专属'));
      f.precision=f.precision || precision(f.value);
      if(f.precision && !['month','day'].includes(f.precision))throw Error('日期精度只能为 month 或 day。');
      if(Object.hasOwn(f,'ongoing') && typeof f.ongoing!=='boolean')throw Error('进行中状态需要为布尔值。');
      if(f.ongoing && !ongoingEnd(f))throw Error('进行中状态仅适用于内容为「至今」的项目、工作或在校经历结束日期。');
      if(f.dateFallback && (f.dateFallback!=='today' || !f.ongoing || !ongoingEnd(f)))throw Error('日期兜底需要先确认经历仍在进行，仅支持使用填写当天。');
      if(f.gpaScale && !['4','4.0','5','5.0'].includes(String(f.gpaScale)))throw Error('GPA 满分口径无效。');
      return f;
    });
    return {...structuredClone(input),schemaVersion:1,kind:'toudi-filling-profile',name:text(input.name,200)?input.name:'个人填报资料',savedAt:text(input.savedAt,80)?input.savedAt:null,sourceName:text(input.sourceName,300)?input.sourceName:'浏览器资料编辑',sourceVersion:text(input.sourceVersion,150)?input.sourceVersion:'',profiles,facts,rules:(input.rules || []).slice(),warnings:structuredClone(input.warnings || []),supplements:structuredClone(input.supplements || [])};
  }
  function profile(pack, id=pack.profiles[0].id) {
    if(!pack.profiles.some(p=>p.id===id))throw Error('请选择有效的资料版本。');
    return {...pack,profileId:id,facts:sortFacts(pack.facts.filter(f=>f.profiles.includes(id)))};
  }
  const manualField = field => ['label','module','groupLabel','recordHint'].some(key=>manual(field[key] || '')) || /家庭情况|家庭信息|家庭关系/.test([field.module,field.groupLabel].join(' '));
  function moduleHint(field) {
    if(manualField(field))return 'manual';
    const context=[field.module,field.groupLabel].join(' ');
    if(/campus-role|在校任职|校园任职|在校经历|校园经历|在校职务|学生工作|学生干部|school[ _-]*posts|campus[ _-]*posts/i.test(context))return 'campus-role';
    if(/获奖|奖励|荣誉|awards/i.test(context))return 'awards';
    if(/论文|发表|出版|专著|publications/i.test(context))return 'publications';
    if(/^(毕业院校|毕业学校|最近毕业专业)$/.test(field.label || ''))return 'education';
    const value=String(field.module || '').toLowerCase();
    return Object.entries(V.modules).find(([alias])=>value.includes(alias))?.[1] || (value.trim()?'unsupported-module':'');
  }
  function semantic(field) { return normal(String(field.semanticLabel || field.label || '').replace(/博士研究生|硕士研究生|博士|硕士|本科|专科/g,'')); }
  function recordMatches(fact,field) {
    const qs=qualifiers([field.label,field.groupLabel,field.recordHint].join(' '));
    const hint=normal(fact.recordLabel+' '+fact.recordHint);
    return fact.module!=='education' || qs.every(q=>hint.includes(normal(q.replace('研究生',''))));
  }
  const sharedAliasIndex=new Map();
  for(const [canonical,synonyms] of Object.entries(V.aliases)){
    const keys=[canonical,...synonyms].map(normal);
    for(const key of keys){if(!sharedAliasIndex.has(key))sharedAliasIndex.set(key,new Set());keys.forEach(value=>sharedAliasIndex.get(key).add(value));}
  }
  const scopedAliasIndex=Object.fromEntries(Object.entries(V.moduleAliases || {}).map(([mod,entries])=>[mod,new Map(Object.entries(entries).map(([canonical,synonyms])=>[normal(canonical),new Set(synonyms.map(normal))]))]));
  function labelMatches(fact,field) {
    const label=semantic(field),factLabel=normal(fact.label);
    if(scopedAliasIndex[moduleHint(field)]?.get(factLabel)?.has(label))return true;
    return factLabel===label || sharedAliasIndex.get(factLabel)?.has(label) || (fact.aliases || []).some(a=>normal(a)===label) || (fact.label==='GPA' && V.aliases.GPA.some(a=>label.startsWith(normal(a))) && /4[.．]0|5[.．]0|满分|scale/i.test(field.label));
  }
  const personalGraduation = field => moduleHint(field)==='personal' && /^(毕业时间|毕业日期)$/.test(field.label || '');
  function highestEducationEnd(p,field) {
    const highest=p.facts.filter(f=>f.label==='最高学历' && !f.manual);
    const levels=new Set(highest.map(f=>optionEquivalent(f.value,'学历')));
    if(levels.size!==1)return [];
    const level=[...levels][0];
    const records=new Set(p.facts.filter(f=>f.module==='education' && f.label==='学历' && optionEquivalent(f.value,'学历')===level).map(f=>f.recordId));
    if(records.size!==1)return [];
    return p.facts.filter(f=>f.module==='education' && records.has(f.recordId) && labelMatches(f,field) && recordMatches(f,field));
  }
  function recordEvidence(p,field,mod) {
    const rawHint=String(field.recordHint || ''),hint=normal(rawHint),identity=V.recordIdentityFields?.[mod];
    const prefix=mod==='publications' && /…|\.{3,}/.test(rawHint)?normal(rawHint.split(/…|\.{3,}/)[0]):'';
    if(!hint || !identity)return null;
    const scores=new Map();
    for(const fact of p.facts){
      if(fact.module!==mod || !identity.includes(fact.label))continue;
      const value=normal(fact.value);
      if(value.length>=2 && (hint===value || hint.includes(value) || (mod!=='publications' && value.includes(hint)) || (prefix.length>=20 && value.startsWith(prefix)))){
        const score=prefix.length>=20 && value.startsWith(prefix)?5000+prefix.length:Math.min(value.length,hint.length)+(hint===value?10000:0);
        scores.set(fact.recordId,Math.max(scores.get(fact.recordId) || 0,score));
      }
    }
    const best=Math.max(0,...scores.values());
    return new Set([...scores].filter(([,score])=>score===best).map(([id])=>id));
  }
  function candidates(p,field) {
    if(personalGraduation(field))return highestEducationEnd(p,field);
    const mod=moduleHint(field);
    let result=p.facts.filter(f=>(!mod || f.module===mod || (mod==='education' && f.label.startsWith('最高'))) && labelMatches(f,field) && recordMatches(f,field));
    const evidence=recordEvidence(p,field,mod);
    if(evidence!==null)result=result.filter(f=>evidence.has(f.recordId));
    const hint=normal([field.groupLabel,field.recordHint].join(' '));
    if(hint && new Set(result.map(f=>f.recordId)).size>1) {
      const selected=result.filter(f=>[f.recordLabel,f.recordHint,...qualifiers(f.recordHint)].some(t=>normal(t) && (hint.includes(normal(t)) || normal(t).includes(hint))));
      if(selected.length)result=selected;
    }
    return result;
  }
  function mappingMatches(p,field,fact) {
    if(manualField(field))return false;
    if(personalGraduation(field))return highestEducationEnd(p,field).some(f=>f.key===fact.key);
    const mod=moduleHint(field);
    if((mod && fact.module!==mod && !(mod==='education' && fact.label.startsWith('最高'))) || !recordMatches(fact,field))return false;
    const evidence=recordEvidence(p,field,mod);if(evidence!==null && !evidence.has(fact.recordId))return false;
    const known=p.facts.some(f=>labelMatches(f,field)) || Object.values(V.aliases).flat().some(a=>normal(a)===semantic(field));
    if(known && !labelMatches(fact,field))return false;
    const eligible=candidates(p,field);
    return !eligible.length || eligible.some(f=>f.key===fact.key);
  }
  function optionEquivalent(value,label) {
    const n=normal(value);
    const map=['学历','最高学历'].includes(label)?{'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}:['学位','最高学位'].includes(label)?{'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士','文学学士':'学士','工学硕士':'硕士','理学硕士':'硕士','文学硕士':'硕士'}:label==='学历类型'?{'普通全日制':'全日制','全日制普通':'全日制'}:{};
    return map[n] || n;
  }
  function numericEquivalent(a,b,label) {
    if(!/^(?:GPA|平均绩点|绩点|考试成绩|考试分数|证书成绩|英语四级|英语六级|四级成绩|六级成绩|身高(?:cm)?|体重(?:kg)?)$/i.test(label))return false;
    const numeric=v=>/^-?\d+(?:\.\d+)?$/.test(String(v).trim());
    return numeric(a) && numeric(b) && Number.isFinite(Number(a)) && Number(a)===Number(b);
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
      if(f.dateFormat && !dateFormats.includes(f.dateFormat))throw Error('网页日期格式无效。');
      if(f.datePart && (!['year','month'].includes(f.datePart) || !['开始日期','结束日期'].includes(f.semanticLabel) || f.adapter!=='moka-select'))throw Error('拆分日期结构无效。');
      seen.add(f.id);
    }
    return scan;
  }
  function plan(p,scan,mappings={},now=new Date()) {
    scanValid(scan);
    const facts=new Map(p.facts.map(f=>[f.key,f]));
    if(!mappings || typeof mappings!=='object' || Array.isArray(mappings) || Object.entries(mappings).some(([id,key])=>!scan.fields.some(f=>f.id===id) || !facts.has(key)))throw Error('匹配必须使用本页字段和当前口径的资料键。');
    const rows=scan.fields.map(field=>{
      const row={fieldId:field.id,label:field.label || '',module:field.module || '',groupLabel:field.groupLabel || '',status:'missing',reason:'资料中没有可确认的对应字段。',expectedValue:field.value ?? ''};
      const kind=field.type || 'text';
      const unsupportedReasons={'disabled-or-readonly':'网站锁定了此字段，请先在网站中解除或修改关联记录。','custom-date':'已识别日期字段；此网站的日历控件需手动选择。','split-date':'已识别分开的年月选项；请按对应经历手动选择，避免混填日期。','unlabeled':'未找到可靠的字段标题，请在网页中确认。','custom-selector':'已识别下拉字段，但暂不能可靠读取选项，请手动选择。'};
      if(field.unsupported || !['text','textarea','email','tel','date','month','number','select','radio','checkbox','combobox','file'].includes(kind))return {...row,status:'unsupported',reason:unsupportedReasons[field.unsupported] || '控件尚不支持可靠填入。'};
      const deferredSelect=kind==='combobox' && ['moka-select','phoenix-select','phoenix-date'].includes(field.adapter);
      if(['file','checkbox'].includes(kind) || (kind==='combobox' && !field.options?.length && !deferredSelect) || manualField(field))return {...row,status:'manual',reason:'上传、协议、家庭/联系人或复杂控件需要人工操作。'};
      const list=Object.hasOwn(mappings,field.id)?[facts.get(mappings[field.id])]:candidates(p,field);
      if(list.length>1)return {...row,status:'ambiguous',reason:'有多个资料记录，分组或记录提示无法唯一确认，请选择事实。'};
      if(!list.length){
        const outside=(p.facts || []).length===0 || !p.facts.some(f=>f.module===moduleHint(field));
        if(outside && ['internship','project'].includes(moduleHint(field)))row.reason='当前资料版本没有该模块资料，请切换包含该经历的资料版本或补充事实。';
        if(moduleHint(field)==='campus-role' && semantic(field)===normal('在校职务类别'))row.reason='资料未保存对应职务类别，需要依据网站候选选项人工确认；不能将职务名称当作类别。';
        return row;
      }
      const fact=list[0];let value=String(fact.value), reason='', valuePrecision=fact.precision;
      const format=field.dateFormat, deferredDate=field.adapter==='phoenix-date' && !format, dateKind=deferredDate?(valuePrecision==='month'?'month':valuePrecision==='day'?'date':''):field.datePart?'month':['date','month'].includes(kind)?kind:format?(format.includes('DD')?'date':'month'):'';
      Object.assign(row,{factKey:fact.key,value,displayValue:fact.sensitive?mask(value,row.label):value,sensitive:fact.sensitive});
      if(Object.hasOwn(mappings,field.id) && !mappingMatches(p,field,fact))reason='映射与字段的明确含义、模块或记录不符，不能跨记录填入。';
      if(!reason && fact.manual)reason='此项资料必须人工确认，不使用自动填入。';
      const constraints=field.constraints || {};
      if(!reason && fact.label==='GPA') {
        const demanded=/4[.．]0|四分/.test(row.label)?4:/5[.．]0|五分/.test(row.label)?5:kind==='number' && ['4','4.0','5','5.0'].includes(constraints.max)?Number(constraints.max):0;
        if(demanded && Number(fact.gpaScale)!==demanded)reason='GPA 未注明相同满分口径，需人工确认。';
      }
      if(!reason && fact.ongoing && ongoingEnd(fact) && dateKind) {
        const hasPresentCheckbox=scan.fields.some(f=>f.type==='checkbox' && f.groupId && f.groupId===field.groupId && ['至今','present','ongoing','仍在进行'].includes(normal(f.label)));
        if(hasPresentCheckbox)reason='网站提供「至今」勾选，请先手动选择，再重新识别。';
        else if(fact.dateFallback!=='today')reason='经历仍在进行，日期控件不支持「至今」；尚未授权具体日期兜底。';
        else {value=localToday(now);valuePrecision='day';Object.assign(row,{dateFallbackUsed:true,resolvedOn:value});}
      }
      if(!reason && /待确认|冲突|不确定/.test(value))reason='资料包含待确认的时间或事实表述，需要人工确认。';
      if(!reason && /至今/.test(value) && !fact.ongoing)reason='资料包含至今的时间表述，需要人工确认。';
      if(!reason && deferredDate && !['month','day'].includes(valuePrecision))reason='资料日期精度不明确，需先核对。';
      if(!reason && dateKind==='date' && valuePrecision!=='day')reason='资料没有精确到日，不能自行补为每月一号。';
      if(!reason && dateKind==='month' && !['month','day'].includes(valuePrecision))reason='资料年月精度不明确。';
      if(!reason && kind==='number') {
        if(!/^-?\d+(?:\.\d+)?$/.test(value))reason='资料不是该数值控件所需的纯数值。';
        else if((constraints.min!==undefined && constraints.min!=='' && Number(value)<Number(constraints.min)) || (constraints.max!==undefined && constraints.max!=='' && Number(value)>Number(constraints.max)))reason='数值超出字段明确范围，需人工核对；未截断或修正资料。';
      }
      if(!reason && dateKind) {
        const parts=value.match(/\d+/g) || [], year=Number(parts[0]), month=Number(parts[1]), day=dateKind==='date'?Number(parts[2]):1;
        const check=new Date(Date.UTC(year,month-1,day));
        if(year<100 || check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day)reason='来源日期不符合日历规则，需要人工核对。';
        else {
          value=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+(dateKind==='date'?'-'+String(day).padStart(2,'0'):'');
          if((constraints.min && value<constraints.min) || (constraints.max && value>constraints.max))reason='日期超出字段明确范围，需人工核对；未截断或修改日期。';
          if(format)value=value.replaceAll('-',format.includes('/')?'/':format.includes('.')?'.':'-');
          if(field.datePart)value=field.datePart==='year'?String(year):String(month);
          row.value=value;row.displayValue=value;
        }
      }
      if(!reason && Number.isInteger(field.maxLength) && field.maxLength>=0 && value.length>field.maxLength)reason='内容超过字段长度限制，需人工整理；未截断原文。';
      if(!reason && ['select','radio','combobox'].includes(kind) && !deferredSelect) {
        const present=v=>['至今','present','ongoing','current'].includes(normal(v));
        const matches=(field.options || []).filter(o=>optionEquivalent(o.text,fact.label)===optionEquivalent(value,fact.label) || String(o.value)===value || (fact.ongoing && ongoingEnd(fact) && present(o.text)));
        if(matches.length!==1)reason='没有唯一等价选项，需要人工选择。';
        else row.optionValue=matches[0].value;
      }
      if(reason)return {...row,status:'manual',reason};
      const existing=String(field.value ?? ''), proposed=String(row.optionValue ?? value);
      const note=row.dateFallbackUsed?' 经历仍在进行；此日期为填写当天的表单占位，不是实际结束日期。':'';
      if(existing && (existing===proposed || existing===value || numericEquivalent(existing,value,fact.label) || (['select','radio','combobox'].includes(kind) && optionEquivalent(existing,fact.label)===optionEquivalent(value,fact.label))))return {...row,status:'already',reason:existing===value?'已有值与资料相同。'+note:'已有选项与资料语义一致，无需覆盖。'+note};
      if(existing)return {...row,status:'conflict',reason:'已有值与资料不同，保留现值，需明确选择覆盖。'+note};
      return {...row,status:'ready',reason:(deferredSelect?'资料已匹配；填写时展开此字段菜单，仅选择唯一对应选项，未找到则保留原值。':'事实、记录及控件约束已确认。')+note};
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
      if(row.dateFallbackUsed && row.resolvedOn!==localToday())throw Error('填写日期已变化，请重新识别页面以更新「至今」占位日期。');
      if(row.status==='conflict' && !overwrite.includes(id))throw Error('已有内容需要明确选择覆盖。');
      return {fieldId:id,value:row.value,expectedValue:row.expectedValue,overwrite:row.status==='conflict',...(Object.hasOwn(row,'optionValue')?{optionValue:row.optionValue}:{})};
    });
    return {protocol:1,origin:plan.origin,path:plan.path,fingerprint:plan.fingerprint,actions,submitted:false};
  }
  function agentRequest(p,scan,plan,model='') {
    const pending=new Set(plan.rows.filter(r=>['missing','ambiguous'].includes(r.status)).map(r=>r.fieldId));
    const pick=(item,keys)=>Object.fromEntries(keys.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
    return {protocol:1,op:'map',model,fields:scan.fields.filter(f=>pending.has(f.id) && !manualField(f) && moduleHint(f)!=='unsupported-module' && (!['campus-role','awards','publications'].includes(moduleHint(f)) || p.facts.some(fact=>fact.module===moduleHint(f)))).map(f=>pick(f,['id','label','module','groupLabel','recordHint','type','options'])),allowedFacts:p.facts.filter(f=>!f.manual).map(f=>pick(f,['key','label','module','recordId','recordLabel','recordHint','aliases']))};
  }
  function safeAgentMappings(p,scan,mappings) {
    const accepted={}, rejected=[];
    for(const [id,key] of Object.entries(mappings)) {
      const field=scan.fields.find(f=>f.id===id), fact=p.facts.find(f=>f.key===key);
      if(!field || !fact || !mappingMatches(p,field,fact)) {rejected.push(id);continue;}
      const evidence=recordEvidence(p,field,moduleHint(field));
      if(evidence!==null){if(evidence.size!==1 || !evidence.has(fact.recordId)){rejected.push(id);continue;}accepted[id]=key;continue;}
      // A model may not choose the first repeated education/work card by guesswork.
      const related=personalGraduation(field)?highestEducationEnd(p,field):p.facts.filter(f=>f.module===fact.module && f.label===fact.label && recordMatches(f,field));
      if(['education','internship','project','campus-role','awards','publications'].includes(fact.module) && new Set(related.map(f=>f.recordId)).size>1) {
        const hint=normal([field.label,field.groupLabel,field.recordHint].join(' '));
        const matching=related.filter(f=>[f.recordLabel,f.recordHint,...qualifiers(f.recordHint)].some(t=>normal(t) && hint.includes(normal(t))));
        if(new Set(matching.map(f=>f.recordId)).size!==1 || !matching.some(f=>f.key===key)) {rejected.push(id);continue;}
      }
      accepted[id]=key;
    }
    return {accepted,rejected};
  }
  return {validatePack,profile,scanValid,plan,review,confirm,agentRequest,safeAgentMappings,normal,profileIds,sortFacts,ongoingEnd};
});
