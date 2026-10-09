'use strict';
// Synthetic records shared by browser checks and a temporary, local visual preview.
const L=require('../app/browser-extension/profile-library.js');
const fullText='项目背景：记录完整需求与适用场景。\n核心工作：\n1. 明确输入、输出与验收条件，保留原始信息。\n2. 对照实际页面完成实现与检查。\n项目成果：交付可使用的完整流程。\n'+Array.from({length:12},(_,i)=>`${i+1}. 这是一段完整的测试原文；保留换行、标点与 <标签>，验证浏览、复制和保存没有内容损失。`).join('\n');
function makePack(){
  let p=L.emptyPack();
  p=L.saveRecord(p,'personal','',{name:'示例同学',phone:'13900000000',email:'example@example.invalid',city:'示例城市',gender:'女',birth:'2001-01-01',origin:'示例地区',hometown:'示例地区',nationality:'中国',ethnicity:'汉族',politics:'共青团员',highest:'硕士',emergencyName:'示例联系人',emergencyPhone:'13800000000',emergencyRelation:'家人',emergencyEmployer:'示例单位',skills:'信息整理、数据分析、产品设计与开发验证',summary:fullText});
  p=L.saveRecord(p,'education','',{school:'示例甲大学',degree:'硕士',major:'信息管理',start:'2024-09-01',end:'2027-06-30'});
  p=L.saveRecord(p,'education','',{school:'示例乙大学',degree:'本科',major:'信息管理',start:'2020-09-01',end:'2024-06-30'});
  p=L.saveRecord(p,'internship','',{company:'示例公司',role:'产品实习生',department:'产品部门',start:'2025-05-01',end:'2025-08-30',tasks:fullText,results:'完整工作成果原文'});
  p=L.saveRecord(p,'project','',{name:'辅助工具设计与实现',role:'产品与开发',start:'2024-12-01',end:'至今',description:fullText,tasks:fullText,results:'完整项目成果原文'});
  p=L.saveRecord(p,'campus-role','',{organization:'示例学生组织',role:'组织委员',start:'2020-10-01',end:'2024-06-30',tasks:fullText});
  p=L.saveRecord(p,'awards','',{name:'示例案例竞赛',level:'校级',rank:'一等奖',date:'2024-06-01',issuer:'示例主办单位',description:'完整获奖说明原文'});
  p=L.saveRecord(p,'publications','',{name:'示例研究论文',venue:'示例刊物',date:'2025-07-01',order:'第二作者',authors:'示例作者一，示例作者二',indexing:'示例收录类别',abstract:fullText});
  p=L.saveRecord(p,'language','',{name:'英语等级考试',language:'英语',level:'熟练',score:'500'});
  p=L.saveRecord(p,'family','',{name:'示例亲属',relation:'父亲',employer:'示例家庭成员单位'});
  p.profiles.push({id:'alternate',label:'另一版本'});
  p.facts.push({key:'alternate.skill',label:'专业技能',value:'另一版本专属内容',module:'personal',recordId:'alternate-person',recordLabel:'另一版本',profiles:['alternate'],aliases:['专业技能']});
  p.sourceVersion='fixture-v1';return require('../app/browser-extension/filling-core.js').validatePack(p);
}
function installFixture({pack,records}){
  const preferences={profile:'general',agentMode:'external',agentModel:'',autoAgent:false};
  window.fixtureCalls=[];window.fixtureCopied='';
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.fixtureCopied=text}}});
  window.chrome={runtime:{sendMessage:async message=>{
    window.fixtureCalls.push(message);
    if(message.op==='profile-read')return {value:{pack,preferences,sync:{status:'disconnected'}}};
    if(message.op==='state')return {value:{state:null,profile:{count:pack.facts.length,profiles:pack.profiles.map(p=>({...p,count:pack.facts.filter(f=>f.profiles.includes(p.id)).length}))},preferences,sync:{status:'disconnected'}}};
    if(message.op==='scan')return {value:{plan:{rows:[{fieldId:'person-name',label:'姓名',module:'personal',groupLabel:'个人信息',status:'ready'},{fieldId:'person-phone',label:'手机',module:'personal',groupLabel:'个人信息',status:'ready'}]},sync:{status:'disconnected'}}};
    if(message.op==='copy-library')return {value:{profileId:message.profile,sourceVersion:pack.sourceVersion,records:records[message.profile]}};
    if(message.op==='preferences'){Object.assign(preferences,message.preferences);return {value:preferences};}
    if(message.op==='profile-save'){pack=message.pack;pack.sourceVersion='fixture-v'+window.fixtureCalls.filter(c=>c.op==='profile-save').length;window.fixtureSaved=pack;return {value:{}};}
    return {value:{}};
  }}};
}
module.exports={makePack,installFixture,fullText};
