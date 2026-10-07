/* Local-only comparison: never sends profile values to a model. */
(function(root){
  const volatile=new Set(['sourceName','sourceVersion','savedAt','importedAt','editedAt']);
  function clean(value,top=true){if(Array.isArray(value))return value.map(x=>clean(x,false));if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!top || !volatile.has(k)).map(k=>[k,clean(value[k],false)]));return value;}
  const same=(a,b)=>JSON.stringify(clean(a))===JSON.stringify(clean(b));
  function compare(base,local,remote){if(same(local,remote))return 'equal';if(same(local,base))return 'remote';if(same(remote,base))return 'local';return 'conflict';}
  function merge(base,local,remote){
    const conflicts=[];
    function pick(b,l,r,path){const type=compare(b,l,r);if(type==='equal'||type==='local')return l;if(type==='remote')return r;conflicts.push(path);return l;}
    const result={};for(const key of new Set([...Object.keys(local||{}),...Object.keys(remote||{})])){
      if(volatile.has(key))continue;
      if(['facts','profiles'].includes(key)){
        const id=key==='facts'?'key':'id',b=new Map((base?.[key]||[]).map(x=>[x[id],x])),l=new Map((local?.[key]||[]).map(x=>[x[id],x])),r=new Map((remote?.[key]||[]).map(x=>[x[id],x]));
        result[key]=[...new Set([...l.keys(),...r.keys(),...b.keys()])].map(k=>pick(b.get(k),l.get(k),r.get(k),key+':'+k)).filter(x=>x!==undefined);
      }else{const value=pick(base?.[key],local?.[key],remote?.[key],key);if(value!==undefined)result[key]=value;}
    }return {pack:result,conflicts};
  }
  const api={same,compare,merge};root.TouDiProfileSync=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
