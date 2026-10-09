((root, factory) => {
  const C = typeof module === 'object' && module.exports ? require('./filling-core.js') : root.TouDiFillingCore;
  const V = typeof module === 'object' && module.exports ? require('./filling-aliases.js') : root.TouDiFillingVocabulary;
  const library = factory(C, V);
  if (typeof module === 'object' && module.exports) module.exports = library;
  else root.TouDiProfileLibrary = library;
})(globalThis, (C, V) => {
  'use strict';
  const field = (id, label, input='text', extra={}) => ({id,label,input,...extra});
  const templates = {
    personal: {label:'个人信息', action:'填写个人信息', fields:[
      field('name','姓名'),field('phone','手机','tel'),field('email','电子邮箱','email'),
      field('city','现居住地','text',{labels:['现居地']}),field('gender','性别','choice',{choices:['男','女','不愿提供']}),
      field('birth','出生日期','date'),field('origin','生源地'),field('household','户籍所在地','text',{labels:['当前户籍所在地']}),
      field('hometown','籍贯'),field('nationality','国籍','text',{optional:true}),
      field('ethnicity','民族','text',{optional:true}),field('politics','政治面貌','choice',{optional:true,choices:['群众','共青团员','中共党员','中共预备党员']}),
      field('marriage','婚姻状况','choice',{optional:true,choices:['未婚','已婚','离异','丧偶']}),
      field('height','身高cm','text',{optional:true}),field('weight','体重kg','text',{optional:true}),field('address','家庭地址','text',{optional:true}),
      field('document','证件类型','choice',{optional:true,choices:['居民身份证','护照','港澳居民来往内地通行证','台湾居民来往大陆通行证']}),
      field('documentNumber','证件号码','text',{optional:true}),field('highest','最高学历','choice',{optional:true,choices:['高中','专科','本科','硕士','博士']}),
      field('highestAward','最高学位','choice',{optional:true,choices:['学士','硕士','博士','无']}),field('skills','专业技能','textarea',{optional:true,labels:['IT技能','技能特长']}),
      field('emergencyName','紧急联系人姓名','text',{optional:true}),field('emergencyPhone','紧急联系人手机','tel',{optional:true}),field('emergencyRelation','紧急联系人关系','text',{optional:true}),field('emergencyEmployer','紧急联系人单位','text',{optional:true}),field('emergencyTitle','紧急联系人职务','text',{optional:true}),
      field('awards','获奖情况','textarea',{optional:true}),field('summary','自我评价','textarea',{optional:true,labels:['个人评价']}),field('hobbies','兴趣爱好','textarea',{optional:true})]},
    family: {label:'家庭成员',action:'添加家庭成员',fields:[field('name','姓名'),field('relation','与本人关系','choice',{choices:['父亲','母亲','配偶','子女','兄弟姐妹']}),field('phone','手机','tel'),field('employer','工作单位'),field('role','职务'),field('location','工作所在地'),field('birth','出生日期','date',{optional:true}),field('politics','政治面貌','text',{optional:true})]},
    education: {label:'教育经历', action:'添加教育经历', fields:[
      field('school','学校'),field('degree','学历','choice',{choices:['高中','专科','本科','硕士','博士']}),
      field('major','专业'),field('award','学位','choice',{choices:['学士','硕士','博士','无']}),
      field('start','开始日期','date'),field('end','结束日期','date'),
      field('college','学院','text',{optional:true}),field('studyType','学历类型','choice',{optional:true,choices:['全日制','非全日制']}),
      field('gpa','GPA','text',{optional:true}),field('rank','成绩排名','text',{optional:true,labels:['年级排名']}),
      field('courses','主修课程','textarea',{optional:true})]},
    internship: {label:'工作与实习', action:'添加工作／实习', fields:[
      field('company','单位'),field('role','岗位','text',{labels:['职务','职位']}),field('department','部门'),
      field('kind','工作类型','choice',{optional:true,choices:['全职','实习','兼职']}),
      field('city','工作地点'),field('start','开始日期','date',{labels:['开始']}),field('end','结束日期','date',{ongoing:true,labels:['结束']}),
      field('tasks','工作职责','textarea',{labels:['职责']}),field('results','工作成果','textarea',{optional:true})]},
    project: {label:'项目经历', action:'添加项目经历', fields:[
      field('name','名称'),field('role','项目角色','text',{labels:['角色']}),field('start','开始日期','date'),
      field('end','结束日期','date',{ongoing:true}),field('description','项目描述','textarea',{labels:['简述']}),
      field('tasks','本人职责','textarea'),field('results','项目成果','textarea',{optional:true}),
      field('url','项目链接','url',{optional:true})]},
    'campus-role': {label:'在校经历',action:'添加在校经历',fields:[field('organization','组织名称'),field('role','职务'),field('start','开始日期','date'),field('end','结束日期','date',{ongoing:true}),field('tasks','职责描述','textarea'),field('results','成果','textarea',{optional:true})]},
    awards: {label:'荣誉获奖',action:'添加获奖记录',fields:[field('name','奖项名称'),field('level','获奖级别','text',{labels:['获奖等级']}),field('rank','奖项等级'),field('category','奖项类别','text',{labels:['获奖类型','奖项类型']}),field('date','获奖日期','date'),field('issuer','颁奖单位'),field('description','获奖说明','textarea',{optional:true,labels:['奖项描述','获奖描述']})]},
    publications: {label:'论文发表',action:'添加论文记录',fields:[field('name','论文名称'),field('venue','发表刊物'),field('date','发表日期','date'),field('order','作者排序'),field('authors','作者名单','textarea',{optional:true}),field('status','发表状态','text',{optional:true}),field('indexing','收录类别','text',{optional:true}),field('onlineDate','在线发表日期','date',{optional:true}),field('issueDate','正式出版日期','date',{optional:true}),field('citation','卷期页码','text',{optional:true}),field('abstract','论文摘要','textarea',{optional:true}),field('url','论文链接','url',{optional:true})]},
    language: {label:'语言能力', action:'添加语言／证书', fields:[
      field('name','语言／证书名称'),field('language','语种'),field('certificate','证书类型'),field('level','熟练程度','choice',{choices:['基础','日常交流','熟练','母语']}),
      field('score','考试成绩'),field('date','取得日期','date',{optional:true})]}
  };
  const uuid = () => globalThis.crypto.randomUUID();
  const emptyPack = () => ({schemaVersion:1,name:'个人填报资料',profiles:[{id:'general',label:'默认资料'}],facts:[],rules:[],warnings:[],supplements:[]});
  const group = (pack, mod, recordId) => pack.facts.filter(f=>f.module===mod && (mod==='personal' || f.recordId===recordId));
  const boundFact = (facts, definition) => facts.find(f=>!(f.module==='personal' && f.manual) && f.label===definition.label) || facts.find(f=>!(f.module==='personal' && f.manual) && (definition.labels || []).includes(f.label));
  const aliases = definition => V.aliases[definition.label] || Object.values(V.aliases).find(list=>list.includes(definition.label)) || [definition.label];
  function dateValid(value) {
    const m=String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if(!m)return false;
    const y=+m[1],mo=+m[2],d=+(m[3] || 1),test=new Date(Date.UTC(y,mo-1,d));
    return y>=100 && test.getUTCFullYear()===y && test.getUTCMonth()===mo-1 && test.getUTCDate()===d;
  }
  function recordDraft(pack, mod, recordId='',profileId=null) {
    const facts=group(pack,mod,recordId).filter(f=>!profileId || f.profiles.includes(profileId)),template=templates[mod];
    if(!template)throw Error('不支持的资料类型。');
    return {module:mod,recordId,fields:template.fields.map(d=>({...d,fact:boundFact(facts,d),value:boundFact(facts,d)?.value ?? ''})),
      profiles:[...new Set(facts.flatMap(f=>f.profiles))],extraFacts:facts.filter(f=>!template.fields.some(d=>boundFact(facts,d)?.key===f.key))};
  }
  function saveRecord(pack, mod, recordId, values, options={}) {
    const candidate=structuredClone(pack),template=templates[mod];
    if(!template)throw Error('请选择资料类型。');
    const id=recordId || (mod==='personal'?'personal':mod+'-'+uuid());
    const old=group(candidate,mod,recordId).filter(f=>!options.profileId || f.profiles.includes(options.profileId)),touched=new Set(old.map(f=>f.key)),profiles=options.profiles || candidate.profiles.map(p=>p.id);
    if(!profiles.length || profiles.some(id=>!candidate.profiles.some(p=>p.id===id)))throw Error('至少选择一个资料版本。');
    for(const definition of template.fields) {
      if(!Object.hasOwn(values,definition.id))continue;
      const original=boundFact(old,definition),value=String(values[definition.id] ?? '');
      if(original && value===String(original.value))continue;
      if(!value.trim()){if(original)candidate.facts=candidate.facts.filter(f=>f.key!==original.key);continue;}
      if(definition.input==='date' && !(definition.ongoing && value==='至今') && !dateValid(value))throw Error(definition.label+'需要完整的 YYYY-MM 或 YYYY-MM-DD 日期。');
      const fact={...original,key:original?.key || mod+'.'+uuid(),label:original?.label || definition.label,value,module:mod,recordId:original?.recordId || id,
        profiles:original?.profiles || profiles.slice(),aliases:original?.aliases || aliases(definition)};
      if(definition.input==='date'){
        fact.precision=value==='至今'?null:value.length===7?'month':'day';
        delete fact.ongoing;delete fact.dateFallback;
        if(value==='至今'){fact.ongoing=true;if(options.dateFallback==='today')fact.dateFallback='today';}
      }
      touched.add(fact.key);
      if(original)candidate.facts[candidate.facts.findIndex(f=>f.key===original.key)]=fact;else candidate.facts.push(fact);
    }
    for(const [key,raw] of Object.entries(options.extraValues || {})){
      const fact=old.find(f=>f.key===key);
      if(!fact || template.fields.some(d=>boundFact(old,d)?.key===key))throw Error('补充字段不属于当前编辑板块。');
      const value=String(raw);if(value===String(fact.value))continue;
      if(!value.trim())candidate.facts=candidate.facts.filter(f=>f.key!==key);
      else candidate.facts[candidate.facts.findIndex(f=>f.key===key)]={...fact,value};
    }
    let current=group(candidate,mod,id).filter(f=>touched.has(f.key));
    if(!current.length)throw Error('请至少填写一项已确认的资料。');
    const find=label=>boundFact(current,template.fields.find(d=>d.label===label) || {label});
    const get=label=>String(find(label)?.value || '');
    const start=find('开始日期')?.value,end=find('结束日期')?.value;
    if(dateValid(start) && dateValid(end)) {
      const a=String(start),b=String(end),width=Math.min(a.length,b.length);
      if(a.slice(0,width)>b.slice(0,width))throw Error('结束日期不能早于开始日期。');
    }
    const naming=mod==='family'?['与本人关系','姓名']:mod==='education'?['学历','学校']:mod==='internship'?['单位','岗位']:mod==='project'?['名称']:mod==='language'?['语言／证书名称']:mod==='campus-role'?['组织名称','职务']:mod==='awards'?['奖项名称']:mod==='publications'?['论文名称']:[];
    const primary=mod==='family'?'姓名':mod==='education'?'学校':mod==='internship'?'单位':mod==='project'?'名称':mod==='language'?'语言／证书名称':mod==='campus-role'?'组织名称':mod==='awards'?'奖项名称':mod==='publications'?'论文名称':null;
    const namingChanged=!old.length || ((!primary || get(primary)) && naming.some(label=>get(label)!==String(boundFact(old,template.fields.find(d=>d.label===label) || {label})?.value || '')));
    const title=naming.map(get).filter(Boolean).join(' · ') || old[0]?.recordLabel || template.label;
    current.forEach(f=>{
      if(namingChanged || !f.recordLabel){f.recordLabel=title;f.recordHint=naming.map(get).filter(Boolean).join(' ');}
      if(options.changeProfiles)f.profiles=profiles.slice();
    });
    if(options.gpaScale!==undefined){const gpa=current.find(f=>f.label==='GPA');if(gpa){if(options.gpaScale)gpa.gpaScale=options.gpaScale;else delete gpa.gpaScale;}}
    if(options.dateFallback!==undefined){
      const end=current.find(f=>C.ongoingEnd(f));
      if(end){end.ongoing=true;if(options.dateFallback==='today')end.dateFallback='today';else delete end.dateFallback;}
    }
    return C.validatePack(candidate);
  }
  function addField(pack, context, value) {
    const candidate=structuredClone(pack),mod=context.module;
    if(!templates[mod])throw Error('请选择资料类型。');
    const label=value.label.trim(),content=String(value.value ?? '');
    if(!label || !content.trim())throw Error('请填写字段名称和已确认内容。');
    const id=context.recordId || (mod==='personal'?'personal':'');
    const existing=group(candidate,mod,id);
    if(mod!=='personal' && !existing.length)throw Error('请先添加一段经历，再为这段经历补充字段。');
    if(existing.some(f=>[f.label,...f.aliases].some(alias=>C.normal(alias)===C.normal(label))))throw Error('本段资料已有这个字段，请直接编辑。');
    candidate.facts.push({...value,key:mod+'.'+uuid(),label,value:content,module:mod,recordId:id,
      recordLabel:existing[0]?.recordLabel || templates[mod].label,recordHint:existing[0]?.recordHint || '',
      profiles:value.profiles || existing[0]?.profiles || candidate.profiles.map(p=>p.id),aliases:value.aliases?.length?value.aliases:V.aliases[label] || [label]});
    return C.validatePack(candidate);
  }
  function addVersion(pack,label,copyFrom) {
    const candidate=structuredClone(pack),name=label.trim();
    if(!name)throw Error('请填写新版本名称。');
    if(candidate.profiles.some(p=>p.label===name))throw Error('已有同名资料版本。');
    if(!candidate.profiles.some(p=>p.id===copyFrom))throw Error('请选择已有资料版本作为来源。');
    if(name.length>20)throw Error('版本名称最多 20 个字。');
    if(candidate.profiles.length>=20)throw Error('最多保留 20 个资料版本。');
    const id='profile-'+uuid();candidate.profiles.push({id,label:name});
    const records=new Map();
    for(const f of pack.facts.filter(f=>f.profiles.includes(copyFrom))){
      const record=f.module+'|'+f.recordId;if(!records.has(record))records.set(record,f.module+'-'+uuid());
      candidate.facts.push({...structuredClone(f),key:f.module+'.'+uuid(),recordId:records.get(record),profiles:[id]});
    }
    return {pack:C.validatePack(candidate),id};
  }
  function removeVersion(pack,id){
    const candidate=structuredClone(pack);
    if(candidate.profiles.length<=1)throw Error('至少保留一个资料版本。');
    if(!candidate.profiles.some(p=>p.id===id))throw Error('资料版本不存在。');
    candidate.profiles=candidate.profiles.filter(p=>p.id!==id);
    candidate.facts=candidate.facts.flatMap(f=>{f.profiles=f.profiles.filter(p=>p!==id);return f.profiles.length?[f]:[];});
    return C.validatePack(candidate);
  }
  function copyRecords(pack,profileId){
    const p=C.profile(C.validatePack(pack),profileId),groups=new Map();
    for(const f of p.facts){const key=f.module+'|'+f.recordId;if(!groups.has(key))groups.set(key,{id:key,module:f.module,title:f.recordLabel || templates[f.module].label,facts:[]});groups.get(key).facts.push({key:f.key,label:f.label,value:String(f.value),manual:!!f.manual});}
    return [...groups.values()].map(record=>({...record,text:[record.title,...record.facts.map(f=>f.label+'：'+f.value)].join('\n')}));
  }
  return {copyRecords,templates,emptyPack,group,recordDraft,saveRecord,addField,addVersion,removeVersion,dateValid};
});
