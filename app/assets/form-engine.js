(function (root, factory) {
  const engine = factory(typeof module==='object'&&module.exports?require('./form-adapters.js'):root.TouDiFormAdapters);
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.TouDiFormEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (adapterLibrary) {
  'use strict';
  let latest = null;
  const ENGINE_VERSION = '0.5.19'+(adapterLibrary?.revision?'.'+adapterLibrary.revision:'');
  let structureHints={};
  const wait=(milliseconds=100)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  const adapters=adapterLibrary?.create({compact:v=>compact(v),visible,structuralPath,labelText,wait,setNative});
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  function hash(text) {
    let n = 2166136261;
    for (let i = 0; i < text.length; i++) { n ^= text.charCodeAt(i); n = Math.imul(n, 16777619); }
    return (n >>> 0).toString(16).padStart(8, '0');
  }
  function visible(node) {
    if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const win = node.ownerDocument.defaultView, style = win.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && [...node.getClientRects()].some(r=>r.width>0 && r.height>0);
  }
  function labelText(node) {
    const copy=node.cloneNode(true);
    copy.querySelectorAll('input,select,textarea,[role="combobox"],[role="option"],[role="alert"],[class*="display-value"],[class*="Input-message"],[class*="Input-addon"]').forEach(x=>x.remove());
    return compact(copy.textContent);
  }
  function questionText(text) {
    const value=compact(text).replace(/^(?:请填写|请输入|请选择|请补充)\s*/, '');
    // A selected year/month/value is not a question, even if exposed as an ARIA name.
    return !value || /^\d+(?:[-/.年]\d+)*(?:月|日|年)?$/.test(value) || /^(请选择|请输入|必填项未填写)$/.test(value)?'':value;
  }
  function named(node) {
    const adapted=adapters?.describe(node);
    if(adapted)return questionText(adapted.label);
    const ids = node.getAttribute('aria-labelledby');
    if (ids) {const title=questionText(ids.split(/\s+/).map(id => node.getRootNode().getElementById?.(id)?.textContent || '').join(' '));if(title)return title;}
    const explicit=questionText(node.getAttribute('aria-label') || [...(node.labels || [])].map(labelText).join(' '));
    if(explicit) return explicit;
    for(let p=node.parentElement,depth=0;p && depth<3;p=p.parentElement,depth++) {
      if(p.querySelectorAll('input,textarea,select,[role="combobox"]').length!==1) break;
      const near=p.querySelector(':scope > label,:scope > .field-label,:scope > .form-label');
      if(near && (!near.htmlFor || near.htmlFor===node.id)) return labelText(near);
    }
    return questionText(node.getAttribute('placeholder'));
  }
  function structuralPath(node) {
    const parts=[];
    for(let n=node;n && n.nodeType===1;n=n.parentElement) {
      const peers=n.parentElement ? [...n.parentElement.children].filter(x=>x.tagName===n.tagName) : [n];
      parts.unshift(n.tagName.toLowerCase()+':'+peers.indexOf(n));
    }
    return parts.join('/');
  }
  function context(node) {
    const adapted=adapters?.describe(node);
    if(adapted)return adapted.context;
    let group = '', hint = '', groupPath = '';
    for (let p = node.parentElement, depth = 0; p && depth < 7; p = p.parentElement, depth++) {
      const legend = p.tagName === 'FIELDSET' ? p.querySelector(':scope > legend') : null;
      const heading = p.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > [role="heading"]');
      const title = compact(legend?.textContent || (p.getAttribute('role') === 'group' ? named(p) : '') || heading?.textContent);
      if (title) { if (!group) { group = title; groupPath=structuralPath(p); } hint = compact(hint + ' ' + title); }
      if (p.tagName === 'FORM') break;
    }
    const module = /家庭成员|家庭情况|家庭信息|亲属|family|父亲|母亲/i.test(hint) ? 'family' : /紧急联系人|emergency contact/i.test(hint) ? 'personal' : /在校职务|在校任职|校园任职|在校经历|校园经历|学生工作|学生干部|campus-role|campus posts|school posts/i.test(hint) ? 'campus-role' : /获奖|荣誉|奖励|awards/i.test(hint) ? 'awards' : /论文|专著|发表|publications/i.test(hint) ? 'publications' : /教育|学历|学位|education/i.test(hint) ? 'education' : /实习|工作经历|任职|employment|work experience/i.test(hint) ? 'work' : /项目|科研|实践|project/i.test(hint) ? 'projects' : /语言|外语|证书|language|certificate/i.test(hint)?'language':'';
    const generic=/^(教育经历|教育背景|学历信息|工作经历|实习经历|项目经历|项目经验|在校职务|在校任职|在校经历|校园经历|学生工作|获奖情况|荣誉奖励|获奖经历|论文\/专著|论文发表|语言能力|外语能力|语言及证书|证书|education|work experience|projects|家庭成员|家庭情况|家庭信息|family)$/i.test(group);
    const recordHint = /本科|硕士|博士|大专|学士|master|bachelor|doctor/i.test(hint) ? hint : module && group && !generic ? group : '';
    return { groupLabel: group, recordHint, module, groupPath };
  }
  function read(entry) {
    const n = entry.node;
    if(entry.field?.adapter)return adapters.read(entry);
    if (entry.type === 'radio') return entry.nodes.find(x => x.checked)?.value || '';
    if (entry.type === 'checkbox') return !!n.checked;
    if (entry.type === 'combobox') {
      const raw=String(n.value ?? n.getAttribute('aria-valuetext') ?? n.textContent ?? '').trim();
      const match=entry.field?.options.filter(x=>x.value===raw || x.text===raw) || [];
      return match.length===1 ? match[0].value : raw;
    }
    return typeof n.value==='string' ? n.value : String(n.getAttribute('aria-valuetext') ?? n.textContent ?? '').trim();
  }
  function radioContext(node, root) {
    for(let p=node.parentElement;p;p=p.parentElement) {
      if(p.getAttribute('role')==='radiogroup') return {container:p,label:named(p)};
      const question=p.querySelector(':scope > label,:scope > .field-label,:scope > .form-label');
      if(question && !question.querySelector('input,select,textarea') && labelText(question)) return {container:p,label:labelText(question)};
      if(p.tagName==='FIELDSET') {
        const controls=[...p.querySelectorAll('input,select,textarea,[role="combobox"]')];
        if(controls.length && controls.every(x=>x.type==='radio' && x.name===node.name)) {
          const legend=p.querySelector(':scope > legend');
          if(legend) return {container:p,label:compact(legend.textContent)};
        }
      }
      if(p.tagName==='FORM') break;
    }
    return {container:node.form || root,label:''};
  }
  // Candidates come from nearby title nodes, never input values or arbitrary page text.
  function structureCandidates(entry) {
    const {node,field}=entry,labels=[],groups=[],refs=new Map();
    const controls='input,textarea,select,[role="combobox"],.phoenix-radio-group';
    const candidate=(el,kind,container)=>{
      if(!el || el.matches(controls) || el.querySelector(controls) || !visible(el))return;
      if(el.closest('[role="option"],[role="listbox"],[class*="display-value"],.phoenix-select'))return;
      const text=questionText(el.textContent);if(!text || text.length>60)return;
      const id=kind+'-'+hash(structuralPath(el)),items=kind==='label'?labels:groups;
      if(items.some(x=>x.id===id))return;
      items.push({id,text});refs.set(id,{text,path:structuralPath(container)});
    };
    for(let p=node.parentElement,depth=0;p&&depth<5;p=p.parentElement,depth++) {
      const count=p.querySelectorAll(controls).length;
      if(!field.label && count===1)for(const el of p.querySelectorAll(':scope > label,:scope > [class*="label"],:scope > [class*="title"]'))candidate(el,'label',p);
      if(!field.groupLabel)for(const el of p.querySelectorAll(':scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > [role="heading"],:scope > .section-title,:scope > .group-title'))candidate(el,'group',p);
      if(p.tagName==='FORM')break;
    }
    return {fieldId:field.id,labels:labels.slice(0,6),groups:groups.slice(0,4),refs};
  }
  function collect() {
    adapters?.reset();
    const entries = [], warnings = [], counts = new Map(),scopeRoots=new Map();
    function walk(root, scope) {
      scopeRoots.set(root,scope);
      const nodes = adapters?adapters.nodes(root):[...root.querySelectorAll('input,textarea,select,[role="combobox"]')];
      const radios = new Set();
      for (const node of nodes) {
        if(node.closest?.("#toudi-floating-host,[data-toudi-panel]"))continue;
        if(adapters && !adapters.includes(node,root))continue;
        const rawType = (node.getAttribute('type') || '').toLowerCase();
        if (['hidden','password','submit','reset','button','image'].includes(rawType) || !visible(node)) continue;
        let label = named(node);
        if (!label) {
          const parent = node.closest('label');
          label = !adapters?.describe(node) && parent ? questionText(labelText(parent)) : '';
        }
        if (/password|token|secret|密码|口令|令牌/i.test(label + ' ' + node.name + ' ' + node.id)) continue;
        const adapted=adapters?.describe(node),adapter=adapted?.adapter || '';
        const dateMeta=adapted?.dateMeta || {};
        const type=adapted?.type || (rawType==='radio'?'radio':rawType==='checkbox'?'checkbox':rawType==='file'?'file':node.tagName==='SELECT'?'select':node.tagName==='TEXTAREA'?'textarea':node.getAttribute('role')==='combobox'?'combobox':rawType||'text');
        let ctx=context(node);
        let members = [node], options = [];
        if (adapter==='phoenix-radio' || adapter==='ant-radio') {options=adapted.options;}
        else if (type === 'radio') {
          const local = radioContext(node,root), container=local.container;
          members = [...container.querySelectorAll('input[type="radio"]')].filter(x => x.name === node.name && visible(x) && radioContext(x,root).container===container);
          if (members.some(x => radios.has(x))) continue;
          members.forEach(x => radios.add(x));
          label = local.label;
          options = members.map(x => ({value:x.value,text:named(x) || (x.closest('label') ? labelText(x.closest('label')) : '')}));
        } else if (type === 'select') options = [...node.options].map(x => ({value:x.value,text:compact(x.textContent)}));
        else if (type === 'combobox' && !adapter.startsWith('ant-')) {
          const box = node.getRootNode().getElementById?.(node.getAttribute('aria-controls'));
          options = box ? [...box.querySelectorAll('[role="option"]')].filter(visible).map(x => ({value:x.getAttribute('data-value') || x.getAttribute('value') || '',text:compact(x.textContent)})) : [];
        }
        const module = ctx.module || (/姓名|性别|出生|手机|电话|邮箱|证件|地址|最高学历|第一学历|国籍|民族|政治面貌|身高|体重|自我评价|个人评价|紧急联系|name|email|phone/i.test(label) ? 'personal' : 'other');
        let unsupported = '';
        if (type === 'file') unsupported = 'file-upload';
        else if (/验证码|校验码|安全验证|captcha|verification code|one.time code/i.test(label)) unsupported = 'verification-code';
        else if (['checkbox','radio'].includes(type) && /同意|声明|隐私|条款|协议|我已阅读|本人确认|agree|consent|terms|declaration/i.test(label)) unsupported = 'consent';
        else if (type === 'combobox' && !adapter && (!options.length || options.some(x => !x.value))) unsupported = 'custom-selector';
        else if(adapted?.unsupported)unsupported=adapted.unsupported;
        else if (!adapted?.presentChecked && members.some(n=>adapters?.disabled(n) || n.disabled || (n.readOnly && !adapted?.allowReadonly) || n.closest('fieldset[disabled]') || n.getAttribute('aria-disabled')==='true')) unsupported='disabled-or-readonly';
        else if (!label) unsupported = 'unlabeled';
        const constraints=Object.fromEntries(['min','max','step','pattern'].filter(k=>node.hasAttribute(k)).map(k=>[k,node.getAttribute(k)]));
        const placeholder=(node.getAttribute('placeholder') || '').trim().toUpperCase();
        const dateFormat=adapted?.dateFormat || (['YYYY-MM-DD','YYYY/MM/DD','YYYY.MM.DD','YYYY-MM','YYYY/MM','YYYY.MM'].includes(placeholder)?placeholder:undefined);
        const descriptor = {scope,label,module,groupLabel:ctx.groupLabel,groupPath:ctx.groupPath,type,name:node.name || '',options,constraints,...dateMeta,...(adapter?{adapter}:{}),...(dateFormat?{dateFormat}:{}),...(adapted?.datePrecision?{datePrecision:adapted.datePrecision}:{}),...(adapted?.regionDepth?{regionDepth:adapted.regionDepth}:{}),required:members.some(x=>x.required || x.getAttribute('aria-required')==='true') || !!adapted?.required,maxLength:node.maxLength >= 0 ? node.maxLength : null,unsupported};
        // Record values can constrain matching, but never rename/reidentify a field.
        const signature = JSON.stringify({scope,path:structuralPath(node),type,name:node.name || ''}), index = counts.get(signature) || 0;
        counts.set(signature,index+1);
        const id = 'field-' + hash(signature + ':' + index);
        const field = {id,label,module,groupId:ctx.groupLabel ? 'group-'+hash(scope+ctx.groupPath+ctx.groupLabel) : '',groupLabel:ctx.groupLabel,recordHint:ctx.recordHint,type,required:descriptor.required,maxLength:descriptor.maxLength,value:unsupported && unsupported!=='unlabeled' ? '' : read({node,nodes:members,type,field:{options,adapter,label}}),options,constraints,...dateMeta,...(adapter?{adapter}:{}),...(dateFormat?{dateFormat}:{}),...(adapted?.datePrecision?{datePrecision:adapted.datePrecision}:{}),...(adapted?.regionDepth?{regionDepth:adapted.regionDepth}:{}),...(adapted?.presentAvailable?{presentAvailable:true}:{})};
        if (unsupported) field.unsupported = unsupported;
        entries.push({field,descriptor,node,nodes:members,type});
      }
      let shadowIndex = 0, frameIndex = 0;
      for (const el of root.querySelectorAll('*')) {
        if(el.id==='toudi-floating-host' || el.hasAttribute('data-toudi-panel') || (el.tagName==='IFRAME' && /^(chrome|moz)-extension:/.test(el.getAttribute('src') || '')))continue;
        if (el.shadowRoot && visible(el)) walk(el.shadowRoot, scope+'/shadow:'+el.tagName.toLowerCase()+':'+shadowIndex++);
        if (el.tagName === 'IFRAME' && visible(el)) {
          const frameScope = scope+'/frame:'+frameIndex++;
          try { if (!el.contentDocument || !el.contentWindow.location.origin) throw Error(); walk(el.contentDocument,frameScope); }
          catch (_) { warnings.push({code:'cross-origin-frame',scope:frameScope,message:'跨域 iframe 未访问'}); }
        }
      }
    }
    walk(document,'document');
    const origin = location.origin, path = location.pathname;
    const candidates=entries.filter(e=>(!e.field.label || !e.field.groupLabel) && (!e.field.unsupported || e.field.unsupported==='unlabeled')).map(structureCandidates).filter(c=>c.labels.length||c.groups.length).slice(0,100);
    const publicCandidates=candidates.map(({refs,...candidate})=>candidate);
    const structureFingerprint=hash(JSON.stringify({origin,path,engineVersion:ENGINE_VERSION,fields:entries.map(e=>({id:e.field.id,label:e.field.label,type:e.field.type,groupId:e.field.groupId})),candidates:publicCandidates}));
    const applied=[],rejected=[];
    for(const [id,hint] of Object.entries(structureHints)) {
      const c=candidates.find(c=>c.fieldId===id),entry=entries.find(e=>e.field.id===id);
      const keys=hint && typeof hint==='object'&&!Array.isArray(hint)?Object.keys(hint):[];
      if(!c || !keys.length || keys.some(k=>!['labelId','groupId'].includes(k) || typeof hint[k]!=='string') || (hint.labelId && !c.labels.some(x=>x.id===hint.labelId)) || (hint.groupId && !c.groups.some(x=>x.id===hint.groupId)) || keys.some(k=>!hint[k])){rejected.push(id);continue;}
      const f=entry.field,d=entry.descriptor;
      if(hint.labelId) {
        f.label=d.label=c.refs.get(hint.labelId).text;
        if(/password|token|secret|密码|口令|令牌|验证码|校验码|captcha|verification code/i.test(f.label)){f.unsupported=d.unsupported='verification-code';}
        else if(['checkbox','radio'].includes(f.type)&&/同意|声明|隐私|条款|协议|本人确认|agree|consent|terms/i.test(f.label)){f.unsupported=d.unsupported='consent';}
        else if(f.unsupported==='unlabeled'){delete f.unsupported;d.unsupported='';f.value=read(entry);}
      }
      if(hint.groupId){const ref=c.refs.get(hint.groupId);f.groupLabel=d.groupLabel=ref.text;d.groupPath=ref.path;f.groupId='group-'+hash(d.scope+ref.path+ref.text);}
      const title=f.groupLabel;
      f.module=d.module=/教育|学历|education/i.test(title)?'education':/实习|工作经历|employment|work experience/i.test(title)?'work':/项目|project/i.test(title)?'projects':/个人|基本信息|姓名|性别|出生|手机|电话|邮箱|证件|地址|name|email|phone/i.test(title+' '+f.label)?'personal':f.module;
      applied.push(id);
    }
    const fingerprint = hash(JSON.stringify({origin,path,structure:entries.map(x=>({id:x.field.id,...x.descriptor}))}));
    const repeatables=repeatableCatalog(entries,scopeRoots);
    return {entries,repeatables,report:{protocol:1,engineVersion:ENGINE_VERSION,origin,path,title:compact(document.title),fingerprint,fields:entries.map(x=>x.field),repeatables:repeatables.map(({node,adds,records,...section})=>section),platforms:adapters?.platforms(document)||[{id:"generic",label:"通用表单",version:"1"}],structure:{fingerprint:structureFingerprint,candidates:publicCandidates,applied,rejected},warnings}};
  }
  const repeatableModules=new Set(['education','work','projects','campus-role','awards','publications','family','language']);
  function recordNode(entry){for(let n=entry.node;n;n=n.parentElement)if(structuralPath(n)===entry.descriptor.groupPath)return n;return null;}
  function sectionHeading(node){
    const moka=node.querySelector(':scope > [class*="blockTitle-"] [class*="text-"]');
    if(moka)return compact(moka.textContent);
    const ant=node.querySelector(':scope > .tit-wrap p');if(ant)return compact(ant.textContent);
    return [...node.children].filter(n=>!n.matches('input,textarea,select,button') && !n.querySelector('input,textarea,select,.form-item') && !/^(?:添加|新增|增加|add)/i.test(compact(n.textContent))).map(n=>compact(n.textContent)).find(t=>t.length<=40 && repeatableModules.has(adapters?.moduleOf(t))) || '';
  }
  function safeAddStatus(nodes){
    if(nodes.length>1)return 'ambiguous';if(!nodes.length)return 'unsupported';
    const n=nodes[0];
    if(n.closest('a[href]') && !/^(?:#|javascript:void\(0\);?)$/.test(n.closest('a').getAttribute('href')))return 'unsupported';
    if(n.closest('button')?.form && n.closest('button').type==='submit')return 'unsupported';
    if(n.closest('[disabled],[aria-disabled="true"],[inert]') || /disabled/i.test(String(n.className)))return 'disabled';
    return 'ready';
  }
  function repeatableCatalog(entries,roots){
    const sections=new Map();
    const install=(node,label,scope)=>{
      const module=adapters?.moduleOf(label);if(!node || !repeatableModules.has(module))return null;
      if(!sections.has(node))sections.set(node,{id:'section-'+hash(scope+structuralPath(node)+label),label,module,node,adds:[],records:[],groupIds:[]});
      return sections.get(node);
    };
    for(const entry of entries){
      if(!entry.field.groupId || !repeatableModules.has(entry.field.module))continue;
      const record=recordNode(entry);if(!record)continue;
      let section;
      for(let p=record.parentElement,i=0;p&&i<9;p=p.parentElement,i++){const title=sectionHeading(p);if(adapters?.moduleOf(title)===entry.field.module){section=install(p,title,entry.descriptor.scope);break;}if(p.tagName==='FORM')break;}
      if(!section)section=install(record,entry.field.groupLabel.replace(/\s*·\s*第\d+段$/,''),entry.descriptor.scope);
      if(section && !section.groupIds.includes(entry.field.groupId)){section.groupIds.push(entry.field.groupId);section.records.push(record);}
    }
    // Semantic add controls are discovered locally, including custom Phoenix
    // div+SVG controls. No CSS generated class names or site account values.
    for(const [root,scope] of roots)for(const leaf of root.querySelectorAll('button,[role="button"],a,span,div')){
      if(!visible(leaf) || leaf.closest('#toudi-floating-host,[data-toudi-panel]'))continue;
      const text=compact(leaf.getAttribute('aria-label') || labelText(leaf));
      if(!/^(?:添加|新增|增加|add)\s*(?:一段|一条|another\s*|new\s*)?.{0,35}$/i.test(text) && !/^(?:添加|新增|增加|\+|＋)$/.test(text))continue;
      if(!/^(?:添加|新增|增加|\+|＋|add)$/i.test(text) && !repeatableModules.has(adapters?.moduleOf(text)))continue;
      if(leaf.querySelector('input,textarea,select') || [...leaf.children].some(n=>compact(n.textContent)===text))continue;
      let control=leaf.closest('button,[role="button"],a') || (leaf.tagName==='SPAN' && compact(leaf.parentElement.textContent)===text?leaf.parentElement:leaf);
      let section;
      for(let p=control.parentElement,i=0;p&&i<9;p=p.parentElement,i++){const title=sectionHeading(p);if(title){const mod=adapters?.moduleOf(text);if(mod!=='other' && mod!==adapters?.moduleOf(title))break;section=install(p,title,scope);break;}if(p.tagName==='FORM')break;}
      if(section && !section.adds.includes(control))section.adds.push(control);
    }
    return [...sections.values()].map(s=>{
      // Saved cards are not empty destinations. Without a verified readable
      // identity, adding the same profile again would duplicate old records.
      const editControls=[...s.node.querySelectorAll('button,[role="button"],a')].filter(n=>visible(n) && /^(编辑|修改|edit)$/i.test(compact(n.getAttribute('aria-label') || labelText(n))));
      const closedCards=editControls.filter(n=>!s.records.some(record=>record.contains(n))).length;
      const lockedRecords=s.records.filter(record=>{
        const fields=entries.filter(e=>record.contains(e.node));
        return fields.length && fields.every(e=>e.field.unsupported==='disabled-or-readonly');
      }).length;
      const blockedReason=closedCards || lockedRecords?'saved-records-closed':'';
      return {...s,closedRecords:closedCards+lockedRecords,blockedReason,addStatus:blockedReason?'requires-edit':safeAddStatus(s.adds)};
    });
  }
  function groupSnapshots(state){
    const groups=new Map();
    for(const e of state.entries){if(!e.field.groupId || !repeatableModules.has(e.field.module))continue;
      if(!groups.has(e.field.groupId))groups.set(e.field.groupId,{id:e.field.groupId,module:e.field.module,node:recordNode(e),entries:[]});groups.get(e.field.groupId).entries.push(e);
    }
    const identities={education:/学校|院校|学历/,work:/公司|单位名称|实习单位|^单位$/,projects:/项目名称|实践名称|^名称$|在校科研及实践项目/,'campus-role':/职务|岗位|组织名称/,awards:/奖项|获奖名称/,publications:/名称|论文题目/,language:/证书名称|证书类型|语言.?证书名称/,family:/姓名|关系/};
    return [...groups.values()].map(g=>({...g,empty:!g.entries.some(e=>e.field.value!==false && String(e.field.value ?? '').trim() && !/^(?:请选择.*|请输入.*)$/.test(String(e.field.value)) && (!['select','radio','combobox','checkbox'].includes(e.type) || identities[g.module]?.test(e.field.label))),signature:JSON.stringify(g.entries.map(e=>[e.field.label,e.type,e.field.value])),shape:JSON.stringify(g.entries.map(e=>[e.field.label,e.type]))}));
  }
  function relateGroups(before,after){
    const mapped=new Map(),used=new Set();
    for(const g of [...before].sort((a,b)=>Number(a.empty)-Number(b.empty))){
      const eligible=after.filter(n=>n.module===g.module && n.signature===g.signature && !used.has(n.id));
      let match=eligible.find(n=>n.node===g.node);
      if(!match && eligible.length===1)match=eligible[0];
      // Indistinguishable blank slots contain no experience identity. Their
      // explicit placement can move to another equally empty destination.
      if(!match && g.empty)match=eligible[0];
      if(!match)throw Error('existing-record-changed');
      mapped.set(g.id,match);used.add(match.id);
    }
    return mapped;
  }
  async function expandRecords(request){
    let state=collect();
    if(!request || request.fingerprint!==state.report.fingerprint || request.fingerprint!==latest?.report.fingerprint)throw Error('structure-changed');
    if(!request.bindings || Array.isArray(request.bindings) || !Array.isArray(request.targets) || request.targets.length>16)throw Error('record-request-invalid');
    const original=state,originalGroups=groupSnapshots(state);let bindings={...request.bindings},additions=[];
    const allowedGroups=new Set(originalGroups.map(g=>g.id)),requested=new Set();
    if(Object.entries(bindings).some(([id,rid])=>!allowedGroups.has(id) || typeof rid!=='string' || !rid || rid.length>240))throw Error('record-binding-invalid');
    if(request.targets.reduce((n,t)=>n+(t.recordIds?.length || 0),0)>100)throw Error('record-limit-exceeded');
    for(const t of request.targets){
      const s=state.repeatables.find(s=>s.id===t.sectionId);
      if(!s || !Array.isArray(t.recordIds) || t.recordIds.some(r=>typeof r!=='string' || !r || r.length>240 || requested.has(s.module+'|'+r)) || request.targets.filter(x=>x.sectionId===t.sectionId).length!==1)throw Error('record-target-invalid');
      t.recordIds.forEach(r=>requested.add(s.module+'|'+r));
    }
    for(const target of request.targets){
      const initialSection=state.repeatables.find(s=>s.id===target.sectionId),item={module:initialSection.module,label:initialSection.label,requested:target.recordIds.length,added:0,remaining:[],reason:''};additions.push(item);
      for(const recordId of target.recordIds){
        state=collect();const section=state.repeatables.find(s=>s.id===target.sectionId),before=groupSnapshots(state);
        if(!section || section.addStatus!=='ready'){item.reason=section?.blockedReason || (section?.addStatus==='disabled'?'add-disabled':section?.addStatus==='ambiguous'?'add-ambiguous':'add-unavailable');break;}
        const count=section.groupIds.length;
        adapters.pointerClick(section.adds[0]);
        let settled=false;
        for(let attempt=0;attempt<36;attempt++){await wait(attempt?80:40);state=collect();const updated=state.repeatables.find(s=>s.id===target.sectionId);if(updated && updated.groupIds.length>count){await wait(100);state=collect();settled=true;break;}}
        if(!settled){item.reason='add-no-new-record';break;}
        try{
          const after=groupSnapshots(state),map=relateGroups(before,after),currentSection=state.repeatables.find(s=>s.id===target.sectionId);
          const used=new Set([...map.values()].map(g=>g.id)),created=after.filter(g=>currentSection?.groupIds.includes(g.id) && !used.has(g.id));
          if(created.length!==1 || !created[0].empty || currentSection.groupIds.length!==count+1)throw Error('new-record-not-unique');
          bindings=Object.fromEntries(Object.entries(bindings).map(([id,rid])=>[map.get(id)?.id,rid]).filter(([id])=>id));
          bindings[created[0].id]=recordId;item.added++;
        }catch(e){item.reason=e.message;break;}
      }
      item.remaining=target.recordIds.slice(item.added);
      if(item.reason==='existing-record-changed' || item.reason==='new-record-not-unique')break;
    }
    state=collect();const finalGroups=groupSnapshots(state);let fieldMap={},validBindings={},safe=true;
    try{
      const map=relateGroups(originalGroups,finalGroups);
      for(const [id,g] of map){const old=originalGroups.find(x=>x.id===id);old.entries.forEach((e,i)=>fieldMap[e.field.id]=g.entries[i].field.id);}
      for(const [id,rid] of Object.entries(bindings))if(finalGroups.some(g=>g.id===id))validBindings[id]=rid;
      for(const old of original.entries.filter(e=>!fieldMap[e.field.id])){
        const matches=state.entries.filter(e=>!e.field.groupId || !repeatableModules.has(e.field.module)).filter(e=>e.node===old.node || e.field.label===old.field.label && e.field.module===old.field.module && e.type===old.type && e.field.value===old.field.value);
        if(matches.length===1)fieldMap[old.field.id]=matches[0].field.id;
      }
    }catch(e){additions.push({label:'已有经历',module:'',requested:0,added:0,remaining:[],reason:e.message});validBindings={};safe=false;}
    latest=state;
    return {scan:state.report,bindings:validBindings,fieldMap,additions,safe,submitted:false};
  }
  async function scan(options={}) { structureHints=options?.structureHints && typeof options.structureHints==='object'&&!Array.isArray(options.structureHints)?options.structureHints:{}; const state = collect(); latest = state; return state.report; }
  async function inspectOptions(request) {
    if(!request || !Array.isArray(request.fieldIds) || request.fieldIds.length>40 || new Set(request.fieldIds).size!==request.fieldIds.length)throw Error('option-request-invalid');
    const initial=collect(),items=[];
    if(request.fingerprint!==initial.report.fingerprint)throw Error('page-changed');
    for(const id of request.fieldIds) {
      const entry=initial.entries.find(x=>x.field.id===id);
      if(!entry || entry.field.unsupported || !['moka-select','phoenix-select','ant-select'].includes(entry.field.adapter)){items.push({fieldId:id,options:[],reason:'options-unavailable'});continue;}
      const before=read(entry);let options=[],reason='';
      try{options=(await adapters.inspectOptions(entry)).filter(o=>o.text && o.value);if(options.length>1000){options=[];reason='options-too-many';}}
      catch(_){reason='options-unavailable';}
      if(read(entry)!==before)throw Error('value-changed-during-inspection');
      items.push({fieldId:id,options,reason:reason || (options.length?'':'options-unavailable')});
    }
    const final=collect();
    if(final.report.fingerprint!==initial.report.fingerprint || initial.report.fields.some(f=>final.report.fields.find(v=>v.id===f.id)?.value!==f.value))throw Error('page-changed');
    return {fingerprint:initial.report.fingerprint,items};
  }
  function result(fieldId,status,reason,entry) {
    const out = {fieldId,status,reason};
    if (entry && !entry.field.unsupported) out.actualValue = read(entry);
    if (entry?.node.validationMessage) out.validationMessage = entry.node.validationMessage;
    return out;
  }
  function setNative(node,value,property='value') {
    let proto = Object.getPrototypeOf(node), setter;
    while (proto && !setter) { setter = Object.getOwnPropertyDescriptor(proto,property)?.set; proto=Object.getPrototypeOf(proto); }
    if (!setter) throw Error('native-setter-unavailable');
    setter.call(node,value);
    const win = node.ownerDocument.defaultView;
    for (const name of ['input','change','blur','focusout']) node.dispatchEvent(new win.Event(name,{bubbles:true,composed:true}));
  }
  function retained(entry,expected){
    const actual=read(entry);
    if(actual===expected)return true;
    // Websites can render numeric results with trailing zeros. Never normalize identifiers.
    return /^(语言成绩|考试成绩|成绩（GPA）|GPA|平均绩点|身高|体重)$/.test(entry.field.label) && /^-?\d+(?:\.\d+)?$/.test(String(actual)) && /^-?\d+(?:\.\d+)?$/.test(String(expected)) && Number(actual)===Number(expected);
  }
  const recordIdentityLabels={education:/^(学校名称|学校|院校|学历)$/,work:/^(公司名称|单位名称|实习单位|单位|公司)$/,projects:/^(项目名称|实践名称|名称|在校科研及实践项目)$/,'campus-role':/^(在校职务名称|职务|岗位|组织名称)$/,awards:/^(奖项|奖项名称|获奖名称)$/,publications:/^(名称|论文名称|论文题目)$/,language:/^(证书名称|语言.?证书名称)$/,family:/^(姓名|与本人关系|关系)$/};
  function sameControl(a,b){
    const strip=d=>Object.fromEntries(Object.entries(d).filter(([key])=>!['scope','groupPath','groupLabel'].includes(key)));
    return JSON.stringify(strip(a.descriptor))===JSON.stringify(strip(b.descriptor));
  }
  function relocate(before,after,applied=new Map()){
    const groupMap={},fieldMap={},usedGroups=new Set(),usedFields=new Set(),groups=groupSnapshots(after);
    const normal=v=>String(v ?? '').normalize('NFKC').replace(/\s+/g,' ').trim();
    const expected=e=>applied.has(e.field.id)?applied.get(e.field.id):e.field.value;
    for(const old of groupSnapshots(before)){
      const identity=old.entries.filter(e=>recordIdentityLabels[old.module]?.test(e.field.label) && normal(expected(e)) && !/^(请选择|请输入)/.test(normal(expected(e))));
      const compatible=g=>g.module===old.module && !usedGroups.has(g.id) && identity.every(e=>g.entries.some(n=>n.field.label===e.field.label && normal(n.field.value)===normal(expected(e))));
      const matches=groups.filter(compatible);
      let match=identity.length && matches.length===1?matches[0]:null;
      // Empty slots carry no identity. Preserve only the same live record node
      // with the same sibling count; never infer a new blank slot by its index.
      if(!match && !identity.length && groups.filter(g=>g.module===old.module).length===groupSnapshots(before).filter(g=>g.module===old.module).length)match=matches.find(g=>g.node===old.node && g.id===old.id);
      if(match){groupMap[old.id]=match.id;usedGroups.add(match.id);}
    }
    for(const old of before.entries){
      const repeated=repeatableModules.has(old.field.module) && old.field.groupId;
      if(repeated && !groupMap[old.field.groupId])continue;
      const matches=after.entries.filter(n=>!usedFields.has(n.field.id) && sameControl(old,n) && (!repeated || n.field.groupId===groupMap[old.field.groupId]));
      const sameNode=matches.filter(n=>n.node===old.node),match=sameNode.length===1?sameNode[0]:matches.length===1?matches[0]:null;
      if(match){fieldMap[old.field.id]=match.field.id;usedFields.add(match.field.id);}
    }
    return {groupMap,fieldMap};
  }
  async function apply(plan) {
    const actions = Array.isArray(plan?.actions) ? [...plan.actions].sort((a,b)=>Number(/^(至今|present|ongoing|current)$/i.test(String(a.value)))-Number(/^(至今|present|ongoing|current)$/i.test(String(b.value)))) : [];
    const initial = collect(), initialUrl=location.href, output = [], applied = new Map();
    let reject = '';
    if (!latest) reject='scan-required';
    else if (plan.origin !== initial.report.origin || plan.path !== initial.report.path) reject='page-changed';
    else if (plan.fingerprint !== initial.report.fingerprint || plan.fingerprint !== latest.report.fingerprint) reject='structure-changed';
    const repeated=new Set(actions.filter((a,i)=>actions.findIndex(x=>x.fieldId===a.fieldId)!==i).map(a=>a.fieldId));
    for (const action of actions) {
      if(repeated.has(action.fieldId)) {output.push(result(action.fieldId,'conflict','duplicate-action'));continue;}
      if (reject) { output.push(result(action.fieldId,'conflict',reject)); continue; }
      const current=collect(), original=initial.entries.find(x=>x.field.id===action.fieldId);
      let entry=current.entries.find(x=>x.field.id===action.fieldId);
      if (location.href!==initialUrl || current.report.origin!==plan.origin || current.report.path!==plan.path) {output.push(result(action.fieldId,'conflict','page-changed'));continue;}
      if(!entry || !original || JSON.stringify(entry.descriptor)!==JSON.stringify(original.descriptor)){
        const id=relocate(initial,current,applied).fieldMap[action.fieldId];
        entry=id?current.entries.find(e=>e.field.id===id):null;
      }
      if (!entry || !original || !sameControl(original,entry)) { output.push(result(action.fieldId,'conflict','field-changed'));continue; }
      const value=read(entry), empty=value==='' || value===false;
      if (entry.field.unsupported) {output.push(result(action.fieldId,'manual',entry.field.unsupported));continue;}
      if (entry.nodes.some(n=>adapters?.disabled(n) || n.disabled || (n.readOnly && !adapters?.describe(n)?.allowReadonly) || n.closest('fieldset[disabled]') || n.getAttribute('aria-disabled')==='true')) {output.push(result(action.fieldId,'manual','disabled-or-readonly',entry));continue;}
      const target=action.optionValue ?? action.value;
      if (!['string','number','boolean'].includes(typeof target)) {output.push(result(action.fieldId,'failed','invalid-value',entry));continue;}
      // Earlier writes can fill a linked field automatically. Accept it only
      // when it already equals this confirmed target; conflicting values retain
      // the same protection against overwriting user edits.
      if(applied.size && Object.hasOwn(action,'expectedValue') && (value!==action.expectedValue || value!==original.field.value) && (value===target || adapters?.matchesValue(entry,String(target)))){
        applied.set(action.fieldId,value);output.push(result(action.fieldId,'verified','pending-readback',entry));continue;
      }
      if (!Object.hasOwn(action,'expectedValue') || value!==action.expectedValue || value!==original.field.value) {output.push(result(action.fieldId,'conflict','value-changed',entry));continue;}
      if (!empty && !action.overwrite) {output.push(result(action.fieldId,'conflict','existing-value',entry));continue;}
      if (entry.type==='checkbox' && typeof action.value!=='boolean') {output.push(result(action.fieldId,'failed','checkbox-requires-boolean',entry));continue;}
      if (entry.field.required && (target==='' || (entry.type==='checkbox' && target===false))) {output.push(result(action.fieldId,'failed','required-empty',entry));continue;}
      // Native constraints can be checked on a detached clone before writing the live control.
      if (['text','textarea','email','tel','number','date','month'].includes(entry.type) && typeof entry.node.checkValidity==='function') {
        const probe=entry.node.cloneNode(false);probe.removeAttribute('id');probe.removeAttribute('name');probe.value=String(target);
        if (['date','month','number'].includes(entry.type) && probe.value!==String(target)) {output.push(result(action.fieldId,'failed','invalid-value',entry));continue;}
        if (!probe.checkValidity()) {output.push(result(action.fieldId,'failed','validation-failed',entry));continue;}
      }
      if (['select','radio','combobox'].includes(entry.type) && !adapters?.deferred(entry.field.adapter) && !entry.field.options.some(x=>x.value===String(target))) {output.push(result(action.fieldId,'failed','option-not-found',entry));continue;}
      if (entry.type==='select' && [...entry.node.options].some(x=>x.value===String(target) && (x.disabled || x.parentElement?.disabled))) {output.push(result(action.fieldId,'manual','option-disabled',entry));continue;}
      try {
        let expected=entry.type==='checkbox'?action.value:String(target);
        if(entry.field.adapter) expected=await adapters.write(entry,String(target));
        else if (entry.type==='checkbox') { if(entry.node.checked!==action.value) entry.node.click(); }
        else if (entry.type==='radio') {
          const selected=entry.nodes.find(n=>n.value===String(target));
          if(!selected.checked) selected.click();
        }
        else if (entry.type==='combobox') {
          const box=entry.node.getRootNode().getElementById(entry.node.getAttribute('aria-controls'));
          const option=[...box.querySelectorAll('[role="option"]')].find(n=>(n.getAttribute('data-value')||n.getAttribute('value'))===String(target));
          if (!option || !visible(option)) throw Error('option-unavailable');
          if (option.closest('button')?.form && option.closest('button').type==='submit') throw Error('option-submit-risk');
          if (option.closest('a[href]')) throw Error('option-navigation-risk');
          if (option.getAttribute('aria-disabled')==='true' || option.disabled) throw Error('option-disabled');
          option.click();
        } else setNative(entry.node,String(target));
        applied.set(action.fieldId,expected);
        output.push(result(action.fieldId,'verified','pending-readback',entry));
      } catch (error) {output.push(result(action.fieldId,'failed',error.message,entry));}
      await wait();
    }
    await wait(500);
    const final=collect();
    const continuation=relocate(initial,final,applied);
    for (let i=0;i<output.length;i++) {
      const item=output[i];if(!applied.has(item.fieldId))continue;
      const entry=final.entries.find(x=>x.field.id===continuation.fieldMap[item.fieldId]);
      if(location.href!==initialUrl || final.report.origin!==plan.origin || final.report.path!==plan.path) output[i]=result(item.fieldId,'failed','page-changed');
      else if(!entry) output[i]=result(item.fieldId,'failed','field-disappeared');
      else if(!retained(entry,applied.get(item.fieldId))) output[i]=result(item.fieldId,'failed','value-not-retained',entry);
      else if(adapters?.validationError(entry)) output[i]={...result(item.fieldId,'failed','validation-failed',entry),validationMessage:adapters.validationError(entry)};
      else if(entry.node.validity && !entry.node.validity.valid) output[i]=result(item.fieldId,'failed','validation-failed',entry);
      else {
        output[i]=result(item.fieldId,'verified','readback-matched',entry);
        const action=actions.find(a=>a.fieldId===item.fieldId),target=String(action?.optionValue ?? action?.value ?? '');
        if(entry.field.adapter==='phoenix-date' && /^\d{4}-\d{2}-\d{2}$/.test(target) && /^\d{4}-\d{2}$/.test(String(applied.get(item.fieldId))))Object.assign(output[i],{datePrecisionReduced:true,sourcePrecision:'day',writtenPrecision:'month',note:'网站只接受年月，已保留来源年月；具体日期仍保存在资料中。'});
      }
    }
    const summary={verified:0,failed:0,conflict:0,manual:0};output.forEach(x=>summary[x.status]++);
    return {results:output,summary,scan:final.report,...continuation,submitted:false,saveState:'unconfirmed',warnings:final.report.fingerprint!==initial.report.fingerprint?[{code:'structure-changed',message:'页面字段结构发生变化，已重新识别'}]:[]};
  }
  function highlight(fieldId) {
    const entry=collect().entries.find(x=>x.field.id===fieldId);if(!entry)return false;
    entry.node.scrollIntoView({block:'center',behavior:'smooth'});
    const old=entry.node.style.outline;entry.node.style.outline='3px solid #416a70';
    setTimeout(()=>{entry.node.style.outline=old;},1600);return true;
  }
  return {scan,apply,highlight,inspectOptions,expandRecords};
});
