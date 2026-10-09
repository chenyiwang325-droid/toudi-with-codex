const el=id=>document.getElementById(id);
const escapeHtml=text=>String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const panelParams=new URLSearchParams(location.search),panelTabId=Number(panelParams.get('tab')),panelToken=panelParams.get('panel');
let state,copyLibrary,activePane='fill',busy=false,filling=false,reviewing=false,scanning=false,hasProfile=false,profileSummary;
let pref=TouDiAgentConfig.normalize();
async function send(op,data={}){const r=await chrome.runtime.sendMessage({op,...data,...(panelToken?{panelTabId,panelToken}:{})});if(r?.error)throw Error(r.error);return r.value;}
function notice(text,error=false){el('notice').hidden=!text;el('notice').textContent=text;el('notice').classList.toggle('error',error);}
async function task(fn,text=''){if(busy)return;busy=true;notice(text);try{await fn();}catch(e){notice(e.message,true);}finally{busy=false;render();}}
function showSync(sync){const message={pending:'资料更新待同步',conflict:'资料同步有冲突，请在设置中核对','workspace-changed':'工作区已变化，请在设置中重新连接'}[sync?.status] || '';el('workspaceSync').hidden=!message;el('workspaceSync').textContent=message;}
function render(){
 const running=filling || state?.automation?.status==='running';
 const checking=reviewing || state?.agentReview?.status==='running' || state?.structureReview?.status==='running';
 el('fill').disabled=running || checking || scanning || !hasProfile || !state?.plan;el('reviewAgent').disabled=running || checking || scanning || !hasProfile || !state?.plan;el('scan').disabled=running || checking || scanning || !hasProfile;el('fillMode').disabled=running || checking || scanning;el('profile').disabled=running || checking || scanning;
 el('reviewAgent').textContent=checking?'核对中…':'Agent 核对';
 el('fill').textContent=running?'正在填写…':'自动填写';
 const progress={reading:'正在读取网页…',preparing:'正在准备填写…',matching:'正在核对对应信息…',writing:'正在填写并检查结果…'}[state?.automation?.phase] || '正在读取网页…';
 el('progress').hidden=!running && !scanning && !checking;el('progress').textContent=scanning?'正在识别网页…':checking?(state?.agentReview?.status==='running'?(state.agentReview.message || '正在核对资料…'):state?.structureReview?.status==='running'?'正在核对网页的板块结构…':'正在准备核对…'):progress;
 const review=state?.agentReview;
 el('reviewResult').hidden=checking || !review || !['completed','failed','skipped'].includes(review.status);
 el('reviewResult').textContent=review?.status==='completed'?'核对完成 · 已匹配 '+(review.accepted || 0)+' 项'+(review.unresolved || review.rejected?' · '+((review.unresolved || 0)+(review.rejected || 0))+' 项未确定':''):review?.status==='failed'?'本次核对未全部完成，已匹配结果保留，可继续填写。':'当前内容已由本地规则匹配，无需模型判断。';
 renderReview(review,checking);
 renderScan();
 const report=state?.report;el('result').hidden=!report || running;
 if(report && !running){
  const failed=(report.results || []).filter(r=>!['verified','skipped'].includes(r.status));
  const pending=(state.pending || []).filter(r=>r.status!=='skipped' && !/至今/.test(r.label));
  const remaining=[...new Map([...failed.map(r=>({...r,...state.labels?.[r.fieldId]})),...pending].filter(r=>r.label).map(r=>[[r.groupLabel,r.label].filter(Boolean).join(' · '),r])).values()];
  const records=report.remainingRecords || [],unresolved=remaining.length || records.length;
  const why=r=>globalThis.TouDiFillingWorkflow?.explain(r.reason,r.status)?.message || r.reason || '可在网页检查或从我的资料复制。';
  el('result').innerHTML=`<div class="finish"><h2>${report.summary?.verified?'已填写 '+report.summary.verified+' 项':'本次未新增填写'}</h2><p>${unresolved?'仍有未完成内容，展开查看原因。':report.summary?.verified?'已读回检查，请在网页核对。':'已有内容与资料一致。'}</p>${unresolved?`<details class="remaining"><summary>未完成的内容</summary><ul>${remaining.map(r=>`<li><button class="text-button" data-fallback-label="${escapeHtml(r.label)}">${escapeHtml([r.groupLabel,r.label].filter(Boolean).join(' · '))}</button><p class="remaining-reason">${escapeHtml(why(r))}</p></li>`).join('')}${records.map(r=>`<li><strong>${escapeHtml(r.label)} · 尚缺 ${r.count} 段</strong><p class="remaining-reason">${escapeHtml(why(r))}</p></li>`).join('')}</ul></details>`:''}${report.warnings?.some(w=>w.code==='continuation-limit')?`<p class="remaining-reason">${escapeHtml(why({reason:'continuation-limit'}))}</p>`:''}</div>`;
 }
}
el('settings').addEventListener('click',()=>send('settings').catch(e=>notice(e.message,true)));
el('importStart').addEventListener('click',()=>send('settings').catch(e=>notice(e.message,true)));
el('openWorkbench').addEventListener('click',()=>send('open-workbench').catch(e=>notice(e.message,true)));
el('profile').addEventListener('change',()=>task(async()=>{pref=await send('preferences',{preferences:{profile:el('profile').value}});state=null;copyLibrary=null;if(activePane==='library')await loadCopyLibrary();await scanPage();}));
el('fillMode').addEventListener('change',render);
const scanModuleNames={personal:'个人信息',education:'教育经历',work:'工作实习',internship:'工作实习',projects:'项目经历',project:'项目经历','campus-role':'在校经历',awards:'荣誉获奖',publications:'论文发表',language:'语言与证书',family:'家庭成员',contact:'联系人',other:'其他内容'};
let reviewRenderKey='';
function renderReview(review,checking){
 const items=review?.items || [];
 el('reviewDetails').hidden=checking || !items.length;
 if(checking || !items.length)return;
 el('reviewDetailsSummary').textContent='查看核对结果 · '+items.length+' 项';
 const key=JSON.stringify(items);if(key===reviewRenderKey)return;reviewRenderKey=key;
 const groups=new Map();for(const item of items){const name=scanModuleNames[item.module] || item.groupLabel || '其他内容';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(item);}
 el('reviewItems').innerHTML=[...groups].map(([name,list])=>`<section class="review-module"><h3>${escapeHtml(name)}</h3>${list.map(item=>{
  const matched=item.status==='matched',fillable=['ready','conflict','already'].includes(item.resultStatus);
  const status=matched?(fillable?'已采用':'已匹配 · 待手填'):item.status==='rejected'?'未采用':'未确定';
  return `<div class="review-item"><div class="review-item-heading"><strong>${escapeHtml(item.label)}</strong><span>${status}</span></div>${matched?`<p class="review-value">${item.selectedOption?'选择：':'填写：'}${escapeHtml(item.displayValue)}</p><p class="review-source">资料：${escapeHtml(item.factLabel)}</p>`:''}${item.reason?`<p class="review-reason">${escapeHtml(item.reason)}</p>`:''}</div>`;
 }).join('')}</section>`).join('');
}
function renderScan(){
 const rows=state?.plan?.rows || [];
 if(scanning){el('scanSummary').innerHTML='<p>正在识别网页中的填写内容…</p>';return;}
 if(!state?.plan){el('scanSummary').innerHTML='<p>先识别网页，再填写对应资料。</p>';el('scanGroups').replaceChildren();return;}
 const canFill=r=>r.status==='ready' || el('fillMode').value!=='empty' && r.status==='conflict';
 const available=rows.filter(canFill).length,already=rows.filter(r=>r.status==='already').length;
 el('scanSummary').innerHTML=`<strong>识别到 ${rows.length} 项</strong><p>可填写 ${available} 项${already?' · 已一致 '+already+' 项':''}</p>`;
 const modules=new Map();
 for(const row of rows){const module=row.recordBinding?.module || row.module || 'other',name=scanModuleNames[module] || row.groupLabel || '其他内容';if(!modules.has(name))modules.set(name,[]);modules.get(name).push(row);}
 el('scanGroups').innerHTML=[...modules].map(([name,items])=>{
  const n=items.filter(canFill).length,matched=items.filter(r=>r.status==='already').length;
  const groups=new Map();for(const row of items){const key=row.recordBinding?.groupId || row.groupLabel || name;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return `<details class="scan-module"><summary><strong>${escapeHtml(name)}</strong><span>${n?'可填 '+n+' 项':matched?'已一致 '+matched+' 项':'暂未匹配'}</span></summary>${[...groups.values()].map(list=>{const title=list[0].recordBinding?.recordLabel || list[0].groupLabel || '';const labels=status=>[...new Set(list.filter(status).map(r=>r.label))].filter(Boolean).join('、');const ready=labels(canFill),equal=labels(r=>r.status==='already'),other=labels(r=>!canFill(r) && r.status!=='already' && r.status!=='skipped');return `<div class="scan-record">${groups.size>1 && title?`<h3>${escapeHtml(title)}</h3>`:''}${ready?`<p class="scan-ready">可填写：${escapeHtml(ready)}</p>`:''}${equal?`<p>已一致：${escapeHtml(equal)}</p>`:''}${other?`<p>未匹配：${escapeHtml(other)}</p>`:''}</div>`;}).join('')}</details>`;
 }).join('');
}
async function scanPage(){
 if(scanning || filling || reviewing || state?.automation?.status==='running')return;
 scanning=true;notice('');render();
 try{const next=await send('scan',{profile:el('profile').value,resume:true});state=next;showSync(next.sync);}
 catch(e){state=null;notice(e.message,true);}
 finally{scanning=false;render();}
}
el('scan').addEventListener('click',()=>scanPage());
el('reviewAgent').addEventListener('click',async()=>{
 if(reviewing || filling || scanning || !state?.plan)return;
 reviewing=true;notice('');render();
 try{state=await send('agent-review',{profile:el('profile').value});if(state.agentError)notice(state.agentError,true);}
 catch(e){notice(e.message,true);try{state=(await send('state')).state;}catch(_){} }
 finally{reviewing=false;render();}
});
async function browseLibrary(label=''){setPane('library');if(!copyLibrary)await loadCopyLibrary();el('copySearch').value=label;renderCopyLibrary();el('copyRecords').scrollTop=0;}
el('browseFallback').addEventListener('click',()=>task(()=>browseLibrary()));
el('result').addEventListener('click',event=>{const button=event.target.closest('[data-fallback-label]');if(button)task(()=>browseLibrary(button.dataset.fallbackLabel));});
el('fill').addEventListener('click',async()=>{
 if(filling || reviewing || state?.agentReview?.status==='running' || state?.automation?.status==='running')return;
 filling=true;state=null;notice('');render();
 try{state=await send('auto-fill',{profile:el('profile').value,mode:el('fillMode').value});notice('');}
 catch(e){notice(e.message,true);try{state=(await send('state')).state;}catch(_){} }
 finally{filling=false;render();}
});
const automationPoll=setInterval(async()=>{if(!filling && !reviewing && state?.automation?.status!=='running' && state?.agentReview?.status!=='running' && state?.structureReview?.status!=='running')return;try{const next=(await send('state')).state;if(next){state=next;render();}}catch(_){}},800);
window.addEventListener('unload',()=>clearInterval(automationPoll));
const copyModuleLabels={personal:'个人信息',education:'教育经历',internship:'工作实习',project:'项目经历','campus-role':'在校经历',awards:'荣誉获奖',publications:'论文发表',language:'语言能力',family:'家庭成员',contact:'联系人'};
const profileView=TouDiProfileView;
let copySection='',copyScrollFrame=0,copyFeedbackTimer=0;
function personalSection(fact){
 return profileView.personalCategory({...fact,module:'personal'});
}
function librarySections(){
 const all=copyLibrary?.records || [],sections=[];
 const personalFacts=all.filter(record=>record.module==='personal').flatMap(record=>record.facts.map(fact=>({...fact,module:'personal'})));
 for(const group of profileView.factGroups('personal',personalFacts)){
  const {id,label,facts}=group;
  sections.push({id:'personal:'+id,label,personal:true,reference:id==='supplement',records:[{id:'personal:'+id,title:label,facts}]});
 }
 const modules=[...Object.keys(copyModuleLabels).filter(id=>id!=='personal'),...new Set(all.map(record=>record.module).filter(id=>!copyModuleLabels[id]))];
 for(const id of modules){
  const records=all.filter(record=>record.module===id);if(!records.length)continue;
  if(id==='awards')for(const group of profileView.awardGroups(records))sections.push({id:'awards:'+group.id,label:group.label,awards:true,records:group.records});
  else sections.push({id,label:copyModuleLabels[id] || id,records});
 }
 return sections;
}
function setPane(pane){
 activePane=pane;document.body.classList.toggle('library-active',pane==='library');el('fillPane').hidden=pane!=='fill';el('copyLibrary').hidden=pane!=='library';
 for(const [id,name] of [['tabFill','fill'],['tabLibrary','library']]){el(id).setAttribute('aria-selected',String(name===pane));el(id).tabIndex=name===pane?0:-1;}
 if(pane==='library')requestAnimationFrame(updateCopyLocation);
 if(panelToken && parent!==window)parent.postMessage({type:'toudi-panel-pane',pane},'*');
}
async function loadCopyLibrary(){
 const profile=el('profile').value;copyLibrary=await send('copy-library',{profile,localOnly:true});renderCopyLibrary();notice('');
 // Show the local copy immediately. A cold native host must not leave the
 // floating window empty or disable all browsing controls while synchronizing.
 send('profile-sync',{background:true}).then(async sync=>{showSync(sync);const value=await send('copy-library',{profile,localOnly:true});if(el('profile').value===profile && copyLibrary?.sourceVersion!==value.sourceVersion){const top=el('copyRecords').scrollTop;copyLibrary=value;renderCopyLibrary();el('copyRecords').scrollTop=top;}}).catch(()=>{});
}
function copyFactMarkup(fact){
 const value=String(fact.value),label=profileView.fieldLabel(fact),long=value.length>140;
 const width=(text,ascii,wide)=>[...text].reduce((n,c)=>n+(/[\x00-\xff]/.test(c)?ascii:wide),0);
 const narrative=profileView.narrative(fact),short=!narrative && !/@|https?:\/\//.test(value) && label.length<=10 && value.length<=24 && width(label,5.5,10)+width(value,6.5,12)<=123;
 return `<div class="copy-fact${short?' compact':narrative?' full-width':' inline'}${narrative?' copy-narrative':''}"><strong title="${escapeHtml(fact.label)}">${escapeHtml(label)}</strong><button class="copy-value${long?' collapsed':''}" data-copy-fact="${escapeHtml(fact.key)}" aria-label="复制${escapeHtml(label)}完整内容">${escapeHtml(value)}</button>${long?'<button class="expand-value" aria-expanded="false">展开全文</button>':''}</div>`;
}
function copyRecordMarkup(record,section){
 const name=section.personal?null:profileView.nameFact(record);
 const heading=section.personal?'':`<h3 class="copy-record-title">${name?`<button class="copy-value copy-record-name" data-copy-fact="${escapeHtml(name.key)}" aria-label="复制${escapeHtml(name.label)}完整内容" title="点击复制${escapeHtml(name.label)}">${escapeHtml(record.title)}</button>`:escapeHtml(record.title)}</h3>`;
 const facts=record.facts.filter(f=>f!==name);
 const body=section.personal?`<div class="copy-facts">${facts.map(copyFactMarkup).join('')}</div>`:profileView.factGroups(record.module,facts).map(group=>`<div class="copy-field-group" data-copy-group="${group.id}">${group.id==='detail'?'<h4>详细内容</h4>':''}<div class="copy-facts">${group.facts.map(copyFactMarkup).join('')}</div></div>`).join('');
 return `<article class="copy-record" data-copy-record-id="${escapeHtml(record.id)}">${heading}${body}</article>`;
}
function copyCaption(){return el('copySearch').value.trim()?`${el('copyRecords').querySelectorAll('[data-copy-fact]').length} 项结果`:'点击复制';}
function updateCopyLocation(){
 const box=el('copyRecords'),sections=[...box.querySelectorAll('.copy-section')];if(!sections.length || activePane!=='library')return;
 const top=box.getBoundingClientRect().top;
 let section=sections[0];for(const candidate of sections){if(candidate.getBoundingClientRect().top<=top+24)section=candidate;else break;}
 if(box.scrollTop>0 && box.scrollHeight-box.clientHeight-box.scrollTop<2)section=sections.at(-1);
 copySection=section.dataset.module;
 for(const button of el('copyDirectory').querySelectorAll('[data-copy-module]')){const current=button.dataset.copyModule===copySection;button.classList.toggle('current',current);button.setAttribute('aria-current',current?'location':'false');}
 const current=el('copyDirectory').querySelector('.current'),nav=el('copyDirectory');
 if(current){const rect=current.getBoundingClientRect(),bounds=nav.getBoundingClientRect();if(rect.top<bounds.top)nav.scrollTop-=bounds.top-rect.top;else if(rect.bottom>bounds.bottom)nav.scrollTop+=rect.bottom-bounds.bottom;}
}
function renderCopyLibrary(){
 const query=el('copySearch').value.trim().toLocaleLowerCase();
 const sections=librarySections().map(section=>({...section,records:section.records.map(record=>({...record,facts:record.facts.filter(fact=>!query || [section.label,record.title,fact.label,fact.value].join(' ').toLocaleLowerCase().includes(query))})).filter(record=>record.facts.length)})).filter(section=>section.records.length);
 el('copyDirectory').innerHTML=sections.map((section,index)=>`${section.personal && !sections[index-1]?.personal?'<span class="directory-heading">个人信息</span>':section.awards && !sections[index-1]?.awards?'<span class="directory-heading">荣誉获奖</span>':''}<button data-copy-module="${escapeHtml(section.id)}" aria-current="false"><span>${escapeHtml(section.label)}</span>${section.awards?`<small>${section.records.length}</small>`:''}</button>`).join('');
 el('copyRecords').innerHTML=sections.length?sections.map(section=>`<section class="copy-section${section.awards?' award-section':''}" data-module="${escapeHtml(section.id)}">${section.reference?`<details class="copy-reference" ${query?'open':''}><summary>${escapeHtml(section.label)} <small>${section.records[0].facts.length} 项</small></summary><p class="reason">不与正式填写字段混用。</p>${section.records.map(record=>copyRecordMarkup(record,section)).join('')}</details>`:`<h2>${escapeHtml(section.label)}${!section.personal?`<small>${section.records.length} ${section.awards?'项':'段'}</small>`:''}</h2>${section.records.map(record=>copyRecordMarkup(record,section)).join('')}`}</section>`).join(''):'<p class="library-empty">'+(query?'没有找到相关资料，试试字段名或关键词。':'当前版本尚无资料，可在「资料与设置」添加。')+'</p>';
 el('copyCount').textContent=copyCaption();requestAnimationFrame(updateCopyLocation);
}
el('tabFill').addEventListener('click',()=>{setPane('fill');if(hasProfile && !state?.plan && !scanning)task(scanPage);});
el('tabLibrary').addEventListener('click',()=>{setPane('library');if(!copyLibrary)task(loadCopyLibrary,'正在读取资料…');});
el('copySearch').addEventListener('input',()=>{renderCopyLibrary();el('copyRecords').scrollTop=0;});
el('copyDirectory').addEventListener('click',event=>{
 const button=event.target.closest('[data-copy-module]');if(!button)return;
 const box=el('copyRecords'),section=[...box.querySelectorAll('.copy-section')].find(n=>n.dataset.module===button.dataset.copyModule);if(!section)return;
 const reference=section.querySelector('.copy-reference');if(reference)reference.open=true;
 box.scrollTo({top:section.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
});
el('copyRecords').addEventListener('scroll',()=>{if(copyScrollFrame)return;copyScrollFrame=requestAnimationFrame(()=>{copyScrollFrame=0;updateCopyLocation();});},{passive:true});
el('copyRecords').addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.classList.contains('expand-value')){const value=button.previousElementSibling;const expanded=value.classList.toggle('collapsed')===false;button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'收起内容':'展开全文';return;}
 const fact=copyLibrary?.records.flatMap(record=>record.facts).find(fact=>fact.key===button.dataset.copyFact);if(fact?.value===undefined)return;
 try{await navigator.clipboard.writeText(String(fact.value));el('copyCount').textContent='已复制全文';button.classList.add('copied');clearTimeout(copyFeedbackTimer);setTimeout(()=>button.classList.remove('copied'),1000);copyFeedbackTimer=setTimeout(()=>{el('copyCount').textContent=copyCaption();},1200);}catch(_){notice('复制未完成，请选中内容后手动复制。',true);}
});
document.querySelector('.panel-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const button=el(activePane==='fill'?'tabLibrary':'tabFill');button.click();button.focus();});

if(panelToken && parent!==window){parent.postMessage({type:'toudi-panel-ready'},'*');send('panel-ready').catch(()=>{});}

task(async()=>{
 const value=await send('state');el('runtimeVersion').textContent='扩展 '+(value.extensionVersion || '未知版本');
 showSync(value.sync);profileSummary=value.profile;pref=value.preferences;hasProfile=!!profileSummary?.count;
 el('empty').hidden=hasProfile;el('controls').hidden=!hasProfile;el('fillPane').hidden=!hasProfile;el('tabLibrary').disabled=!hasProfile;
 el('profile').replaceChildren(...(profileSummary?.profiles || [{id:'general',label:'默认资料'}]).map(p=>new Option(p.label,p.id)));el('profile').value=pref.profile;
 state=value.state;render();notice('');if(location.hash==='#library' && hasProfile){setPane('library');await loadCopyLibrary();}if(activePane==='fill' && hasProfile && state?.automation?.status!=='running')await scanPage();
});
