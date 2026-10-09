'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const item=(label,control)=>`<div class="ant-form-item"><div class="ant-form-item-label"><label>${label}</label></div><div>${control}</div></div>`;
const select=(id)=>`<div class="ant-select"><div role="combobox" id="${id}" class="ant-select-selection" aria-controls="menu-${id}" style="height:30px"><div class="ant-select-selection-selected-value"></div></div></div>`;
const fixture=`<form><div class="form-cell"><div class="tit-wrap"><p>个人基本信息</p></div><div class="form-cell-inner">${item('最高学历毕业院校',select('highest'))}${item('第一学历毕业院校','<input class="ant-input" placeholder="请选择第一学历毕业院校">')}${item('第一学历专业','<input class="ant-input" placeholder="请选择第一学历专业">')}</div></div><div class="form-cell"><div class="tit-wrap"><p>教育背景</p></div><div class="form-cell-inner">${item('学校名称',select('school'))}${item('学历',select('degree'))}${item('专业','<input class="ant-input" placeholder="请选择专业">')}</div></div><button type="submit">提交</button></form>`;
let browser;
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://synthetic.invalid/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:fixture}));await page.goto('https://synthetic.invalid/form');
  await page.evaluate(()=>{
    window.submits=0;window.confirms=0;window.openCount=0;window.duplicates=false;window.linkConflict=false;
    document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++;});
    const choices={highest:['合成研究生大学'],school:['合成研究生大学'],degree:['硕士研究生']};
    for(const box of document.querySelectorAll('[role="combobox"]')){
      const menu=document.createElement('div');menu.id=box.getAttribute('aria-controls');menu.style.display='none';menu.innerHTML=choices[box.id].map(v=>`<div role="option">${v}</div>`).join('');document.body.append(menu);
      box.onclick=()=>{for(const n of document.querySelectorAll('[role="option"]'))n.parentElement.style.display='none';menu.style.display='block';};
      for(const option of menu.children)option.onclick=()=>{
        const live=document.getElementById(box.id),replacement=live.cloneNode(true);replacement.querySelector('.ant-select-selection-selected-value').textContent=option.textContent;replacement.onclick=live.onclick;live.replaceWith(replacement);menu.style.display='none';
        if(box.id==='highest'){
          document.querySelector('#school .ant-select-selection-selected-value').textContent=window.linkConflict?'不同学校':'合成研究生大学';
          document.querySelector('#degree .ant-select-selection-selected-value').textContent='硕士研究生';
        }
      };
      box.onkeydown=e=>{if(e.key==='Escape')menu.style.display='none';};
    }
    for(const input of document.querySelectorAll('input.ant-input'))input.onclick=()=>{
      window.openCount++;const kind=/专业/.test(input.placeholder)?'专业':'学校',layer=document.createElement('div');layer.className='ant-modal-wrap school-wrap';layer.setAttribute('role','dialog');
      layer.innerHTML=`<div class="school-form"><div class="tit">请选择${kind}：</div><div class="search-bar"><input placeholder="请输入${kind}名称"></div><div class="school-list"></div></div><div class="ant-modal-footer"><button type="button">取消</button><button type="button">选择</button></div>`;document.body.append(layer);
      let picked='';const search=layer.querySelector('.search-bar input');
      if(kind==='学校')search.oninput=()=>setTimeout(()=>{
        const list=layer.querySelector('.school-list');list.innerHTML=(window.duplicates?['合成本科学院','合成本科学院']:['合成本科学院','合成本科学院分校']).map(v=>`<span class="school-item">${v}</span>`).join('');
        for(const option of list.children)option.onclick=()=>{list.querySelectorAll('.active').forEach(n=>n.classList.remove('active'));option.classList.add('active');picked=option.textContent;};
      },180);
      if(kind==='专业')setTimeout(()=>{
        const tree=document.createElement('div');tree.className='subject-wrap';tree.innerHTML='<div class="subject-item">类别甲类</div><div class="subject-item">类别乙类</div>';layer.querySelector('.school-form').append(tree);
        for(const category of tree.children)category.onmouseover=e=>{
          if(e.target!==category)return;
          layer.querySelectorAll('.subject-item-children').forEach(n=>n.remove());const child=document.createElement('div');child.className='subject-item-children';
          child.innerHTML=(category.firstChild.textContent==='类别甲类'?['合成设计','合成其他专业']:window.duplicates?['合成设计']:['其他']).map(v=>`<label class="ant-radio-wrapper"><input type="radio" name="directory-choice" value="[object Object]">${v}</label>`).join('');category.append(child);
          child.querySelectorAll('input').forEach(n=>n.onclick=e=>{e.stopPropagation();picked=n.parentElement.textContent;});
        };
      },180);
      const buttons=layer.querySelectorAll('.ant-modal-footer button');buttons[0].onclick=()=>layer.remove();buttons[1].onclick=()=>{if(picked){window.confirms++;const replacement=input.cloneNode();replacement.value=kind==='专业'?picked+'(类别甲类)':picked;replacement.onclick=input.onclick;input.replaceWith(replacement);layer.remove();}};
    };
  });
  for(const file of ['assets/form-adapters.js','assets/form-engine.js'])await page.addScriptTag({path:path.resolve('app',file)});
  const output=await page.evaluate(async()=>{
    const E=TouDiFormEngine,scan=await E.scan(),values={'最高学历毕业院校':'合成研究生大学','第一学历毕业院校':'合成本科学院','第一学历专业':'合成设计','学校名称':'合成研究生大学','学历':'硕士研究生','专业':'合成设计学'};
    const before=window.openCount,inspect=await E.inspectOptions({fingerprint:scan.fingerprint,fieldIds:scan.fields.filter(f=>/第一学历|^专业$/.test(f.label)).map(f=>f.id)});
    if(window.openCount!==before || document.querySelector('[role="dialog"]'))throw Error('generic inspection opened a directory');
    const report=await E.apply({...scan,actions:scan.fields.map(f=>({fieldId:f.id,value:values[f.label],expectedValue:f.value}))});return {scan,inspect,report,final:await E.scan(),submits:window.submits,confirms:window.confirms};
  });
  assert.equal(output.scan.fields.length,6,JSON.stringify(output.scan));assert(output.scan.fields.every(f=>f.adapter==='ant-select'&&!f.unsupported));assert.equal(output.report.summary.verified,6,JSON.stringify(output.report));assert.equal(output.confirms,3);assert.equal(output.submits,0);assert.equal(output.final.fields.find(f=>f.label==='第一学历毕业院校').value,'合成本科学院');assert.equal(output.final.fields.find(f=>f.label==='专业').value,'合成设计');
  for(const label of ['第一学历毕业院校','第一学历专业']){
    const report=await page.evaluate(async label=>{window.duplicates=true;const E=TouDiFormEngine,scan=await E.scan(),field=scan.fields.find(f=>f.label===label);return E.apply({...scan,actions:[{fieldId:field.id,value:label.includes('专业')?'合成设计':'合成本科学院',expectedValue:field.value,overwrite:true}]});},label);
    assert.equal(report.results[0].reason,'option-not-unique',label);assert.equal(await page.locator('[role="dialog"]').count(),0);
  }
  const conflict=await page.evaluate(async()=>{window.duplicates=false;window.linkConflict=true;document.querySelector('#highest .ant-select-selection-selected-value').textContent='';document.querySelector('#school .ant-select-selection-selected-value').textContent='';const E=TouDiFormEngine,scan=await E.scan(),fields=scan.fields.filter(f=>['最高学历毕业院校','学校名称'].includes(f.label));return E.apply({...scan,actions:fields.map(f=>({fieldId:f.id,value:'合成研究生大学',expectedValue:f.value}))});});
  assert.equal(conflict.summary.verified,1);assert.equal(conflict.summary.conflict,1);assert.equal(conflict.results[1].reason,'value-changed');assert.equal(await page.locator('#school .ant-select-selection-selected-value').innerText(),'不同学校');assert.deepEqual(errors,[]);
  console.log('PASS Ant directories: remounted select readback, linked matching fields retained, conflicting linked values protected, input-looking school/major modal search and tree selection, explicit confirm, duplicate school/major rejected and cancelled, no generic modal inspection, zero submit and page errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
