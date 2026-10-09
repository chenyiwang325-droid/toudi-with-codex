// Only an action-created, per-page extension iframe may use filling resources.
const PANEL_SESSION_PREFIX='toudiPanel:';
const PANEL_OPERATIONS=new Set(['panel-ready','agent-review','state','auto-fill','scan','preferences','copy-library','profile-sync','settings','open-workbench','remap','adapt','structure-task','agent-task','answer-task','answer-generate','answer-import','answer-approve','highlight','fill','codex-status']);
async function panelTarget(message={}){
  if(!message.panelToken && Number.isInteger(message.targetTabId))return chrome.tabs.get(message.targetTabId);
  if(!message.panelToken){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab;}
  const session=(await chrome.storage.session.get(PANEL_SESSION_PREFIX+message.panelTabId))[PANEL_SESSION_PREFIX+message.panelTabId];
  if(!session || session.token!==message.panelToken)throw Error('此填报窗口已失效，请从招聘页重新打开 TouDi。');
  const tab=await chrome.tabs.get(message.panelTabId),[active]=await chrome.tabs.query({active:true,windowId:session.sourceWindowId});
  if(active?.id!==tab.id || tab.windowId!==session.sourceWindowId || tab.url?.split('#')[0]!==session.targetUrl)throw Error('请返回此填报窗口对应的招聘页面再操作。');
  return tab;
}
async function assertPanelTarget(message){if(message.panelToken)await panelTarget(message);}
async function trustedPanelSender(message,sender){
  if(sender.id!==chrome.runtime.id)return false;
  const plain=sender.url?.split('#')[0];
  if(['popup.html','options.html'].some(name=>plain===chrome.runtime.getURL(name)))return !message.panelToken && (!sender.tab || !sender.frameId);
  if(!PANEL_OPERATIONS.has(message.op)||!Number.isInteger(message.panelTabId)||!message.panelToken)return false;
  const session=(await chrome.storage.session.get(PANEL_SESSION_PREFIX+message.panelTabId))[PANEL_SESSION_PREFIX+message.panelTabId];
  if(!session||session.token!==message.panelToken||sender.tab?.id!==message.panelTabId||sender.url!==session.url)return false;
  await assertPanelTarget(message);return true;
}
chrome.action?.onClicked.addListener(async tab=>{
  if(!tab?.id)return;
  if(!/^https?:\/\//.test(tab.url || '')){await chrome.action.setBadgeText({tabId:tab.id,text:'!'});await chrome.action.setTitle({tabId:tab.id,title:'请在招聘网页打开 TouDi。'});return;}
  try{
    const token=crypto.randomUUID(),url=chrome.runtime.getURL('popup.html')+'?panel='+encodeURIComponent(token)+'&tab='+tab.id;
    await chrome.storage.session.set({[PANEL_SESSION_PREFIX+tab.id]:{token,url,sourceWindowId:tab.windowId,targetUrl:tab.url.split('#')[0]}});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['panel-host.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},func:config=>globalThis.TouDiPanelHost(config),args:[{url,token}]});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
    await chrome.action.setTitle({tabId:tab.id,title:'TouDi · 辅助填报'});
  }catch(_){await chrome.action.setBadgeText({tabId:tab.id,text:'!'});await chrome.action.setTitle({tabId:tab.id,title:'当前网页无法打开浮窗，请回到招聘表单后重试。'});}
});
chrome.tabs.onRemoved?.addListener(tabId=>chrome.storage.session.remove(PANEL_SESSION_PREFIX+tabId));
