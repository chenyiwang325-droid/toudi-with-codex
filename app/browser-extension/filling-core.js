(function (root, factory) {
  const vocabulary = typeof module === 'object' && module.exports ? require('./filling-aliases.js') : root.TouDiFillingVocabulary;
  const core = factory(vocabulary);
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.TouDiFillingCore = core;
})(globalThis, function (V) {
  'use strict';
  const modules = ['personal','education','internship','project','language','campus-role','awards','publications','family'];
  const profileIds = V.profiles.map(p=>p.id);
  const normal = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const manual = label => V.manualTerms.some(term=>String(label).toLowerCase().includes(term));
  const sensitive = label => V.sensitiveTerms.some(term=>String(label).toLowerCase().includes(term));
  const qualifiers = value => String(value).match(/博士研究生|硕士研究生|博士|硕士|本科|专科|高中/g) || [];
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
      if(Object.hasOwn(f,'answerSource') && typeof f.answerSource!=='boolean')throw Error('问答资料许可需要为布尔值。');
      f.sensitive=!!(f.sensitive || f.module==='family' || sensitive(f.label));
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
  const manualField = field => ['label','module','groupLabel','recordHint'].some(key=>manual(field[key] || ''));
  function moduleHint(field) {
    if(manualField(field))return 'manual';
    const context=[field.module,field.groupLabel].join(' ');
    if(/紧急联系人|emergency contact/i.test(context+' '+field.label))return 'personal';
    if(/家庭成员|家庭情况|家庭信息|家庭关系|亲属|family|父亲|母亲/i.test(context) || /^(父亲|母亲)/.test(field.label || ''))return 'family';
    if(/campus-role|在校任职|校园任职|在校经历|校园经历|在校职务|学生工作|学生干部|school[ _-]*posts|campus[ _-]*posts/i.test(context))return 'campus-role';
    if(/获奖|奖励|荣誉|awards/i.test(context))return 'awards';
    if(/论文|发表|出版|专著|publications/i.test(context))return 'publications';
    if(/^(毕业院校|毕业学校|最近毕业专业)$/.test(field.label || ''))return 'education';
    const value=String(field.module || '').toLowerCase();
    return Object.entries(V.modules).find(([alias])=>value.includes(alias))?.[1] || (value.trim()?'unsupported-module':'');
  }
  function semantic(field) {
    let label=String(field.semanticLabel || field.label || '');
    if(/^(作者|作者类型|本人作者身份)$/.test(label) && ['select','radio','combobox'].includes(field.type) && (field.options || []).some(o=>/一作|第一作者|通讯作者/.test(o.text)))return normal('作者排序');
    if(moduleHint(field)==='family')label=label.replace(/^(父亲|母亲|家庭成员|亲属)/,'') || label;
    if(/紧急联系人|emergency contact/i.test([field.module,field.groupLabel].join(' ')) && !/紧急|emergency/i.test(label)) {
      for(const [source,target] of [['姓名','紧急联系人姓名'],['手机','紧急联系人手机'],['与本人关系','紧急联系人关系'],['工作单位','紧急联系人单位'],['职务','紧急联系人职务']])if(V.aliases[source].some(x=>normal(x)===normal(label))){label=target;break;}
    }
    return normal(label.replace(/博士研究生|硕士研究生|博士|硕士|本科|专科|高中/g,''));
  }
  function recordMatches(fact,field) {
    if(fact.module==='family'){const relation=[field.label,field.groupLabel].join(' ').match(/父亲|母亲/);if(relation && ![fact.recordLabel,fact.recordHint].join(' ').includes(relation[0]))return false;}
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
    if(moduleHint(field)==='language'){for(const canonical of ['语种','证书类型','考试成绩']){const names=[canonical,...(V.moduleAliases.language[canonical] || [])].map(normal);if(names.includes(label))return factLabel===normal(canonical);}}
    if(moduleHint(field)==='awards'){const scope=new Set(['获奖级别','获奖等级','award level','award scope'].map(normal)),rank=new Set(['奖项等级','奖励等级','award rank','prize rank'].map(normal));if((scope.has(factLabel)&&rank.has(label)) || (rank.has(factLabel)&&scope.has(label)))return false;}
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
  function personalReference(field) {
    if(moduleHint(field)!=='personal')return null;
    const education=String(field.label || '').match(/^(最高|第一)学历(毕业院校|毕业学校|毕业时间|毕业日期|学习形式|专业)?$/);
    if(education&&(education[1]==='第一'||education[2]))return {module:'education',kind:education[1],label:({'毕业院校':'学校','毕业学校':'学校','毕业时间':'结束日期','毕业日期':'结束日期','学习形式':'学历类型','专业':'专业'})[education[2]] || '学历'};
    if(/^(学习形式|学习方式)$/.test(field.label || ''))return {module:'education',kind:'最高',label:'学历类型'};
    if(/^(已通过的英语等级证书|英语等级证书|英语等级成绩)$/.test(field.label || ''))return {module:'language',kind:'CET',label:/成绩/.test(field.label)?'考试成绩':'证书类型'};
    if(/^外语等级证书$/.test(field.label || ''))return {module:'language',kind:'foreign',label:'证书类型'};
    return null;
  }
  function personalReferenceFacts(p,field) {
    const ref=personalReference(field);if(!ref)return [];
    let ids=new Set();
    if(ref.module==='education'&&ref.kind==='最高'){
      const levels=new Set(p.facts.filter(f=>f.label==='最高学历'&&!f.manual).map(f=>optionEquivalent(f.value,'学历')));
      if(levels.size===1)ids=new Set(p.facts.filter(f=>f.module==='education'&&f.label==='学历'&&levels.has(optionEquivalent(f.value,'学历'))).map(f=>f.recordId));
    } else if(ref.module==='education'){
      const records=new Set(p.facts.filter(f=>f.module==='education').map(f=>f.recordId));
      // "First qualification" refers to higher education, not the oldest school.
      for(const id of records){const qualifications=p.facts.filter(f=>f.module==='education'&&f.recordId===id&&f.label==='学历'),levels=new Set(qualifications.map(f=>optionEquivalent(f.value,'学历')));if(levels.size!==1)return [];const level=[...levels][0];if(['高中','普通高中','中专','职高','初中','小学'].includes(level))records.delete(id);else if(!['本科','专科','硕士','博士'].includes(level) || qualifications.some(f=>f.manual))return [];}
      const dated=p.facts.filter(f=>f.module==='education'&&records.has(f.recordId)&&f.label==='开始日期'&&!f.manual&&/^\d{4}-\d{2}/.test(String(f.value)));
      if([...records].some(id=>!dated.some(f=>f.recordId===id)))return [];
      const first=dated.map(f=>String(f.value)).sort()[0];ids=new Set(dated.filter(f=>String(f.value)===first).map(f=>f.recordId));
    } else {
      if(ref.kind==='foreign' && p.facts.some(f=>f.module==='language'&&!f.manual && ((f.label==='语种'&&!/^(英语|english)$/i.test(String(f.value))) || (f.label==='证书类型'&&!/六级|四级|CET[- ]?[46]/i.test(String(f.value))))))return [];
      const certificates=p.facts.filter(f=>f.module==='language'&&f.label==='证书类型'&&!f.manual).map(f=>({id:f.recordId,rank:/六级|CET[- ]?6/i.test(f.value)?6:/四级|CET[- ]?4/i.test(f.value)?4:0}));
      const rank=Math.max(0,...certificates.map(f=>f.rank));if(rank)ids=new Set(certificates.filter(f=>f.rank===rank).map(f=>f.id));
    }
    if(ids.size!==1)return [];
    return p.facts.filter(f=>f.module===ref.module&&ids.has(f.recordId)&&labelMatches(f,{...field,label:ref.label,module:ref.module,groupLabel:'',recordHint:''}));
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
  const highestPersonalFact=(fact,field)=>fact.module==='personal' && ['最高学历','最高学位'].includes(fact.label) && normal(field.label)===normal(fact.label);
  const agentModule=field=>personalReference(field)?.module || (personalGraduation(field)?'education':moduleHint(field)==='education' && ['最高学历','最高学位'].includes(field.label)?'personal':moduleHint(field));
  function candidates(p,field) {
    if(personalReference(field))return personalReferenceFacts(p,field);
    if(personalGraduation(field))return highestEducationEnd(p,field);
    const mod=moduleHint(field);
    let result=p.facts.filter(f=>!(f.module==='personal' && f.manual) && ((!mod && f.module!=='family') || f.module===mod || (mod==='education' && highestPersonalFact(f,field))) && labelMatches(f,field) && recordMatches(f,field));
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
    if(manualField(field) || fact.module==='family' && moduleHint(field)!=='family')return false;
    if(personalReference(field))return personalReferenceFacts(p,field).some(f=>f.key===fact.key);
    const campusCategory=moduleHint(field)==='campus-role' && /^(在校职务类别|校园职务类别|任职类别|职务类别)$/.test(field.label || '');
    if(campusCategory) {if(fact.module!=='campus-role' || !['职务','职务类别'].includes(fact.label))return false;const evidence=recordEvidence(p,field,'campus-role');return evidence===null || evidence.has(fact.recordId);}
    if(personalGraduation(field))return highestEducationEnd(p,field).some(f=>f.key===fact.key);
    const mod=moduleHint(field);
    if((mod && fact.module!==mod && !(mod==='education' && highestPersonalFact(fact,field))) || !recordMatches(fact,field))return false;
    if(mod==='education' && /学制|修业年限|study duration/i.test(field.label || '') && !/学制|修业年限|study duration/i.test(fact.label))return false;
    const evidence=recordEvidence(p,field,mod);if(evidence!==null && !evidence.has(fact.recordId))return false;
    const known=p.facts.some(f=>labelMatches(f,field)) || Object.values(V.aliases).flat().some(a=>normal(a)===semantic(field));
    if(known && !labelMatches(fact,field))return false;
    const eligible=candidates(p,field);
    return !eligible.length || eligible.some(f=>f.key===fact.key);
  }
  function optionEquivalent(value,label) {
    let n=normal(value);
    if(label==='获奖级别')n=({'校级':'院校级','学校级':'院校级','高校级':'院校级','校院级':'院校级','省级':'省区级','省部级':'省区级','市级':'地市级','全国级':'国家级','国际性':'国际级'})[n] || n;
    if(label==='专业'){
      n=normal(String(value).replace(/\s*[（(][^()（）]+类[)）]\s*$/,''));
      if(n.length>=5)n=n.replace(/(规划|工程|管理|技术|设计|经济|教育|园林)学$/,'$1');
    }
    if(['证书类型','语言／证书名称'].includes(label)){if(/^(大学英语)?(四级|4级|四级考试|4级考试)$/.test(n) || ['cet4','collegeenglishtest4'].includes(n))return 'cet4';if(/^(大学英语)?(六级|6级|六级考试|6级考试)$/.test(n) || ['cet6','collegeenglishtest6'].includes(n))return 'cet6';}
    const map=['学历','最高学历'].includes(label)?{'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}:['学位','最高学位'].includes(label)?{'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士','文学学士':'学士','工学硕士':'硕士','理学硕士':'硕士','文学硕士':'硕士'}:label==='学历类型'?{'普通全日制':'全日制','全日制普通':'全日制','全国普通高等院校全日制':'全日制','全国普通高等院校非全日制':'非全日制'}:{};
    return map[n] || n;
  }
  function numericEquivalent(a,b,label) {
    if(!/^(?:GPA|平均绩点|绩点|考试成绩|考试分数|证书成绩|英语四级|英语六级|四级成绩|六级成绩|身高(?:cm)?|体重(?:kg)?)$/i.test(label))return false;
    const numeric=v=>/^-?\d+(?:\.\d+)?$/.test(String(v).trim());
    return numeric(a) && numeric(b) && Number.isFinite(Number(a)) && Number(a)===Number(b);
  }
  function regionEquivalent(field,existing,proposed){
    if(field.adapter!=='ant-region' || !Number.isInteger(field.regionDepth) || field.regionDepth<2 || field.regionDepth>4)return false;
    const parts=v=>String(v).replace(/[\s/／>]+/g,'').split(/(?<=省|市|自治区|特别行政区)/).filter(Boolean).map(v=>v.replace(/省|市|自治区|特别行政区/g,''));
    const actual=parts(existing),source=parts(proposed),depth=field.regionDepth;
    return actual.length===depth && source.length>=depth && actual.every((v,i)=>v===source[i]);
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
  const repeatedModules=new Set(['education','internship','project','campus-role','awards','publications','family','language']);
  const meaningfulValue=f=>f.value!==false && String(f.value ?? '').trim()!=='' && !/^(?:请选择.*|请输入.*|please select.*|select\.\.\.)$/i.test(String(f.value).trim());
  const recordIdentities={education:/学校|院校|学历/,internship:/公司|单位名称|实习单位|^单位$/,project:/项目名称|实践名称|^名称$|在校科研及实践项目/,'campus-role':/职务|岗位|组织名称/,awards:/奖项|获奖名称/,publications:/名称|论文题目/,language:/证书名称|证书类型|语言.?证书名称/,family:/姓名|关系/};
  const hasRecordContent=f=>meaningfulValue(f) && (!['select','radio','combobox','checkbox'].includes(f.type) || recordIdentities[moduleHint(f)]?.test(f.label));
  // Empty slots are destinations for explicit whole-record placement, not
  // evidence about the identity of an existing nonempty experience.
  function allocateRecords(p,scan,bindings={}) {
    const groups=bindRecordGroups(p,scan,bindings),next={...bindings},modules=[],unusedGroups=[];
    for(const module of repeatedModules){
      const relevant=groups.filter(g=>g.module===module),sections=(scan.repeatables || []).filter(s=>({work:'internship',projects:'project'})[s.module]===module || s.module===module),section=sections.length===1?sections[0]:null;
      let records=[...new Map(p.facts.filter(f=>f.module===module && !f.manual && String(f.value ?? '').trim()).map(f=>[f.recordId,{id:f.recordId,label:f.recordLabel || f.recordHint || f.recordId}])).values()];
      if(module==='education' && section && qualifiers(section.label || '').length)records=records.filter(r=>p.facts.some(f=>f.module===module && f.recordId===r.id && !f.manual && recordMatches(f,{groupLabel:section.label})));
      if(!records.length)continue;
      if(!relevant.length && !sections.length)continue;
      const used=new Set(relevant.filter(g=>g.status==='bound').map(g=>g.recordId));
      let blank=0;
      for(const g of relevant){
        const fields=scan.fields.filter(f=>g.fieldIds.includes(f.id));
        if(g.status==='bound'){next[g.groupId]=g.recordId;if(!fields.some(hasRecordContent))blank++;continue;}
        if(fields.some(hasRecordContent) || new Set(fields.map(moduleHint)).size!==1)continue;
        const constrained=module==='education'?fields.filter(f=>qualifiers([f.label,f.groupLabel,f.recordHint].join(' ')).length):[];
        const record=records.find(r=>!used.has(r.id) && constrained.every(field=>p.facts.some(f=>f.module===module && f.recordId===r.id && recordMatches(f,field))));if(!record){unusedGroups.push(g.groupId);continue;}
        next[g.groupId]=record.id;used.add(record.id);blank++;
      }
      const remaining=records.filter(r=>!used.has(r.id)),unresolved=relevant.filter(g=>g.status!=='bound' && !next[g.groupId] && scan.fields.some(f=>g.fieldIds.includes(f.id) && hasRecordContent(f))).length;
      const canAdd=!!section && section.addStatus==='ready' && !unresolved;
      modules.push({module,label:section?.label || relevant[0]?.label || module,total:records.length,matched:used.size,blank,missing:remaining,sectionId:section?.id || '',canAdd,unresolved,reason:section?.blockedReason || (unresolved?'已有经历无法确认归属，先纠正对应关系，避免重复添加。':sections.length>1?'页面存在多个同类模块，需确认新增位置。':section?.addStatus==='disabled'?'网站新增入口已停用或达到数量上限。':section?.addStatus==='ambiguous'?'该模块存在多个新增入口，需手动确认。':!canAdd && remaining.length?'未找到可直接操作的新增经历入口。':'')});
    }
    return {bindings:next,modules,unusedGroups};
  }
  function bindRecordGroups(p,scan,bindings={}) {
    if(!bindings || typeof bindings!=='object' || Array.isArray(bindings))throw Error('经历绑定格式无效。');
    const grouped=new Map();
    for(const f of scan.fields)if(f.groupId && repeatedModules.has(moduleHint(f))){if(!grouped.has(f.groupId))grouped.set(f.groupId,[]);grouped.get(f.groupId).push(f);}
    const moduleGroups=new Map();for(const fields of grouped.values()){const mod=moduleHint(fields[0]);moduleGroups.set(mod,(moduleGroups.get(mod)||0)+1);}
    if(Object.entries(bindings).some(([id,rid])=>!grouped.has(id) || typeof rid!=='string'))throw Error('经历绑定必须对应当前页面板块。');
    return [...grouped].map(([groupId,fields])=>{
      const mod=moduleHint(fields[0]),facts=p.facts.filter(f=>f.module===mod),records=new Map(facts.map(f=>[f.recordId,{id:f.recordId,label:f.recordLabel || f.recordHint || f.recordId}]));
      let eligible=new Set(records.keys()),hasEvidence=false;
      const constrain=ids=>{hasEvidence=true;eligible=new Set([...eligible].filter(id=>ids.has(id)));};
      if(new Set(fields.map(moduleHint)).size!==1)constrain(new Set());
      for(const field of fields){
        const evidence=recordEvidence(p,field,mod);if(evidence!==null)constrain(evidence);
        if(mod==='education' && qualifiers([field.label,field.groupLabel,field.recordHint].join(' ')).length)constrain(new Set(facts.filter(f=>recordMatches(f,field)).map(f=>f.recordId)));
        const identities=mod==='education'?['学校','院校','学历','专业']:(V.recordIdentityFields?.[mod] || []);
        const relevant=facts.filter(f=>identities.includes(f.label) && labelMatches(f,field));
        const identityValue=(field.options || []).find(o=>o.value===field.value)?.text ?? field.value;
        const value=normal(identityValue || '');
        if(value && !/^(请选择|选择|请输入|please|select)/i.test(value) && relevant.length){
          const matches=relevant.filter(f=>[f.value,f.recordLabel,f.recordHint].some(v=>v && optionEquivalent(v,f.label)===optionEquivalent(identityValue,f.label)));
          constrain(new Set(matches.map(f=>f.recordId)));
        }
      }
      const header=recordEvidence(p,{recordHint:fields[0].groupLabel || ''},mod);if(header?.size)constrain(header);
      const explicit=bindings[groupId];
      if(explicit){if(!records.has(explicit))throw Error('该经历不属于当前板块的资料模块。');hasEvidence=true;eligible=new Set([explicit]);}
      const bound=eligible.size===1 && (hasEvidence || (records.size===1 && moduleGroups.get(mod)===1)), conflict=hasEvidence && eligible.size===0;
      const recordId=bound?[...eligible][0]:'';
      return {groupId,module:mod,label:fields[0].groupLabel || mod,status:bound?'bound':conflict?'conflict':'unbound',recordId,recordLabel:records.get(recordId)?.label || '',reason:bound?'整段字段使用同一份经历。':conflict?'页面经历信息与所选资料不一致，请核对整段名称或重新选择经历。':'请先为这一整段选择对应经历，开始、结束时间与正文将统一匹配。',candidates:[...records.values()],fieldIds:fields.map(f=>f.id)};
    });
  }
  function plan(p,scan,mappings={},now=new Date(),optionDecisions={},recordBindings={}) {
    scanValid(scan);
    const facts=new Map(p.facts.map(f=>[f.key,f]));
    if(!mappings || typeof mappings!=='object' || Array.isArray(mappings) || Object.entries(mappings).some(([id,key])=>!scan.fields.some(f=>f.id===id) || !facts.has(key)))throw Error('匹配必须使用本页字段和当前口径的资料键。');
    const groups=bindRecordGroups(p,scan,recordBindings), byField=new Map(groups.flatMap(g=>g.fieldIds.map(id=>[id,g])));
    const rows=scan.fields.map(field=>{
      const row={fieldId:field.id,label:field.label || '',module:field.module || '',groupLabel:field.groupLabel || '',status:'missing',reason:'资料中没有可确认的对应字段。',expectedValue:field.value ?? ''};
      const binding=byField.get(field.id),matchField=binding?.status==='bound'?{...field,module:binding.module,groupLabel:'',recordHint:''}:field,matchProfile=binding?.status==='bound'?{...p,facts:p.facts.filter(f=>f.module===binding.module && f.recordId===binding.recordId)}:p;
      if(binding){row.recordBinding={groupId:binding.groupId,status:binding.status,recordId:binding.recordId,recordLabel:binding.recordLabel};row.allowedFactKeys=binding.status==='bound'?p.facts.filter(f=>!f.manual && f.module===binding.module && f.recordId===binding.recordId && mappingMatches(matchProfile,matchField,f)).map(f=>f.key):[];}
      const kind=field.type || 'text';
      const unsupportedReasons={'disabled-or-readonly':'网站锁定了此字段，请先在网站中解除或修改关联记录。','custom-date':'已识别日期字段；此网站的日历控件需手动选择。','split-date':'已识别分开的年月选项；请按对应经历手动选择，避免混填日期。','unlabeled':'未找到可靠的字段标题，请在网页中确认。','custom-selector':'已识别下拉字段，但暂不能可靠读取选项，请手动选择。'};
      if(field.unsupported || !['text','textarea','email','tel','date','month','number','select','radio','checkbox','combobox','file'].includes(kind))return {...row,status:'unsupported',reason:unsupportedReasons[field.unsupported] || '控件尚不支持可靠填入。'};
      const deferredSelect=kind==='combobox' && ['moka-select','phoenix-select','phoenix-date','ant-select','ant-date','ant-split-date','ant-region'].includes(field.adapter);
      if(['file','checkbox'].includes(kind) || (kind==='combobox' && !field.options?.length && !deferredSelect) || manualField(field))return {...row,status:'manual',reason:'上传、协议或复杂控件需要人工操作。'};
      if(binding && binding.status!=='bound')return {...row,status:'ambiguous',reason:binding.reason};
      let list=Object.hasOwn(mappings,field.id)?[facts.get(mappings[field.id])]:candidates(matchProfile,matchField);
      if(binding)list=list.filter(f=>f.module===binding.module && f.recordId===binding.recordId);
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
      if(Object.hasOwn(mappings,field.id) && !mappingMatches(matchProfile,matchField,fact))reason='映射与字段的明确含义、模块或记录不符，不能跨记录填入。';
      if(!reason && fact.manual)reason='此项资料必须人工确认，不使用自动填入。';
      const constraints=field.constraints || {};
      if(!reason && fact.label==='GPA') {
        const demanded=/4[.．]0|四分/.test(row.label)?4:/5[.．]0|五分/.test(row.label)?5:kind==='number' && ['4','4.0','5','5.0'].includes(constraints.max)?Number(constraints.max):0;
        if(demanded && Number(fact.gpaScale)!==demanded)reason='GPA 未注明相同满分口径，需人工确认。';
      }
      if(!reason && ongoingEnd(fact) && (dateKind || deferredDate)) {
        const hasPresentCheckbox=scan.fields.some(f=>f.type==='checkbox' && f.groupId && f.groupId===field.groupId && ['至今','present','ongoing','仍在进行'].includes(normal(f.label)));
        if(field.presentAvailable){row.presentControl=true;valuePrecision='day';}
        else if(hasPresentCheckbox)reason='网站提供「至今」勾选，请先手动选择，再重新识别。';
        else if(fact.dateFallback!=='today')reason='经历仍在进行，日期控件不支持「至今」；尚未授权具体日期兜底。';
        else {value=localToday(now);valuePrecision='day';Object.assign(row,{dateFallbackUsed:true,resolvedOn:value});}
      }
      if(!reason && /待确认|未确认|待核|未核|未知|冲突|不确定/.test(value))reason='资料包含待确认的时间或事实表述，需要人工确认。';
      if(!reason && /至今/.test(value) && !fact.ongoing && !row.presentControl)reason='资料包含至今的时间表述，需要人工确认。';
      if(!reason && deferredDate && !['month','day'].includes(valuePrecision))reason='资料日期精度不明确，需先核对。';
      if(!reason && dateKind==='date' && valuePrecision!=='day')reason='资料没有精确到日，不能自行补为每月一号。';
      if(!reason && dateKind==='month' && !['month','day'].includes(valuePrecision))reason='资料年月精度不明确。';
      if(!reason && kind==='number') {
        if(!/^-?\d+(?:\.\d+)?$/.test(value))reason='资料不是该数值控件所需的纯数值。';
        else if((constraints.min!==undefined && constraints.min!=='' && Number(value)<Number(constraints.min)) || (constraints.max!==undefined && constraints.max!=='' && Number(value)>Number(constraints.max)))reason='数值超出字段明确范围，需人工核对；未截断或修正资料。';
      }
      if(!reason && dateKind && !row.presentControl) {
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
      const decision=optionDecisions[field.id];
      if(!reason && decision && decision.factKey===fact.key && validOptionDecision(matchProfile,matchField,decision)) {
        row.optionValue=decision.optionValue;row.optionText=field.options.find(o=>o.value===decision.optionValue).text;
        row.displayValue=row.optionText;row.agentReason=decision.reason;row.sourceKeys=decision.sourceKeys;
      }
      if(!reason && ['select','radio','combobox'].includes(kind) && (!deferredSelect || field.options?.length) && row.optionValue===undefined) {
        const present=v=>['至今','present','ongoing','current'].includes(normal(v));
        const binaryMarriage=fact.label==='婚姻状况' && normal(field.label)==='婚否'?{'已婚':'是','未婚':'否'}[normal(value)]:undefined;
        const matches=(field.options || []).filter(o=>optionEquivalent(o.text,fact.label)===optionEquivalent(value,fact.label) || String(o.value)===value || (binaryMarriage && normal(o.text)===binaryMarriage) || (fact.ongoing && ongoingEnd(fact) && present(o.text)));
        if(matches.length!==1)reason='没有唯一等价选项，需要人工选择。';
        else row.optionValue=matches[0].value;
      }
      if(reason)return {...row,status:'manual',reason};
      const existing=String(field.value ?? ''), proposed=String(row.optionValue ?? value);
      const note=row.agentReason?' Agent：'+row.agentReason:row.dateFallbackUsed?' 经历仍在进行；此日期为填写当天的表单占位，不是实际结束日期。':'';
      if(existing && (existing===proposed || existing===value || (row.optionText && existing===row.optionText) || numericEquivalent(existing,value,fact.label) || (deferredDate && /^\d{4}-\d{2}$/.test(existing) && value.startsWith(existing+'-')) || regionEquivalent(field,existing,value) || (['select','radio','combobox'].includes(kind) && optionEquivalent(existing,fact.label)===optionEquivalent(value,fact.label))))return {...row,status:'already',reason:existing===value?'已有值与资料相同。'+note:'已有选项与资料语义一致，无需覆盖。'+note};
      if(existing)return {...row,status:'conflict',reason:'已有值与资料不同，保留现值，需明确选择覆盖。'+note};
      return {...row,status:'ready',reason:(deferredSelect?'资料已匹配；填写时展开此字段菜单，仅选择唯一对应选项，未找到则保留原值。':'事实、记录及控件约束已确认。')+note};
    });
    const statusCounts={};for(const row of rows)statusCounts[row.status]=(statusCounts[row.status] || 0)+1;
    return {protocol:1,sourceVersion:p.sourceVersion,profileId:p.profileId,origin:scan.origin,path:scan.path,fingerprint:scan.fingerprint,groups,rows,statusCounts,warnings:[...p.warnings,...(scan.warnings || [])],choices:p.facts.filter(f=>!f.manual).map(f=>({key:f.key,module:f.module,recordId:f.recordId,label:[f.recordLabel,f.label].filter(Boolean).join(' · ')}))};
  }
  function review(plan,revealValues=false) {return {...plan,rows:plan.rows.map(({value,expectedValue,...row})=>revealValues && value!==undefined?{...row,displayValue:row.optionText || value}:row)};}
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
  const modelSensitive=f=>f.sensitive || f.module==='family' || sensitive(f.label) || /^(姓名|性别|出生日期|年龄|婚姻状况|政治面貌|民族|籍贯|现居地|户籍地|详细地址|身份证号码|手机|电话|邮箱)$/.test(f.label) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)/.test(String(f.value || ''));
  function relevantAgentFacts(p,field) {
    return p.facts.filter(f=>f.module===agentModule(field) && !f.manual && !modelSensitive(f) && mappingMatches(p,field,f));
  }
  function agentPending(row,field) {
    return ['missing','ambiguous'].includes(row.status) || row.status==='manual' && /没有唯一等价选项/.test(row.reason) || ['ready','conflict','already'].includes(row.status) && field.type==='combobox' && ['moka-select','phoenix-select','ant-select'].includes(field.adapter) && !field.options?.length && !field.datePart;
  }
  function agentRequest(p,scan,plan,model='',reviewAll=false) {
    const pick=(item,keys)=>Object.fromEntries(keys.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
    const facts=new Map(),fields=[];
    for(const f of scan.fields) {
      const row=plan.rows.find(r=>r.fieldId===f.id);
      if(moduleHint(f)==='family' || !row || !(agentPending(row,f) || reviewAll && ['ready','conflict','already'].includes(row.status)) || manualField(f) || sensitive(f.label) || moduleHint(f)==='unsupported-module' || f.unsupported)continue;
      if(row.recordBinding && row.recordBinding.status!=='bound')continue;
      const bound=row.recordBinding;
      const related=relevantAgentFacts(bound?{...p,facts:p.facts.filter(x=>x.recordId===bound.recordId && x.module===moduleHint(f))}:p,bound?{...f,recordHint:'',groupLabel:''}:f);
      // A vague field must not turn into a request for the whole profile.
      if(!related.length || related.length>40 || !moduleHint(f))continue;
      related.forEach(fact=>facts.set(fact.key,pick(fact,['key','label','module','recordId','recordLabel','recordHint','aliases','value','manual','sensitive'])));
      fields.push({...pick(f,['id','label','groupLabel','recordHint','type','options']),module:agentModule(f),...(bound?{recordHint:bound.recordLabel}:{}),factKeys:related.map(fact=>fact.key)});
    }
    return {protocol:1,op:'map',model,fields,allowedFacts:[...facts.values()]};
  }
  function validOptionDecision(p,field,d) {
    if(!d || typeof d!=='object' || Array.isArray(d) || Object.keys(d).some(k=>!['factKey','optionValue','reason','sourceKeys'].includes(k)))return false;
    const fact=p.facts.find(f=>f.key===d.factKey),related=relevantAgentFacts(p,field);
    if(!fact || !related.some(f=>f.key===fact.key) || typeof d.reason!=='string' || !d.reason.trim() || d.reason.length>1000 || !Array.isArray(d.sourceKeys) || !d.sourceKeys.includes(fact.key) || d.sourceKeys.some(k=>!related.some(f=>f.key===k)))return false;
    if(!['select','radio','combobox'].includes(field.type) || typeof d.optionValue!=='string' || !d.optionValue || field.options?.filter(o=>o.value===d.optionValue).length!==1)return false;
    if(/待核|未核|未知|不确定|待确认|未确认/.test(String(fact.value)))return false;
    // A rank decision must use the candidate's rank, not a list of author names.
    if(/收录|检索|论文级别/.test(field.label) || /收录|检索/.test(fact.label)){
      const token=v=>String(v).toUpperCase().match(/(?<![A-Z])(?:SCI(?:E)?|SSCI|CSSCI|CSCD|EI|ESCI|CPCI)(?![A-Z])/g) || [];
      const offered=field.options.find(o=>o.value===d.optionValue).text, requested=token(offered), known=token(fact.value);
      if(requested.some(t=>!known.includes(t)))return false;
    }
    if(/作者|一作|通讯/.test(field.label) && /作者排序|作者顺序|本人排名|作者位次/.test(fact.label)) {
      const choice=field.options.find(o=>o.value===d.optionValue).text;
      if(/一作|第一|first/i.test(choice) && !/一作|第一|共同一作|^1$|first/i.test(String(fact.value)))return false;
      if(/通讯|corresponding/i.test(choice) && !/通讯|corresponding/i.test(String(fact.value)))return false;
    }
    return true;
  }
  function safeAgentDecisions(p,scan,decisions={},mappings={},recordBindings={}) {
    const groups=bindRecordGroups(p,scan,recordBindings),byField=new Map(groups.flatMap(g=>g.fieldIds.map(id=>[id,g])));
    const accepted={},rejected=[];
    for(const [id,d] of Object.entries(decisions || {})){
      const original=scan.fields.find(f=>f.id===id),group=byField.get(id),field=original && group?.status==='bound'?{...original,module:group.module,recordHint:'',groupLabel:''}:original,scoped=group?{...p,facts:p.facts.filter(f=>f.module===group.module && f.recordId===group.recordId)}:p;
      if(!field || (group && group.status!=='bound') || mappings[id]!==d?.factKey || !validOptionDecision(scoped,field,d)){rejected.push(id);continue;}
      accepted[id]=d;
    }
    return {accepted,rejected};
  }
  function safeAgentMappings(p,scan,mappings,recordBindings={}) {
    const groups=bindRecordGroups(p,scan,recordBindings),byField=new Map(groups.flatMap(g=>g.fieldIds.map(id=>[id,g])));
    const accepted={}, rejected=[];
    for(const [id,key] of Object.entries(mappings)) {
      const original=scan.fields.find(f=>f.id===id),group=byField.get(id),field=original && group?.status==='bound'?{...original,module:group.module,recordHint:'',groupLabel:''}:original, fact=p.facts.find(f=>f.key===key), scoped=group?{...p,facts:p.facts.filter(f=>f.module===group.module && f.recordId===group.recordId)}:p;
      if(!field || !fact || fact.manual || fact.sensitive || !mappingMatches(scoped,field,fact)) {rejected.push(id);continue;}
      if(group){if(group.status!=='bound' || fact.recordId!==group.recordId){rejected.push(id);continue;}accepted[id]=key;continue;}
      const evidence=recordEvidence(p,field,moduleHint(field));
      if(evidence!==null){if(evidence.size!==1 || !evidence.has(fact.recordId)){rejected.push(id);continue;}accepted[id]=key;continue;}
      // A model may not choose the first repeated education/work card by guesswork.
      const related=personalGraduation(field)?highestEducationEnd(p,field):p.facts.filter(f=>f.module===fact.module && f.label===fact.label && recordMatches(f,field));
      if(['education','internship','project','campus-role','awards','publications','family'].includes(fact.module) && new Set(related.map(f=>f.recordId)).size>1) {
        const hint=normal([field.label,field.groupLabel,field.recordHint].join(' '));
        const matching=related.filter(f=>[f.recordLabel,f.recordHint,...qualifiers(f.recordHint)].some(t=>normal(t) && hint.includes(normal(t))));
        if(new Set(matching.map(f=>f.recordId)).size!==1 || !matching.some(f=>f.key===key)) {rejected.push(id);continue;}
      }
      accepted[id]=key;
    }
    return {accepted,rejected};
  }
  return {validatePack,profile,scanValid,bindRecordGroups,allocateRecords,plan,review,confirm,agentRequest,safeAgentMappings,safeAgentDecisions,normal,profileIds,sortFacts,ongoingEnd};
});
