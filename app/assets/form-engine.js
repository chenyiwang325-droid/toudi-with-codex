(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.TouDiFormEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  let latest = null;
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
    copy.querySelectorAll('input,select,textarea,[role="combobox"]').forEach(x=>x.remove());
    return compact(copy.textContent);
  }
  function named(node) {
    const ids = node.getAttribute('aria-labelledby');
    if (ids) return compact(ids.split(/\s+/).map(id => node.getRootNode().getElementById?.(id)?.textContent || '').join(' '));
    const explicit=compact(node.getAttribute('aria-label') || [...(node.labels || [])].map(labelText).join(' '));
    if(explicit) return explicit;
    for(let p=node.parentElement,depth=0;p && depth<3;p=p.parentElement,depth++) {
      if(p.querySelectorAll('input,textarea,select,[role="combobox"]').length!==1) break;
      const near=p.querySelector(':scope > label,:scope > .field-label,:scope > .form-label');
      if(near && (!near.htmlFor || near.htmlFor===node.id)) return labelText(near);
    }
    return compact(node.getAttribute('placeholder'));
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
  function collect() {
    const entries = [], warnings = [], counts = new Map();
    function walk(root, scope) {
      const nodes = [...root.querySelectorAll('input,textarea,select,[role="combobox"]')];
      const radios = new Set();
      for (const node of nodes) {
        const rawType = (node.getAttribute('type') || '').toLowerCase();
        if (['hidden','password','submit','reset','button','image'].includes(rawType) || !visible(node)) continue;
        let label = named(node);
        if (!label) {
          const parent = node.closest('label');
          label = parent ? labelText(parent) : '';
        }
        if (/password|token|secret|密码|口令|令牌/i.test(label + ' ' + node.name + ' ' + node.id)) continue;
        const type = rawType === 'radio' ? 'radio' : rawType === 'checkbox' ? 'checkbox' : rawType === 'file' ? 'file' : node.tagName === 'SELECT' ? 'select' : node.tagName === 'TEXTAREA' ? 'textarea' : node.getAttribute('role') === 'combobox' ? 'combobox' : rawType || 'text';
        const ctx = context(node);
        let members = [node], options = [];
        if (type === 'radio') {
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
        else if (type === 'combobox' && (!options.length || options.some(x => !x.value))) unsupported = 'custom-selector';
        else if (!label) unsupported = 'unlabeled';
        else if (members.some(n=>n.disabled || n.readOnly || n.closest('fieldset[disabled]') || n.getAttribute('aria-disabled')==='true')) unsupported='disabled-or-readonly';
        const constraints=Object.fromEntries(['min','max','step','pattern'].filter(k=>node.hasAttribute(k)).map(k=>[k,node.getAttribute(k)]));
        const placeholder=(node.getAttribute('placeholder') || '').trim().toUpperCase();
        const dateFormat=['YYYY-MM-DD','YYYY/MM/DD','YYYY.MM.DD','YYYY-MM','YYYY/MM','YYYY.MM'].includes(placeholder)?placeholder:undefined;
        const descriptor = {scope,label,module,groupLabel:ctx.groupLabel,groupPath:ctx.groupPath,recordHint:ctx.recordHint,type,name:node.name || '',options,constraints,...(dateFormat?{dateFormat}:{}),required:members.some(x=>x.required || x.getAttribute('aria-required')==='true'),maxLength:node.maxLength >= 0 ? node.maxLength : null,unsupported};
        const signature = JSON.stringify(descriptor), index = counts.get(signature) || 0;
        counts.set(signature,index+1);
        const id = 'field-' + hash(signature + ':' + index);
        const field = {id,label,module,groupId:ctx.groupLabel ? 'group-'+hash(scope+ctx.groupPath+ctx.groupLabel) : '',groupLabel:ctx.groupLabel,recordHint:ctx.recordHint,type,required:descriptor.required,maxLength:descriptor.maxLength,value:unsupported ? '' : read({node,nodes:members,type,field:{options}}),options,constraints,...(dateFormat?{dateFormat}:{})};
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
    const fingerprint = hash(JSON.stringify({origin,path,structure:entries.map(x=>({id:x.field.id,...x.descriptor}))}));
    return {entries,report:{protocol:1,origin,path,title:compact(document.title),fingerprint,fields:entries.map(x=>x.field),warnings}};
  }
  async function scan() { const state = collect(); latest = state; return state.report; }
  const wait = (milliseconds=100) => new Promise(resolve => setTimeout(resolve,milliseconds));
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
      if (entry.nodes.some(n=>n.disabled || n.readOnly || n.closest('fieldset[disabled]') || n.getAttribute('aria-disabled')==='true')) {output.push(result(action.fieldId,'manual','disabled-or-readonly',entry));continue;}
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
      if (['select','radio','combobox'].includes(entry.type) && !entry.field.options.some(x=>x.value===String(target))) {output.push(result(action.fieldId,'failed','option-not-found',entry));continue;}
      if (entry.type==='select' && [...entry.node.options].some(x=>x.value===String(target) && (x.disabled || x.parentElement?.disabled))) {output.push(result(action.fieldId,'manual','option-disabled',entry));continue;}
      try {
        if (entry.type==='checkbox') { if(entry.node.checked!==action.value) entry.node.click(); }
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
        applied.set(action.fieldId,entry.type==='checkbox'?action.value:String(target));
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
