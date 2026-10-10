/* A single file-backed schedule. FullCalendar is loaded only when this module opens. */
(() => {
  'use strict';
  const TYPES = {application:'投递',exam:'笔试',interview:'面试',preparation:'准备',review:'复盘',other:'其他'};
  const STATUS = {planned:'待完成',completed:'已完成',cancelled:'已取消'};
  const $ = id => document.getElementById(id), clone = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({schemaVersion:1,timeZone:'Asia/Shanghai',events:[],calendar:{enabled:false,calendarId:''}});
  const readPack = value => ({...empty(),...value,calendar:{...empty().calendar,...value.calendar}});
  let pack=empty(), version='', loaded=false, loading=null, opening=null, calendar=null, library=null;
  let rangeTitle='';
  let mode='timeGridWeek', editing=null, form=null, editorBase='', saving=false, dirty=false, lastError='';
  let activeRecovery=null;
  let previewChanging=false, companyData=null, companyIndex=[];
  let nativeStatus=null, nativeCalendars=[], syncRunning=false, syncResults=[], lastSync='', connectionOpen=false;
  let connectionTask=null, connectionBusy='';
  const host=document.createElement('section'); host.id='scheduleView'; host.style.display='none';
  host.innerHTML=`<div class="schedule-toolbar"><div class="schedule-navigation"><button class="btn" data-schedule="today">今天</button><button class="btn schedule-icon" data-schedule="prev" aria-label="上一周或月">${arrow(false)}</button><button class="btn schedule-icon" data-schedule="next" aria-label="下一周或月">${arrow(true)}</button><h2 id="scheduleRange">日程</h2></div><div class="schedule-tools"><div class="schedule-tabs" role="group" aria-label="日程视图">${[['timeGridWeek','周'],['dayGridMonth','月'],['agenda','列表']].map(([key,name])=>`<button data-schedule-mode="${key}" aria-pressed="${mode===key}">${name}</button>`).join('')}</div><button class="btn" data-schedule="connect">日历连接</button><button class="btn btn-primary" data-schedule="new">新增事项</button></div></div><div id="scheduleNotice" class="schedule-notice" role="status" hidden></div><div class="schedule-layout"><div class="schedule-canvas"><div id="scheduleCalendar"></div><div id="scheduleAgenda" hidden></div></div><aside id="scheduleInspector" aria-label="事项与编辑"></aside></div><footer class="schedule-footer"><span id="scheduleSummary"></span><span id="scheduleSyncStatus"></span><button class="schedule-link" data-schedule="export">导出日历</button></footer>`;
  document.querySelector('.content').append(host);
  function arrow(right){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m${right?'9 6 6 6-6 6':'15 6-6 6 6 6'}"/></svg>`;}
  const writable=()=>!window.__SNAPSHOT__ && serverMode && apiBase!==null && loaded;
  const rowByKey=key=>data.find(row=>row._key===key);
  const label=event=>rowByKey(event.companyKey)?.名称 || (event.companyKey?'原招聘记录已移除':'');
  const day=(value,zone=pack.timeZone)=>new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const time=(value,zone=pack.timeZone)=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  const today=()=>day(Date.now());
  function addDay(value,n){const dt=new Date(value+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);}
  function localISO(date,clock,zone){
    const wanted=Date.parse(`${date}T${clock}:00Z`); if(!Number.isFinite(wanted))throw Error('请选择有效的日期和时间');
    let epoch=wanted;
    for(let i=0;i<4;i++) {const represented=Date.parse(`${day(epoch,zone)}T${time(epoch,zone)}:00Z`);epoch+=wanted-represented;}
    if(day(epoch,zone)!==date || time(epoch,zone)!==clock)throw Error('该时间在当前时区不存在，请调整时间');
    if([-3600000,3600000].some(delta=>day(epoch+delta,zone)===date&&time(epoch+delta,zone)===clock))throw Error('该时间在当前时区重复出现，请通过 Agent 指定带偏移的时间');
    return new Date(epoch).toISOString();
  }
  function notice(message,actions='',owner=''){const box=$('scheduleNotice');box.dataset.owner=owner;box.hidden=!message;box.innerHTML=message?`<span>${esc(message)}</span>${actions}`:'';}
  function exactSourceDay(input){
    const value=String(input||'').trim();
    const parts=value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)||value.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/)||value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if(!parts)return null;
    const date=parts[1]+'-'+parts[2].padStart(2,'0')+'-'+parts[3].padStart(2,'0');
    return Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?date:null;
  }
  function orderByStart(a,b){const key=event=>!event.start?'9999':event.allDay?event.start+'T00:00':day(event.start)+'T'+time(event.start);return key(a).localeCompare(key(b));}
  function sourceEvents(){
    return data.filter(row=>!row._excluded && !['已通过','已拒绝','已截止'].includes(row._status)).flatMap(row=>{
      const value=exactSourceDay(row.截止时间);if(!value)return [];
      return [{id:'deadline:'+row._key,title:row.名称+' · 招聘截止',start:value,allDay:true,editable:false,classNames:['schedule-source'],extendedProps:{source:true,companyKey:row._key,type:'application',priority:-1}}];
    });
  }
  function calendarEvents(){return [...pack.events.filter(event=>event.start&&event.status!=='cancelled').map(event=>({id:event.id,title:event.title,start:event.start,end:event.end||undefined,allDay:event.allDay,editable:writable()&&!saving,classNames:[event.status==='completed'?'schedule-completed':'schedule-event'],extendedProps:{type:event.type,companyKey:event.companyKey,status:event.status,priority:event.priority||0}})),...sourceEvents()];}
  function styleLink(file){return new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=file;link.onload=resolve;link.onerror=()=>{link.remove();reject(Error('日历样式加载失败，可重新打开日程'));};document.head.append(link);});}
  function script(file){return new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=file;tag.onload=resolve;tag.onerror=()=>{tag.remove();reject(Error('日历组件加载失败，可重新打开日程'));};document.head.append(tag);});}
  async function loadLibrary(){
    if(library)return library;
    library=(async()=>{
      const base='/assets/vendor/fullcalendar-7.1.1/';
      if(window.__TOUDI_CALENDAR_ASSETS__){
        for(const name of ['skeleton.css','theme.css']){const tag=document.createElement('style');tag.textContent=window.__TOUDI_CALENDAR_ASSETS__[name];document.head.append(tag);}
        for(const name of ['fullcalendar.js','theme.js','zh-cn.js']){const url=URL.createObjectURL(new Blob([window.__TOUDI_CALENDAR_ASSETS__[name]],{type:'text/javascript'}));try{await script(url);}finally{URL.revokeObjectURL(url);}}
      }else{
        await Promise.all([styleLink(base+'skeleton.css'),styleLink(base+'theme.css')]);
        for(const name of ['fullcalendar.js','theme.js','zh-cn.js'])await script(base+name);
      }
    })().catch(error=>{library=null;throw error;});
    return library;
  }
  async function refresh(options={}){
    if(dirty || saving)return false;
    if(loading)return loading;
    loading=(async()=>{
      try{
        const result=window.__SNAPSHOT__?{data:window.__SNAPSHOT_SEED__?.toudiSchedule||empty(),version:'snapshot'}:await managementRequest('schedule');
        pack=readPack(result.data);version=String(result.version);loaded=true;lastError='';
        if(view==='schedule'){update();if(!options.preserveInspector&&!editing&&!connectionOpen)inspector();}
        if(pack.calendar.enabled)sync(false);
        return true;
      }catch(error){lastError=error.message;if(view==='schedule')notice('日程读取失败：'+error.message,'<button class="schedule-link" data-schedule="retry">重新读取</button>');return false;}
      finally{loading=null;}
    })();return loading;
  }
  function show(){
    if(!opening)opening=showModule().finally(()=>{opening=null;});
    return opening;
  }
  async function showModule(){
    document.body.classList.add('schedule-module');host.style.display='';if(!calendar && innerWidth<=800)mode='agenda';
    if(!calendar)$('scheduleCalendar').textContent='正在加载日历…';
    try{
      await refresh(); if(!loaded){inspector();return;}
      await loadLibrary(); if(view!=='schedule')return;
      if(!calendar){
        $('scheduleCalendar').textContent='';
        calendar=new FullCalendar.Calendar($('scheduleCalendar'),{
          initialView:mode==='agenda'?'timeGridWeek':mode,locale:'zh-cn',timeZone:pack.timeZone,firstDay:1,
          headerToolbar:false,height:$('scheduleCalendar').parentElement.clientHeight,nowIndicator:true,editable:writable(),selectable:writable(),
          slotMinTime:'00:00:00',slotMaxTime:'24:00:00',scrollTime:'07:30:00',slotDuration:'00:30:00',
          allDayText:'全天',allDayHeaderClass:'schedule-all-day-header',eventTimeFormat:{hour:'2-digit',minute:'2-digit',hour12:false},slotHeaderFormat:{hour:'2-digit',minute:'2-digit',hour12:false},
          // Month rows own equal space; the measured placement hides overflow.
          // The all-day lane counts the more link as one of its three rows.
          views:{dayGridMonth:{dayMaxEvents:true,dayMaxEventRows:true},timeGrid:{dayMaxEvents:false,dayMaxEventRows:3}},
          moreLinkText:num=>`+${num} 项`,moreLinkClass:'schedule-more',popoverClass:'schedule-popover',
          eventOrder:'-priority,start,allDay,title',eventMinHeight:28,selectMirror:true,unselectAuto:false,events:calendarEvents(),
          dayLaneClass:info=>info.isToday?'schedule-today':'',
          dateClick:info=>{
            const start=info.allDay?info.dateStr.slice(0,10)+'T09:00':info.dateStr.slice(0,16),end=new Date(Date.parse(start+'Z')+60*60000).toISOString();
            open(null,{date:start.slice(0,10),endDate:end.slice(0,10),startTime:start.slice(11,16),endTime:end.slice(11,16),allDay:info.allDay});
          },
          select:info=>{
            if(previewChanging)return;
            const seed={scheduled:true,hasEnd:true,date:info.startStr.slice(0,10),endDate:info.allDay?addDay(info.endStr.slice(0,10),-1):info.endStr.slice(0,10),startTime:info.allDay?'09:00':info.startStr.slice(11,16),endTime:info.allDay?'10:00':info.endStr.slice(11,16),allDay:info.allDay,timeZone:pack.timeZone};
            if(editing&&form){collect();Object.assign(form,seed);for(const [name,value] of Object.entries(seed)){const node=$('scheduleForm')?.elements[name];if(node){if(node.type==='checkbox')node.checked=value;else node.value=value;}}changed();renderEditor();}
            else open(null,seed);
          },
          eventClick:info=>{info.jsEvent.preventDefault();info.event.extendedProps.source?showSource(info.event.extendedProps.companyKey):open(info.event.id);},
          eventDrop:changeDate,eventResize:changeDate,
          datesSet:info=>{const first=info.startStr.slice(0,10),last=addDay(info.endStr.slice(0,10),-1);rangeTitle=mode==='timeGridWeek'?first.replace(/-/g,' / ')+' — '+last.slice(5).replace('-',' / '):info.view.title;$('scheduleRange').textContent=rangeTitle;},
          eventDidMount:info=>{info.el.classList.add(info.event.extendedProps.source?'schedule-source':info.event.extendedProps.status==='completed'?'schedule-completed':'schedule-event');info.el.dataset.scheduleEvent=info.event.id;info.el.title=[info.event.title,TYPES[info.event.extendedProps.type],info.timeText].filter(Boolean).join(' · ');},
          eventContent:info=>{const node=document.createElement('div');node.className='schedule-event-content'+(info.event.allDay||mode==='dayGridMonth'?' schedule-event-compact':'');const title=document.createElement('strong');title.textContent=info.event.extendedProps.source?(rowByKey(info.event.extendedProps.companyKey)?.名称||info.event.title):info.event.title;node.append(title);if(info.timeText){const line=document.createElement('span');line.textContent=info.timeText.replace(/\s*[-–—]\s*/g,'–');node.append(line);}return {domNodes:[node]};}
        });calendar.render();
        // Use the outer fixed layout's height. WebKit percentage sizing and nested
        // resize callbacks can otherwise form a feedback loop during first paint.
        let observedHeight=$('scheduleCalendar').parentElement.clientHeight,frame=0;
        new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
          const height=$('scheduleCalendar').parentElement.clientHeight;
          if(height>0&&height!==observedHeight){observedHeight=height;calendar.setOption('height',height);}
        });}).observe($('scheduleCalendar').parentElement);
      }
      update();if(!editing&&!connectionOpen)inspector();checkDrafts();
      if(pack.calendar.enabled)sync(false);
    }catch(error){notice(error.message,'<button class="schedule-link" data-schedule="retry">重新读取</button>');}
  }
  function hide(){host.style.display='none';document.body.classList.remove('schedule-module');}
  function update(){
    if(!loaded)return;
    $('scheduleCalendar').dataset.view=mode;
    if(calendar){calendar.setOption('timeZone',pack.timeZone);calendar.setOption('editable',writable()&&!saving);calendar.batchRendering(()=>{calendar.getEventSources().forEach(source=>source.remove());calendar.addEventSource(calendarEvents());});updatePreview();}
    $('scheduleCalendar').hidden=mode==='agenda';$('scheduleAgenda').hidden=mode!=='agenda';
    if(mode==='agenda')agenda();
    host.querySelectorAll('[data-schedule-mode]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.scheduleMode===mode));
    for(const name of ['prev','next','today'])host.querySelector(`[data-schedule="${name}"]`).disabled=mode==='agenda';
    host.querySelector('[data-schedule="new"]').disabled=!writable()||saving;
    $('scheduleSummary').textContent=`${pack.events.filter(event=>event.status==='planned').length} 项待完成 · ${pack.timeZone}`;
    if(calendar&&mode!=='agenda')$('scheduleRange').textContent=rangeTitle;
  }
  function agenda(){
    const events=pack.events.filter(event=>event.status!=='cancelled').sort(orderByStart);
    const groups=new Map();for(const event of events){const key=event.start?(event.allDay?event.start:day(event.start)):'待安排';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);}
    $('scheduleRange').textContent='全部事项';
    $('scheduleAgenda').innerHTML=events.length?[...groups].map(([key,rows])=>`<section class="schedule-day"><h3>${esc(key)}</h3>${rows.map(event=>`<button class="schedule-agenda-row" data-schedule-id="${esc(event.id)}"><span class="schedule-agenda-time">${!event.start?'未排期':event.allDay?'全天':esc(time(event.start))}</span><span><strong>${esc(event.title)}</strong><small>${esc([TYPES[event.type],label(event)].filter(Boolean).join(' · '))}</small></span><span class="schedule-state">${STATUS[event.status]}</span></button>`).join('')}</section>`).join(''):'<div class="schedule-empty"><h3>把下一步安排在日历里</h3><p>添加投递、笔试、面试、准备或复盘事项；时间暂未确定时也可以先保留待办。</p><button class="btn btn-primary" data-schedule="new">新增事项</button></div>';
  }
  function inspector(){
    host.classList.remove('schedule-panel-open','schedule-connection-open');
    const upcoming=pack.events.filter(event=>event.status==='planned'&&event.start&&(event.allDay?event.start>=today():new Date(event.end||event.start).getTime()>=Date.now())).sort(orderByStart).slice(0,6);
    const unplanned=pack.events.filter(event=>event.status==='planned'&&!event.start);
    const uncertain=data.filter(row=>!row._excluded && row.截止时间 && !exactSourceDay(row.截止时间) && !['已通过','已拒绝','已截止'].includes(row._status));
    $('scheduleInspector').innerHTML=`<div class="schedule-inspector-head"><h3>近期安排</h3></div><div class="schedule-inspector-body"><p class="schedule-help">点击日期添加事项，拖动已有事项调整日期与时间。</p>${upcoming.length?upcoming.map(event=>`<button class="schedule-upcoming" data-schedule-id="${esc(event.id)}"><small>${esc(event.allDay?event.start+' · 全天':day(event.start)+' · '+time(event.start))}</small><strong>${esc(event.title)}</strong><span>${esc(TYPES[event.type])}</span></button>`).join(''):'<p class="schedule-muted">暂无近期事项</p>'}${unplanned.length?`<h4>待安排 · ${unplanned.length}</h4>${unplanned.map(event=>`<button class="schedule-upcoming" data-schedule-id="${esc(event.id)}"><strong>${esc(event.title)}</strong><span>${esc(TYPES[event.type])}</span></button>`).join('')}`:''}<details class="schedule-source-help"><summary>招聘截止时间</summary><p>明确到日的截止时间显示为灰色全天事项，随招聘记录更新。仅有月份、招满即止等信息保留原文，不推定日期。</p>${uncertain.length?`<p>${uncertain.length} 条招聘记录的截止日期待确定。</p>`:''}</details></div>`;
  }
  function showSource(key){
    if(dirty){notice('当前编辑尚未保存，请先保存或取消。');return;}
    const row=rowByKey(key);if(!row)return;host.classList.add('schedule-panel-open');
    $('scheduleInspector').innerHTML=`<div class="schedule-inspector-head"><h3>招聘截止</h3><button class="schedule-close" data-schedule="cancel" aria-label="收起详情">${arrow(true)}</button></div><div class="schedule-inspector-body"><h4>${esc(row.名称)}</h4><p>${esc(row.截止时间)}</p><p class="schedule-help">截止日期来自招聘记录。</p><div class="schedule-connection-actions"><button class="btn btn-primary" data-schedule-company="${esc(key)}">安排投递</button><button class="schedule-link" data-schedule-record="${row._idx}">查看招聘详情</button></div></div>`;
  }
  function defaults(seed={}){seed={...seed,meetingInfo:seed.meetingInfo??seed.url??''};if(seed.date&&!seed.endDate)seed={...seed,endDate:seed.date};return {title:'',type:'other',status:'planned',scheduled:true,date:today(),endDate:today(),startTime:'09:00',endTime:'10:00',hasEnd:true,allDay:false,companyKey:'',prepId:'',reviewId:'',location:'',url:'',notes:'',priority:0,estimatedMinutes:'',reminderMinutes:'',syncToCalendar:false,timeZone:pack.timeZone,...seed};}
  function formFor(event){return defaults({...event,scheduled:!!event.start,date:event.start?(event.allDay?event.start:day(event.start,event.timeZone)):today(),endDate:event.end?(event.allDay?addDay(event.end,-1):day(event.end,event.timeZone)):event.start?(event.allDay?event.start:day(event.start,event.timeZone)):today(),startTime:event.start&&!event.allDay?time(event.start,event.timeZone):'09:00',endTime:event.end&&!event.allDay?time(event.end,event.timeZone):'10:00',hasEnd:!!event.end||event.allDay,estimatedMinutes:event.estimatedMinutes??'',reminderMinutes:event.reminderMinutes??''});}
  function open(id,seed={}){
    if(dirty){notice('当前编辑尚未保存，请先保存或取消。');return;}
    const event=id&&pack.events.find(row=>row.id===id); if(id&&!event)return;
    if(!writable()){if(event){showReadOnly(event);}else notice('此入口仅供阅读，请在桌面 App 或可写工作区添加日程。');return;}
    host.classList.add('schedule-panel-open');editing=id||'new';form=event?formFor(event):defaults(seed);editorBase=version;dirty=false;connectionOpen=false;notice('');renderEditor();
  }
  function optionRows(list,value){return list.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('');}
  function clearPreview(){
    if(!calendar)return;
    previewChanging=true;try{calendar.unselect();}finally{previewChanging=false;}
    delete $('scheduleCalendar').dataset.previewStart;delete $('scheduleCalendar').dataset.previewEnd;
  }
  function updatePreview(){
    if(!calendar)return;
    if(!editing||!form?.scheduled){clearPreview();return;}
    try{
      const start=form.allDay?form.date:localISO(form.date,form.startTime,form.timeZone);
      // An undetermined end stays undetermined in the saved record. Only its
      // visual preview occupies one slot, so a draft never creates an event.
      const end=form.allDay?addDay(form.endDate,1):form.hasEnd?localISO(form.endDate,form.endTime,form.timeZone):new Date(new Date(start).getTime()+30*60000).toISOString();
      if(!start||!end||(form.allDay?end<=start:new Date(end)<=new Date(start))){clearPreview();return;}
      previewChanging=true;try{calendar.select({start,end,allDay:form.allDay});}finally{previewChanging=false;}
      $('scheduleCalendar').dataset.previewStart=start;$('scheduleCalendar').dataset.previewEnd=end;
    }catch(_){clearPreview();}
  }
  function companyChoices(query){
    if(companyData!==data){companyData=data;companyIndex=data.map(row=>({key:row._key,title:row.名称||'',detail:[row.岗位,row.地点].filter(Boolean).join(' · '),search:[row.名称,row.岗位,row.地点].join(' ').toLocaleLowerCase()}));}
    const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),matches=[];
    for(const row of companyIndex){if(words.every(word=>row.search.includes(word)))matches.push(row);if(matches.length===20)break;}
    return matches;
  }
  function bindCompanyPicker(){
    const editor=$('scheduleForm'),input=$('scheduleCompanyQuery'),list=$('scheduleCompanyList'),clear=$('scheduleCompanyClear'),wrap=input.closest('.schedule-company-picker');
    let choices=[],active=-1;
    const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
    function select(key){
      editor.elements.companyKey.value=key;form.companyKey=key;
      input.value=key?(rowByKey(key)?.名称||'原招聘记录已移除'):'';input.dataset.boundTitle=input.value;
      clear.hidden=!key;close();changed();updateCompanyLinks();
    }
    function show(){
      choices=companyChoices(input.value);active=-1;
      list.innerHTML=choices.length?choices.map((row,i)=>`<button type="button" role="option" aria-selected="${row.key===form.companyKey}" id="scheduleCompanyOption${i}" data-company-key="${esc(row.key)}"><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></button>`).join(''):'<p class="schedule-picker-empty">未找到公司，可试试岗位或地点</p>';
      list.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
      const body=wrap.closest('.schedule-inspector-body');wrap.classList.toggle('schedule-picker-up',body.getBoundingClientRect().bottom-wrap.getBoundingClientRect().bottom<180);
    }
    input.addEventListener('focus',show);
    input.addEventListener('input',event=>{event.stopPropagation();show();});
    input.addEventListener('change',event=>event.stopPropagation());
    input.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();close();input.value=input.dataset.boundTitle;return;}
      if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(list.hidden)show();if(!choices.length)return;active=(active+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;list.querySelectorAll('[role=option]').forEach((node,i)=>node.classList.toggle('active',i===active));input.setAttribute('aria-activedescendant','scheduleCompanyOption'+active);$('scheduleCompanyOption'+active).scrollIntoView({block:'nearest'});}
      else if(event.key==='Enter'&&!list.hidden){event.preventDefault();if(choices[active>=0?active:0])select(choices[active>=0?active:0].key);}
    });
    list.addEventListener('mousedown',event=>event.preventDefault());
    list.addEventListener('click',event=>{const button=event.target.closest('[data-company-key]');if(button)select(button.dataset.companyKey);});
    clear.addEventListener('click',()=>{select('');input.focus();});
    wrap.addEventListener('focusout',()=>{if(!wrap.contains(document.activeElement)){close();input.value=input.dataset.boundTitle;}});
  }
  function updateCompanyLinks(){
    const editor=$('scheduleForm'),row=rowByKey(form.companyKey),link=$('scheduleCompanyRecord');
    link.hidden=!row;if(row)link.dataset.scheduleRecord=row._idx;else delete link.dataset.scheduleRecord;
    for(const [name,items,labelFor] of [['prepId',prepData?.preps||[],row=>row.position||row.company||row.title||'准备文档'],['reviewId',reviewData?.sessions||[],row=>(row.company||'')+' '+(row.date||'')]]){
      const matches=items.filter(item=>!form.companyKey||item.companyKey===form.companyKey),value=form[name];
      editor.elements[name].innerHTML=optionRows([['','不关联'],...matches.map(item=>[item.id,labelFor(item)]),...(value&&!matches.some(item=>item.id===value)?[[value,'已关联材料']]:[])],value);
    }
  }
  function renderEditor(){
    const field=(name,title,type='text')=>`<label>${title}<input name="${name}" type="${type}" value="${esc(form[name])}"></label>`;
    const preps=(prepData?.preps||[]).filter(row=>!form.companyKey||row.companyKey===form.companyKey), reviews=(reviewData?.sessions||[]).filter(row=>!form.companyKey||row.companyKey===form.companyKey);
    $('scheduleInspector').innerHTML=`<div class="schedule-inspector-head"><h3>${editing==='new'?'新增事项':'编辑事项'}</h3><button class="schedule-close" data-schedule="cancel" aria-label="收起编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><form id="scheduleForm" class="schedule-editor"><div class="schedule-inspector-body">${field('title','标题')}<div class="schedule-fields"><label>类型<select name="type">${optionRows(Object.entries(TYPES),form.type)}</select></label><label>状态<select name="status">${optionRows(Object.entries(STATUS),form.status)}</select></label></div><div class="schedule-checks"><label><input type="checkbox" name="scheduled" ${form.scheduled?'checked':''}>安排日期</label><label><input type="checkbox" name="allDay" ${form.allDay?'checked':''}>全天</label></div><div class="schedule-dates" ${form.scheduled?'':'hidden'}><div class="schedule-fields">${field('date','开始日期','date')}${field('endDate','结束日期','date')}</div><div class="schedule-fields" ${form.allDay?'hidden':''}>${field('startTime','开始时间','time')}${field('endTime','结束时间','time')}</div><label class="schedule-check" ${form.allDay?'hidden':''}><input name="hasEnd" type="checkbox" ${form.hasEnd?'checked':''}>结束时间已确定</label></div><div class="schedule-company"><label for="scheduleCompanyQuery">关联公司</label><input type="hidden" name="companyKey" value="${esc(form.companyKey)}"><div class="schedule-company-picker"><div class="schedule-company-input"><input id="scheduleCompanyQuery" type="search" role="combobox" aria-label="检索关联公司" aria-autocomplete="list" aria-expanded="false" aria-controls="scheduleCompanyList" autocomplete="off" placeholder="输入公司、岗位或地点" value="${esc(form.companyKey?(rowByKey(form.companyKey)?.名称||'原招聘记录已移除'):'')}" data-bound-title="${esc(form.companyKey?(rowByKey(form.companyKey)?.名称||'原招聘记录已移除'):'')}"><button id="scheduleCompanyClear" type="button" aria-label="解除公司关联" ${form.companyKey?'':'hidden'}>×</button></div><div id="scheduleCompanyList" class="schedule-company-list" role="listbox" aria-label="公司检索结果" hidden></div></div><button id="scheduleCompanyRecord" type="button" class="schedule-link schedule-record-link" hidden>查看招聘详情</button></div>${field('location','地点')}<label>会议号或链接<textarea name="meetingInfo" rows="2" placeholder="会议号、入会链接或说明">${esc(form.meetingInfo)}</textarea></label><label>备注<textarea name="notes" rows="3">${esc(form.notes)}</textarea></label><div class="schedule-fields"><label>日历提醒<select name="reminderMinutes">${optionRows([['','不提醒'],['0','开始时'],['10','提前 10 分钟'],['30','提前 30 分钟'],['60','提前 1 小时'],['1440','提前 1 天']],String(form.reminderMinutes))}</select></label><label>优先级<select name="priority">${optionRows([['0','普通'],['1','优先'],['2','重要']],String(form.priority))}</select></label></div><label class="schedule-check"><input type="checkbox" name="syncToCalendar" ${form.syncToCalendar?'checked':''}>同步到本机日历</label><details class="schedule-details"><summary>关联材料与计划信息</summary><label>准备文档<select name="prepId">${optionRows([['','不关联'],...preps.map(row=>[row.id,row.position||row.company||row.title||'准备文档']),...(form.prepId&&!preps.some(row=>row.id===form.prepId)?[[form.prepId,'已关联材料']]:[])],form.prepId)}</select></label><label>复盘记录<select name="reviewId">${optionRows([['','不关联'],...reviews.map(row=>[row.id,(row.company||'')+' '+(row.date||'')]),...(form.reviewId&&!reviews.some(row=>row.id===form.reviewId)?[[form.reviewId,'已关联材料']]:[])],form.reviewId)}</select></label>${field('estimatedMinutes','预计用时（分钟）','number')}<label>时区<select name="timeZone">${optionRows([...new Set([pack.timeZone,form.timeZone,'Asia/Shanghai','UTC'])].map(zone=>[zone,zone]),form.timeZone)}</select></label></details><p id="scheduleFormError" class="schedule-error" role="alert"></p></div><div class="schedule-editor-footer">${editing!=='new'?'<button type="button" class="schedule-link" data-schedule="delete">取消事项</button>':''}<span></span><button type="button" class="btn" data-schedule="cancel">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>`;
    bindCompanyPicker();updateCompanyLinks();updatePreview();
    $('scheduleForm').addEventListener('submit',event=>{event.preventDefault();save();});
    $('scheduleForm').addEventListener('input',changed);$('scheduleForm').addEventListener('change',event=>{changed();if(['scheduled','allDay'].includes(event.target.name))renderEditor();});
  }
  function collect(){if(!$('scheduleForm'))return;for(const node of $('scheduleForm').elements){if(!node.name)continue;form[node.name]=node.type==='checkbox'?node.checked:node.value;}}
  function changed(){collect();if(form.scheduled&&form.endDate<form.date){form.endDate=form.date;$('scheduleForm').elements.endDate.value=form.date;}dirty=true;updatePreview();writeDraft('schedule',editorBase,{editing,form:clone(form)});setSaveState('schedule','idle','日程编辑已暂存');}
  function meetingUrl(value){
    const text=String(value||'').trim();if(!/^https?:\/\//i.test(text)||/[\x00-\x20\x7f]/.test(text))return '';
    try{const url=new URL(text);return url.hostname&&!url.username&&!url.password?text:'';}catch(_){return '';}
  }
  function eventFromForm(){
    collect();if(!form.title.trim())throw Error('请输入事项标题');
    if(form.syncToCalendar&&(!form.scheduled||(!form.allDay&&!form.hasEnd)))throw Error('同步到本机日历需要确定开始和结束时间');
    const id=editing==='new'?crypto.randomUUID():editing;
    const original=pack.events.find(row=>row.id===editing);
    const exact=(which,date,clock)=>original?.[which]&&!original.allDay&&original.timeZone===form.timeZone&&day(original[which],form.timeZone)===date&&time(original[which],form.timeZone)===clock?original[which]:localISO(date,clock,form.timeZone);
    const start=!form.scheduled?null:form.allDay?form.date:exact('start',form.date,form.startTime);
    const end=!form.scheduled?null:form.allDay?addDay(form.endDate,1):form.hasEnd?exact('end',form.endDate,form.endTime):null;
    if(start&&end&&(form.allDay?end<=start:new Date(end)<=new Date(start)))throw Error('结束日期或时间必须晚于开始时间');
    const result={id,title:form.title.trim(),type:form.type,status:form.status,start,end,allDay:form.allDay,timeZone:form.timeZone,companyKey:form.companyKey,prepId:form.prepId,reviewId:form.reviewId,location:form.location,url:meetingUrl(form.meetingInfo),meetingInfo:form.meetingInfo,notes:form.notes,priority:Number(form.priority),estimatedMinutes:form.estimatedMinutes===''?null:Number(form.estimatedMinutes),reminderMinutes:form.reminderMinutes===''?null:Number(form.reminderMinutes),syncToCalendar:form.syncToCalendar};
    return result;
  }
  async function save(){
    if(saving||!writable())return;
    try{const event=eventFromForm();await commit({base:editorBase,action:'upsert',item:event});finishEdit();showToast('日程已保存');update();inspector();sync(false);}
    catch(error){$('scheduleFormError').textContent=error.message;dirty=true;writeDraft('schedule',editorBase,{editing,form:clone(form)});setSaveState('schedule',error.message.includes('冲突')?'conflict':'error',error.message);}
  }
  async function commit(payload){saving=true;setSaveState('schedule','saving','正在保存日程…');try{const result=await managementRequest('schedule',payload);pack=readPack(result.data);version=String(result.version);setSaveState('schedule','saved','日程已保存');return result;}finally{saving=false;}}
  function finishEdit(){if(activeRecovery){if(localStorage.getItem(activeRecovery.key)===activeRecovery.raw){confirmedDrafts.set(activeRecovery.key,JSON.stringify(canonicalJson(activeRecovery.draft)));localStorage.removeItem(activeRecovery.key);scheduleDraftMirror();}activeRecovery=null;}const draft=readOwnDraft('schedule');if(draft)clearOwnDraft('schedule',draft.revision);editing=null;form=null;dirty=false;editorBase='';clearPreview();notice('');}
  function cancel(){if(saving)return;host.classList.remove('schedule-connection-open');finishEdit();connectionOpen=false;setSaveState('schedule','idle');inspector();checkDrafts();refresh();}
  async function remove(){
    if(saving||editing==='new'||!writable())return;
    try{await commit({base:editorBase,action:'delete',item:{id:editing}});finishEdit();update();inspector();showToast('事项已取消');sync(false);}catch(error){$('scheduleFormError').textContent=error.message;}
  }
  async function changeDate(info){
    if(dirty||saving||!writable()){info.revert();notice('请先结束当前编辑，再拖动改期。');return;}
    const original=pack.events.find(event=>event.id===info.event.id);if(!original){info.revert();return;}
    const draft={...original,start:info.event.startStr,end:info.event.endStr||null,allDay:info.event.allDay};
    try{await commit({base:version,action:'upsert',item:draft});update();inspector();showToast('日期已更新');sync(false);}
    catch(error){info.revert();writeDraft('schedule',version,{editing:original.id,form:formFor(draft)});notice('改期未保存：'+error.message,'<button class="schedule-link" data-schedule="restore">恢复改期草稿</button>');}
  }
  function checkDrafts(){if(!dirty&&!connectionOpen&&listUnsavedDrafts().some(entry=>entry.domain==='schedule'))notice('有未保存的日程编辑。','<button class="schedule-link" data-schedule="restore">恢复草稿</button><button class="schedule-link" data-schedule="discard">舍弃草稿</button>');}
  function restoreDraft(){const entry=listUnsavedDrafts().filter(row=>row.domain==='schedule').sort((a,b)=>b.draft.savedAt.localeCompare(a.draft.savedAt))[0];if(!entry?.draft.data.form)return;activeRecovery={...entry,raw:localStorage.getItem(entry.key)};editing=entry.draft.data.editing;form=defaults(clone(entry.draft.data.form));editorBase=entry.draft.base;dirty=true;renderEditor();notice(editorBase===version?'已恢复未保存编辑。':'已恢复草稿；工作区已有更新，保存会保留冲突供核对。','<button class="schedule-link" data-schedule="draft-export">导出草稿</button>');}
  function discardDrafts(){if(saving)return;for(const entry of listUnsavedDrafts().filter(row=>row.domain==='schedule')){confirmedDrafts.set(entry.key,JSON.stringify(canonicalJson(entry.draft)));localStorage.removeItem(entry.key);}scheduleDraftMirror();finishEdit();setSaveState('schedule','idle');refresh();inspector();}
  function showReadOnly(event){host.classList.add('schedule-panel-open');$('scheduleInspector').innerHTML=`<div class="schedule-inspector-head"><h3>${esc(event.title)}</h3><button class="schedule-close" data-schedule="cancel" aria-label="收起详情">${arrow(true)}</button></div><div class="schedule-inspector-body"><p>${esc([TYPES[event.type],STATUS[event.status],label(event)].filter(Boolean).join(' · '))}</p><p>${esc(event.start?event.allDay?event.start:day(event.start)+' '+time(event.start):'尚未排期')}</p>${event.meetingInfo?`<h4>入会信息</h4><p class="schedule-notes">${esc(event.meetingInfo)}</p>`:''}<p class="schedule-notes">${esc(event.notes||'')}</p>${meetingUrl(event.url)?`<a class="action-link" href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">打开链接</a>`:''}<p class="schedule-help">只读快照；在桌面 App 中编辑。</p></div>`;}
  async function connection(){
    if(dirty){notice('请先保存或取消当前编辑。');return;}
    connectionOpen=true;editing=null;form=null;clearPreview();host.classList.add('schedule-connection-open','schedule-panel-open');
    if(connectionTask){renderConnection();return connectionTask;}
    connectionBusy='正在检查日历权限…';renderConnection();
    const bridge=window.toudiDesktop?.calendar;
    connectionTask=(async()=>{
      nativeCalendars=[];
      if(bridge){try{nativeStatus=await bridge('status');if(nativeStatus.authorization==='fullAccess'){connectionBusy='正在读取可写日历…';if(connectionOpen)renderConnection();const result=await bridge('calendars');nativeStatus=result;nativeCalendars=result.calendars||[];}}catch(error){nativeStatus={supported:true,error:String(error)};}}
    })();
    try{await connectionTask;}finally{connectionTask=null;connectionBusy='';if(connectionOpen)renderConnection();}
  }
  function renderConnection(){
    const supported=!!window.toudiDesktop?.calendar && nativeStatus?.supported;
    const authorized=supported&&nativeStatus.authorization==='fullAccess';
    const denied=['denied','restricted'].includes(nativeStatus?.authorization);
    const content=connectionBusy?`<p class="schedule-connection-progress" role="status">${esc(connectionBusy)}</p>`:!supported?'<p>在 macOS 桌面 App 中连接本机日历。此入口可以导出 .ics 文件供日历导入。</p>':authorized?`<p class="schedule-help">日历权限已获准。选定目标后，在事项编辑中勾选“同步到本机日历”。</p>${nativeCalendars.length?`<label class="schedule-field">目标日历<select id="scheduleNativeCalendar">${optionRows([['','请选择'],...nativeCalendars.map(row=>[row.id,row.title+(row.source?' · '+row.source:'')])],pack.calendar.calendarId)}</select></label><div class="schedule-connection-actions"><button class="btn btn-primary" data-schedule="enable-sync" ${syncRunning?'disabled':''}>${pack.calendar.enabled?'保存连接':'启用同步'}</button>${pack.calendar.enabled?`<button class="btn" data-schedule="sync" ${syncRunning?'disabled':''}>${syncRunning?'正在同步…':'立即同步'}</button><button class="schedule-link" data-schedule="disconnect" ${syncRunning?'disabled':''}>停止同步</button>`:''}</div>`:'<p>没有可写日历。请先在 macOS“日历”中添加或启用一个日历，再重新检查。</p>'}<button class="schedule-link" data-schedule="connect">重新检查权限与日历</button>`:`<p>${nativeStatus?.authorization==='restricted'?'本机限制了日历访问。请检查系统权限或设备管理限制。':denied?'日历权限未获准。请在系统设置中将 TouDi 的日历权限设为完整访问，然后回来重新检查。':'连接需要日历完整访问权限，用于更新已有事项和避免重复。'}</p><div class="schedule-connection-actions">${denied?'<button class="btn btn-primary" data-schedule="calendar-settings">打开日历权限设置</button><button class="btn" data-schedule="connect">重新检查权限</button>':'<button class="btn btn-primary" data-schedule="authorize">连接本机日历</button>'}</div>`;
    $('scheduleInspector').innerHTML=`<div class="schedule-inspector-head"><h3>日历连接</h3><button class="schedule-close" data-schedule="cancel" aria-label="关闭">${arrow(true)}</button></div><div class="schedule-inspector-body"><h4>本机日历</h4><p class="schedule-help">将勾选同步的事项写入一个日历。日程以中控台为准；系统日历的外部修改会保留并提示核对。</p>${content}${nativeStatus?.error?`<p class="schedule-error" role="alert">${esc(String(nativeStatus.error))}</p>`:''}<h4>导出日历文件</h4><p class="schedule-help">导出已安排日期的事项，手动导入其他日历。导入文件不建立自动同步。</p><button class="btn" data-schedule="export">导出 .ics</button><div id="scheduleSyncResults">${syncResultHtml()}</div></div>`;
  }
  function syncResultHtml(){return syncResults.length?`<h4>同步结果</h4>${syncResults.map(result=>`<div class="schedule-sync-row"><strong>${esc(pack.events.find(event=>event.id===result.id)?.title||'事项')}</strong><span>${esc(result.ok?({created:'已添加',updated:'已更新',unchanged:'已一致',deleted:'已取消',noop:'无需变更'}[result.operation]||'已同步'):result.error||'未同步')}</span></div>`).join('')}`:'';}
  async function authorize(){
    if(connectionBusy)return;
    if(connectionTask)await connectionTask;
    if(connectionBusy||!connectionOpen)return;
    connectionBusy='等待 macOS 日历授权，请在系统提示中选择允许…';renderConnection();
    try{nativeStatus=await window.toudiDesktop.calendar('authorize');if(nativeStatus.authorization==='fullAccess'){connectionBusy='';await connection();}}
    catch(error){nativeStatus={supported:true,error:String(error)};}
    finally{connectionBusy='';if(connectionOpen)renderConnection();}
  }
  async function recheckConnection(){
    if(!connectionOpen||connectionBusy||connectionTask||syncRunning||!window.toudiDesktop?.calendar)return;
    const state=()=>JSON.stringify({supported:nativeStatus?.supported,authorization:nativeStatus?.authorization,error:nativeStatus?.error,calendars:nativeCalendars});
    const before=state(),choice=$('scheduleNativeCalendar')?.value;
    connectionTask=(async()=>{
      try{
        const status=await window.toudiDesktop.calendar('status');
        if(status.authorization==='fullAccess'){
          const result=await window.toudiDesktop.calendar('calendars');nativeStatus=result;nativeCalendars=result.calendars||[];
        }else{nativeStatus=status;nativeCalendars=[];}
      }catch(error){nativeStatus={supported:true,error:String(error)};}
    })();
    try{await connectionTask;}finally{
      connectionTask=null;
      // Keep controls and their current selection while the window regains focus.
      // Replacing the clicked button here can discard its pending mouseup/click.
      if(connectionOpen&&!connectionBusy&&state()!==before){
        renderConnection();const select=$('scheduleNativeCalendar');
        if(select&&choice&&nativeCalendars.some(row=>row.id===choice))select.value=choice;
      }
    }
  }
  async function calendarSettings(){try{await window.toudiDesktop.calendar('settings');}catch(error){notice('未能打开系统设置：'+String(error));}}
  async function enableSync(enabled){
    if(!writable()||saving)return;
    const id=enabled?$('scheduleNativeCalendar')?.value:pack.calendar.calendarId;if(enabled&&!id){notice('请选择一个可写日历。');return;}
    try{await commit({base:version,action:'replace',data:{...pack,calendar:{enabled,calendarId:id||''}}});renderConnection();if(enabled)await sync(true);else{$('scheduleSyncStatus').textContent='自动同步已停止';showToast('已停止同步，已有系统日程保留');}}catch(error){notice(error.message);}
  }
  async function sync(manual){
    if(syncRunning||!pack.calendar.enabled||!window.toudiDesktop?.calendar||window.__SNAPSHOT__)return;
    const items=[],skipped=[];
    for(const event of pack.events){
      if(!event.syncToCalendar)continue;
      if(!event.start||(!event.allDay&&!event.end)){skipped.push({id:event.id,ok:false,error:'日期或结束时间尚未确定'});continue;}
      items.push(Object.fromEntries(['id','title','start','end','allDay','timeZone','notes','location','url','meetingInfo','status','reminderMinutes'].map(key=>[key,event[key]??(key==='end'||key==='reminderMinutes'?null:key==='timeZone'?pack.timeZone:'')])));
    }
    const signature=JSON.stringify({calendar:pack.calendar,items});if(!manual&&signature===lastSync)return;
    if(!items.length){syncResults=skipped;lastSync=skipped.length?'':signature;if($('scheduleNotice').dataset.owner==='calendar-sync')notice('');$('scheduleSyncStatus').textContent=skipped.length?`${skipped.length} 项时间未确定`:'日历已连接 · 暂无勾选同步的事项';if(connectionOpen)renderConnection();return;}
    syncRunning=true;$('scheduleSyncStatus').textContent='正在同步本机日历…';
    if(connectionOpen)renderConnection();
    try{
      const results=[];
      for(let offset=0;offset<items.length;offset+=1000){
        const batch=items.slice(offset,offset+1000),result=await window.toudiDesktop.calendar('sync',{workspaceKey:toudiWorkspaceStorage.id,calendarId:pack.calendar.calendarId,items:batch,revision:version});
        if(!result.supported||result.authorization!=='fullAccess')throw Error('日历完整访问权限不可用，请在日历连接中重新检查权限');
        const rows=Array.isArray(result.results)?result.results:[];
        for(const item of batch){const matching=rows.filter(row=>row.id===item.id);results.push(matching.length===1?matching[0]:{id:item.id,ok:false,error:'系统日历未返回该事项的确认结果，请重试同步'});}
      }
      syncResults=[...results,...skipped];const failed=syncResults.filter(row=>row.ok!==true);lastSync=failed.length?'':signature;
      if($('scheduleNotice').dataset.owner==='calendar-sync')notice('');
      $('scheduleSyncStatus').textContent=failed.length?`${failed.length} 项未同步 · 在日历连接中查看`:`${results.length} 项已同步到本机日历`;
      if(manual&&!failed.length)showToast(`${results.length} 项已同步到本机日历`);
    }catch(error){lastSync='';syncResults=[...items.map(item=>({id:item.id,ok:false,error:String(error)})),...skipped];$('scheduleSyncStatus').textContent='本机日历未同步';notice('日程已保存在中控台，系统日历同步失败：'+String(error),'','calendar-sync');}
    finally{syncRunning=false;if(connectionOpen)renderConnection();}
  }
  async function exportCalendar(){if(window.__SNAPSHOT__){notice('请在桌面 App 导出日历文件。');return;}try{const response=await fetch((apiBase||'')+'/api/schedule.ics',{cache:'no-store'});if(!response.ok)throw Error('日历导出失败');downloadBlob(await response.blob(),'TouDi日程.ics');}catch(error){notice(error.message);}}
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.scheduleId){open(button.dataset.scheduleId);return;}
    if(button.dataset.scheduleCompany){open(null,recordDefaults(button.dataset.scheduleCompany));return;}
    if(button.dataset.scheduleRecord){showDetail(Number(button.dataset.scheduleRecord));return;}
    if(button.dataset.scheduleMode){mode=button.dataset.scheduleMode;if(mode!=='agenda')calendar?.changeView(mode);update();return;}
    const actions={today:()=>calendar?.today(),prev:()=>calendar?.prev(),next:()=>calendar?.next(),new:()=>open(null),cancel,delete:remove,retry:show,connect:connection,authorize,'calendar-settings':calendarSettings,'enable-sync':()=>enableSync(true),disconnect:()=>enableSync(false),sync:()=>sync(true),export:exportCalendar,restore:restoreDraft,discard:discardDrafts,'draft-export':()=>downloadBlob(new Blob([JSON.stringify({workspaceKey:toudiWorkspaceStorage.id,base:editorBase,editing,form},null,2)],{type:'application/json'}),'TouDi日程草稿.json')};
    await actions[button.dataset.schedule]?.();
  });
  function recordDefaults(key){const row=rowByKey(key),date=exactSourceDay(row?.截止时间),url=String(row?.['网申链接/邮箱']||'');return {companyKey:key,type:'application',title:(row?.名称||'')+' · 投递',location:row?.地点||'',url:/^https?:\/\//i.test(url)?url:'',scheduled:!!date,allDay:true,...(date?{date,endDate:date}:{})};}
  async function enterFromRecord(){if(dirty){showToast('请先保存或取消当前日程编辑');return false;}if(!await settlePersonalEdits()){showToast('个人标记尚未保存，请先处理保存状态');return false;}closeDetailModal();switchView('schedule');await show();if(!writable())return false;await Promise.all([ensureViewData('qbank'),ensureViewData('review')]);return true;}
  window.toudiSchedule={show,hide,refresh,update,hasDraft:()=>dirty||saving,hasError:()=>!!lastError,
    openForRecord:async key=>{if(await enterFromRecord()){const seed=recordDefaults(key);if(seed.scheduled&&mode!=='agenda')calendar.gotoDate(seed.date);open(null,seed);}},
    openLinked:async id=>{if(await enterFromRecord()){const event=pack.events.find(row=>row.id===id&&row.status!=='cancelled');if(!event){notice('该事项已取消或移除。');return;}if(event.start&&mode!=='agenda')calendar.gotoDate(event.allDay?event.start:day(event.start));open(id);}},
    linked:key=>pack.events.filter(event=>event.companyKey===key&&event.status!=='cancelled'),
    native:()=>({status:nativeStatus,results:syncResults}),get:()=>clone(pack)};
  matchMedia('(max-width:800px)').addEventListener('change',event=>{if(event.matches&&mode==='timeGridWeek'){mode='agenda';if(view==='schedule')update();}});
  window.addEventListener('focus',recheckConnection);
  window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
})();
