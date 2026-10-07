'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
let pw;try{pw=require('playwright')}catch{pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
let browser;
(async()=>{
 browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();
 await page.route('http://synthetic.test/**',r=>r.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><form><div class="section-title">教育经历</div><div><div class="question-title">学校名称</div><div><div><div><input id="school" value="合成学校"></div></div></div></div><div><div class="question-title">专业</div><div><div><div><input disabled id="locked"></div></div></div></div></form>`}));
 await page.goto('http://synthetic.test/app?private=not-for-model');
 await page.addScriptTag({path:path.resolve(__dirname,'../app/assets/form-adapters.js')});await page.addScriptTag({path:path.resolve(__dirname,'../app/assets/form-engine.js')});
 const scan=hints=>page.evaluate(h=>TouDiFormEngine.scan({structureHints:h}),hints||{});
 const base=await scan(),f=base.fields.find(x=>x.unsupported==='unlabeled');assert(f);assert.equal(f.value,'合成学校');assert.equal(base.structure.candidates.length,1);
 assert(!JSON.stringify(base.structure).includes('合成学校'));assert(!JSON.stringify(base.structure).includes('not-for-model'));
 const c=base.structure.candidates[0];assert.equal(c.labels[0].text,'学校名称');assert.equal(c.groups[0].text,'教育经历');
 const hints={[f.id]:{labelId:c.labels[0].id,groupId:c.groups[0].id}}, adapted=await scan(hints),a=adapted.fields.find(x=>x.id===f.id);
 assert.equal(adapted.structure.fingerprint,base.structure.fingerprint);assert.deepEqual(adapted.structure.applied,[f.id]);assert.equal(a.label,'学校名称');assert.equal(a.module,'education');assert.equal(a.unsupported,undefined);assert.equal(a.value,f.value);assert.notEqual(adapted.fingerprint,base.fingerprint);
 const result=await page.evaluate(({s,f})=>TouDiFormEngine.apply({origin:s.origin,path:s.path,fingerprint:s.fingerprint,actions:[{fieldId:f.id,expectedValue:f.value,value:'另一合成学校',overwrite:true}]}),{s:adapted,f:a});assert.equal(result.summary.verified,1);
 const next=await scan(hints);assert.equal(next.structure.fingerprint,base.structure.fingerprint);assert.equal(next.fields.find(x=>x.id===f.id).value,'另一合成学校');
 for(const h of [{labelId:'arbitrary'}, {selector:'#school'}, {}, {labelId:c.labels[0].id,script:'anything'}, {labelId:''}]){const s=await scan({[f.id]:h});assert.deepEqual(s.structure.applied,[]);assert.deepEqual(s.structure.rejected,[f.id]);}
 const reset=await scan();assert.equal(reset.fields.find(x=>x.id===f.id).label,'');
 console.log('PASS structure candidates: nearby titles only, no values/query, fixed IDs/fingerprint, whitelisted hints, disabled exclusion, fill/readback and rejection');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close()});
