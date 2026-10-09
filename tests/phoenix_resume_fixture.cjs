'use strict';
// Synthetic résumé form. The public field vocabulary and control protocol are
// reusable; no company URL, account or private résumé value is captured here.
const sections=[
 ['个人信息',[['姓名','text'],['性别','radio'],['出生日期','date'],['邮箱','text'],['手机号','text'],['证件照','file'],['证件号码','text'],['最高学历','select'],['最高学位','select'],['学习形式','select'],['毕业时间','date'],['现居住地','select'],['户口所在地','select'],['政治面貌','select'],['婚否','radio'],['民族','modal'],['籍贯','modal'],['通讯地址','text'],['紧急联系人','text'],['紧急联系电话','text'],['外语等级证书','text'],['计算机等级证书','text'],['自我评价','textarea']]],
 ['求职意向',[['期望工作城市','select'],['期望年薪(税前)','text']]],
 ['教育经历',[['具体学制','select'],['学历','select'],['开始时间','date'],['结束时间','date'],['学校名称','text'],['专业名称','text'],['学习形式','select'],['成绩（GPA）','text'],['班级排名','select'],['专业排名','select']]],
 ['在校职务',[['在校职务名称','text'],['开始时间','date'],['结束时间','date'],['在校职务描述','textarea']]],
 ['在校实践',[['开始时间','date'],['结束时间','date'],['实践名称','text'],['实践描述','textarea']]],
 ['获奖情况',[['奖项','text'],['获奖时间','date'],['获奖描述','textarea'],['获奖级别','select']]],
 ['论文/专著',[['学术级别','select'],['名称','text'],['发布时间','date'],['期刊名称/专利号申请号','text']]],
 ['实习经历',[['开始时间','date'],['结束时间','date'],['单位名称','text'],['实习内容','textarea']]],
 ['证书',[['证书种类','select'],['证书名称','text'],['获得时间','date'],['颁发机构','text']]],
 ['家庭情况',[['姓名','text'],['与本人关系','text'],['工作单位','text'],['职务','text']]],
 ['附件',[['简历附件','file']]],['附件',[['附件','file']]]
];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=sections.flatMap(([section,rows],i)=>rows.map(([label,type],j)=>({section,label,type,key:i+':'+j})));
function control(f){
 if(f.type==='radio')return '<div class="phoenix-radio-group">'+(f.label==='婚否'?['是','否']:['男','女']).map(t=>'<span class="phoenix-radio"><span class="phoenix-radio__radio-text">'+t+'</span></span>').join('')+'</div>';
 if(['select','modal','date'].includes(f.type))return '<div class="phoenix-select"><div class="phoenix-select__content"></div><input class="phoenix-select__input" readonly data-kind="'+f.type+'"></div>';
 return f.type==='textarea'?'<textarea class="phoenix-textarea"></textarea>':'<input class="phoenix-input" type="'+(f.type==='file'?'file':'text')+'">';
}
const html='<!doctype html><meta charset="utf-8"><title>合成完整招聘资料表</title><style>body{font:14px sans-serif;padding:25px}.section{margin:12px 0;padding:10px;border:1px solid #ccc}.form-item--phoenix{display:inline-block;width:45%;padding:8px;vertical-align:top}.phoenix-select{border:1px solid #999;padding:5px}.phoenix-select__input{width:100%;height:24px}textarea{width:95%;height:90px}.common-unmodeled-layer{position:fixed;left:400px;top:100px;width:320px;background:#eee;z-index:1000}.common-unmodeled-layer-hidden{display:none}.list-item-container,.phoenix-selectList__listItem{padding:8px}.icon-container{display:inline-block;width:22px}svg{width:20px;height:20px}</style><form>'+sections.map(([title,rows],i)=>'<section class="section"><div class="section-heading">'+title+'</div><div><div><div><div><div class="ux-standard-form">'+rows.map((_,j)=>{const f=fields.find(f=>f.key===i+':'+j);return '<div class="form-item form-item--phoenix" data-fixture="'+f.key+'"><div class="form-item__title"><span class="form-item__text">'+escape(f.label)+'</span></div><div class="form-item__control">'+control(f)+'</div></div>'}).join('')+'</div></div></div></div></div></section>').join('')+'<button type="submit">提交申请</button></form><div class="common-unmodeled-layer common-unmodeled-layer-hidden"></div>';
function installControls(){
 window.fixtureSubmissions=0;window.fixtureOpens=0;window.fixtureSvgPicks=0;window.fixtureReuseVisible=false;
 document.querySelector('form').onsubmit=e=>{e.preventDefault();fixtureSubmissions++};
 const layer=document.querySelector('.common-unmodeled-layer');
 const close=()=>{if(!fixtureReuseVisible)layer.classList.add('common-unmodeled-layer-hidden');document.querySelectorAll('.phoenix-select--active').forEach(n=>n.classList.remove('phoenix-select--active'))};
 document.querySelectorAll('.form-item__title').forEach(n=>n.onclick=close);
 document.querySelectorAll('.phoenix-radio').forEach(n=>n.onclick=()=>{n.parentElement.querySelectorAll('.phoenix-radio').forEach(v=>v.classList.remove('phoenix-radio--checked'));n.classList.add('phoenix-radio--checked')});
 // Actual input owns the open event. An outer-wrapper .click() is ineffective.
 document.querySelectorAll('.phoenix-select__input').forEach(input=>input.onmousedown=e=>{
  e.preventDefault();close();fixtureOpens++;const select=input.closest('.phoenix-select'),field=input.closest('.form-item--phoenix'),kind=input.dataset.kind;
  select.classList.add('phoenix-select--active');layer.classList.remove('common-unmodeled-layer-hidden');layer.dataset.owner=field.dataset.fixture;
  const options=window.fixtureOptions[field.dataset.fixture]||[];
  const commit=value=>{select.querySelector('.phoenix-select__content').textContent=value;close()};
  if(kind==='date'){layer.innerHTML='<div class="phoenix-date-picker"><input class="phoenix-calendar-input"></div>';layer.querySelector('input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit(e.target.value)}};return}
  if(kind==='select'){
   layer.innerHTML='<div class="phoenix-selectList">'+options.map(t=>'<div class="phoenix-selectList__listItem"><span class="phoenix-selectList__singleLabel">'+t+'</span></div>').join('')+'</div>';
   layer.querySelectorAll('.phoenix-selectList__singleLabel').forEach(n=>n.onmousedown=e=>{e.preventDefault();commit(n.textContent)});return;
  }
  layer.innerHTML='<div class="constant-main-selector-container"><div class="content-search"><input></div>'+options.map(t=>'<div class="list-item-container"><span class="icon-container"><svg class="RadioUnchecked"><circle></circle></svg></span><span class="item-text-label no-hover">'+t+'</span></div>').join('')+'</div><div class="selector-footer-button"><button type="button" class="phoenix-button">取消</button><button type="button" class="phoenix-button">确定</button></div>';
  let picked='';layer.querySelectorAll('svg').forEach(svg=>svg.onmousedown=e=>{e.preventDefault();e.stopPropagation();fixtureSvgPicks++;picked=svg.closest('.list-item-container').querySelector('.item-text-label').textContent;svg.classList.replace('RadioUnchecked','RadioChecked')});
  layer.querySelectorAll('button').forEach(b=>b.onclick=()=>b.textContent==='确定'?commit(picked):close());
 });
}
module.exports={html,fields,installControls};
