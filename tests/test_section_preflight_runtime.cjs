'use strict';
// Owned synthetic pages + actual MV3 worker. Never uses the user's browser.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),F=require('./test_record_expansion.cjs');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const definitions=[
 ['employment','工作经历','work',0,[['单位','企业名称']]],
 ['internship','实习经历','work',3,[['单位','企业名称'],['职务','职位名称'],['开始','开始时间'],['结束','结束时间'],['工作职责','工作描述']]],
 ['activity','活动实践','projects',0,[['名称','实践名称']]],
 ['project','项目经验','projects',2,[['名称','项目名称'],['角色','项目职务'],['开始日期','开始时间'],['结束日期','结束时间'],['项目描述','项目描述']]],
 ['campus-role','校内职务','campus-role',3,[['组织名称','组织/团体名称'],['职务','担任职务'],['开始日期','开始时间'],['结束日期','结束时间'],['职责描述','职责和成就']]],
 ['certificate','证书','language',2,[['证书类型','证书名称'],['取得日期','获得时间']]],
 ['exam','英语能力','language',2,[['证书类型','英语证书名称'],['考试成绩','成绩'],['取得日期','获得时间']]]
];
const full='Synthetic full original, including all responsibilities and results.\n'.repeat(20),facts=[];
for(const [module,,,count,labels] of definitions.filter(d=>['internship','project','campus-role'].includes(d[0])))for(let i=0;i<count;i++)for(const [label] of labels)facts.push({key:module+i+label,module,recordId:module+i,recordLabel:'Synthetic '+module+i,label,value:/开始/.test(label)?'2025-05-01':/结束/.test(label)?'2025-08-30':/职责|描述/.test(label)?(module==='campus-role'?full.replaceAll('\n',' '):full):'Synthetic '+module+i+label,profiles:['general']});
for(let i=0;i<2;i++)for(const [label,value] of [['证书类型',i?'大学英语六级考试':'大学英语四级考试'],['语种','英语'],['考试成绩',String(520+i)],['取得日期','2020-07-01']])facts.push({key:'language'+i+label,module:'language',recordId:'language'+i,recordLabel:i?'大学英语六级考试':'大学英语四级考试',label,value,profiles:['general']});
const repo=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'toudi-preflight-')),extension=path.join(temp,'extension');
fs.cpSync(path.join(repo,'app/browser-extension'),extension,{recursive:true});for(const [src,dst] of [['favicon.svg','logo.svg'],['form-engine.js','form-engine.js'],['form-adapters.js','form-adapters.js']])fs.copyFileSync(path.join(repo,'app/assets',src),path.join(extension,dst));
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const worker=path.join(extension,'worker.js');fs.writeFileSync(worker,'const listener=chrome.action.onClicked.addListener.bind(chrome.action.onClicked);chrome.action.onClicked.addListener=fn=>{globalThis.fixtureAction=fn;listener(fn)};\n'+fs.readFileSync(worker,'utf8'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(F.html+'<script>('+F.installFixture.toString()+')('+JSON.stringify({definitions,variant:'ant',zero:req.url!=='/existing'})+');'+(req.url==='/existing'?`const input=document.querySelector('[data-section="1"] input');input.value='Synthetic internship1单位';input.dispatchEvent(new Event('input',{bubbles:true}));`: '')+(req.url!=='/empty'?`document.querySelectorAll('[data-section]').forEach(s=>{const d=document.createElement('details'),summary=document.createElement('summary');summary.textContent=s.querySelector('.tit-wrap').textContent;d.append(summary);s.replaceWith(d);d.append(s);});`:'')+'</script>')});let context;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));context=await pw.chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1360,height:900}});
 const sw=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await sw.evaluate(async facts=>{await init;await chrome.storage.local.set({toudiPrivateProfile:Core.validatePack({schemaVersion:1,profiles:[{id:'general',label:'Synthetic'}],facts,rules:[]}),toudiFillingPreferences:{profile:'general',agentMode:'external',autoAgent:false}})},facts);
 for(const route of ['/empty','/collapsed','/existing']){
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+route);await page.bringToFront();await sw.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await fixtureAction(tab)});
  await page.waitForFunction(()=>document.querySelector('#toudi-floating-host'));let panel;for(let i=0;i<50;i++){panel=page.frames().find(f=>f.url().startsWith('chrome-extension:'));if(panel)break;await new Promise(r=>setTimeout(r,50))}
  await panel.locator('#scanSummary').filter({hasText:'识别到'}).waitFor();assert.equal(await page.locator('.form-cell-inner').count(),route==='/existing'?7:0,'Scan must not create records');if(route!=='/empty')assert.equal(await page.locator('details[open]').count(),0,'Scan must not open scopes');
  assert.match(await panel.locator('#scanSummary').innerText(),/检查并补齐/,JSON.stringify(await panel.evaluate(()=>({scan:state?.scan,expansion:state?.plan?.expansion}))));await panel.locator('#fill').click();await panel.locator('#result .finish').waitFor({timeout:20000}).catch(async error=>{console.error(JSON.stringify(await panel.evaluate(()=>({automation:state?.automation,expansion:state?.plan?.expansion,notice:document.querySelector('#notice')?.textContent,result:document.querySelector('#result')?.textContent}))));throw error;});
  const rows=await page.locator('[data-section]').evaluateAll(sections=>sections.map(s=>({title:s.querySelector('.tit-wrap').textContent,rows:[...s.querySelectorAll('.form-cell-inner')].map(r=>[...r.querySelectorAll('input,textarea')].map(n=>n.value))})));
  rows.forEach((section,i)=>{assert.equal(section.rows.length,route==='/existing'?Math.max(1,definitions[i][3]):definitions[i][3],section.title);for(const record of definitions[i][3]?section.rows:[])assert(record.every(Boolean),section.title+' has an unfilled original field')});
  for(const section of rows.filter(s=>/实习|项目|职务/.test(s.title)))for(const record of section.rows)assert.equal(record.at(-1),/职务/.test(section.title)?full.replaceAll('\n',' '):full,'Full original must be written without shortening');
  assert.equal(await page.evaluate(()=>submissions),0);assert.deepEqual(errors,[]);
  await panel.locator('#fill').click();await panel.locator('#result .finish').filter({hasText:'本次未新增填写'}).waitFor();assert.equal(await page.locator('.form-cell-inner').count(),route==='/existing'?14:12,'Repeat run must not duplicate either certificate representation');
  const report=await sw.evaluate(async()=>{const {toudiLastReport:r}=await chrome.storage.local.get('toudiLastReport');return r});assert.equal(report.submitted,false);assert(report.results.every(r=>!Object.hasOwn(r,'actualValue')));
  await page.close();
 }
 console.log('PASS actual extension: read-only module inventory -> expand -> route empty parallel scopes -> 12 complete records -> exact original readback -> zero duplicate records or submissions');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await context?.close();server.close();fs.rmSync(temp,{recursive:true,force:true})});
