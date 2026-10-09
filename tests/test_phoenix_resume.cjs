'use strict';
// Isolated synthetic page; no access to the user's Chrome or real application.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const C=require('../app/browser-extension/filling-core.js'),F=require('./phoenix_resume_fixture.cjs');
let pw;try{pw=require('playwright')}catch(_){pw=require(process.env.TOUDI_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const full='合成原始全文：需求、本人工作、交付结果和完整项目说明。\n'.repeat(30),facts=[];
function add(module,id,label,value){facts.push({key:[module,id,label].join('.'),module,recordId:id,recordLabel:'合成'+id,label,value,profiles:['general']})}
function rows(module,id,entries){entries.forEach(([label,value])=>add(module,id,label,value))}
rows('personal','person',[['姓名','示例同学'],['性别','女'],['出生日期','2000-01-01'],['电子邮箱','fixture@example.invalid'],['手机','13800000000'],['证件号码','合成证件号码'],['最高学历','硕士'],['最高学位','硕士'],['现居地','示例城市'],['当前户籍所在地','示例城市'],['政治面貌','群众'],['婚姻状况','未婚'],['民族','汉族'],['籍贯','示例省示例市'],['通讯地址','合成通讯地址'],['紧急联系人姓名','示例联系人'],['紧急联系人手机','13800000001'],['计算机等级证书','合成计算机证书'],['自我评价',full],['期望工作城市','示例城市'],['期望年薪(税前)','合成待遇']]);
for(const id of ['master','bachelor'])rows('education',id,[['具体学制','3年'],['学历',id==='master'?'硕士':'本科'],['开始日期','2024-09-01'],['结束日期','2027-06-30'],['学校','示例'+id+'大学'],['专业','示例专业'],['学历类型','普通全日制'],['GPA','3.8'],['班级排名','前10%'],['年级排名','前10%']]);
for(const id of ['campusA','campusB'])rows('campus-role',id,[['职务','示例'+id+'委员'],['开始日期','2020-10-01'],['结束日期','2024-06-30'],['职责描述',full]]);
for(const id of ['projectA','projectB'])rows('project',id,[['名称','示例'+id+'项目'],['开始日期','2024-12-01'],['结束日期','2025-04-30'],['项目描述',full]]);
for(const id of ['honor','scholarship'])rows('awards',id,[['奖项名称','示例'+id+'奖项'],['获奖日期','2024-06-01'],['获奖说明',full],['获奖级别','校级']]);
for(const id of ['paperA','paperB'])rows('publications',id,[['论文名称','示例'+id+'论文'],['发表日期','2025-05-01'],['发表刊物','示例期刊'],['收录类别','SCI']]);
for(const id of ['workA','workB'])rows('internship',id,[['单位','示例'+id+'单位'],['开始日期','2025-05-01'],['结束日期','2025-08-30'],['职责',full]]);
for(const id of ['cet4','cet6'])rows('language',id,[['语言／证书名称',id==='cet6'?'大学英语六级':'大学英语四级'],['语种','英语'],['证书类型',id==='cet6'?'CET6':'CET4'],['证书种类','英语'],['取得日期','2023-06-17'],['颁发机构','示例考试机构']]);
for(const id of ['familyA','familyB'])rows('family',id,[['姓名','合成'+id+'成员'],['与本人关系',id==='familyA'?'父亲':'母亲'],['工作单位','合成单位'],['职务','合成职务']]);
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成完整资料'}],facts,rules:[]}));let browser;
(async()=>{
 browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://fixture.invalid/**',r=>r.fulfill({body:F.html,contentType:'text/html'}));await page.goto('https://fixture.invalid/apply');
 const options={};for(const f of F.fields){if(['select','modal'].includes(f.type))options[f.key]=({最高学历:['本科','硕士研究生'],最高学位:['学士','硕士'],学历:['本科','硕士研究生'],学习形式:['全日制','非全日制'],现居住地:['示例城市'],户口所在地:['示例城市'],政治面貌:['群众'],民族:['汉族','藏族'],籍贯:['示例省示例市'],期望工作城市:['示例城市'],具体学制:['3年'],班级排名:['前10%'],专业排名:['前10%'],获奖级别:['校级'],学术级别:['国际级','国家级'],证书种类:['英语']})[f.label]||[];}
 await page.evaluate(value=>window.fixtureOptions=value,options);await page.evaluate(F.installControls);
 await page.addScriptTag({path:path.resolve(__dirname,'../app/assets/form-adapters.js')});await page.addScriptTag({path:path.resolve(__dirname,'../app/assets/form-engine.js')});
 const scan=await page.evaluate(()=>TouDiFormEngine.scan());assert.equal(scan.fields.length,65);assert.equal(scan.fields.filter(f=>f.type==='file').length,3);assert(!scan.fields.some(f=>f.label.includes('示例')));
 const groupModules=['education','campus-role','project','awards','publications','internship','language','family'];let plan=C.plan(p,scan);assert.equal(plan.groups.length,8);assert(plan.groups.every(g=>g.status==='unbound'));
 const wanted={education:'master','campus-role':'campusB',project:'projectB',awards:'scholarship',publications:'paperB',internship:'workB',language:'cet6',family:'familyB'};
 const bindings=Object.fromEntries(plan.groups.map(g=>[g.groupId,wanted[g.module]]));plan=C.plan(p,scan,{},new Date(),{},bindings);
 for(const module of groupModules){const group=plan.groups.find(g=>g.module===module);assert.equal(group.recordId,wanted[module]);}
 const projectRow=plan.rows.find(r=>r.label==='实践描述');assert.equal(projectRow.displayValue,full);assert.equal(projectRow.factKey,'project.projectB.项目描述');
 assert.equal(plan.rows.find(r=>r.label==='婚否').optionValue,'否');assert.equal(plan.rows.find(r=>r.label==='学习形式'&&r.module==='personal').value,'普通全日制');assert.equal(plan.rows.find(r=>r.label==='外语等级证书').value,'CET6');
 assert.equal(plan.rows.find(r=>r.label==='学术级别').status,'missing','International/national scope must not be treated as SCI indexing');
 assert.equal(plan.rows.find(r=>r.label==='获得时间').status,'ready');assert.equal(plan.rows.find(r=>r.label==='期刊名称/专利号申请号').value,'示例期刊');
 const ready=plan.rows.filter(r=>r.status==='ready');assert.equal(ready.length,61,JSON.stringify(plan.rows.filter(r=>r.status!=='ready').map(r=>[r.label,r.status,r.reason])));
 const result=await page.evaluate(request=>TouDiFormEngine.apply(request),C.confirm(plan,ready.map(r=>r.fieldId)));assert.equal(result.summary.verified,61,JSON.stringify(result.results.filter(r=>r.status!=='verified').map(r=>({label:scan.fields.find(f=>f.id===r.fieldId)?.label,status:r.status,reason:r.reason}))));assert.equal(result.submitted,false);
 const after=await page.evaluate(()=>TouDiFormEngine.scan());for(const row of ready){const actual=after.fields.find(f=>f.id===row.fieldId).value;assert(actual===row.value||actual===row.optionValue||(['学历','最高学历'].includes(row.label)&&actual==='硕士研究生')||(row.label==='学习形式'&&actual==='全日制'),JSON.stringify({label:row.label,actual,wanted:row.value}));}
 assert.equal(C.plan(p,after,{},new Date(),{},bindings).rows.filter(r=>r.status==='already').length,61);assert.equal(await page.evaluate(()=>fixtureSubmissions),0);assert.equal(await page.evaluate(()=>fixtureSvgPicks),2);assert.deepEqual(errors,[]);
 // Phoenix reuses the same portal DOM node after dismissing its previous owner.
 // A still-visible unowned portal is covered separately as a rejection case.
 let current=await page.evaluate(()=>TouDiFormEngine.scan());
 const highest=current.fields.find(f=>f.label==='最高学历'),degree=current.fields.find(f=>f.label==='最高学位');
 const reused=await page.evaluate(request=>TouDiFormEngine.apply(request),{protocol:1,origin:current.origin,path:current.path,fingerprint:current.fingerprint,submitted:false,actions:[{fieldId:highest.id,value:'本科',expectedValue:highest.value,overwrite:true},{fieldId:degree.id,value:'学士',expectedValue:degree.value,overwrite:true}]});assert.equal(reused.summary.verified,2,JSON.stringify(reused));
 console.log('PASS 65-field Phoenix résumé: all eight experience modules; one explicit record per block; 61 writes/readbacks; complete original bodies; input mouse-down, SVG selection, reused portal; personal references and marriage choice; 3 attachments and academic scope left untouched; zero submissions');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
