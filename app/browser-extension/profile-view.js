((root, factory) => {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else root.TouDiProfileView = view;
})(globalThis, () => {
  'use strict';
  const awardCategories = Object.freeze([
    {id:'honor',label:'荣誉'}, {id:'scholarship',label:'奖学金'},
    {id:'competition',label:'竞赛'}, {id:'other',label:'其他'}
  ].map(Object.freeze));
  function categoryIds(value) {
    const text=String(value || '').trim().toLowerCase(),ids=[];
    if (/荣誉|称号|表彰|honou?r/.test(text))ids.push('honor');
    if (/奖学金|scholarship/.test(text))ids.push('scholarship');
    if (/竞赛|比赛|大赛|competition|contest/.test(text))ids.push('competition');
    return ids;
  }
  function awardCategory(record) {
    const types=(record.facts || []).filter(f=>/^(获奖类型|奖项类别|奖项类型|荣誉类型|类别|类型)$/.test(String(f.label).trim()));
    // A record's explicit type is authoritative; unknown or mixed types stay visible in Other.
    const ids=[...new Set(types.flatMap(f=>categoryIds(f.value)))];
    const inferred=types.length?ids:categoryIds(record.title || record.recordLabel);
    return awardCategories.find(c=>c.id===(inferred.length===1?inferred[0]:'other'));
  }
  function awardGroups(records) {
    return awardCategories.map(category=>({...category,records:records.filter(record=>awardCategory(record).id===category.id)})).filter(group=>group.records.length);
  }
  function nameFact(record) {
    return (record.facts || []).find(f=>String(f.value)===record.title && /^(名称|项目名称|奖项名称|论文名称|专著名称|学校|单位|公司名称|组织名称|语言[／/]证书名称|证书名称|姓名)$/.test(String(f.label)));
  }
  const isReference=fact=>fact.module==='personal' && fact.manual===true;
  const personalCategories=Object.freeze([
    {id:'basic',label:'身份信息'}, {id:'contact',label:'联系方式'},
    {id:'address',label:'地址与户籍'}, {id:'education',label:'学历摘要'},
    {id:'emergency',label:'紧急联系人'}, {id:'preference',label:'求职意向'},
    {id:'skills',label:'技能与评价'}, {id:'other',label:'补充信息'},
    {id:'supplement',label:'参考材料'}
  ].map(Object.freeze));
  function personalCategory(fact) {
    const label=String(fact.label || '');
    if(isReference(fact) || /游戏经历|电子游戏|游戏经验|特定用途|专项素材/.test(label))return 'supplement';
    if(/紧急|备用联系|联系人.*(?:单位|关系|职务|姓名|电话|手机)/.test(label))return 'emergency';
    if(/籍贯|生源|户籍|户口|地址|邮编|住址|居住|通讯/.test(label))return 'address';
    if(/学历|学位|毕业|专业|学校|院校/.test(label) && !/技能|能力/.test(label))return 'education';
    if(/技能|评价|优势|特长|爱好|兴趣|自我介绍|个人介绍|能力/.test(label))return 'skills';
    if(/求职|意向|期望|薪资|到岗|岗位|工作地点|行业偏好|择业/.test(label))return 'preference';
    if(/联系|电话|手机|邮箱|电子邮件/.test(label))return 'contact';
    if(/姓名|姓氏|英文名|性别|出生|生日|年龄|民族|国籍|政治|党员|入党|婚姻|身高|体重|证件|身份证|健康/.test(label))return 'basic';
    return 'other';
  }
  function narrative(fact) {
    return /描述|职责|成果|摘要|评价|介绍|技能|特长|爱好|兴趣|说明|经历|事迹|获奖情况|主修课程/.test(fact.label)
      || String(fact.value).includes('\n') || String(fact.value).length>100;
  }
  function fieldLabel(fact) {
    const label=String(fact.label || '');
    return fact.module==='personal' && personalCategory(fact)==='emergency'?(label.replace(/^紧急联系人/,'') || '联系人'):label;
  }
  function factGroups(module,facts) {
    if(module==='personal'){
      const groups=personalCategories.map(c=>({...c,facts:facts.filter(f=>personalCategory(f)===c.id)})).filter(g=>g.facts.length);
      const education=groups.find(g=>g.id==='education'),basic=groups.find(g=>g.id==='basic');
      // One or two summary values do not need a separate panel. Full education
      // records still live in Education; this only groups the browsing surface.
      if(basic && education && education.facts.length<=2){basic.label='身份与学历';basic.facts.push(...education.facts);return groups.filter(g=>g!==education);}
      return groups;
    }
    return [{id:'basic',label:'基本信息',facts:facts.filter(f=>!narrative(f))},
      {id:'detail',label:'详细内容',facts:facts.filter(narrative)}].filter(g=>g.facts.length);
  }
  return {awardCategories,awardCategory,awardGroups,nameFact,isReference,personalCategories,personalCategory,narrative,factGroups,fieldLabel};
});
