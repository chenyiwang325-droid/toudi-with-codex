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
    const module=moduleOf(title);
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
  const moduleOf=title=>/教育|学历|education/i.test(title)?'education':/在校职务|在校任职|校园任职|在校经历|校园经历|学生工作|学生干部|campus/i.test(title)?'campus-role':/实习|工作经历|任职|employment|work experience/i.test(title)?'work':/获奖|荣誉|奖励|award/i.test(title)?'awards':/论文|专著|发表|publication/i.test(title)?'publications':/家庭|亲属|family/i.test(title)?'family':/项目|科研|实践|project/i.test(title)?'projects':/个人|基本|求职意向|自我评价|附加信息|紧急联系人|personal/i.test(title)?'personal':/语言|外语|证书|language|certificate/i.test(title)?'language':'other';
  function phoenixContext(field) {
    const record=field.closest('.ux-standard-form') || field.closest('.form-part') || field.parentElement;
    if(contexts.has(record))return contexts.get(record);
    let section=null,title='';
    for(let p=record?.parentElement,depth=0;p&&depth<8;p=p.parentElement,depth++) {
      const headings=[...p.children].filter(n=>!n.querySelector('.form-item,input,textarea,select') && !n.matches('input,textarea,select')).map(n=>compact(n.textContent));
      title=headings.find(t=>/^(个人信息|基本信息|求职意向|教育经历|教育背景|工作经历|实习经历|实习经验|项目经历|项目经验|在校经历|在校职务|在校实践|论文\/专著|语言能力|外语能力|语言及证书|证书|获奖情况|荣誉奖励|科研经历|社会实践|家庭成员|家庭情况|紧急联系人|自我评价|其他信息|附加信息|附件|培训经历)$/.test(t)) || '';
      if(title){section=p;break;}
    }
    const records=section?[...section.querySelectorAll('.ux-standard-form')]:[record];
    const degree=[...record.querySelectorAll('.form-item--phoenix')].find(f=>/^(最高)?学历$/.test(phoenixTitle(f)));
    const level=degree?phoenixRead(degree.querySelector('.phoenix-select__input') || degree.querySelector('.phoenix-radio-group')):'';
    const module=moduleOf(title);
    // Read an already-filled identity as record context, never as the field title.
    const identityLabels={'family':/^(与本人关系|关系|姓名)$/,'campus-role':/^(在校职务名称|职务|岗位)$/,'projects':/^(在校科研及实践项目|项目名称|实践名称|名称)$/,'awards':/^(奖项|奖项名称|获奖名称)$/,'publications':/^(名称|论文名称|论文题目)$/,'work':/^(单位名称|公司名称|实习单位|单位)$/};
    let recordHint=module==='education'&&/^(博士研究生|硕士研究生|博士|硕士|大学本科|本科|专科|大专|高中)$/.test(level)?level:'';
    if(identityLabels[module]){
      const names=[...record.querySelectorAll('.form-item--phoenix')].filter(f=>identityLabels[module].test(phoenixTitle(f))).map(f=>phoenixRead(f.querySelector('.phoenix-select__input,input:not([type="hidden"]),textarea'))).filter(v=>v && !/^(请选择|请输入)$/.test(v));
      const unique=[...new Set(names)];if(unique.length===1)recordHint=unique[0];
    }
    const result={module,groupLabel:title+(records.length>1?' · 第'+(records.indexOf(record)+1)+'段':''),groupPath:structuralPath(record),recordHint};contexts.set(record,result);return result;
  }
  function phoenixRead(node) {
    if(!node)return '';
    const current=presentControl(node);
    if(current?.checked)return '至今';
    if(node.matches('.phoenix-radio-group'))return compact(node.querySelector('.phoenix-radio--checked .phoenix-radio__radio-text')?.textContent);
    const select=node.closest('.phoenix-select');
    if(select)return compact(select.querySelector('.phoenix-select__content')?.textContent);
    return String(node.value || '');
  }
  function presentControl(node){
    const field=phoenixField(node);
    if(!field || !/^(结束时间|结束日期)$/.test(phoenixTitle(field)))return null;
    const record=field.closest('.ux-standard-form');
    if(!record)return null;
    const candidates=[...record.querySelectorAll('.phoenix-checkbox')].filter(n=>n.closest('.ux-standard-form')===record && /^(至今|目前|Present)$/i.test(compact(n.querySelector('.phoenix-checkbox__text')?.textContent))).map(n=>n.querySelector('input[type="checkbox"]')).filter(Boolean);
    return candidates.length===1?candidates[0]:null;
  }
  const dateLabel=label=>/^(出生日期(?:（年龄）|\s*\(年龄\))?|毕业时间|入学时间|开始时间|结束时间|开始日期|结束日期|获奖时间|取得日期|获得时间|获证日期|考试日期|发布时间)$/.test(label);
  const dateValue=v=>{const m=String(v).match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?$/);return m?m[1]+'-'+m[2].padStart(2,'0')+(m[3]?'-'+m[3].padStart(2,'0'):''):v;};
  const antField=node=>node.closest('.ant-form-item');
  const antTitle=field=>{
    const label=[...(field?.querySelectorAll('.ant-form-item-label label,.ant-form-item-label') || [])].find(n=>n.closest('.ant-form-item')===field);
    if(!label)return '';
    const copy=label.cloneNode(true);copy.querySelectorAll('.labelRequired,.anticon,[role="img"],button').forEach(n=>n.remove());
    return compact(copy.textContent).replace(/[＊*?？]\s*$/,'').trim();
  };
  function antRead(node) {
    if(node.matches('.ant-radio-group'))return node.querySelector('input:checked')?.value || '';
    if(node.matches('.cascader-plugins-wrap')){
      const values=[...node.querySelectorAll('[role="combobox"]')].map(antRead);
      if(values.every(v=>!v))return '';
      if(/时间|日期/.test(antTitle(antField(node))))return dateValue(values.map(v=>v.replace(/[年月]/g,'')).join('-'));
      return values.join('/');
    }
    if(node.matches('[role="combobox"]'))return compact((node.closest('.ant-select') || node).querySelector('.ant-select-selection-selected-value,.ant-select-selection-item')?.textContent);
    const value=String(node.value || '');
    return node.matches('input.ant-input') && /^请选择/.test(node.getAttribute('placeholder') || '') && /专业$/.test(antTitle(antField(node)))?value.replace(/\s*[（(][^()（）]+类[)）]\s*$/,'').trim():value;
  }
  function antContext(field) {
    const section=field.closest('.form-cell,fieldset,[role="group"]'),record=field.closest('.form-cell-inner') || section || field.closest('form') || field.parentElement;
    if(contexts.has(record))return contexts.get(record);
    const title=compact(section?.querySelector(':scope > .tit-wrap p,:scope > legend,:scope > h2,:scope > h3')?.textContent);
    const records=section?[...section.querySelectorAll('.form-cell-inner')]:[record],module=moduleOf(title);
    const identity=module==='education'?/^(学历|学校名称|毕业院校)$/:module==='work'?/^(单位|单位名称|公司名称|实习单位)$/:module==='family'?/^(关系|与本人关系|姓名)$/:module==='awards'?/^(获奖名称|奖项名称|奖项)$/:module==='campus-role'?/^(职务|在校职务名称)$/:module==='projects'?/^(项目名称|名称)$/:null;
    const hints=identity?[...record.querySelectorAll('.ant-form-item')].filter(f=>identity.test(antTitle(f))).map(f=>antRead(f.querySelector('[role="combobox"],input:not([type="hidden"]),textarea') || f)).filter(Boolean):[];
    const result={module:module==='other'&&!title?'':module,groupLabel:title,groupPath:structuralPath(record),recordHint:[...new Set(hints)].join(' ')};
    if(records.length>1)result.groupLabel+=' · 第'+(records.indexOf(record)+1)+'段';
    contexts.set(record,result);return result;
  }
  function describeAnt(node) {
    const field=antField(node);if(!field)return null;
    const label=antTitle(field) || (node.matches('[role="combobox"]')&&/中国\+86/.test(antRead(node))?'电话区号':''),context=antContext(field),radio=node.matches('.ant-radio-group'),split=node.matches('.cascader-plugins-wrap'),date=!!node.closest('.ant-calendar-picker');
    // Some Ant forms draw school/major selectors as writable inputs. Typing in
    // those inputs never commits the selected directory item.
    const directory=node.matches('input.ant-input')&&!date&&/^请选择/.test(node.getAttribute('placeholder') || '')&&/学校(?:名称)?$|院校$|专业$/.test(label);
    const select=node.matches('[role="combobox"]') || directory;
    const adapter=radio?'ant-radio':split?(/时间|日期/.test(label)?'ant-split-date':'ant-region'):select?'ant-select':date?'ant-date':'';
    return {label:select&&/联系电话|手机/.test(label)?'电话区号':label,context,adapter,...(radio?{type:'radio',options:[...node.querySelectorAll('input[type="radio"]')].map(n=>({value:n.value,text:compact(n.closest('label')?.textContent)}))}:split||select||date?{type:'combobox'}:{}),required:!!field.querySelector('.ant-form-item-required,.labelRequired'),allowReadonly:date,...(date?{dateFormat:'YYYY-MM-DD'}:adapter==='ant-split-date'?{dateFormat:'YYYY-MM'}:adapter==='ant-region'?{regionDepth:node.querySelectorAll('[role="combobox"]').length}:{})};
  }
  const antMenuRows=menu=>[...menu.querySelectorAll('[role="option"]')].filter(visible).filter(n=>!disabledOption(n));
  function closeAnt(node) {
    const win=node.ownerDocument.defaultView;
    node.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
    antField(node)?.querySelector('.ant-form-item-label')?.click();
  }
  async function openAntSelect(node) {
    node.click();
    for(let i=0;i<12;i++){
      const id=node.getAttribute('aria-controls') || node.getAttribute('aria-owns'),menu=id?node.ownerDocument.getElementById(id):null;
      if(menu&&visible(menu)&&antMenuRows(menu).length)return menu;
      await wait(30);
    }
    throw Error('menu-not-associated');
  }
  async function selectAnt(node,target,label,{numeric=false,search=false}={}) {
    if(node.matches('input'))return selectAntDirectory(node,target,label);
    const doc=node.ownerDocument,path=structuralPath(node),title=antTitle(antField(node));
    let menu=await openAntSelect(node);
    try{
      const normalize=v=>numeric?String(Number(String(v).replace(/[年月]/g,''))):equivalence(v,label);
      let matches=antMenuRows(menu).filter(n=>normalize(n.textContent)===normalize(target));
      if(!matches.length&&search){
        const input=node.matches('input')?node:node.querySelector('.ant-select-search__field,.ant-select-selection-search-input');
        if(input&&!input.disabled&&!input.readOnly){setNative(input,target);for(let i=0;i<15;i++){await wait(60);matches=antMenuRows(menu).filter(n=>normalize(n.textContent)===normalize(target));if(matches.length)break;}}
      }
      if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
      matches[0].click();
      // Linked fields may remount this combobox after selection. Read the same
      // structural position and title, never the disconnected old element.
      for(let i=0;i<20;i++){
        await wait(40);
        const live=node.isConnected?node:[...doc.querySelectorAll('[role="combobox"]')].find(n=>structuralPath(n)===path && antTitle(antField(n))===title);
        if(live && normalize(antRead(live))===normalize(target))return antRead(live);
      }
      throw Error('value-not-retained');
    } finally {closeAnt(node);}
  }
  async function selectAntDirectory(node,target,label) {
    const doc=node.ownerDocument,path=structuralPath(node),title=antTitle(antField(node)),kind=/专业$/.test(label)?'专业':'学校';
    const dialogs=()=>[...doc.querySelectorAll('.ant-modal-wrap[role="dialog"]')].filter(visible),before=new Set(dialogs());
    if(before.size)throw Error('menu-not-associated');
    node.click();let layer,confirmed=false;
    try{
      for(let i=0;i<20;i++){
        const found=dialogs().filter(n=>!before.has(n));
        if(found.length>1)throw Error('menu-not-unique');
        if(found.length===1){layer=found[0];break;}
        await wait(40);
      }
      if(!layer || compact(layer.querySelector('.school-form .tit')?.textContent)!=='请选择'+kind+'：')throw Error('menu-not-associated');
      const inputs=[...layer.querySelectorAll('.search-bar input')].filter(visible).filter(n=>n.getAttribute('placeholder')==='请输入'+kind+'名称');
      if(inputs.length!==1 || inputs[0].readOnly || inputs[0].disabled)throw Error('selector-layout-unsupported');
      let categories=[];
      if(kind==='专业')for(let i=0;i<60;i++){
        categories=[...layer.querySelectorAll('.subject-wrap .subject-item')].filter(visible);
        if(categories.length)break;
        // The title/search box renders before the remote catalogue. Starting
        // its search at that point can replace the not-yet-loaded tree.
        await wait(50);
      }
      if(kind==='专业' && categories.length){
        if(categories.length>250)throw Error('selector-layout-unsupported');
        // These directory searches can return no data while the same item is
        // present in the expandable catalogue. Inspect its real radio labels,
        // across all categories, before selecting a unique exact match.
        const routes=categories.map(n=>{const copy=n.cloneNode(true);copy.querySelectorAll('.subject-item-children').forEach(n=>n.remove());return {path:structuralPath(n),title:compact(copy.textContent)};});
        const found=[];let hovered;
        const expand=async category=>{
          const win=doc.defaultView,rect=category.getBoundingClientRect(),position={view:win,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2};
          if(hovered && hovered!==category)hovered.dispatchEvent(new win.MouseEvent('mouseout',{...position,bubbles:true,composed:true,relatedTarget:category}));
          category.click();await wait(20);
          if(![...category.querySelectorAll('.subject-item-children label.ant-radio-wrapper')].some(visible)){
            category.dispatchEvent(new win.MouseEvent('mouseover',{...position,bubbles:true,composed:true,relatedTarget:hovered===category?null:hovered || doc.body}));
            category.dispatchEvent(new win.MouseEvent('mouseenter',{...position,bubbles:false,composed:true}));
            category.dispatchEvent(new win.MouseEvent('mousemove',{...position,bubbles:true,composed:true}));
            await wait(40);
          }
          hovered=category;
        };
        for(const route of routes){
          const category=[...layer.querySelectorAll('.subject-wrap .subject-item')].find(n=>structuralPath(n)===route.path);
          if(!category)throw Error('menu-not-associated');
          await expand(category);
          const live=[...layer.querySelectorAll('.subject-wrap .subject-item')].find(n=>structuralPath(n)===route.path);
          const choices=[...(live?.querySelectorAll('.subject-item-children label.ant-radio-wrapper') || [])].filter(visible);
          for(const choice of choices)if(!disabledOption(choice) && equivalence(choice.textContent,label)===equivalence(target,label))found.push({...route,text:compact(choice.textContent)});
        }
        if(found.length!==1)throw Error(found.length?'option-not-unique':'option-not-found');
        const category=[...layer.querySelectorAll('.subject-wrap .subject-item')].find(n=>structuralPath(n)===found[0].path);
        if(!category)throw Error('menu-not-associated');
        await expand(category);
        const live=[...layer.querySelectorAll('.subject-wrap .subject-item')].find(n=>structuralPath(n)===found[0].path);
        const choices=[...(live?.querySelectorAll('.subject-item-children label.ant-radio-wrapper') || [])].filter(visible).filter(n=>!disabledOption(n)&&compact(n.textContent)===found[0].text);
        if(choices.length!==1)throw Error('option-not-unique');
        const radio=choices[0].querySelector('input[type="radio"]');
        if(!radio || radio.disabled)throw Error('option-disabled');
        radio.click();await wait(40);
        if(!radio.checked)throw Error('option-not-selected');
      }else{
        setNative(inputs[0],target);
        let matches=[];
        for(let i=0;i<60;i++){
          await wait(60);
          matches=[...layer.querySelectorAll('.school-list .school-item')].filter(visible).filter(n=>!disabledOption(n) && equivalence(n.textContent,label)===equivalence(target,label));
          if(matches.length)break;
        }
        if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
        matches[0].click();await wait(40);
        if(!matches[0].classList.contains('active'))throw Error('option-not-selected');
      }
      const buttons=[...layer.querySelectorAll('.ant-modal-footer button[type="button"]')].filter(n=>visible(n)&&compact(n.textContent)==='选择'&&!n.disabled&&!disabledOption(n));
      if(buttons.length!==1)throw Error('option-confirm-unavailable');
      buttons[0].click();confirmed=true;
      for(let i=0;i<20;i++){
        await wait(40);
        const live=node.isConnected?node:[...doc.querySelectorAll('input.ant-input')].find(n=>structuralPath(n)===path && antTitle(antField(n))===title);
        if(live && equivalence(antRead(live),label)===equivalence(target,label))return antRead(live);
      }
      throw Error('value-not-retained');
    }finally{
      if(!confirmed && layer && visible(layer)){
        const cancel=[...layer.querySelectorAll('.ant-modal-footer button[type="button"]')].filter(n=>visible(n)&&compact(n.textContent)==='取消'&&!n.disabled);
        if(cancel.length===1)cancel[0].click();
      }
    }
  }
  async function antWrite(entry,target) {
    const node=entry.node,label=entry.field.label;
    if(entry.field.adapter==='ant-radio'){
      const matches=[...node.querySelectorAll('input[type="radio"]')].filter(n=>n.value===target);
      if(matches.length!==1||matches[0].disabled)throw Error('option-unavailable');matches[0].click();return antRead(node);
    }
    if(entry.field.adapter==='ant-select')return selectAnt(node,target,label,{search:true});
    if(entry.field.adapter==='ant-split-date'){
      const parts=target.match(/^(\d{4})-(\d{2})$/),boxes=[...node.querySelectorAll('[role="combobox"]')];
      if(!parts||boxes.length!==2)throw Error('date-control-unsupported');
      await selectAnt(boxes[0],parts[1],label,{numeric:true});await selectAnt(boxes[1],parts[2],label,{numeric:true});return dateValue(antRead(node));
    }
    if(entry.field.adapter==='ant-region'){
      const parts=String(target).split(/(?<=省|市|区|县|自治区|特别行政区)|[\s/／>]+/).filter(Boolean),boxes=[...node.querySelectorAll('[role="combobox"]')];
      if(!parts.length||boxes.length<2)throw Error('region-source-incomplete');
      // Each later menu is loaded by the preceding selection, in this same field.
      for(let index=0;index<boxes.length;index++){
        const menu=await openAntSelect(boxes[index]);
        try{
          const normalize=v=>String(v).replace(/\s|省|市|自治区|特别行政区/g,'');
          const candidates=antMenuRows(menu).filter(n=>parts.some(p=>normalize(p)===normalize(n.textContent)));
          if(candidates.length!==1)throw Error(candidates.length?'option-not-unique':'option-not-found');
          candidates[0].click();await wait(60);
        } finally {closeAnt(boxes[index]);}
      }
      return antRead(node);
    }
    if(entry.field.adapter==='ant-date'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(target))throw Error('date-precision-required');
      const doc=node.ownerDocument,before=new Set([...doc.querySelectorAll('.ant-calendar-picker-container')].filter(visible));node.click();
      let layer;
      try{
        for(let i=0;i<12;i++){const found=[...doc.querySelectorAll('.ant-calendar-picker-container')].filter(visible).filter(n=>!before.has(n));if(found.length===1){layer=found[0];break;}if(found.length>1)throw Error('menu-not-unique');await wait(30);}
        const inputs=layer?[...layer.querySelectorAll('.ant-calendar-input')].filter(visible):[];
        if(inputs.length!==1||inputs[0].readOnly)throw Error('date-control-unsupported');
        setNative(inputs[0],target);inputs[0].dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));await wait(60);
        if(dateValue(antRead(node))!==target)throw Error('date-not-retained');return target;
      } finally {closeAnt(node);}
    }
    throw Error('selector-layout-unsupported');
  }
  function describeRaw(node) {
    if(antField(node))return describeAnt(node);
    const m=mokaField(node);
    if(m) {
      const inputs=/date_info-/.test(m.className)?[...m.querySelectorAll('input:not([type="hidden"])')]:[];
      const index=inputs.length===4?inputs.indexOf(node):-1,select=!!mokaSelect(node);
      return {label:mokaLabel(node,m),context:mokaContext(node,m)||{groupLabel:'',groupPath:'',recordHint:'',module:''},adapter:select?'moka-select':'',...(select?{type:'combobox'}:{}),required:!!m.querySelector('[class*="required-asterisk-"]'),unsupported:/day_info-/.test(m.className)?'custom-date':select&&inputs.length&&index<0?'split-date':'',dateMeta:index>=0?{datePart:index%2?'month':'year',semanticLabel:index<2?'开始日期':'结束日期'}:{}};
    }
    const p=phoenixField(node);if(!p)return null;
    const label=phoenixTitle(p),radio=node.matches('.phoenix-radio-group'),select=!!node.closest('.phoenix-select'),date=select&&dateLabel(label);
    const current=date?presentControl(node):null;
    return {label,context:phoenixContext(p),adapter:radio?'phoenix-radio':date?'phoenix-date':select?'phoenix-select':'',...(radio?{type:'radio',options:[...node.querySelectorAll('.phoenix-radio')].map(n=>({text:compact(n.querySelector('.phoenix-radio__radio-text')?.textContent),value:compact(n.querySelector('.phoenix-radio__radio-text')?.textContent)}))}:select?{type:'combobox'}:{}),required:!!p.querySelector(':scope > .form-item__title .form-item__required'),allowReadonly:select,...(date?{datePrecision:'deferred',presentAvailable:!!current,presentChecked:!!current?.checked}:{})};
  }
  function describe(node){if(!descriptions.has(node))descriptions.set(node,describeRaw(node));return descriptions.get(node);}
  const disabled=node=>!!node.closest('[class*="--disable"],[class*="--statusDisable"],[class*="primaryDisable"],[aria-disabled="true"],fieldset[disabled]');
  const disabledOption=node=>disabled(node)||!!node.closest('a[href],button[type="submit"],[class*="Disabled"],[class*="disabled"]');
  const equivalence=(v,label)=>{let text=String(v).normalize('NFKC').trim();if(/专业$/.test(label)){text=text.replace(/\s*[（(][^()（）]+类[)）]\s*$/,'').trim();if(text.length>=5)text=text.replace(/(规划|工程|管理|技术|设计|经济|教育|园林)学$/,'$1');}const dict=/^(最高)?学历$/.test(label)?{'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}:/^(最高)?学位$/.test(label)?{'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士'}:/学习形式|学历类型/.test(label)?{'普通全日制':'全日制','全日制普通':'全日制','全国普通高等院校全日制':'全日制','全国普通高等院校非全日制':'非全日制'}:/^获奖级别$/.test(label)?{'校级':'院校级','学校级':'院校级','高校级':'院校级','校院级':'院校级','省级':'省区级','省部级':'省区级','市级':'地市级','全国级':'国家级','国际性':'国际级'}:{};return /英语等级证书|证书类型/.test(label)?(/^(大学)?英语六级(?:考试)?$|^CET[- ]?6$/i.test(text)?'CET6':/^(大学)?英语四级(?:考试)?$|^CET[- ]?4$/i.test(text)?'CET4':text):dict[text]||text;};
  const layers=doc=>[...doc.querySelectorAll('.common-unmodeled-layer')].filter(visible);
  function pointerClick(node) {
    const win=node.ownerDocument.defaultView,box=node.getBoundingClientRect(),init={bubbles:true,cancelable:true,view:win,button:0,clientX:box.left+box.width/2,clientY:box.top+box.height/2};
    if(win.PointerEvent)node.dispatchEvent(new win.PointerEvent('pointerdown',{...init,pointerId:1,pointerType:'mouse',isPrimary:true}));
    node.dispatchEvent(new win.MouseEvent('mousedown',init));
    if(win.PointerEvent)node.dispatchEvent(new win.PointerEvent('pointerup',{...init,pointerId:1,pointerType:'mouse',isPrimary:true}));
    node.dispatchEvent(new win.MouseEvent('mouseup',init));
    if(typeof node.click==='function')node.click();else node.dispatchEvent(new win.MouseEvent('click',init));
  }
  const layerSignature=node=>{const r=node.getBoundingClientRect();return [node.className,node.textContent,r.left,r.top].join('|');};
  // Phoenix attaches its handler to the inner wrapper, not the outer shell.
  function footerButton(layer,text){return [...layer.querySelectorAll('.selector-footer-button .phoenix-button,.area-footer-button .phoenix-button')].filter(n=>compact(n.textContent)===text).map(n=>n.querySelector('.phoenix-button__wraper') || n);}
  async function closePhoenix(entry){
    const title=phoenixField(entry.node)?.querySelector('.form-item__title');
    if(title)pointerClick(title);
    const doc=entry.node.ownerDocument;
    // Popover dismissal listens to mouse-down. A bare click can leave the old
    // portal alive; its exit animation must finish before opening the next one.
    for(let i=0;i<20;i++){
      if(!layers(doc).length && ![...doc.querySelectorAll('.phoenix-select--active')].some(visible))return;
      await wait(40);
    }
    throw Error('menu-not-closed');
  }
  function calendarMonth(text){
    const value=compact(text),numeric=value.match(/^(\d{1,2})月$/);
    if(numeric)return Number(numeric[1]);
    const index=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'].indexOf(value);
    return index<0?NaN:index+1;
  }
  async function openPhoenix(entry) {
    const doc=entry.node.ownerDocument,field=phoenixField(entry.node),select=entry.node.closest('.phoenix-select');
    if(!select || !field)throw Error('option-unavailable');
    await closePhoenix(entry);
    const before=new Map(layers(doc).map(n=>[n,layerSignature(n)]));
    // Phoenix variants attach opening to the input/mouse-down, not the outer wrapper.
    pointerClick(entry.node);
    for(let i=0;i<20;i++){
      const shown=layers(doc),found=shown.filter(n=>!before.has(n) || before.get(n)!==layerSignature(n));
      const active=[...doc.querySelectorAll('.phoenix-select--active')].filter(visible);
      // Never adopt the only stale, fading portal while the new one is mounting.
      // Dates and option lists also have distinct content contracts.
      const ownsType=n=>entry.field.adapter==='phoenix-date'?!!n.querySelector('.phoenix-date-picker'):!!n.querySelector('.phoenix-selectList,.area-selector-container,.constant-main-selector-container');
      if(shown.length===1 && found.length===1 && ownsType(found[0]) && active.length===1 && active[0]===select)return found[0];
      // A shared portal may retain identical options and position. Its sole
      // active owner still establishes the association; never use another menu.
      if(shown.length===1 && ownsType(shown[0]) && active.length===1 && active[0]===select)return shown[0];
      await wait(40);
    }
    throw Error('menu-not-associated');
  }
  async function inspectOptions(entry) {
    let rows=[];
    if(entry.field.adapter==='ant-select'){
      // Searchable directories are resolved by their own confirmation flow;
      // opening one for generic menu inspection would leave a modal behind.
      if(entry.node.matches('input'))return [];
      try{return antMenuRows(await openAntSelect(entry.node)).map(n=>({value:compact(n.textContent),text:compact(n.textContent)}));}
      finally{closeAnt(entry.node);}
    }
    if(entry.field.adapter==='moka-select') {
      const container=entry.node.closest('[class*="sd-Dropdown-container-"]');
      if(!container)throw Error('option-unavailable');
      entry.node.click();
      try {
        for(let i=0;i<12;i++) {rows=[...container.querySelectorAll('[class*="sd-Menu-content-item-"]')].filter(visible);if(rows.length)break;await wait(50);}
        return rows.filter(n=>!disabledOption(n)).map(n=>({value:compact(n.textContent),text:compact(n.textContent)}));
      } finally {directPart(mokaField(entry.node),'title-')?.click();}
    }
    if(entry.field.adapter!=='phoenix-select')return [];
    const layer=await openPhoenix(entry);
    try {
      const menu=layer.querySelector('.phoenix-selectList');
      if(menu) {
        if(menu.querySelector('[class*="multiple"],[class*="multiLabel"]'))return [];
        rows=[...menu.querySelectorAll('.phoenix-selectList__listItem')].filter(visible);
        return rows.filter(n=>!disabledOption(n)).map(n=>{const text=compact(n.querySelector('.phoenix-selectList__singleLabel')?.textContent || n.textContent);return {value:text,text};});
      }
      // Do not scrape hierarchical region trees or search remote directories.
      if(!layer.querySelector('.constant-main-selector-container') || layer.querySelector('.area-selector-container'))return [];
      rows=[...layer.querySelectorAll('.list-item-container')].filter(visible);
      return rows.filter(n=>!disabledOption(n)).map(n=>{const text=compact(n.querySelector('.item-text-label')?.textContent);return {value:text,text};});
    } finally {
      const cancel=footerButton(layer,'取消');if(cancel.length===1 && !disabledOption(cancel[0]))pointerClick(cancel[0]);
      await closePhoenix(entry);
    }
  }
  async function phoenixWrite(entry,target) {
    if(entry.field.adapter==='phoenix-date' && /^(至今|present|ongoing|current)$/i.test(target)){
      const current=presentControl(entry.node);
      if(!current || current.disabled || disabled(current))throw Error('present-control-unavailable');
      if(!current.checked)pointerClick(current);
      await wait(100);
      if(!current.checked || phoenixRead(entry.node)!=='至今')throw Error('date-not-retained');
      return '至今';
    }
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
                const decade=compact(panel.querySelector('.phoenix-calendar-year-panel-decade-select')?.textContent),range=decade.match(/(\d{4})\s*[-–]\s*(\d{4})/);
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
          const months=[...layer.querySelectorAll('.phoenix-calendar-month-calendar .phoenix-calendar-month-panel-month')].filter(visible).filter(n=>calendarMonth(n.textContent)===month);
          if(months.length!==1)throw Error(months.length?'date-month-not-unique':'date-month-not-found');
          if(disabledOption(months[0]))throw Error('date-month-disabled');months[0].click();await wait(100);
          if(dateValue(phoenixRead(entry.node))!==expected)throw Error('date-not-retained');
          confirmed=true;return expected;
        }
        // A month-only source never gains an invented day when the real picker needs one.
        if(!/^\d{4}-\d{2}-\d{2}$/.test(target))throw Error('date-precision-required');
        const dayCalendar=layer.querySelector('.phoenix-date-picker .phoenix-calendar:not(.phoenix-calendar-month-calendar)');
        if(dayCalendar?.querySelector('.phoenix-calendar-date')){
          const [year,month,day]=target.split('-').map(Number);
          const yearOf=()=>Number(compact(layer.querySelector('.phoenix-calendar-year-select')?.textContent).match(/\d{4}/)?.[0]);
          const monthOf=()=>Number(compact(layer.querySelector('.phoenix-calendar-month-select')?.textContent).match(/\d{1,2}/)?.[0]);
          if(!Number.isInteger(yearOf()) || !Number.isInteger(monthOf()))throw Error('date-control-unsupported');
          if(yearOf()!==year){
            const yearSelect=layer.querySelector('.phoenix-calendar-year-select');
            yearSelect.click();await wait(60);
            let selected=false;
            for(let i=0;i<25;i++){
              const panel=[...layer.querySelectorAll('.phoenix-calendar-year-panel')].find(visible);if(!panel)throw Error('date-year-panel-unavailable');
              const years=[...panel.querySelectorAll('.phoenix-calendar-year-panel-year')].filter(visible).filter(n=>compact(n.textContent)===String(year));
              if(years.length>1)throw Error('date-year-not-unique');
              if(years.length===1){if(disabledOption(years[0]))throw Error('date-year-disabled');years[0].click();await wait(60);selected=true;break;}
              const decade=compact(panel.querySelector('.phoenix-calendar-year-panel-decade-select')?.textContent),range=decade.match(/(\d{4})\s*[-–]\s*(\d{4})/);
              if(!range)throw Error('date-decade-unavailable');
              const direction=year<Number(range[1])?'prev':year>Number(range[2])?'next':'';
              const button=direction && panel.querySelector('.phoenix-calendar-year-panel-'+direction+'-decade-btn');
              if(!button || disabledOption(button))throw Error('date-year-navigation-unavailable');
              button.click();await wait(60);
              if(compact(layer.querySelector('.phoenix-calendar-year-panel-decade-select')?.textContent)===decade)throw Error('date-year-navigation-stalled');
            }
            if(!selected || yearOf()!==year)throw Error('date-year-not-retained');
          }
          if(monthOf()!==month){
            const selector=layer.querySelector('.phoenix-calendar-month-select');selector.click();await wait(60);
            const months=[...layer.querySelectorAll('.phoenix-calendar-month-panel-month')].filter(visible).filter(n=>calendarMonth(n.textContent)===month);
            if(months.length!==1)throw Error('date-month-not-unique');
            if(disabledOption(months[0]))throw Error('date-month-disabled');months[0].click();await wait(60);
          }
          if(yearOf()!==year || monthOf()!==month)throw Error('date-month-not-retained');
          const days=[...layer.querySelectorAll('.phoenix-calendar-cell')].filter(visible).filter(n=>!n.matches('.phoenix-calendar-last-month-cell,.phoenix-calendar-next-month-btn,.phoenix-calendar-next-month-btn-day,.phoenix-calendar-next-month-cell') && compact(n.querySelector('.phoenix-calendar-date')?.textContent)===String(day));
          if(days.length!==1)throw Error('date-day-not-unique');
          const chosen=days[0].querySelector('.phoenix-calendar-date');if(disabledOption(days[0]) || disabledOption(chosen))throw Error('date-day-disabled');
          pointerClick(chosen);await wait(100);
          if(dateValue(phoenixRead(entry.node))!==target)throw Error('date-not-retained');
          confirmed=true;return target;
        }
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
        pointerClick(chosen.querySelector('.phoenix-selectList__singleLabel') || chosen);confirmed=true;await wait(120);
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
      const matchingRows=()=>[...layer.querySelectorAll(area?'.area-item-container':'.list-item-container')].filter(visible).filter(row=>{
        const label=compact(row.querySelector(area?'.area-text-label':'.item-text-label')?.textContent);
        const path=compact(row.querySelector('.area-item-path')?.textContent);
        return area?regionMatches(label,path):normalize(label)===normalize(target);
      });
      let matches=[];
      for(let i=0;i<20;i++) {
        matches=matchingRows();
        if(matches.length)break;
        await wait(60);
      }
      if(matches.length!==1)throw Error(matches.length?'option-not-unique':'option-not-found');
      const chosen=matches[0];if(disabledOption(chosen))throw Error('option-disabled');
      const icon=chosen.querySelector('.icon-container');
      const selectedLabel=compact(chosen.querySelector(area?'.area-text-label':'.item-text-label')?.textContent);
      const hasState=!!icon?.querySelector('[class*=Unchecked],[class*=Checked]');
      const checked=row=>!!row?.querySelector('.icon-container [class*=Checked]:not([class*=Unchecked])');
      // Region text may drill down; the radio/check icon selects the current region.
      if(!checked(chosen))pointerClick(icon?.querySelector('svg') || icon || chosen);
      // Virtualized React lists replace row nodes when selection changes. Read
      // the current row, never the detached Unchecked icon from before the click.
      if(hasState){
        let selected=false;
        for(let i=0;i<15;i++){const current=matchingRows();if(current.length===1 && !disabledOption(current[0]) && checked(current[0])){selected=true;break;}await wait(40);}
        if(!selected)throw Error('option-not-selected');
      }else await wait(80);
      const buttons=footerButton(layer,'确定');if(buttons.length!==1 || disabledOption(buttons[0]))throw Error('option-confirm-unavailable');
      // A successful click is not success: read back the persisted displayed value below.
      pointerClick(buttons[0]);
      for(let i=0;i<15;i++){
        await wait(40);const actual=phoenixRead(entry.node);
        if(normalize(actual)===normalize(target) || area&&normalize(actual)===normalize(selectedLabel)){confirmed=true;return actual;}
      }
      throw Error('value-not-retained');
    } finally {
      if(!confirmed){const cancel=footerButton(layer,'取消');if(cancel.length===1 && !disabledOption(cancel[0]))pointerClick(cancel[0]);}
      await closePhoenix(entry);
    }
  }
  const registry=[{id:'moka',label:'Moka',version:'1',detect:root=>!!root.querySelector('[class^="apply-block-"] [class^="apply-field-"],[class*=" apply-block-"] [class*=" apply-field-"]')},{id:'zhiye-phoenix',label:'Zhiye / Phoenix',version:'1',detect:root=>!!root.querySelector('.form-item--phoenix .phoenix-input,.form-item--phoenix .phoenix-select,.form-item--phoenix .phoenix-radio-group')},{id:'ant-design',label:'Ant Design / Hotjob',version:'1',detect:root=>!!root.querySelector('.ant-form-item input,.ant-form-item textarea,.ant-form-item [role="combobox"]')}];
  function platforms(root){if(!platformCache.has(root))platformCache.set(root,registry.filter(a=>a.detect(root)));return platformCache.get(root);}
  function includes(node,root){
    if(node.closest('nav,header,aside,[role="search"],[role="listbox"],[role="option"],.common-unmodeled-layer,.phoenix-selectList,.ant-select-dropdown,.ant-calendar-picker-container,#toudi-floating-host,[data-toudi-panel]'))return false;
    const known=platforms(root);
    if(phoenixField(node) || mokaField(node) || antField(node))return true;
    if(!known.some(p=>['zhiye-phoenix','moka'].includes(p.id)))return node.type!=='search';
    // Component families coexist. Restrict generic fallbacks to a recruitment
    // form/section, rather than discarding them when one Phoenix field exists.
    if(node.type==='search')return false;
    const form=node.closest('form');
    if(form?.querySelector('.form-item--phoenix,[class^="apply-field-"],[class*=" apply-field-"]'))return true;
    for(let p=node.parentElement,depth=0;p&&depth<8;p=p.parentElement,depth++){
      const heading=p.querySelector(':scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > [role="heading"]');
      if(heading && moduleOf(compact(heading.textContent))!=='other')return true;
    }
    return false;
  }
  return {
    reset(){descriptions=new WeakMap();platformCache=new WeakMap();contexts=new WeakMap();},
    validationError:entry=>{
      const ant=antField(entry.node);if(ant)return [...ant.querySelectorAll('.ant-form-explain,.ant-form-item-explain-error')].filter(visible).map(n=>compact(n.textContent)).join('；');
      const field=phoenixField(entry.node);if(!field)return '';
      return [...field.querySelectorAll('.form-item__error')].filter(error=>error.closest('.form-item--phoenix')===field&&visible(error)).map(error=>compact(error.textContent)).filter(Boolean).join('；');
    },
    describe,disabled,inspectOptions,moduleOf,pointerClick,deferred:id=>['moka-select','phoenix-select','phoenix-date','ant-select','ant-date','ant-split-date','ant-region'].includes(id),
    matchesValue:(entry,target)=>entry.field.adapter==='ant-select'?equivalence(antRead(entry.node),entry.field.label)===equivalence(target,entry.field.label):entry.field.adapter==='ant-split-date'?dateValue(antRead(entry.node))===target:false,
    platforms:root=>{const found=platforms(root);return (found.length?found:[{id:'generic',label:'通用表单',version:'1'}]).map(({id,label,version})=>({id,label,version}));},
    includes,
    nodes:root=>[...root.querySelectorAll('input,textarea,select,[role="combobox"],.phoenix-radio-group,.ant-radio-group,.cascader-plugins-wrap')].filter(n=>(!n.closest('.phoenix-radio-group')||n.matches('.phoenix-radio-group'))&&(!n.closest('.ant-radio-group')||n.matches('.ant-radio-group'))&&(!n.closest('.cascader-plugins-wrap')||n.matches('.cascader-plugins-wrap'))&&!n.matches('.ant-select-search__field,.ant-select-selection-search-input,.ant-calendar-input')&&!n.closest('.ant-select-dropdown,.ant-calendar-picker-container,.school-wrap[role="dialog"]')),
    read:entry=>entry.field.adapter.startsWith('ant-')?antRead(entry.node):entry.field.adapter==='moka-select'?mokaValue(entry.node):entry.field.adapter==='phoenix-date'?dateValue(phoenixRead(entry.node)):phoenixRead(entry.node),
    write:(entry,target)=>entry.field.adapter.startsWith('ant-')?antWrite(entry,target):entry.field.adapter==='moka-select'?selectMoka(entry,target):phoenixWrite(entry,target)
  };
}
return {create,revision:'11'};
});
