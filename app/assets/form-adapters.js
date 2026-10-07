/* Platform-specific DOM adapters. No candidate values or site account data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TouDiFormAdapters=api;})(globalThis,function(){
'use strict';
function create({compact,visible,structuralPath,labelText,wait,setNative}) {
  let descriptions=new WeakMap(),platformCache=new WeakMap(),contexts=new WeakMap();
  // Moka's label wraps the selected value and validation message, not the question.
  // Anchor to the field/block structure; CSS-module hash suffixes are not stable.
  const mokaField = node => node.closest('[class^="apply-field-"],[class*=" apply-field-"]');
  const classPart = (prefix) => `[class^="${prefix}"],[class*=" ${prefix}"]`;
  const directPart = (node,prefix) => [...(node?.children || [])].find(n=>[...n.classList].some(c=>c.startsWith(prefix)));
  const mokaTitle = field => {
    const title=directPart(field,'title-');
    return title?labelText(title).replace(/[＊*]\s*$/,'').trim():'';
  };
  const mokaSelect = node => node?.closest('[class*="sd-Select-container-"]');
  function mokaValue(node) {
    return compact(mokaSelect(node)?.querySelector('[class*="sd-Input-display-value-"]')?.textContent);
  }
  function mokaLabel(node, field) {
    let title=mokaTitle(field);
    const inputs=[...field.querySelectorAll('input:not([type="hidden"]),textarea,select')];
    if(inputs.length>1 && mokaSelect(node)) {
      if(/证件号码/.test(title))return '证件类型';
      if(/手机/.test(title))return '电话区号';
      if(/date_info-/.test(field.className) && inputs.length===4)
        return title+' · '+['开始年份','开始月份','结束年份','结束月份'][inputs.indexOf(node)];
      return title+' · 子选项 '+(inputs.indexOf(node)+1);
    }
    return title;
  }
  function mokaContext(node, field) {
    const block=field.closest(classPart('apply-block-')), record=field.closest(classPart('apply-fields-'));
    if(!block || !record)return null;
    const heading=directPart(block,'blockTitle-');
    const title=compact(heading?.querySelector(classPart('text-'))?.textContent);
    if(!title)return null;
    const module=/教育/.test(title)?'education':/实习|工作经历/.test(title)?'work':/项目/.test(title)?'projects':/个人|求职意向/.test(title)?'personal':'other';
    // Only an explicit education-level value identifies a record; never infer by order.
    const degree=[...record.querySelectorAll(classPart('apply-field-'))].find(f=>mokaTitle(f)==='学历');
    const level=degree?mokaValue(degree.querySelector('input')):'';
    const recordHint=module==='education' && /^(博士研究生|硕士研究生|博士|硕士|本科|专科|大专|高中)$/.test(level)?level:'';
    const records=[...block.children].filter(n=>n.matches(classPart('apply-fields-')));
    return {groupLabel:title+(records.length>1?' · 第'+(records.indexOf(record)+1)+'段':''),recordHint,module,groupPath:structuralPath(record)};
  }
  async function selectMoka(entry,target) {
    const container=entry.node.closest('[class*="sd-Dropdown-container-"]');
    if(!container)throw Error('option-unavailable');
    const norm=v=>{
      const text=String(v).normalize('NFKC').trim();
      const aliases=/^(最高)?学历$/.test(entry.field.label)?{'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}:{};
      return aliases[text] || text;
    };
    entry.node.click();
    try {
      let choices=[];
      // Read the clicked control's own menu only; no page-wide first-option heuristic.
      for(let attempt=0;attempt<12;attempt++) {
        choices=[...container.querySelectorAll('[class*="sd-Menu-content-item-"]')].filter(visible);
        if(choices.length)break;
        await wait(50);
      }
      const matches=choices.filter(n=>norm(n.textContent)===norm(target));
      if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
      const option=matches[0];
      if(option.closest('a[href],button[type="submit"],[aria-disabled="true"],[class*="disabled"],[class*="Disabled"]'))throw Error('option-disabled');
      option.click();
      return String(option.textContent).trim();
    } finally {
      // Close without choosing another value or triggering a form submission.
      const title=directPart(mokaField(entry.node),'title-');
      title?.click();
    }
  }
  const phoenixField=node=>node.closest('.form-item--phoenix');
  const phoenixTitle=field=>compact(field?.querySelector(':scope > .form-item__title .form-item__text')?.textContent);
  const moduleOf=title=>/教育|学历/.test(title)?'education':/在校职务|在校任职|校园任职|在校经历|校园经历|学生工作|学生干部/.test(title)?'campus-role':/实习|工作经历|任职/.test(title)?'work':/获奖|荣誉/.test(title)?'awards':/论文|专著|发表/.test(title)?'publications':/家庭|亲属/.test(title)?'family':/项目|科研|实践/.test(title)?'projects':/个人|基本|求职意向/.test(title)?'personal':/语言|外语|证书/.test(title)?'language':'other';
  function phoenixContext(field) {
    const record=field.closest('.ux-standard-form') || field.closest('.form-part') || field.parentElement;
    if(contexts.has(record))return contexts.get(record);
    let section=null,title='';
    for(let p=record?.parentElement,depth=0;p&&depth<8;p=p.parentElement,depth++) {
      const headings=[...p.children].filter(n=>!n.querySelector('.form-item,input,textarea,select') && !n.matches('input,textarea,select')).map(n=>compact(n.textContent));
      title=headings.find(t=>/^(个人信息|基本信息|求职意向|教育经历|教育背景|工作经历|实习经历|实习经验|项目经历|项目经验|在校经历|在校职务|在校实践|论文\/专著|语言能力|外语能力|语言及证书|获奖情况|荣誉奖励|科研经历|社会实践|家庭成员|家庭情况|自我评价|其他信息|附加信息|附件|培训经历)$/.test(t)) || '';
      if(title){section=p;break;}
    }
    const records=section?[...section.querySelectorAll('.ux-standard-form')]:[record];
    const degree=[...record.querySelectorAll('.form-item--phoenix')].find(f=>/^(最高)?学历$/.test(phoenixTitle(f)));
    const level=degree?phoenixRead(degree.querySelector('.phoenix-select__input') || degree.querySelector('.phoenix-radio-group')):'';
    const module=moduleOf(title);
    const result={module,groupLabel:title+(records.length>1?' · 第'+(records.indexOf(record)+1)+'段':''),groupPath:structuralPath(record),recordHint:module==='education'&&/^(博士研究生|硕士研究生|博士|硕士|大学本科|本科|专科|大专|高中)$/.test(level)?level:''};contexts.set(record,result);return result;
  }
  function phoenixRead(node) {
    if(!node)return '';
    if(node.matches('.phoenix-radio-group'))return compact(node.querySelector('.phoenix-radio--checked .phoenix-radio__radio-text')?.textContent);
    const select=node.closest('.phoenix-select');
    if(select)return compact(select.querySelector('.phoenix-select__content')?.textContent);
    return String(node.value || '');
  }
  const dateLabel=label=>/^(出生日期(?:（年龄）|\s*\(年龄\))?|毕业时间|入学时间|开始时间|结束时间|开始日期|结束日期|获奖时间|取得日期|获证日期|考试日期|发布时间)$/.test(label);
  const dateValue=v=>{const m=String(v).match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?$/);return m?m[1]+'-'+m[2].padStart(2,'0')+(m[3]?'-'+m[3].padStart(2,'0'):''):v;};
  function describeRaw(node) {
    const m=mokaField(node);
    if(m) {
      const inputs=/date_info-/.test(m.className)?[...m.querySelectorAll('input:not([type="hidden"])')]:[];
      const index=inputs.length===4?inputs.indexOf(node):-1,select=!!mokaSelect(node);
      return {label:mokaLabel(node,m),context:mokaContext(node,m)||{groupLabel:'',groupPath:'',recordHint:'',module:''},adapter:select?'moka-select':'',...(select?{type:'combobox'}:{}),required:!!m.querySelector('[class*="required-asterisk-"]'),unsupported:/day_info-/.test(m.className)?'custom-date':select&&inputs.length&&index<0?'split-date':'',dateMeta:index>=0?{datePart:index%2?'month':'year',semanticLabel:index<2?'开始日期':'结束日期'}:{}};
    }
    const p=phoenixField(node);if(!p)return null;
    const label=phoenixTitle(p),radio=node.matches('.phoenix-radio-group'),select=!!node.closest('.phoenix-select'),date=select&&dateLabel(label);
    return {label,context:phoenixContext(p),adapter:radio?'phoenix-radio':date?'phoenix-date':select?'phoenix-select':'',...(radio?{type:'radio',options:[...node.querySelectorAll('.phoenix-radio')].map(n=>({text:compact(n.querySelector('.phoenix-radio__radio-text')?.textContent),value:compact(n.querySelector('.phoenix-radio__radio-text')?.textContent)}))}:select?{type:'combobox'}:{}),required:!!p.querySelector(':scope > .form-item__title .form-item__required'),allowReadonly:select,...(date?{datePrecision:'deferred'}:{})};
  }
  function describe(node){if(!descriptions.has(node))descriptions.set(node,describeRaw(node));return descriptions.get(node);}
  const disabled=node=>!!node.closest('[class*="--disabled"],[class*="--statusDisable"],[aria-disabled="true"],fieldset[disabled]');
  const disabledOption=node=>disabled(node)||!!node.closest('a[href],button[type="submit"],[class*="Disabled"],[class*="disabled"]');
  const equivalence=(v,label)=>{const text=String(v).normalize('NFKC').trim();const dict=/^(最高)?学历$/.test(label)?{'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}:/^(最高)?学位$/.test(label)?{'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士'}:/学习形式|学历类型/.test(label)?{'普通全日制':'全日制'}:{};return dict[text]||text;};
  const layers=doc=>[...doc.querySelectorAll('.common-unmodeled-layer')].filter(visible);
  function footerButton(layer,text){return [...layer.querySelectorAll('.selector-footer-button .phoenix-button,.area-footer-button .phoenix-button')].filter(n=>compact(n.textContent)===text);}
  async function openPhoenix(entry) {
    const doc=entry.node.ownerDocument,field=phoenixField(entry.node),select=entry.node.closest('.phoenix-select');
    if(!select || !field)throw Error('option-unavailable');
    field.querySelector('.form-item__title')?.click();
    await wait(30);
    const before=new Set(layers(doc));select.click();
    for(let i=0;i<20;i++){
      const found=layers(doc).filter(n=>!before.has(n));
      if(found.length>1)throw Error('menu-not-unique');
      if(found.length===1 && select.classList.contains('phoenix-select--active'))return found[0];
      await wait(40);
    }
    throw Error('menu-not-associated');
  }
  async function phoenixWrite(entry,target) {
    if(entry.field.adapter==='phoenix-radio'){
      const matches=[...entry.node.querySelectorAll('.phoenix-radio')].filter(n=>equivalence(compact(n.querySelector('.phoenix-radio__radio-text')?.textContent),entry.field.label)===equivalence(target,entry.field.label));
      if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
      if(disabledOption(matches[0]))throw Error('option-disabled');matches[0].click();return compact(matches[0].querySelector('.phoenix-radio__radio-text')?.textContent);
    }
    if(entry.field.adapter==='phoenix-date'){
      if(!/^\d{4}-\d{2}(?:-\d{2})?$/.test(target))throw Error('date-precision-required');
      const [y,m,sourceDay]=target.split('-').map(Number),d=sourceDay || 1,check=new Date(Date.UTC(y,m-1,d));
      if(y<100 || check.getUTCFullYear()!==y || check.getUTCMonth()!==m-1 || check.getUTCDate()!==d)throw Error('invalid-date');
    }
    if(entry.node.closest('.phoenix-select--multiple,[aria-multiselectable="true"]'))throw Error('multiple-selection-unsupported');
    const layer=await openPhoenix(entry);let confirmed=false;
    try {
      if(entry.field.adapter==='phoenix-date'){
        const monthCalendar=layer.querySelector('.phoenix-date-picker .phoenix-calendar.phoenix-calendar-month-calendar');
        if(monthCalendar){
          const [year,month]=target.split('-').map(Number),expected=target.slice(0,7);
          const displayedYear=()=>Number(compact(layer.querySelector('.phoenix-calendar-month-panel-year-select-content')?.textContent));
          if(!Number.isInteger(displayedYear()) || displayedYear()<100)throw Error('date-year-unavailable');
          if(displayedYear()!==year){
            const yearSelect=monthCalendar.querySelector('.phoenix-calendar-month-panel-year-select');
            if(yearSelect){
              yearSelect.click();await wait(80);
              let selected=false;
              for(let attempt=0;attempt<100;attempt++){
                const panel=[...layer.querySelectorAll('.phoenix-calendar-year-panel')].find(visible);if(!panel)throw Error('date-year-panel-unavailable');
                const years=[...panel.querySelectorAll('.phoenix-calendar-year-panel-year')].filter(visible).filter(n=>compact(n.textContent)===String(year));
                if(years.length>1)throw Error('date-year-not-unique');
                if(years.length===1){if(disabledOption(years[0]))throw Error('date-year-disabled');years[0].click();await wait(80);if(![...layer.querySelectorAll('.phoenix-calendar-year-panel')].some(visible) && displayedYear()===year){selected=true;break;}continue;}
                const decade=compact(panel.querySelector('.phoenix-calendar-year-panel-decade-select')?.textContent),range=decade.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
                if(!range)throw Error('date-decade-unavailable');
                const direction=year<Number(range[1])?'prev':year>Number(range[2])?'next':'';if(!direction)throw Error('date-year-not-found');
                const button=panel.querySelector('.phoenix-calendar-year-panel-'+direction+'-decade-btn');if(!button || disabledOption(button))throw Error('date-year-navigation-unavailable');
                button.click();await wait(80);
                if(compact(layer.querySelector('.phoenix-calendar-year-panel-decade-select')?.textContent)===decade)throw Error('date-year-navigation-stalled');
              }
              if(!selected)throw Error('date-year-navigation-limit');
            } else {
              for(let attempt=0;displayedYear()!==year && attempt<100;attempt++){
                const before=displayedYear(),button=layer.querySelector('.phoenix-calendar-month-panel-'+(year<before?'prev':'next')+'-year-btn');
                if(!button || disabledOption(button))throw Error('date-year-navigation-unavailable');button.click();await wait(80);
                if(displayedYear()!==before+(year<before?-1:1))throw Error('date-year-navigation-stalled');
              }
            }
          }
          if(displayedYear()!==year)throw Error('date-year-not-retained');
          const months=[...layer.querySelectorAll('.phoenix-calendar-month-calendar .phoenix-calendar-month-panel-month')].filter(visible).filter(n=>compact(n.textContent)===month+'月');
          if(months.length!==1)throw Error(months.length?'date-month-not-unique':'date-month-not-found');
          if(disabledOption(months[0]))throw Error('date-month-disabled');months[0].click();await wait(100);
          if(dateValue(phoenixRead(entry.node))!==expected)throw Error('date-not-retained');
          confirmed=true;return expected;
        }
        // A month-only source never gains an invented day when the real picker needs one.
        if(!/^\d{4}-\d{2}-\d{2}$/.test(target))throw Error('date-precision-required');
        const inputs=[...layer.querySelectorAll('.phoenix-calendar-input')].filter(visible).filter(n=>!n.disabled && !n.readOnly);
        if(inputs.length!==1)throw Error('date-control-unsupported');
        setNative(inputs[0],target);
        const win=inputs[0].ownerDocument.defaultView;
        inputs[0].dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        await wait(100);
        if(dateValue(phoenixRead(entry.node))!==target)throw Error('date-not-retained');
        confirmed=true;return target;
      }
      if(layer.querySelector('.phoenix-selectList')){
        const menu=layer.querySelector('.phoenix-selectList');
        if(menu.querySelector('[class*="multiple"],[class*="multiLabel"]'))throw Error('multiple-selection-unsupported');
        const search=menu.querySelector('.phoenix-selectList__searchWrapper input');
        if(search){setNative(search,equivalence(target,entry.field.label));await wait(250);}
        let matches=[];
        for(let i=0;i<20;i++){
          matches=[...menu.querySelectorAll('.phoenix-selectList__listItem')].filter(visible).filter(n=>equivalence(compact(n.querySelector('.phoenix-selectList__singleLabel')?.textContent || n.textContent),entry.field.label)===equivalence(target,entry.field.label));
          if(matches.length)break;await wait(60);
        }
        if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
        const chosen=matches[0];if(disabledOption(chosen))throw Error('option-disabled');
        chosen.click();confirmed=true;await wait(120);
        const actual=phoenixRead(entry.node);if(equivalence(actual,entry.field.label)!==equivalence(target,entry.field.label))throw Error('value-not-retained');return actual;
      }
      const area=!!layer.querySelector('.area-selector-container'),constant=!!layer.querySelector('.constant-main-selector-container');
      if(!area&&!constant)throw Error('selector-layout-unsupported');
      // Search only in this newly opened control's menu. Do not traverse other portals.
      const search=layer.querySelector(area?'.area-search-input input':'.content-search input');
      const normalize=v=>{const t=equivalence(v,entry.field.label);return area?t.replace(/[\s/／>、]+/g,'').replace(/(省|市|自治区|特别行政区)/g,''):t;};
      const regionParts=v=>String(v).split(/(?<=省|市|自治区|特别行政区)|[\s/／>]+/).filter(Boolean).map(normalize).filter(Boolean);
      const wanted=regionParts(target);
      const regionMatches=(label,path)=>{
        const actual=regionParts(path+'/'+label);
        if(actual.at(-1)!==wanted.at(-1))return false;
        let index=0;for(const part of actual)if(part===wanted[index])index++;
        return index===wanted.length;
      };
      const term=area?String(target).split(/(?<=省|市|自治区|特别行政区)|[\s/／>]+/).filter(Boolean).at(-1):equivalence(target,entry.field.label);
      if(search){setNative(search,term);await wait(350);}
      let matches=[];
      for(let i=0;i<20;i++) {
        const rows=[...layer.querySelectorAll(area?'.area-item-container':'.list-item-container')].filter(visible);
        matches=rows.filter(row=>{
          const label=compact(row.querySelector(area?'.area-text-label':'.item-text-label')?.textContent);
          const path=compact(row.querySelector('.area-item-path')?.textContent);
          return area?regionMatches(label,path):normalize(label)===normalize(target);
        });
        if(matches.length)break;
        await wait(60);
      }
      if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
      const chosen=matches[0];if(disabledOption(chosen))throw Error('option-disabled');
      const icon=chosen.querySelector('.icon-container');
      // Region text may drill down; the radio/check icon selects the current region.
      (icon || chosen).click();await wait(80);
      if(icon?.querySelector('[class*=Unchecked]'))throw Error('option-not-selected');
      const buttons=footerButton(layer,'确定');if(buttons.length!==1 || disabledOption(buttons[0]))throw Error('option-confirm-unavailable');
      // A successful click is not success: read back the persisted displayed value below.
      buttons[0].click();confirmed=true;await wait(80);
      const actual=phoenixRead(entry.node),selectedLabel=compact(chosen.querySelector(area?'.area-text-label':'.item-text-label')?.textContent);if(normalize(actual)!==normalize(target) && !(area&&normalize(actual)===normalize(selectedLabel)))throw Error('value-not-retained');return actual;
    } finally {
      if(!confirmed){const cancel=footerButton(layer,'取消');if(cancel.length===1)cancel[0].click();}
      phoenixField(entry.node)?.querySelector('.form-item__title')?.click();
    }
  }
  const registry=[{id:'moka',label:'Moka',version:'1',detect:root=>!!root.querySelector('[class^="apply-block-"] [class^="apply-field-"],[class*=" apply-block-"] [class*=" apply-field-"]')},{id:'zhiye-phoenix',label:'Zhiye / Phoenix',version:'1',detect:root=>!!root.querySelector('.form-item--phoenix .phoenix-input,.form-item--phoenix .phoenix-select,.form-item--phoenix .phoenix-radio-group')}];
  function platforms(root){if(!platformCache.has(root))platformCache.set(root,registry.filter(a=>a.detect(root)));return platformCache.get(root);}
  return {
    reset(){descriptions=new WeakMap();platformCache=new WeakMap();contexts=new WeakMap();},
    describe,disabled,deferred:id=>['moka-select','phoenix-select','phoenix-date'].includes(id),
    platforms:root=>{const found=platforms(root);return (found.length?found:[{id:'generic',label:'通用表单',version:'1'}]).map(({id,label,version})=>({id,label,version}));},
    includes:(node,root)=>platforms(root).some(p=>p.id==='zhiye-phoenix')?!!phoenixField(node):platforms(root).some(p=>p.id==='moka')?!!mokaField(node):true,
    nodes:root=>[...root.querySelectorAll('input,textarea,select,[role="combobox"],.phoenix-radio-group')].filter(n=>!n.closest('.phoenix-radio-group')||n.matches('.phoenix-radio-group')),
    read:entry=>entry.field.adapter==='moka-select'?mokaValue(entry.node):entry.field.adapter==='phoenix-date'?dateValue(phoenixRead(entry.node)):phoenixRead(entry.node),
    write:(entry,target)=>entry.field.adapter==='moka-select'?selectMoka(entry,target):phoenixWrite(entry,target)
  };
}
return {create};
});
