'use strict';
// Synthetic reproduction of document mouse-down dismissal and overlapping
// exit/mount animations. No recruitment-site code or user data is included.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
let browser;
function fixture(){
 const item=(label,kind)=>`<div class="form-item form-item--phoenix" data-kind="${kind}"><div class="form-item__title"><span class="form-item__text">${label}</span></div><div class="phoenix-select"><span class="phoenix-select__content"></span><input class="phoenix-select__input" readonly></div></div>`;
 document.body.innerHTML='<section><div>实习经历</div><div class="ux-standard-form">'+item('开始时间','month')+item('结束时间','month')+'</div></section><section><div>获奖情况</div><div class="ux-standard-form">'+item('获奖时间','day')+item('获奖级别','select')+item('奖项等级','select')+'</div></section>';
 let current;
 function close(){if(!current)return;const previous=current;current=null;previous.field.querySelector('.phoenix-select').classList.remove('phoenix-select--active');setTimeout(()=>{previous.layer.style.display='none'},120);}
 document.addEventListener('mousedown',event=>{if(current && !current.layer.contains(event.target) && event.target!==current.input)close();});
 document.querySelectorAll('.phoenix-select__input').forEach(input=>input.addEventListener('mousedown',()=>{
  const field=input.closest('.form-item'),layer=document.createElement('div');layer.className='common-unmodeled-layer';layer.style.cssText='position:fixed;top:20px;right:20px;background:white;padding:12px;display:none';document.body.append(layer);current={field,layer,input};field.querySelector('.phoenix-select').classList.add('phoenix-select--active');
  const commit=value=>{field.querySelector('.phoenix-select__content').textContent=value;close();};
  setTimeout(()=>{
   const kind=field.dataset.kind;
   if(kind==='select'){layer.innerHTML='<div class="phoenix-selectList">'+['院校级','省区级','国家级'].map(v=>`<div class="phoenix-selectList__listItem"><span class="phoenix-selectList__singleLabel">${v}</span></div>`).join('')+'</div>';layer.querySelectorAll('.phoenix-selectList__listItem').forEach(n=>n.onclick=()=>commit(n.textContent));}
   if(kind==='month'){layer.innerHTML='<div class="phoenix-date-picker"><div class="phoenix-calendar phoenix-calendar-month-calendar"><span class="phoenix-calendar-month-panel-year-select-content">2026</span>'+Array.from({length:12},(_,i)=>`<a class="phoenix-calendar-month-panel-month">${i+1}月</a>`).join('')+'</div></div>';layer.querySelectorAll('a').forEach(n=>n.onclick=()=>commit('2026-'+String(parseInt(n.textContent)).padStart(2,'0')));}
   if(kind==='day'){layer.innerHTML='<div class="phoenix-date-picker"><div class="phoenix-calendar"><input class="phoenix-calendar-input"></div></div>';layer.querySelector('input').onkeydown=e=>{if(e.key==='Enter')commit(e.target.value)};}
   layer.style.display='block';
  },80);
 }));
}
(async()=>{
 browser=await pw.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage();await page.route('https://fixture.invalid/**',r=>r.fulfill({body:'<meta charset="utf-8"><style>.form-item{display:inline-block;padding:12px}input,.phoenix-select__content{display:block;min-width:120px;min-height:24px}.phoenix-calendar-month-panel-month{display:inline-block;padding:10px}</style>',contentType:'text/html'}));await page.goto('https://fixture.invalid/apply');await page.evaluate(fixture);
 for(const file of ['form-adapters.js','form-engine.js'])await page.addScriptTag({path:path.join(__dirname,'../app/assets',file)});
 const scan=await page.evaluate(()=>TouDiFormEngine.scan()),selectIds=scan.fields.filter(f=>f.adapter==='phoenix-select').map(f=>f.id);
 const inspected=await page.evaluate(r=>TouDiFormEngine.inspectOptions(r),{fingerprint:scan.fingerprint,fieldIds:selectIds});assert(inspected.items.every(i=>i.options.length===3));assert.equal(await page.locator('.common-unmodeled-layer:visible').count(),0,'inspection closes old portals before the next control');
 const actions=scan.fields.filter(f=>f.adapter==='phoenix-date').map(f=>({fieldId:f.id,value:f.label==='开始时间'?'2026-03-25':f.label==='结束时间'?'2026-07-16':'2024-06-30',expectedValue:''}));
 const result=await page.evaluate(r=>TouDiFormEngine.apply(r),{protocol:1,origin:scan.origin,path:scan.path,fingerprint:scan.fingerprint,actions});assert.equal(result.summary.verified,3,JSON.stringify(result));assert.deepEqual(result.results.map(r=>r.actualValue),['2026-03','2026-07','2024-06-30']);assert.equal(await page.locator('.common-unmodeled-layer:visible').count(),0);
 console.log('PASS Phoenix portal sequence: two inspected menus with real mouse-down dismissal and overlapping animations, followed by exact start/end and award-date writes with readback');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
