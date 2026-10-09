'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const C=require('../app/browser-extension/filling-core.js'),L=require('../app/browser-extension/profile-library.js');
const facts=[];
function record(module,id,label,entries){for(const [label2,value] of entries)facts.push({key:id+'.'+label2,module,recordId:id,recordLabel:label,recordHint:label,label:label2,value});}
record('personal','self','本人',[['姓名','合成本人'],['手机','13800001001'],['紧急联系人姓名','合成母亲'],['紧急联系人手机','13800001003'],['紧急联系人单位','合成乙单位'],['紧急联系人职务','合成乙职务'],['紧急联系人关系','母亲']]);
record('family','father','父亲',[['姓名','合成父亲'],['与本人关系','父亲'],['手机','13800001002'],['工作单位','合成甲单位'],['职务','合成甲职务'],['工作所在地','合成甲城市'],['出生日期','1970-01-01']]);
record('family','mother','母亲',[['姓名','合成母亲'],['与本人关系','母亲'],['手机','13800001003'],['工作单位','合成乙单位'],['职务','合成乙职务'],['工作所在地','合成乙城市'],['出生日期','1971-01-01']]);
record('internship','work','合成工作',[['单位','合成工作单位'],['开始日期','2024-01-01'],['结束日期','2024-06-30'],['证明人','合成证明人'],['证明人电话','13800001004'],['证明人单位及职务','合成工作单位经理']]);
record('language','cet4','四级',[['语种','英语'],['证书类型','大学英语四级'],['考试成绩','500']]);
record('language','cet6','六级',[['语种','英语'],['证书类型','大学英语六级'],['考试成绩','510']]);
const pack=C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],facts,rules:[]}),p=C.profile(pack);
const field=(label,module='personal',groupLabel='个人信息',extra={})=>({id:label,module,groupLabel,label,type:'text',value:'',...extra});
const scan=fields=>({protocol:1,origin:'https://synthetic.test',path:'/form',fingerprint:'synthetic',fields});
for(const [label,want] of [['姓名','合成母亲'],['联系电话','13800001003'],['单位','合成乙单位'],['职务','合成乙职务'],['与本人关系','母亲']]){const row=C.plan(p,scan([field(label,'personal','紧急联系人')])).rows[0];assert.equal(row.status,'ready',JSON.stringify(row));assert.equal(row.value,want);}
assert.equal(C.plan(p,scan([field('紧急联系人联系电话')])).rows[0].value,'13800001003');
assert.equal(C.plan(p,scan([field('联系电话')])).rows[0].value,'13800001001');
assert.equal(C.plan(p,scan([field('姓名','personal','家庭成员')])).rows[0].status,'ambiguous');
assert.equal(C.plan(p,scan([field('父亲姓名')])).rows[0].value,'合成父亲');
assert(pack.facts.filter(f=>f.module==='family').every(f=>f.sensitive));
const familyScan=scan([field('工作单位','family','家庭成员',{groupId:'family'})]),familyPlan=C.plan(p,familyScan,{},new Date(),{},{family:'father'});
assert.equal(familyPlan.rows[0].value,'合成甲单位');assert.equal(C.agentRequest(p,familyScan,familyPlan).allowedFacts.length,0);
const languageScan=scan(['语言类型','证书类型','语言成绩'].map(label=>field(label,'language','语言能力',{groupId:'lang'})));
assert(C.plan(p,languageScan).rows.every(r=>r.status==='ambiguous'));
assert.deepEqual(C.plan(p,languageScan,{},new Date(),{},{lang:'cet6'}).rows.map(r=>r.value),['英语','大学英语六级','510']);
assert.equal(L.recordDraft(pack,'family','father','general').fields.find(f=>f.id==='employer').value,'合成甲单位');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const part=(title,labels)=>'<fieldset><legend>'+title+'</legend>'+labels.map(label=>'<label>'+label+'<input type="text"></label>').join('')+'</fieldset>';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<form>'+part('个人信息',['姓名','联系电话'])+part('紧急联系人',['姓名','联系电话','单位','职务','与本人关系'])+part('家庭成员',['姓名','联系电话','工作单位','职务','工作所在地','出生日期'])+part('家庭成员',['姓名','联系电话','工作单位','职务','工作所在地','出生日期'])+part('实习经历',['单位','开始日期','结束日期','证明人','证明人电话','证明人单位及职务'])+'</form>'}));await page.goto('https://synthetic.test/form');for(const file of ['assets/form-adapters.js','assets/form-engine.js','browser-extension/filling-aliases.js','browser-extension/filling-core.js'])await page.addScriptTag({path:path.resolve('app',file)});
 const result=await page.evaluate(async pack=>{const C=TouDiFillingCore,E=TouDiFormEngine,p=C.profile(C.validatePack(pack)),scan=await E.scan(),cold=C.plan(p,scan),family=cold.groups.filter(g=>g.module==='family');if(family.length!==2)throw Error(JSON.stringify({scan,cold}));const bindings={[family[0].groupId]:'mother',[family[1].groupId]:'father',[cold.groups.find(g=>g.module==='internship').groupId]:'work'},plan=C.plan(p,scan,{},new Date(),{},bindings);if(plan.rows.some(r=>r.status!=='ready'))throw Error(JSON.stringify({scan,plan}));const report=await E.apply(C.confirm(plan,plan.rows.map(r=>r.fieldId))),after=await E.scan();document.querySelector('input').value='原有姓名';const protectedScan=await E.scan(),protectedPlan=C.plan(p,protectedScan,{},new Date(),{},bindings),conflict=protectedPlan.rows[0];return {scan,plan,report,after,conflict,actions:C.confirm(protectedPlan,protectedPlan.rows.filter(r=>r.status==='ready').map(r=>r.fieldId)).actions};},pack);
 assert.equal(result.report.summary.verified,25,JSON.stringify(result.report));for(const row of result.plan.rows)assert.equal(result.after.fields.find(f=>f.id===row.fieldId).value,row.value);assert.equal(result.conflict.status,'conflict');assert(!result.actions.some(a=>a.fieldId===result.conflict.fieldId));console.log('PASS contact context, family whole-record binding, private Agent exclusion, language record binding, 25 native input writes/readbacks, existing-value protection');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
