'use strict';
// Synthetic ATSX structure: empty modules, existing cards and scoped portals.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const field=(label,content)=>`<div class="atsx-row atsx-form-item"><div class="atsx-form-item-label"><label>${label}</label></div><div class="atsx-form-item-control-wrapper">${content}</div></div>`;
const period=(owner,start='',end='')=>field('起止时间',`<div class="atsx-date-picker atsx-date-picker-period-month">${['Begin','End'].map((part,i)=>{const p=(i?end:start).split('-');return `<div class="atsx-date-picker-period-month-label" data-cy="${owner}${part}"><span data-cy="year">${p[0]||'YYYY'}</span>-<span data-cy="month">${p[1]||'MM'}</span></div>`;}).join('')}<input class="atsx-date-picker-period-hidden-input" style="display:none"></div>`);
const select=(owner,value,choices)=>`<div class="atsx-select"><div role="combobox" aria-controls="menu-${owner}" data-choices='${JSON.stringify(choices)}'><div class="atsx-select-selection-selected-value">${value}</div><input class="atsx-select-search__field" style="display:none"></div></div>`;
const record=(kind,index,filled=false)=>{
 const id=kind+'['+index+']';
 const body=kind==='project'?field('项目名称','<input>')+field('项目角色','<input>')+period(id)+field('描述','<textarea></textarea>'):kind==='award'?field('获奖名称','<input>')+field('获奖时间',`<div class="atsx-date-picker"><input placeholder="YYYY" data-cy="${id}.dateInput"></div>`)+field('描述','<textarea></textarea>'):kind==='internship'?field('公司名称',`<input value="${filled?'合成单位甲':''}">`)+field('职位名称',`<input value="${filled?'研究实习生':''}">`)+period(id,filled?'2025-05':'',filled?'2025-08':'')+field('描述',`<textarea>${filled?'网页已有完整描述。':''}</textarea>`):field('语言',select('language','英语',['英语','法语']))+field('精通程度',select('proficiency','日常会话',['日常会话','专业交流']));
 return `<div class="resumeEditForm-item resumeEditForm-${kind}">${body}</div>`;
};
const section=(kind,title,content='')=>`<div class="createFormSection-container"><div class="resumeEditForm-${kind} createFormSection-repeatable createFormSection__synthetic"><div class="createFormSection-left"><div class="createFormSection-title"><p>${title}</p></div><p class="createFormSection-desc"></p></div><div class="createFormSection-right"><div class="createFormSection-formList">${content}</div><div class="createFormSection-addBtn"><span class="addMore-add">添加</span></div></div></div></div>`;
const education='<div class="resumeEditForm-item">'+field('学校名称','<div class="atsx-select"><div role="combobox"><div class="atsx-select-selection__rendered"><ul><li><input class="atsx-select-search__field"></li></ul></div></div></div>')+field('学历',select('degree','本科',['本科','硕士']))+period('education[0]','2019-09','2024-06')+'</div>';
const fixture='<title>合成 ATSX 申请表</title><form>'+section('education','教育经历',education)+section('internship','实习经历',record('internship',0,true))+section('project','项目经历')+section('award','获奖')+section('language','语言能力',record('language',0))+'<div class="resumeEditForm-career createFormSection__synthetic"><div class="createFormSection-left"><p>工作经历</p></div><label><input type="checkbox" checked>没有工作经历</label></div>'+section('work','作品')+'<button type="submit">提交简历</button></form>';
const facts=[],f=(module,rid,label,value,more={})=>facts.push({key:[module,rid,label].join('.'),module,recordId:rid,recordLabel:rid,label,value,...more});
f('education','bachelor','学校','合成本科学院');f('education','bachelor','学历','本科');f('education','bachelor','开始日期','2019-09-01',{precision:'day'});f('education','bachelor','结束日期','2024-06-30',{precision:'day'});
for(const [rid,name,start,end] of [['intern-a','合成单位甲','2025-05-06','2025-08-29'],['intern-b','合成单位乙','2023-10-01','2023-12-30']]){f('internship',rid,'单位',name);f('internship',rid,'职务','研究实习生');f('internship',rid,'开始',start,{precision:'day'});f('internship',rid,'结束',end,{precision:'day'});f('internship',rid,'工作职责','完整职责第一段。\n完整职责第二段。');}
for(const [rid,name,start,end] of [['project-a','合成项目甲','2024-12-01','2025-04-30'],['project-b','合成项目乙','2024-09-01','2025-03-30']]){f('project',rid,'名称',name);f('project',rid,'角色','项目负责人');f('project',rid,'开始日期',start,{precision:'day'});f('project',rid,'结束日期',end,{precision:'day'});f('project',rid,'项目描述','完整项目原文第一段。\n完整项目原文第二段。');}
for(const [rid,name,date] of [['award-a','合成竞赛一等奖','2024-10-11'],['award-b','合成奖学金','2016-11-01']]){f('awards',rid,'奖项名称',name);f('awards',rid,'获奖日期',date,{precision:'day'});f('awards',rid,'奖项描述','完整获奖说明。\n不删减任何文字。');}
for(const [rid,type] of [['cet6','CET-6'],['cet4','CET-4']]){f('language',rid,'证书类型',type);f('language',rid,'语种','英语');}
const pack={schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts,rules:[]};let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://synthetic.invalid/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:fixture}));await page.goto('https://synthetic.invalid/form');
 await page.evaluate(recordSource=>{
  const makeRecord=eval('('+recordSource+')');window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++;};
  const close=()=>document.querySelectorAll('.atsx-date-picker-dropdown,.atsx-select-dropdown').forEach(n=>n.remove());
  const setup=root=>{
   root.querySelectorAll('.atsx-form-item-label').forEach(n=>n.onmousedown=close);
   for(const endpoint of root.querySelectorAll('.atsx-date-picker-period-month-label'))endpoint.onclick=()=>{
    close();const layer=document.createElement('div');layer.className='atsx-date-picker-dropdown';const owner=endpoint.getAttribute('data-cy');layer.innerHTML=`<div class="atsx-date-picker-period-month-panel" data-cy="${owner}Dropdown"><div>${Array.from({length:14},(_,i)=>2028-i).map(y=>`<div class="atsx-date-picker-period-month-panel-list-item">${y}</div>`).join('')}</div><div>${Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>`<div class="atsx-date-picker-period-month-panel-list-item">${m}</div>`).join('')}</div></div>`;document.body.append(layer);
    layer.querySelectorAll('.atsx-date-picker-period-month-panel-list-item').forEach(n=>n.onmousedown=()=>{const part=n.textContent.length===4?'year':'month';endpoint.querySelector(`[data-cy="${part}"]`).textContent=n.textContent;if(part==='month')close();});
   };
   for(const input of root.querySelectorAll('.atsx-date-picker > input[placeholder="YYYY"]'))input.onclick=()=>{
    close();let from=2018;const layer=document.createElement('div');layer.className='atsx-date-picker-dropdown';document.body.append(layer);
    const paint=()=>{layer.innerHTML=`<div class="atsx-date-picker-panel" data-cy="${input.getAttribute('data-cy')}Dropdown"><div class="atsx-date-picker-panel-header"><i data-cy="prev">前</i><span>${from}-${from+8}</span><i data-cy="next">后</i></div><div class="atsx-date-picker-panel-body-year">${Array.from({length:9},(_,i)=>`<div class="atsx-date-picker-panel-body-cell-content">${from+i}</div>`).join('')}</div></div>`;layer.querySelector('[data-cy="prev"]').onclick=()=>{from-=9;paint();};layer.querySelector('[data-cy="next"]').onclick=()=>{from+=9;paint();};layer.querySelectorAll('.atsx-date-picker-panel-body-cell-content').forEach(n=>n.onmousedown=()=>{input.value=n.textContent;close();});};paint();
   };
   for(const box of root.querySelectorAll('[role="combobox"][data-choices]'))box.onclick=()=>{
    close();const layer=document.createElement('div');layer.className='atsx-select-dropdown';layer.id=box.getAttribute('aria-controls');layer.innerHTML=JSON.parse(box.dataset.choices).map(v=>`<div role="option">${v}</div>`).join('');document.body.append(layer);layer.querySelectorAll('[role="option"]').forEach(n=>n.onmousedown=()=>{box.querySelector('.atsx-select-selection-selected-value').textContent=n.textContent;close();});
   };
  };
  // Record creation is the website's own local control, never a save/submit.
  for(const section of document.querySelectorAll('.createFormSection-repeatable'))section.querySelector('.createFormSection-addBtn').onclick=()=>{const kind=[...section.classList].find(c=>c.startsWith('resumeEditForm-')).slice(15);if(kind==='work')throw Error('must not create portfolio');const list=section.querySelector('.createFormSection-formList');list.insertAdjacentHTML('beforeend',makeRecord(kind,list.children.length));setup(list.lastElementChild);};
  setup(document);
 },`function(kind,index,filled=false){const field=${field.toString()},period=${period.toString()},select=${select.toString()};return (${record.toString()})(kind,index,filled);}`);
 for(const file of ['assets/form-adapters.js','assets/form-engine.js','browser-extension/filling-aliases.js','browser-extension/filling-core.js'])await page.addScriptTag({path:path.resolve('app',file)});
 const result=await page.evaluate(async pack=>{
  const E=TouDiFormEngine,C=TouDiFillingCore,p=C.profile(C.validatePack(pack)),initial=await E.scan(),allocation=C.allocateRecords(p,initial);
  const targets=allocation.modules.filter(m=>m.canAdd&&m.missing.length).map(m=>({sectionId:m.sectionId,recordIds:m.missing.map(r=>r.id)}));
  const expanded=await E.expandRecords({fingerprint:initial.fingerprint,bindings:allocation.bindings,targets});
  const a=C.allocateRecords(p,expanded.scan,expanded.bindings),plan=C.plan(p,expanded.scan,{},new Date(),{},a.bindings),ready=plan.rows.filter(r=>r.status==='ready');
  const report=await E.apply(C.confirm(plan,ready.map(r=>r.fieldId)));const after=await E.scan(),again=C.allocateRecords(p,after);
  return {initial,allocation,expanded,plan,report,after,again,submits:window.submits};
 },pack);
 assert(result.initial.platforms.some(p=>p.id==='atsx'));
 for(const mod of ['projects','awards']){const s=result.initial.repeatables.find(s=>s.module===mod);assert(s&&s.addStatus==='ready'&&s.groupIds.length===0,JSON.stringify(result.initial.repeatables));}
 assert(!result.initial.fields.some(f=>f.label==='YYYY'||f.label==='2025'||f.label==='MM'));
 assert.equal(result.expanded.additions.reduce((n,a)=>n+a.added,0),5,JSON.stringify(result.expanded));
 assert(!result.plan.rows.some(r=>['work','projects','awards'].includes(r.module)&&['missing','unsupported','ambiguous'].includes(r.status)),JSON.stringify(result.plan.rows));
 assert.equal(result.report.summary.verified,22,JSON.stringify(result.report));
 assert.equal(result.report.summary.failed||0,0);assert.equal(result.submits,0);assert.deepEqual(errors,[]);
 assert.equal(result.after.fields.find(f=>f.module==='work'&&f.recordHint==='合成单位甲'&&f.label==='描述').value,'网页已有完整描述。');
 assert.equal(result.again.modules.reduce((n,m)=>n+(m.canAdd?m.missing.length:0),0),0,JSON.stringify(result.again));
 assert.equal(result.again.modules.find(m=>m.module==='language').total,1);
 assert.equal(result.after.fields.find(f=>f.module==='education'&&f.label==='学校名称').value,'合成本科学院');
 for(const r of result.plan.rows.filter(r=>r.module==='projects'&&r.label==='描述'))assert.equal(result.after.fields.find(f=>f.id===r.fieldId).value,'完整项目原文第一段。\n完整项目原文第二段。');
 assert.deepEqual(result.after.fields.filter(f=>f.module==='awards'&&f.label==='获奖时间').map(f=>f.value),['2024','2016']);
 // Real option ownership and pointer events apply a choice, not only highlight it.
 const options=await page.evaluate(async()=>{const s=await TouDiFormEngine.scan(),f=s.fields.find(f=>f.module==='language'&&f.label==='语言');return TouDiFormEngine.inspectOptions({fingerprint:s.fingerprint,fieldIds:[f.id]});});assert.equal(options.items[0].options.length,2);
 console.log('PASS ATSX: read-only empty-module inventory; add/bind/fill 5 records; 22 writes read back; school autocomplete; scoped year/month and older award year; preserve existing text; aggregate language certificates; no duplicate second run; no submit.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
