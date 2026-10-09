'use strict';
// Synthetic copy of the public Phoenix interaction contract, no applicant data.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
let pw;try{pw=require('playwright')}catch(_){pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
let browser;
(async()=>{
 browser=await pw.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<style>.form-item{padding:15px}.phoenix-select{padding:8px}.common-unmodeled-layer{position:fixed;top:20px;right:10px;background:white;padding:10px;z-index:10}svg{width:18px;height:18px}.phoenix-button__wraper{padding:8px}</style><section><h2>个人信息</h2><div class="ux-standard-form">${['民族','现居住地'].map((label,i)=>`<div class="form-item form-item--phoenix"><div class="form-item__title"><span class="form-item__text">${label}</span></div><div class="phoenix-select" data-region="${i}"><div class="phoenix-select__content"></div><input class="phoenix-select__input" readonly></div></div>`).join('')}</div></section>`);
 await page.evaluate(()=>{
  window.confirmations=0;window.originalRows=[];window.replacedRows=0;window.failSelection=false;
  const close=()=>{document.querySelectorAll('.common-unmodeled-layer').forEach(n=>n.remove());document.querySelectorAll('.phoenix-select').forEach(n=>n.classList.remove('phoenix-select--active'))};
  document.querySelectorAll('.form-item__title').forEach(n=>n.onmousedown=close);
  document.querySelectorAll('.phoenix-select').forEach(select=>select.onclick=()=>{
   close();select.classList.add('phoenix-select--active');const area=select.dataset.region==='1',label=area?'示例市':'合成民族甲',layer=document.createElement('div');layer.className='common-unmodeled-layer';document.body.append(layer);let picked='';
   const rows=document.createElement('div');rows.className=area?'area-selector-container':'constant-main-selector-container';rows.innerHTML='<div class="'+(area?'area-search-input':'content-search')+'"><input></div>';layer.append(rows);
   const footer=document.createElement('div');footer.className=area?'area-footer-button':'selector-footer-button';footer.innerHTML='<div class="phoenix-button"><div class="phoenix-button__wraper">取消</div></div><div class="phoenix-button"><div class="phoenix-button__wraper">确定</div></div>';layer.append(footer);
   function render(selected){const old=rows.querySelector('.list-item-container,.area-item-container');if(old){old.remove();replacedRows++;}const row=document.createElement('div');row.className=area?'area-item-container':'list-item-container';row.innerHTML='<span class="icon-container"><svg class="'+(selected?'RadioChecked':'RadioUnchecked')+'"><path d="M0 0L10 10"></path></svg></span><span class="'+(area?'area-text-label':'item-text-label')+'">'+label+'</span>'+(area?'<span class="area-item-path">示例省</span>':'');rows.append(row);row.querySelector('svg').onclick=()=>{originalRows.push(row);if(!failSelection)setTimeout(()=>{picked=label;render(true)},60)};}
   render(false);footer.querySelectorAll('.phoenix-button__wraper').forEach(button=>button.onclick=()=>{if(button.textContent==='确定'){confirmations++;setTimeout(()=>select.querySelector('.phoenix-select__content').textContent=picked,180)}close()});
  });
 });
 for(const file of ['form-adapters.js','form-engine.js'])await page.addScriptTag({path:path.join(__dirname,'../app/assets',file)});
 let scan=await page.evaluate(()=>TouDiFormEngine.scan());let result=await page.evaluate(scan=>TouDiFormEngine.apply({protocol:1,origin:scan.origin,path:scan.path,fingerprint:scan.fingerprint,actions:scan.fields.map(f=>({fieldId:f.id,value:f.label==='民族'?'合成民族甲':'示例省示例市',expectedValue:''}))}),scan);
 assert.equal(result.summary.verified,2,JSON.stringify(result));assert.deepEqual(await page.evaluate(()=>({confirmations,replacedRows,detached:originalRows.every(n=>!n.isConnected),menus:document.querySelectorAll('.common-unmodeled-layer').length})),{confirmations:2,replacedRows:2,detached:true,menus:0});
 await page.evaluate(()=>{failSelection=true;document.querySelector('.phoenix-select__content').textContent=''});scan=await page.evaluate(()=>TouDiFormEngine.scan());result=await page.evaluate(scan=>TouDiFormEngine.apply({protocol:1,origin:scan.origin,path:scan.path,fingerprint:scan.fingerprint,actions:[{fieldId:scan.fields[0].id,value:'合成民族甲',expectedValue:''}]}),scan);assert.equal(result.results[0].reason,'option-not-selected');assert.equal(await page.evaluate(()=>confirmations),2,'A failed selection never commits a blank option');assert.deepEqual(errors,[]);
 console.log('PASS remounted Phoenix constant/area rows, asynchronous selected state, inner confirm, delayed retained value, cancellation on failed selection and no blank commit');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>browser?.close());
