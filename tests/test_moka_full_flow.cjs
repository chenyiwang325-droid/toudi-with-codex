'use strict';
// Synthetic applicant and controls. Reproduces observed interaction protocols,
// including nested add headings, combined fields, confirmation and readback.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
let pw;try{pw=require('playwright');}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const input=(value='')=>`<input value="${value}">`;
const select=(value='',options=['是','否'])=>`<div class="sd-Dropdown-container-fixture"><label class="sd-Select-container-fixture"><span class="sd-Input-display-value-fixture">${value}</span><input></label><div class="sd-Dropdown-dropdown-fixture" hidden>${options.map(o=>`<div class="sd-Menu-content-item-fixture">${o}</div>`).join('')}</div></div>`;
const field=(label,control,extra='')=>`<div class="apply-field-fixture ${extra}"><div class="title-fixture">${label}</div>${control}</div>`;
const record=html=>`<div class="apply-fields-fixture">${html}</div>`;
const block=(label,html)=>`<section class="apply-block-fixture"><div class="blockTitle-fixture"><div><div><span class="text-fixture">${label}</span></div><div><div><button type="button" class="add-fixture">添加</button></div></div></div></div>${html}</section>`;
const dateRange=()=>field('起止时间',select('',['2022','2023','2024','2027'])+select('',['1','6','9','10'])+select('',['2022','2023','2024','2027'])+select('',['1','6','9','10'])+'<label><input type="checkbox">至今</label>','date_info-fixture');
const education=(level,school,major)=>record(field('学校名称',select(school,[school]))+field('专业名称',select(major,[major]))+field('学历',select(level,['本科','硕士']))+field('是否全日制',select())+field('是否最高学历',select())+field('是否第一学历',select())+field('在校成绩（GPA及排名）',input())+field('在校担任职务',input()));
const region=label=>field(label,'<div class="sd-Dropdown-container-fixture region-fixture"><input readonly><div class="sd-Dropdown-dropdown-fixture" hidden><ul><li class="sd-Tabs-item-fixture">省份</li><li class="sd-Tabs-item-fixture">城市</li><li class="sd-Tabs-item-fixture">县区</li></ul><div class="page-container-fixture"></div><div class="confirm-fixture"><button type="button">确认</button></div></div></div>','location_info-fixture');
const date=(label,monthOnly)=>field(label,`<div class="sd-Dropdown-container-fixture date-fixture" data-month-only="${monthOnly}"><input readonly><div class="sd-Dropdown-dropdown-fixture" hidden></div></div>`,'day_info-fixture');
const fullIntern='工作一：保存完整原始说明。\n工作二：研究、验证、交付及成果均保持原文。'.repeat(15);
const html=`<meta charset="utf-8"><style>[hidden]{display:none!important}input,textarea{width:170px;min-height:24px}.apply-field-fixture{padding:5px}.apply-fields-fixture{padding:5px}.sd-Dropdown-dropdown-fixture{padding:8px}li,span.sd-Tag-container-fixture{display:inline-block;padding:4px}</style><form>
${block('个人信息',record(region('现居住地')+date('出生日期 (年龄)',true)+date('可到岗实习日期',false)))}
${block('教育背景',education('硕士','合成研究大学','应用工程学(专业技术方向')+education('本科','合成本科大学','应用工程'))}
${block('实习经历',record(dateRange()+field('公司名称',input('合成公司(研发部)'))+field('职位名称',input('实习生'))+field('证明人及联系方式',input())+field('项目描述','<textarea></textarea>')))}
${block('语言能力',record(field('英语',select('',['熟练','流利','普通']))+field('其他',input())+field('取得证书',input())))}
${block('家庭成员',record(field('姓名',input())+field('与本人关系',select('',['父亲','母亲']))))}
${block('自我描述',record(field('自我描述','<textarea></textarea>')))}<button type="submit">提交申请</button></form><script>
window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();submits++};
const menus=()=>document.querySelectorAll('.sd-Dropdown-dropdown-fixture');
document.addEventListener('mousedown',e=>menus().forEach(m=>{if(!m.parentElement.contains(e.target)){m.hidden=true;if(m.parentElement.classList.contains('region-fixture')&&!m.parentElement.dataset.committed)m.parentElement.querySelector('input').value=m.parentElement.dataset.before||''}}));
document.querySelectorAll('.sd-Select-container-fixture').forEach(c=>{const m=c.parentElement.querySelector('.sd-Dropdown-dropdown-fixture');c.querySelector('input').onclick=()=>m.hidden=false;m.querySelectorAll('.sd-Menu-content-item-fixture').forEach(o=>o.onclick=()=>{c.querySelector('.sd-Input-display-value-fixture').textContent=o.textContent;m.hidden=true})});
document.querySelectorAll('.region-fixture').forEach(c=>{let chosen=[],depth=0;const m=c.querySelector('.sd-Dropdown-dropdown-fixture'),value=c.querySelector('input');
 const render=()=>{const offered=depth===0?['合成省','其他省']:depth===1?['示范市']:['样本区'];m.querySelector('.page-container-fixture').innerHTML=offered.map(t=>'<span class="sd-Tag-container-fixture"><div class="sd-Tag-text-fixture">'+t+'</div></span>').join('');m.querySelectorAll('.sd-Tag-container-fixture').forEach(n=>n.onclick=()=>{chosen[depth]=n.textContent;chosen=chosen.slice(0,depth+1);value.value=chosen.join(' ');depth=Math.min(2,depth+1);render()})};
 value.onclick=()=>{c.dataset.before=value.value;delete c.dataset.committed;chosen=[];depth=0;render();m.hidden=false};m.querySelectorAll('li').forEach((n,i)=>n.onclick=()=>{depth=i;render()});m.querySelector('button').onclick=()=>{if(chosen.length!==3)return;c.dataset.committed='yes';window.regionConfirms=(window.regionConfirms||0)+1;m.hidden=true};
});
const months=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
document.querySelectorAll('.date-fixture').forEach(c=>{const menu=c.querySelector('.sd-Dropdown-dropdown-fixture'),value=c.querySelector('input'),monthOnly=c.dataset.monthOnly==='true';let y=2026,m=10,mode=monthOnly?'month':'day',decade=2020;
 const render=()=>{menu.innerHTML='<div><span class="sd-Icon-icondoubleLeft-fixture">←</span><span class="sd-basic-selector-year-fixture">'+(mode==='year'?decade+'-'+(decade+9):y+'年')+'</span>'+(mode==='day'?'<span class="sd-basic-selector-month-fixture">'+months[m-1]+'</span>':'')+'<span class="sd-Icon-icondoubleRight-fixture">→</span></div><div class="items-fixture"></div>';const items=menu.querySelector('.items-fixture');
 if(mode==='year'){items.innerHTML=Array.from({length:10},(_,i)=>'<div class="sd-basic-year-item-fixture">'+(decade+i)+'</div>').join('');items.querySelectorAll('div').forEach(n=>n.onclick=()=>{y=Number(n.textContent);mode=monthOnly?'month':'day';render()})}
 else if(mode==='month'){items.innerHTML=months.map(t=>'<div class="sd-basic-year-item-fixture">'+t+'</div>').join('');items.querySelectorAll('div').forEach((n,i)=>n.onclick=()=>{m=i+1;if(monthOnly){value.value=y+'-'+String(m).padStart(2,'0')+' (25岁)'}else{mode='day';render()}})}
 else {items.innerHTML='<div class="sd-basic-fade-fixture"><div class="sd-basic-date-item-fixture">1</div></div>'+Array.from({length:28},(_,i)=>'<div class="sd-basic-date-item-fixture">'+(i+1)+'</div>').join('');items.querySelectorAll('.sd-basic-date-item-fixture').forEach(n=>n.onclick=()=>{value.value=y+'-'+String(m).padStart(2,'0')+'-'+String(n.textContent).padStart(2,'0');menu.hidden=true})}
 menu.querySelector('.sd-basic-selector-year-fixture').onclick=()=>{mode='year';decade=Math.floor(y/10)*10;render()};menu.querySelector('.sd-basic-selector-month-fixture')?.addEventListener('click',()=>{mode='month';render()});menu.querySelector('.sd-Icon-icondoubleLeft-fixture').onclick=()=>{decade-=10;render()};menu.querySelector('.sd-Icon-icondoubleRight-fixture').onclick=()=>{decade+=10;render()};};value.onclick=()=>{mode=monthOnly?'month':'day';render();menu.hidden=false};
});
</script>`;
const fact=(key,label,value,module='personal',recordId='',extra={})=>({key,label,value,module,recordId,...extra});
const pack={schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],rules:[],facts:[
 fact('residence','现居地','合成省示范市样本区'),fact('birth','出生日期','2001-01-16'),fact('available','可到岗实习日期','2027-09-01'),fact('highest','最高学历','硕士'),fact('self','个人评价','原始自我评价全文。'),
 ...['m','b'].flatMap((id,i)=>[fact(id+'school','学校',i?'合成本科大学':'合成研究大学','education',id),fact(id+'major','专业','应用工程','education',id),fact(id+'level','学历',i?'本科':'硕士','education',id),fact(id+'type','学历类型','全国普通高等院校全日制','education',id),fact(id+'gpa','GPA',i?'3.5':'4.2','education',id,{gpaScale:i?'4':'5'}),fact(id+'rank','年级排名',i?'10/120':'2/60','education',id),fact(id+'start','开始日期',i?'2019-09-01':'2024-09-01','education',id),fact(id+'end','结束日期',i?'2024-06-30':'2027-06-30','education',id)]),
 fact('company','单位','合成公司','internship','work'),fact('workstart','开始日期','2023-09-01','internship','work'),fact('workend','结束日期','2024-06-30','internship','work'),fact('worktext','工作职责',fullIntern,'internship','work'),fact('ref','证明人','合成联系人','internship','work'),fact('refphone','证明人电话','00000000000','internship','work'),
 ...['c4','c6'].flatMap((id,i)=>[fact(id+'type','证书类型',i?'大学英语六级':'大学英语四级','language',id),fact(id+'language','语种','英语','language',id),fact(id+'score','考试成绩',i?'560':'600','language',id)]),
 ...['学习委员','团组织委员','学习部干事'].flatMap((name,i)=>[fact('role'+i,'职务',name,'campus-role','role'+i),fact('role'+i+'start','开始日期',i===2?'2019-10-01':'2020-10-01','campus-role','role'+i),fact('role'+i+'end','结束日期',i===2?'2020-09-30':'2024-06-30','campus-role','role'+i)]),
 fact('father','姓名','合成父亲','family','father'),fact('fatherrelation','与本人关系','父亲','family','father'),fact('mother','姓名','合成母亲','family','mother'),fact('motherrelation','与本人关系','母亲','family','mother')
]};
(async()=>{
 const browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage();await page.route('https://fixture.invalid/**',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto('https://fixture.invalid/moka');
  for(const file of ['assets/form-adapters.js','assets/form-engine.js','browser-extension/filling-aliases.js','browser-extension/filling-core.js'])await page.addScriptTag({path:path.resolve('app',file)});
  const state=await page.evaluate(async pack=>{const C=TouDiFillingCore,p=C.profile(C.validatePack(pack),'general'),scan=await TouDiFormEngine.scan(),placement=C.allocateRecords(p,scan),plan=C.plan(p,scan,{},new Date(),{},placement.bindings);return {p,scan,placement,plan}},pack);
  const {scan,plan,placement}=state,r=(label,record)=>plan.rows.find(r=>r.label===label && (!record || r.recordBinding?.recordId===record));
  assert.equal(scan.repeatables.length,4);assert(scan.repeatables.every(s=>s.addStatus==='ready'),'nested title/add must share each full section');
  assert(plan.groups.filter(g=>g.module==='education' || g.module==='internship').every(g=>g.status==='bound'),'annotation cannot break a whole record');
  assert.deepEqual(['开始年份','开始月份','结束年份','结束月份'].map(p=>r('起止时间 · '+p).value),['2023','9','2024','6']);
  assert.equal(r('项目描述').value,fullIntern);assert.equal(r('证明人及联系方式').value,'合成联系人，00000000000');assert(r('证明人及联系方式').sensitive);
  assert.equal(r('是否全日制','m').value,'是');assert.equal(r('是否最高学历','b').value,'否');assert.equal(r('是否第一学历','m').value,'否');assert.equal(r('是否第一学历','b').value,'是');
  assert.equal(r('在校成绩（GPA及排名）','m').value,'GPA：4.2（满分 5）；排名：2/60');assert.equal(r('在校担任职务','b').value,'学习委员；团组织委员；学习部干事');assert.equal(r('在校担任职务','m').status,'missing','no undergraduate roles in master record');
  assert.equal(r('取得证书').value,'大学英语四级；大学英语六级');assert.equal(r('英语').status,'missing');assert.equal(placement.modules.find(m=>m.module==='language').missing.length,0,'two certificates do not create two ability cards');
  assert.equal(placement.modules.find(m=>m.module==='family').missing.length,1,'one empty family slot allocates one source record');
  assert.equal(r('自我描述').value,'原始自我评价全文。');assert.equal(r('出生日期 (年龄)').value,'2001-01');
  const decision=await page.evaluate(state=>{const C=TouDiFillingCore,scan=structuredClone(state.scan),field=scan.fields.find(f=>f.label==='英语');field.options=[{value:'熟练',text:'熟练'},{value:'流利',text:'流利'},{value:'普通',text:'普通'}];const request=C.agentRequest(state.p,scan,state.plan);if(request.fields.find(f=>f.id===field.id)?.factKeys.length!==6)throw Error('all same-language sources required');const mappings=C.safeAgentMappings(state.p,scan,{[field.id]:'c6type'},state.placement.bindings);const option={factKey:'c6type',optionValue:'普通',reason:'合成受控决策',sourceKeys:['c6type','c6score']};const decisions=C.safeAgentDecisions(state.p,scan,{[field.id]:option},mappings.accepted,state.placement.bindings);return {plan:C.plan(state.p,scan,mappings.accepted,new Date(),decisions.accepted,state.placement.bindings),accepted:decisions.accepted,id:field.id}},state);
  assert(decision.accepted[decision.id]);assert.equal(decision.plan.rows.find(r=>r.fieldId===decision.id).optionValue,'普通');
  const result=await page.evaluate(plan=>TouDiFormEngine.apply(TouDiFillingCore.confirm(plan,plan.rows.filter(r=>r.status==='ready').map(r=>r.fieldId))),plan);
  assert.equal(result.summary.failed || 0,0,JSON.stringify(result));assert.equal(result.summary.verified,plan.statusCounts.ready,JSON.stringify(result));
  assert.equal(await page.evaluate(()=>regionConfirms),1);assert.equal(await page.evaluate(()=>submits),0);
  assert.equal(await page.locator('textarea').first().inputValue(),fullIntern);assert.equal(await page.locator('.sd-Dropdown-dropdown-fixture:not([hidden])').count(),0,'all menus close with real pointer-down dismissal');
  const again=await page.evaluate(async state=>{const C=TouDiFillingCore,s=await TouDiFormEngine.scan();return C.plan(state.p,s,{},new Date(),{},state.placement.bindings)},state);
  assert(again.rows.filter(r=>plan.rows.some(first=>first.fieldId===r.fieldId && first.status==='ready')).every(r=>r.status==='already'),JSON.stringify(again.rows.filter(r=>r.status!=='already')));
  // A mismatched employer must remain blocked, unlike a department annotation.
  await page.locator('input[value="合成公司(研发部)"]').fill('另一家合成公司');
  const conflict=await page.evaluate(async state=>TouDiFillingCore.bindRecordGroups(state.p,await TouDiFormEngine.scan()),state);assert.equal(conflict.find(g=>g.module==='internship').status,'conflict');
  console.log('PASS Moka full flow: canonical sections, split dates with checkbox, annotation binding, full original descriptions, composed fields, language ability scope, structured option decisions, committed region, month/day pickers, readback, repeat safety and no submission');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
