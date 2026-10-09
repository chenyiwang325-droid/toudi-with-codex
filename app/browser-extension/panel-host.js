// Runs only after an explicit action click, in Chrome's isolated content world.
// The host knows geometry only. Personal content remains in the extension iframe.
(() => {
  // An extension reload can leave a dead iframe in the still-open recruitment page.
  // After extension reload the previous listener belongs to an invalid context.
  // DOM cleanup must still proceed even if its old runtime API rejects disposal.
  try{globalThis.TouDiPanelHost?.dispose?.();}catch(_){}
  document.querySelectorAll('[data-toudi-panel="host"]').forEach(node=>node.remove());
  let current;
  globalThis.TouDiPanelHost = config => {
    if(current)current.dispose();
    const host=document.createElement('div');host.id='toudi-floating-host';host.setAttribute('data-toudi-panel','host');
    const shadow=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');style.textContent=`:host{all:initial;position:fixed!important;z-index:2147483647!important;display:block!important;color-scheme:light}*{box-sizing:border-box}.shell{display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:#f4f6f7;border:1px solid #dfe6e8;border-radius:16px;box-shadow:0 3px 10px #152c330d,0 18px 48px #152c3326;color:#243338;font:12px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.bar{display:flex;gap:6px;align-items:center;height:32px;flex:none;background:#f4f7f7;border-bottom:1px solid #e4e9e9;padding:0 8px;cursor:grab;touch-action:none;user-select:none}.bar:active{cursor:grabbing}.label{flex:1;font-size:11px;color:#52686e}.bar button{border:0;background:transparent;color:#40575e;cursor:pointer;width:26px;height:26px;border-radius:4px;font:16px sans-serif;transition:background-color 140ms cubic-bezier(.22,1,.36,1),color 140ms cubic-bezier(.22,1,.36,1)}.bar button:hover{background:#e8eeee}.bar button:focus-visible{outline:2px solid #466f74;outline-offset:-2px}iframe{width:100%;flex:1;min-height:0;border:0;background:#f4f6f7}.status{position:absolute;top:48px;left:16px;right:16px;padding:16px;border:1px solid #cdd7da;border-radius:8px;background:#f4f6f7;color:#243338;font:13px/1.7 sans-serif}.fallback{flex:none;align-self:flex-start;margin:0 16px 16px;padding:8px 12px;border:1px solid #cdd7da;border-radius:5px;background:white;color:#243338;font:12px sans-serif;cursor:pointer}.unavailable iframe{display:none}.unavailable .status{position:static;margin:16px}.minimized iframe,.minimized .status,.minimized .fallback,[hidden]{display:none!important}.minimized .bar{height:36px}@media(prefers-color-scheme:dark){.shell,.status{background:#182126;border-color:#3e5158;color:#e3ebed}.bar{background:#273438;border-bottom-color:#3a484c}.label,.bar button{color:#c2d3d7}.bar button:hover{background:#354a52}.fallback{background:#27383e;border-color:#52686e;color:#e3ebed}}@media(prefers-reduced-motion:reduce){.bar button{transition:none}}`;
    const shell=document.createElement('div');shell.className='shell';
    const bar=document.createElement('div');bar.className='bar';bar.setAttribute('aria-label','拖动填报窗口');
    const label=document.createElement('span');label.className='label';label.textContent='TouDi · 拖动此处移动';
    const minimize=document.createElement('button');minimize.textContent='−';minimize.title='最小化窗口';minimize.setAttribute('aria-label','最小化窗口');
    const close=document.createElement('button');close.textContent='×';close.title='关闭窗口';close.setAttribute('aria-label','关闭窗口');
    const makeFrame=()=>{const node=document.createElement('iframe');node.src=config.url;node.title='TouDi 辅助填报';node.setAttribute('data-toudi-panel','frame');node.allow='clipboard-write';return node;};
    let frame=makeFrame();
    bar.append(label,minimize,close);shell.append(bar,frame);shadow.append(style,shell);document.documentElement.append(host);
    let x=Math.max(8,innerWidth-416),y=Math.max(8,Math.min(64,innerHeight*.06)),minimized=false,unavailable=false,pane='fill',drag,readyTimer,contextTimer;
    function layout(){const width=Math.max(160,Math.min(minimized?210:400,innerWidth-16)),height=minimized?38:Math.max(140,Math.min(690,innerHeight*.82,innerHeight-16));x=Math.max(8,Math.min(x,innerWidth-width-8));y=Math.max(8,Math.min(y,innerHeight-height-8));for(const [key,value]of Object.entries({left:x,top:y,width,height}))host.style.setProperty(key,value+'px','important');}
    function show(){minimized=false;shell.classList.remove('minimized');minimize.textContent='−';minimize.title='最小化窗口';minimize.setAttribute('aria-label','最小化窗口');label.textContent='TouDi · 拖动此处移动';layout();}
    function finish(){drag=null;frame.style.pointerEvents='';}
    function dispose(){
      clearTimeout(readyTimer);clearInterval(contextTimer);frameWatch.disconnect();
      // The close button survives in page DOM after an extension reload, while
      // its old runtime context does not. Always remove the page-owned shell.
      try{chrome.runtime.onMessage.removeListener(runtimeReady);}catch(_){}
      removeEventListener('message',ready);removeEventListener('resize',layout);host.remove();current=null;
    }
    minimize.addEventListener('click',()=>{if(minimized){show();return;}minimized=true;shell.classList.add('minimized');minimize.textContent='□';minimize.title='展开窗口';minimize.setAttribute('aria-label','展开窗口');label.textContent='TouDi · 辅助填报';layout();});
    close.addEventListener('click',dispose);
    bar.addEventListener('pointerdown',event=>{if(event.target.closest('button')||event.button!==0)return;drag={x:event.clientX,y:event.clientY,left:x,top:y};bar.setPointerCapture(event.pointerId);frame.style.pointerEvents='none';event.preventDefault();});
    bar.addEventListener('pointermove',event=>{if(!drag)return;x=drag.left+event.clientX-drag.x;y=drag.top+event.clientY-drag.y;layout();});
    bar.addEventListener('pointerup',finish);bar.addEventListener('lostpointercapture',finish);
    const status=document.createElement('div');status.className='status';status.setAttribute('role','status');status.textContent='正在打开填报工具…';shell.append(status);
    let loaded=false,fallback;
    const expectedOrigin=new URL(config.url).protocol+'//'+new URL(config.url).host;
    const validFrame=()=>!frame.hasAttribute('srcdoc') && frame.getAttribute('src')===config.url;
    function recover(){
      clearTimeout(readyTimer);frameWatch.disconnect();const previous=frame;frame=makeFrame();previous.replaceWith(frame);
      loaded=false;unavailable=false;shell.classList.remove('unavailable');status.hidden=false;status.textContent='正在打开填报工具…';if(fallback)fallback.hidden=true;
      watchFrame();readyTimer=setTimeout(()=>{if(!loaded)fail('load-timeout');},6000);layout();
    }
    function fail(reason){
      loaded=false;unavailable=true;clearTimeout(readyTimer);shell.classList.add('unavailable');status.hidden=false;
      status.textContent='浮窗未能加载，请重试。招聘网页和已填写内容保持原样。';
      if(!fallback){fallback=document.createElement('button');fallback.className='fallback';fallback.textContent='重新加载浮窗';fallback.addEventListener('click',recover);shell.append(fallback);}
      fallback.hidden=false;layout();
    }
    const markReady=()=>{if(!validFrame())return;loaded=true;unavailable=false;clearTimeout(readyTimer);shell.classList.remove('unavailable');status.hidden=true;if(fallback)fallback.hidden=true;layout();};
    const ready=event=>{if(!validFrame() || event.source!==frame.contentWindow || event.origin!==expectedOrigin)return;if(event.data?.type==='toudi-panel-pane' && ['fill','library'].includes(event.data.pane)){pane=event.data.pane;layout();return;}if(event.data?.type==='toudi-panel-ready')markReady();};
    // Runtime acknowledgement requires the action token and carries no profile values.
    const runtimeReady=(message,sender)=>{if(sender.id===chrome.runtime.id && message.type==='toudi-panel-ready' && message.panelToken===config.token)markReady();};
    // A frame can load successfully and later be replaced by an empty srcdoc.
    // Report the loss without changing its URL, attributes or origin isolation.
    const frameWatch=new MutationObserver(()=>{if(!validFrame())fail('frame-replaced');});
    function watchFrame(){frameWatch.observe(frame,{attributes:true,attributeFilter:['src','srcdoc']});frame.addEventListener('error',()=>fail('load-error'));}
    watchFrame();chrome.runtime.onMessage.addListener(runtimeReady);
    addEventListener('message',ready);
    readyTimer=setTimeout(()=>{if(!loaded)fail('load-timeout');},6000);
    if(!validFrame())fail('frame-replaced');
    addEventListener('resize',layout);layout();current={host,show,dispose};
    globalThis.TouDiPanelHost.dispose=dispose;
    // Chrome invalidates the content context on reload, but may retain its DOM.
    // Discard that dead shell; the next explicit toolbar click creates a fresh
    // authenticated frame in this same recruitment document.
    contextTimer=setInterval(()=>{try{if(!chrome.runtime.id)dispose();}catch(_){dispose();}},1000);
  };
})();
