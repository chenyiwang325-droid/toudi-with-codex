(function (root, factory) {
  const engine = factory(typeof module==='object'&&module.exports?require('./form-adapters.js'):root.TouDiFormAdapters);
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.TouDiFormEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (adapterLibrary) {
  'use strict';
  let latest = null;
  const ENGINE_VERSION = '0.5.0';
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
    const value=compact(text);
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
    const module = /教育|学历|学位|education/i.test(hint) ? 'education' : /实习|工作经历|任职|employment|work experience/i.test(hint) ? 'work' : /项目|project/i.test(hint) ? 'projects' : '';
    const generic=/^(教育经历|教育背景|学历信息|工作经历|实习经历|项目经历|education|work experience|projects)$/i.test(group);
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
    const entries = [], warnings = [], counts = new Map();
    function walk(root, scope) {
      const nodes = adapters?adapters.nodes(root):[...root.querySelectorAll('input,textarea,select,[role="combobox"]')];
      const radios = new Set();
      for (const node of nodes) {
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
        if (adapter==='phoenix-radio') {options=adapted.options;}
        else if (type === 'radio') {
          const local = radioContext(node,root), container=local.container;
          members = [...container.querySelectorAll('input[type="radio"]')].filter(x => x.name === node.name && visible(x) && radioContext(x,root).container===container);
          if (members.some(x => radios.has(x))) continue;
          members.forEach(x => radios.add(x));
          label = local.label;
          options = members.map(x => ({value:x.value,text:named(x) || (x.closest('label') ? labelText(x.closest('label')) : '')}));
        } else if (type === 'select') options = [...node.options].map(x => ({value:x.value,text:compact(x.textContent)}));
        else if (type === 'combobox') {
          const box = node.getRootNode().getElementById?.(node.getAttribute('aria-controls'));
          options = box ? [...box.querySelectorAll('[role="option"]')].filter(visible).map(x => ({value:x.getAttribute('data-value') || x.getAttribute('value') || '',text:compact(x.textContent)})) : [];
        }
        const module = ctx.module || (/姓名|性别|出生|手机|电话|邮箱|证件|地址|name|email|phone/i.test(label) ? 'personal' : 'other');
        let unsupported = '';
        if (type === 'file') unsupported = 'file-upload';
        else if (/验证码|校验码|安全验证|captcha|verification code|one.time code/i.test(label)) unsupported = 'verification-code';
        else if (['checkbox','radio'].includes(type) && /同意|声明|隐私|条款|协议|我已阅读|本人确认|agree|consent|terms|declaration/i.test(label)) unsupported = 'consent';
        else if (type === 'combobox' && !adapter && (!options.length || options.some(x => !x.value))) unsupported = 'custom-selector';
        else if(adapted?.unsupported)unsupported=adapted.unsupported;
        else if (members.some(n=>adapters?.disabled(n) || n.disabled || (n.readOnly && !adapted?.allowReadonly) || n.closest('fieldset[disabled]') || n.getAttribute('aria-disabled')==='true')) unsupported='disabled-or-readonly';
        else if (!label) unsupported = 'unlabeled';
        const constraints=Object.fromEntries(['min','max','step','pattern'].filter(k=>node.hasAttribute(k)).map(k=>[k,node.getAttribute(k)]));
        const placeholder=(node.getAttribute('placeholder') || '').trim().toUpperCase();
        const dateFormat=adapted?.dateFormat || (['YYYY-MM-DD','YYYY/MM/DD','YYYY.MM.DD','YYYY-MM','YYYY/MM','YYYY.MM'].includes(placeholder)?placeholder:undefined);
        const descriptor = {scope,label,module,groupLabel:ctx.groupLabel,groupPath:ctx.groupPath,recordHint:ctx.recordHint,type,name:node.name || '',options,constraints,...dateMeta,...(adapter?{adapter}:{}),...(dateFormat?{dateFormat}:{}),required:members.some(x=>x.required || x.getAttribute('aria-required')==='true') || !!adapted?.required,maxLength:node.maxLength >= 0 ? node.maxLength : null,unsupported};
        // Record values can constrain matching, but never rename/reidentify a field.
        const signature = JSON.stringify({scope,path:structuralPath(node),type,name:node.name || ''}), index = counts.get(signature) || 0;
        counts.set(signature,index+1);
        const id = 'field-' + hash(signature + ':' + index);
        const field = {id,label,module,groupId:ctx.groupLabel ? 'group-'+hash(scope+ctx.groupPath+ctx.groupLabel) : '',groupLabel:ctx.groupLabel,recordHint:ctx.recordHint,type,required:descriptor.required,maxLength:descriptor.maxLength,value:unsupported && unsupported!=='unlabeled' ? '' : read({node,nodes:members,type,field:{options,adapter}}),options,constraints,...dateMeta,...(adapter?{adapter}:{}),...(dateFormat?{dateFormat}:{})};
        if (unsupported) field.unsupported = unsupported;
        entries.push({field,descriptor,node,nodes:members,type});
      }
      let shadowIndex = 0, frameIndex = 0;
      for (const el of root.querySelectorAll('*')) {
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
    return {entries,report:{protocol:1,engineVersion:ENGINE_VERSION,origin,path,title:compact(document.title),fingerprint,fields:entries.map(x=>x.field),platforms:adapters?.platforms(document)||[{id:"generic",label:"通用表单",version:"1"}],structure:{fingerprint:structureFingerprint,candidates:publicCandidates,applied,rejected},warnings}};
  }
  async function scan(options={}) { structureHints=options?.structureHints && typeof options.structureHints==='object'&&!Array.isArray(options.structureHints)?options.structureHints:{}; const state = collect(); latest = state; return state.report; }
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
  async function apply(plan) {
    const actions = Array.isArray(plan?.actions) ? plan.actions : [];
    const initial = collect(), output = [], applied = new Map();
    let reject = '';
    if (!latest) reject='scan-required';
    else if (plan.origin !== initial.report.origin || plan.path !== initial.report.path) reject='page-changed';
    else if (plan.fingerprint !== initial.report.fingerprint || plan.fingerprint !== latest.report.fingerprint) reject='structure-changed';
    const repeated=new Set(actions.filter((a,i)=>actions.findIndex(x=>x.fieldId===a.fieldId)!==i).map(a=>a.fieldId));
    for (const action of actions) {
      if(repeated.has(action.fieldId)) {output.push(result(action.fieldId,'conflict','duplicate-action'));continue;}
      if (reject) { output.push(result(action.fieldId,'conflict',reject)); continue; }
      const current=collect(), entry=current.entries.find(x=>x.field.id===action.fieldId), original=latest.entries.find(x=>x.field.id===action.fieldId);
      if (current.report.origin!==plan.origin || current.report.path!==plan.path) {output.push(result(action.fieldId,'conflict','page-changed'));continue;}
      if (!entry || !original || JSON.stringify(entry.descriptor)!==JSON.stringify(original.descriptor)) { output.push(result(action.fieldId,'conflict','field-changed'));continue; }
      const value=read(entry), empty=value==='' || value===false;
      if (entry.field.unsupported) {output.push(result(action.fieldId,'manual',entry.field.unsupported));continue;}
      if (entry.nodes.some(n=>adapters?.disabled(n) || n.disabled || (n.readOnly && !adapters?.describe(n)?.allowReadonly) || n.closest('fieldset[disabled]') || n.getAttribute('aria-disabled')==='true')) {output.push(result(action.fieldId,'manual','disabled-or-readonly',entry));continue;}
      if (!Object.hasOwn(action,'expectedValue') || value!==action.expectedValue || value!==original.field.value) {output.push(result(action.fieldId,'conflict','value-changed',entry));continue;}
      if (!empty && !action.overwrite) {output.push(result(action.fieldId,'conflict','existing-value',entry));continue;}
      const target=action.optionValue ?? action.value;
      if (!['string','number','boolean'].includes(typeof target)) {output.push(result(action.fieldId,'failed','invalid-value',entry));continue;}
      if (entry.type==='checkbox' && typeof action.value!=='boolean') {output.push(result(action.fieldId,'failed','checkbox-requires-boolean',entry));continue;}
      if (entry.field.required && (target==='' || (entry.type==='checkbox' && target===false))) {output.push(result(action.fieldId,'failed','required-empty',entry));continue;}
      if (entry.field.maxLength!==null && String(target).length>entry.field.maxLength) {output.push(result(action.fieldId,'failed','maxlength-exceeded',entry));continue;}
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
    for (let i=0;i<output.length;i++) {
      const item=output[i];if(!applied.has(item.fieldId))continue;
      const entry=final.entries.find(x=>x.field.id===item.fieldId);
      if(final.report.origin!==plan.origin || final.report.path!==plan.path) output[i]=result(item.fieldId,'failed','page-changed');
      else if(!entry) output[i]=result(item.fieldId,'failed','field-disappeared');
      else if(read(entry)!==applied.get(item.fieldId)) output[i]=result(item.fieldId,'failed','value-not-retained',entry);
      else if(entry.node.validity && !entry.node.validity.valid) output[i]=result(item.fieldId,'failed','validation-failed',entry);
      else output[i]=result(item.fieldId,'verified','readback-matched',entry);
    }
    const summary={verified:0,failed:0,conflict:0,manual:0};output.forEach(x=>summary[x.status]++);
    return {results:output,summary,submitted:false,saveState:'unconfirmed',warnings:final.report.fingerprint!==initial.report.fingerprint?[{code:'structure-changed',message:'页面字段结构发生变化，请重新扫描'}]:[]};
  }
  function highlight(fieldId) {
    const entry=collect().entries.find(x=>x.field.id===fieldId);if(!entry)return false;
    entry.node.scrollIntoView({block:'center',behavior:'smooth'});
    const old=entry.node.style.outline;entry.node.style.outline='3px solid #416a70';
    setTimeout(()=>{entry.node.style.outline=old;},1600);return true;
  }
  return {scan,apply,highlight};
});
