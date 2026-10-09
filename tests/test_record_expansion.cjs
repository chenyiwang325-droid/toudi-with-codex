'use strict';
// Browser plugin not available. Isolated synthetic forms, no user Chrome/profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const C=require('../app/browser-extension/filling-core.js');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const definitions=[
 ['education','教育经历','education',3,[['学校','学校名称'],['开始日期','开始时间'],['结束日期','结束时间'],['专业','专业']]],
 ['internship','实习经历','work',3,[['单位','单位名称'],['开始日期','开始时间'],['结束日期','结束时间'],['职责','实习内容']]],
 ['project','项目经历','projects',2,[['名称','项目名称'],['开始日期','开始时间'],['结束日期','结束时间'],['项目描述','项目描述']]],
 ['campus-role','在校职务','campus-role',3,[['职务','职务'],['开始日期','开始时间'],['结束日期','结束时间'],['职责描述','任职描述']]],
 ['awards','获奖情况','awards',3,[['奖项名称','奖项名称'],['获奖日期','获得时间'],['获奖说明','获奖描述']]],
 ['publications','论文/专著','publications',2,[['论文名称','名称'],['发表日期','发表时间'],['发表刊物','期刊名称']]],
 ['language','证书','language',2,[['语言／证书名称','证书名称'],['取得日期','获得时间']]],
 ['family','家庭情况','family',2,[['姓名','姓名'],['与本人关系','与本人关系'],['工作单位','工作单位']]]
];
const full='合成完整经历原文：背景、职责、本人行动与结果。\n'.repeat(25),facts=[];
for(const [module,,,count,labels]of definitions)for(let i=0;i<count;i++)for(const [label]of labels){const value=/开始/.test(label)?'2025-05-01':/结束/.test(label)?'2025-08-30':/日期/.test(label)?'2024-06-01':/描述|职责|说明/.test(label)?full:'合成'+module+i+label;facts.push({key:module+i+label,module,recordId:module+i,recordLabel:'合成'+module+i,label,value,profiles:['general']});}
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts,rules:[]}));
const html='<meta charset="utf-8"><title>合成整段经历填写</title><style>body{font:14px sans-serif;padding:20px;background:#fafafa}section{padding:16px;border:1px solid #ddd;margin:12px 0}fieldset,.ux-standard-form,.form-cell-inner,[class*=apply-fields-]{padding:12px;margin:8px 0;background:white;border:1px solid #eee}label,.form-item,.ant-form-item,[class*=apply-field-]{display:inline-block;width:46%;padding:6px;vertical-align:top}input,textarea{display:block;width:95%;min-height:24px}textarea{height:70px}.plus{display:flex;gap:6px;cursor:pointer;color:#536770;width:max-content}svg{width:16px;height:16px}</style><form id="form"><h1>合成资料填写</h1><div id="sections"></div><button type="submit">提交申请</button></form>';
function installFixture({definitions,variant,prefilled,limit,noEffect,unsafeButton,zero,defaultSelect}){
 window.addCounts={};window.submissions=0;window.variant=variant;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
 const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const states=definitions.map(([module,title,wire,count,labels])=>({module,title,wire,count,labels,rows:zero?[]:[{values:prefilled&&module==='internship'?{单位名称:'合成internship1单位',实习内容:'已有完整内容，必须保留'}:{}}]}));
 const render=()=>{
  document.querySelector('#sections').innerHTML=states.map((s,i)=>{
   const rows=s.rows.map(row=>{
    const fields=s.labels.map(([,label])=>{const v=escape(row.values[label]||''),control=/<never>/.test(label)?'':/内容|描述/.test(label)?'<textarea>'+v+'</textarea>':'<input value="'+v+'">';
     return variant==='phoenix'?'<div class="form-item form-item--phoenix"><div class="form-item__title"><span class="form-item__text">'+label+'</span></div><div class="phoenix-input">'+control+'</div></div>':variant==='moka'?'<div class="apply-field-fixture"><div class="title-fixture">'+label+'</div>'+control+'</div>':variant==='ant'?'<div class="ant-form-item"><div class="ant-form-item-label"><label>'+label+'</label></div>'+control+'</div>':'<label>'+label+control+'</label>';
    }).join('')+(defaultSelect&&s.module==='internship'?'<label>工作类型<select><option selected>实习</option></select></label>':'');return variant==='phoenix'?'<div><div class="ux-standard-form">'+fields+'</div></div>':variant==='moka'?'<div class="apply-fields-fixture">'+fields+'</div>':variant==='ant'?'<div class="form-cell-inner">'+fields+'</div>':'<fieldset><legend>'+s.title+'</legend>'+fields+'</fieldset>';
   }).join('');
   const disabled=limit && s.rows.length>=limit,add=variant==='phoenix'?'<div><div class="plus" '+(disabled?'aria-disabled="true"':'')+'><svg><path/></svg><span>添加'+s.title+'</span></div></div>':'<button '+(unsafeButton?'':'type="button"')+(disabled?' disabled':'')+'>添加'+s.title+'</button>';
   return '<section class="'+(variant==='moka'?'apply-block-fixture':variant==='ant'?'form-cell':'section')+'" data-section="'+i+'">'+(variant==='moka'?'<div class="blockTitle-fixture"><span class="text-fixture">'+s.title+'</span></div>':variant==='ant'?'<div class="tit-wrap"><p>'+s.title+'</p></div>':'<h2>'+s.title+'</h2>')+'<div>'+rows+add+'</div></section>';
  }).join('');
  document.querySelectorAll('[data-section]').forEach(section=>{
   const s=states[Number(section.dataset.section)],buttons=section.querySelectorAll('button,.plus');
   const values=()=>{s.rows=[...section.querySelectorAll(variant==='phoenix'?'.ux-standard-form':variant==='moka'?'.apply-fields-fixture':variant==='ant'?'.form-cell-inner':'fieldset')].map(record=>({values:Object.fromEntries(s.labels.map(([,l],j)=>[l,record.querySelectorAll('input,textarea')[j].value]))}));};
   section.querySelectorAll('input,textarea').forEach(n=>n.addEventListener('input',values));
   buttons.forEach(button=>button.addEventListener('click',()=>{if(button.disabled||button.getAttribute('aria-disabled')==='true'||noEffect)return;values();window.addCounts[s.module]=(window.addCounts[s.module]||0)+1;setTimeout(()=>{s.rows.unshift({values:{}});render()},35)}));
  });
 };render();
}
let browser;
async function run(variant,options={}){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://fixture.invalid/**',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto('https://fixture.invalid/apply');
 await page.evaluate(installFixture,{definitions,variant,...options});await page.addScriptTag({path:path.resolve(__dirname,'../app/assets/form-adapters.js')});await page.addScriptTag({path:path.resolve(__dirname,'../app/assets/form-engine.js')});
 if(options.savedCards)await page.locator('section').first().evaluate(section=>section.insertAdjacentHTML('beforeend','<article class="record-card"><p>已保存的合成学校</p><button type="button">编辑</button></article>'));
 if(options.lockedRecords)await page.locator('.ux-standard-form').first().evaluate(record=>record.querySelectorAll('input,textarea').forEach(n=>n.disabled=true));
 let scan=await page.evaluate(()=>TouDiFormEngine.scan()),placement=C.allocateRecords(p,scan);
 assert.equal(scan.repeatables.length,8,variant+' catalogs every section exactly once');assert.equal(await page.evaluate(()=>Object.values(addCounts).reduce((n,x)=>n+x,0)),0,'Scan is read-only');
 if(options.unsafeButton){assert(scan.repeatables.every(s=>s.addStatus==='unsupported'));await page.close();return {variant,unsafeRejected:true};}
 if(options.savedCards || options.lockedRecords){const module=placement.modules.find(m=>m.module==='education');assert.equal(module.canAdd,false);assert.equal(module.reason,'saved-records-closed');assert.equal(scan.repeatables.find(s=>s.module==='education').addStatus,'requires-edit');await page.close();return {variant,savedOrLockedBlocked:true};}
 const targets=placement.modules.filter(m=>m.canAdd&&m.missing.length).map(m=>({sectionId:m.sectionId,recordIds:m.missing.map(r=>r.id)}));
 let expanded;try{expanded=await page.evaluate(r=>TouDiFormEngine.expandRecords(r),{fingerprint:scan.fingerprint,bindings:placement.bindings,targets});}catch(e){throw Error(variant+': '+e.message+' '+JSON.stringify({groups:[...new Map(scan.fields.map(f=>[f.groupId,f.module])).entries()],bindings:placement.bindings,sections:scan.repeatables.map(s=>[s.module,s.groupIds])}));}
 assert.equal(expanded.safe,true);scan=expanded.scan;placement=C.allocateRecords(p,scan,expanded.bindings);
 if(options.noEffect){assert(expanded.additions.every(m=>m.reason==='add-no-new-record'));assert.equal(Object.keys(expanded.bindings).length,8);await page.close();return {variant,noEffectHandled:true};}
 const plan=C.plan(p,scan,{},new Date(),{},placement.bindings),selected=plan.rows.filter(r=>r.status==='ready').map(r=>r.fieldId),approved=C.confirm(plan,selected),report=await page.evaluate(a=>TouDiFormEngine.apply(a),approved);
 assert.equal(report.summary.verified,selected.length,JSON.stringify(report.results.filter(r=>r.status!=='verified')));assert.equal(report.summary.failed,0);assert.equal(await page.evaluate(()=>submissions),0);assert.deepEqual(errors,[]);
 for(const row of plan.rows.filter(r=>r.factKey&&r.status==='ready')){const field=scan.fields.find(f=>f.id===row.fieldId);assert.equal(row.recordBinding.recordId,p.facts.find(f=>f.key===row.factKey).recordId);if(/描述|职责|说明/.test(p.facts.find(f=>f.key===row.factKey).label))assert.equal(row.value,full,variant+' full original text');assert.equal(report.results.find(r=>r.fieldId===field.id).actualValue,row.value);}
 if(options.prefilled){const group=plan.groups.find(g=>g.recordId==='internship1');assert(group);assert.equal(plan.rows.find(r=>r.fieldId===group.fieldIds.at(-1)).expectedValue,'已有完整内容，必须保留');}
 if(options.limit){assert(placement.modules.some(m=>m.missing.length&&!m.canAdd));assert(expanded.additions.some(m=>m.reason==='add-disabled'));}
 else assert(placement.modules.every(m=>!m.missing.length),variant+' all source records materialized');
 if(!options.limit)for(const [module,,wire,count]of definitions)assert.equal(plan.groups.filter(g=>g.module===module).length,count,JSON.stringify({variant,module,expected:count,groups:plan.groups.map(g=>[g.module,g.recordId]),initial:expanded.additions}));
 const rescanned=await page.evaluate(()=>TouDiFormEngine.scan()),again=C.allocateRecords(p,rescanned,placement.bindings);assert(again.modules.every(m=>!m.canAdd||!m.missing.length),'Second fill does not add duplicate records');
 const result={variant,groups:plan.groups.length,added:expanded.additions.reduce((n,m)=>n+m.added,0),verified:report.summary.verified,remaining:placement.modules.reduce((n,m)=>n+m.missing.length,0)};
 if(process.env.TOUDI_EXPANSION_EVIDENCE){await page.setViewportSize({width:1240,height:850});await page.screenshot({path:path.join(process.env.TOUDI_EXPANSION_EVIDENCE,'自动补齐-'+variant+(options.limit?'-上限':'')+'.png')});}
 await page.close();return result;
}
module.exports={definitions,facts,full,html,installFixture};
if(require.main===module)(async()=>{browser=await pw.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const results=[];
 for(const variant of ['generic','phoenix','moka','ant'])results.push(await run(variant,{prefilled:true}));
 results.push(await run('phoenix',{limit:2}));results.push(await run('generic',{zero:true}));results.push(await run('generic',{unsafeButton:true}));results.push(await run('generic',{defaultSelect:true}));
 results.push(await run('generic',{savedCards:true}));results.push(await run('phoenix',{lockedRecords:true}));
 // A no-op add control cannot trigger an unbounded loop or fill a fabricated group.
 results.push(await run('phoenix',{noEffect:true}));
 console.log('PASS whole-record expansion / full original readback / no duplicates / reordered reactive DOM / preserved existing groups / no submit',JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close()});
