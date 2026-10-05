#!/usr/bin/env python3
"""手机版快照构建：把中控台（投递管理.html + 四份数据 JSON）打包成加密首页，二进制资料原件按需加载，
产物 投递数据/手机版/index.html 与 assets/*.bin —— 打开后先输口令，浏览器内 AES-GCM 解密还原，可部署到任意静态托管。

用法：
    python3 app/脚本/10_手机版快照.py            # 构建（口令取 手机版/.passcode，没有则自动生成）
    python3 app/脚本/10_手机版快照.py --set-pass  # 交互式修改口令并重建

规则（固定流程的一部分）：
- 加密参数：明文凭 HTML 先 gzip 压缩（压缩率 ~75%，否则 base64 密文随机字节压不动、传输体积大），
  再 PBKDF2-HMAC-SHA256 150k 迭代派生 AES-256-GCM 密钥加密；salt/iv 每次随机；
  默认密文存为 assets/*.bin，解锁壳按需获取；--inline-payload 可回退内嵌 base64。页面源码不含个人明文数据。
  解锁端用 DecompressionStream('gzip') 解压（Safari 16.4+/Chrome 80+，2023 年后的浏览器均可）。
- 快照为只读：种子数据在解锁后保存在内存，按当前模块加载，不覆盖该源 localStorage；
  手机端编辑不生效是设计行为（编辑回电脑）。
- .passcode 是本机密文口令文件，勿提交/外发；忘记口令重跑本脚本重建即可，本机数据不受影响。
"""
from publish_records import validate
from update_common import data_lock
import argparse
import base64
import gzip
import json
import os
import re
import secrets
import shutil
import sys
from datetime import datetime
from hashlib import pbkdf2_hmac, sha256

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from prep_resources import resource_bundle
from prospect_catalog import read_catalog, safe_path
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, str(Path(SCRIPT_DIR).parent))
DATA_DIR = os.path.join(os.environ.get('TOUDI_WORKSPACE', str(Path(__file__).resolve().parents[2] / 'runtime')), '投递数据')
os.makedirs(DATA_DIR, exist_ok=True)
HTML_FILE = str(Path(__file__).resolve().parents[1] / '投递管理.html')
EDITS_FILE = os.path.join(DATA_DIR, '用户编辑数据.json')
REVIEWS_FILE = os.path.join(DATA_DIR, '面试复盘数据.json')
PREPS_FILE = os.path.join(DATA_DIR, '面试准备数据.json')
QBANK_FILE = os.path.join(DATA_DIR, '逐字稿数据.json')
OUT_DIR = os.path.join(DATA_DIR, '手机版')
OUT_FILE = os.path.join(OUT_DIR, 'index.html')
PASS_FILE = os.path.join(OUT_DIR, '.passcode')

ITERATIONS = 150_000


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def build_payload(resources=None):
    """中控台 HTML + 种子数据脚本 → 明文快照。"""
    html = open(HTML_FILE, encoding='utf-8').read()
    from preference_rules import bootstrap_script
    settings = read_json(os.path.join(DATA_DIR, '工作区配置.json'), {})
    html = html.replace('<script src="/assets/preference-defaults.js"></script>',
                        '<script>' + bootstrap_script(settings.get('preferenceRules')) + '</script>')
    settings_style = Path(HTML_FILE).parent / 'assets' / 'settings.css'
    html = html.replace('<link rel="stylesheet" href="/assets/settings.css">', '<style>' + settings_style.read_text(encoding='utf-8') + '</style>')
    management = Path(HTML_FILE).parent / 'assets' / 'workbench.js'
    html = html.replace('<script src="/assets/workbench.js"></script>', '<script>' + management.read_text(encoding='utf-8').replace('</script', '<\\/script') + '</script>')
    # Assisted filling uses the local fact source, never the encrypted reading snapshot.
    html = html.replace('<link rel="stylesheet" href="/assets/filling.css">', '').replace('<script src="/assets/filling.js"></script>', '')
    icon = (Path(HTML_FILE).parent / 'assets' / 'favicon.svg').read_bytes()
    html = html.replace('href="/assets/favicon.svg"', 'href="data:image/svg+xml;base64,' + base64.b64encode(icon).decode() + '"')
    rows = read_json(os.path.join(DATA_DIR, '投递记录.json'), [])
    validate(rows)
    html = html.replace('const RAW_DATA = [];', 'const RAW_DATA = ' + json.dumps(rows, ensure_ascii=False).replace('<', chr(92) + 'u003c') + ';', 1)
    boot = 'initServerStorage().then(()=>ensureViewData(view));'
    if boot not in html:
        raise RuntimeError('中控台启动流程已变化，请检查手机版初始化适配')
    # Static mobile pages have no /api server. Read all seeded caches immediately,
    # rather than blocking preparation data behind network/local-service probes.
    html = html.replace(boot, 'ensureViewData(view);')
    html = html.replace('async function detectApiBase() {', 'async function detectApiBase() {\n  if(window.__SNAPSHOT__)return null;')
    edits = read_json(EDITS_FILE, {})
    reviews = read_json(REVIEWS_FILE, {'sessions': []})
    preps = read_json(PREPS_FILE, {'preps': []})
    qbank = read_json(QBANK_FILE, {'categories': []})
    snap_date = datetime.now().strftime('%Y-%m-%d %H:%M')

    seed = {
        'toudiEdits': edits.get('edits') or {},
        'toudiPref': edits.get('pref') or {},
        'toudiReviews': {'sessions': reviews.get('sessions') or []},
        'toudiPreps': {'preps': preps.get('preps') or []},
        'toudiQBank': {'categories': qbank.get('categories') or []},
    }
    prospects_root = Path(DATA_DIR).parent / '岗位探查'
    prospects = read_catalog(prospects_root, edits.get('edits') or {})
    files = {}
    for item in prospects['prospects']:
        for attachment in item.get('attachments', []):
            files[attachment['file']] = safe_path(prospects_root, attachment['file']).read_text()
    for archive in prospects.get('archives', []):
        files[archive['file']] = safe_path(prospects_root, archive['file']).read_text()
    prospects['files'] = files
    seed['toudiProspects'] = prospects
    # Snapshot-owned objects are read lazily from memory, never sync-written over desktop caches.
    seed_js = 'window.__SNAPSHOT__=true;window.__SNAPSHOT_SEED__=' + json.dumps(seed, ensure_ascii=False, separators=(',', ':')).replace('<', chr(92) + 'u003c') + ';'
    if resources is None:
        resources = resource_bundle(DATA_DIR, preps)
    resources_js = 'window.__PREP_RESOURCES__=' + json.dumps(resources, ensure_ascii=False).replace('<', chr(92) + 'u003c') + ';'
    # Keep the desktop reader unchanged; only the mobile snapshot loads originals on demand.
    html = html.replace("data.mime==='application/pdf'&&data.data", "data.mime==='application/pdf'&&(data.data||data.binaryUrl)")
    start = "      pages.addEventListener('toggle',()=>{if(!pages.open||pages.dataset.loaded)return;pages.dataset.loaded='1';"
    end = "      });\n    }else if(data.text===undefined)"
    if start not in html or end not in html:
        raise RuntimeError('资料阅读器结构已变化，请检查手机版原页加载适配')
    begin = html.index(start)
    finish = html.index(end, begin)
    html = html[:begin] + """      pages.addEventListener('toggle',async()=>{
        if(!pages.open||pages.dataset.loaded||pages.dataset.loading)return;
        pages.dataset.loading='1';
        let status=pages.querySelector('.resource-status');
        if(!status){status=document.createElement('p');status.className='resource-status';pages.append(status);}
        status.textContent='正在加载原页，正文可继续阅读…';
        try{
          let bytes;
          if(data.binaryUrl){
            const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
            try{
              const response=await fetch(data.binaryUrl,{signal:controller.signal});
              if(!response.ok)throw new Error('HTTP '+response.status);
              const encrypted=await response.arrayBuffer();
              bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(data.binaryIv),c=>c.charCodeAt(0))},window.__SNAPSHOT_KEY__,encrypted);
            }finally{clearTimeout(timer);}
          }else{bytes=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));}
          if(!block.isConnected)return;
          const url=URL.createObjectURL(new Blob([bytes],{type:data.mime}));
          const frame=document.createElement('iframe');frame.src=url;frame.title=data.name;frame.style.cssText='width:100%;height:70vh;border:0';pages.append(frame);
          pages.dataset.loaded='1';status.remove();
          const observer=new MutationObserver(()=>{if(!block.isConnected){URL.revokeObjectURL(url);observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
        }catch(error){status.textContent='原页暂时加载失败，正文不受影响。收起后重新展开即可重试。';}
        finally{delete pages.dataset.loading;}
""" + html[finish:]
    badge_js = (
        "window.addEventListener('load',function(){var b=document.createElement('div');"
        f"b.textContent='只读快照 · 更新于 {snap_date}';"
        "b.style.cssText='position:fixed;left:10px;bottom:10px;z-index:150;background:var(--card);color:var(--text2);border:1px solid var(--border);"
        "font-size:11px;padding:4px 10px;border-radius:999px;opacity:.75;pointer-events:none';"
        "document.body.appendChild(b);});")
    inject = '<script>' + seed_js + resources_js + badge_js + '</script>'

    m = re.search(r'<body[^>]*>', html)
    if not m:
        print('[失败] 投递管理.html 中未找到 <body>')
        sys.exit(1)
    return html[:m.end()] + inject + html[m.end():], snap_date


WRAPPER = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>投递中控台 · 手机版</title>
<script>(function(){try{var w=JSON.parse(localStorage.getItem('toudiWorkspace_v1')||'{}');document.documentElement.dataset.theme=(w.theme==='dark'||((!w.theme||w.theme==='system')&&matchMedia('(prefers-color-scheme:dark)').matches))?'dark':'light';}catch(e){}})();</script>
<style>
  :root { color-scheme:light;--shell-bg:#f4f6f7;--shell-card:#fff;--shell-text:#243338;--shell-muted:#62767c;--shell-border:#d5dfe2;--shell-accent:#386a70;--shell-on:#fff; }
  :root[data-theme=dark] { color-scheme:dark;--shell-bg:#172025;--shell-card:#202b31;--shell-text:#e4eaed;--shell-muted:#b3c1c7;--shell-border:#405057;--shell-accent:#8ebfc0;--shell-on:#172025; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--shell-bg);
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif; }
  .card { background:var(--shell-card); border:1px solid var(--shell-border); border-radius:8px; box-shadow:none;
          padding:28px 24px; width:min(92vw,360px); text-align:center; }
  h1 { font-size:18px; color:var(--shell-text); margin-bottom:6px; }
  .sub { font-size:12px; color:var(--shell-muted); margin-bottom:20px; }
  input { background:var(--shell-card);color:var(--shell-text);width:100%; padding:12px 14px; font-size:16px; border:1px solid var(--shell-border); border-radius:8px; outline:none;
          text-align:center; letter-spacing:2px; }
  input:focus { border-color:var(--shell-accent); box-shadow:0 0 0 3px rgba(56,106,112,.15); }
  button { width:100%; margin-top:12px; padding:12px; font-size:15px; font-weight:600; color:var(--shell-on); background:var(--shell-accent);
           border:none; border-radius:8px; cursor:pointer; }
  button:active { background:var(--shell-accent); }
  .err { color:#ef4444; font-size:12px; margin-top:10px; min-height:16px; }
  .remember { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:14px;
              font-size:12px; color:var(--shell-muted); }
  .remember input { width:auto; letter-spacing:0; }
  .busy { color:var(--shell-muted); font-size:13px; margin-top:14px; display:none; }
</style>
</head>
<body>
<div class="card" id="card">
  <h1>投递中控台 · 手机版</h1>
  <div class="sub">只读快照 · 数据更新于 __SNAP_DATE__</div>
  <form id="f">
    <input type="password" id="pw" placeholder="输入访问口令" autocomplete="current-password">
    <button type="submit">解锁</button>
  </form>
  <div class="err" id="err"></div>
  <label class="remember"><input type="checkbox" id="rm" checked> 在本机记住口令</label>
  <div class="busy" id="busy">解密中，正在读取只读快照…</div>
</div>
<script>
var SALT='__SALT__', IV='__IV__', CT='__CT__', PAYLOAD_URL='__PAYLOAD_URL__';
window.__SNAPSHOT_PERF__={};
function b64(s){return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0)});}
async function unlock(pw){
  var metrics=window.__SNAPSHOT_PERF__, started=performance.now();
  var encryptedPromise=PAYLOAD_URL?fetch(PAYLOAD_URL).then(async function(response){
    if(!response.ok)throw new Error('密文下载失败 HTTP '+response.status);
    var bytes=await response.arrayBuffer();metrics.downloadMs=performance.now()-started;metrics.payloadBytes=bytes.byteLength;return bytes;
  }):Promise.resolve(b64(CT));
  var deriveStarted=performance.now();
  var km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  var key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(SALT),iterations:__ITER__,hash:'SHA-256'},
    km,{name:'AES-GCM',length:256},false,['decrypt']);
  metrics.deriveMs=performance.now()-deriveStarted;
  var encrypted=await encryptedPromise,decryptStarted=performance.now();
  var buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(IV)},key,encrypted);
  metrics.decryptMs=performance.now()-decryptStarted;
  window.__SNAPSHOT_KEY__=key;
  document.getElementById('busy').textContent='口令已验证，正在打开中控台…';
  var decompressStarted=performance.now(),ds=new DecompressionStream('gzip');
  var plain=await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
  metrics.decompressMs=performance.now()-decompressStarted;metrics.plainBytes=plain.byteLength;
  return new TextDecoder('utf-8').decode(plain);
}

async function go(pw){
  if(window.__UNLOCKING__)return;window.__UNLOCKING__=true;
  document.getElementById('err').textContent='';
  document.getElementById('busy').style.display='block';
  document.getElementById('busy').textContent='正在验证口令…';
  try{
    var html=await unlock(pw);
    if(document.getElementById('rm').checked){try{localStorage.setItem('snap_pw',btoa(pw));}catch(e){}}
    else{try{localStorage.removeItem('snap_pw');}catch(e){}}
    window.__SNAPSHOT_PERF__.renderStarted=performance.now();document.open();document.write(html);document.close();window.__SNAPSHOT_PERF__.parsedMs=performance.now()-window.__SNAPSHOT_PERF__.renderStarted;
  }catch(e){
    document.getElementById('busy').style.display='none';
    document.getElementById('err').textContent=(typeof DecompressionStream==='undefined')?
      '浏览器版本过低，请升级系统浏览器后再试':(e.name==='OperationError'?'口令不正确，请重试':'页面打开失败，请刷新后重试');
    window.__UNLOCKING__=false;
  }
}
document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();go(document.getElementById('pw').value);});
(function(){try{var s=localStorage.getItem('snap_pw');if(s){document.getElementById('pw').value=atob(s);go(atob(s));}}catch(e){}})();
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description='手机版加密快照构建')
    ap.add_argument('--inline-payload', action='store_true', help='兼容回退：密文仍内嵌首页，与旧打包方式相同')
    ap.add_argument('--set-pass', action='store_true', help='交互式设置新口令')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    if args.set_pass or not os.path.exists(PASS_FILE):
        if args.set_pass:
            pw = input('请输入新口令（手机解锁用，建议 6 位以上）: ').strip()
            if len(pw) < 4:
                print('[失败] 口令至少 4 位')
                sys.exit(1)
        else:
            pw = secrets.token_urlsafe(8)[:10]
            print(f'[已生成随机口令并保存] {PASS_FILE}，请在本机读取；日志不输出口令')
        with open(PASS_FILE, 'w', encoding='utf-8') as f:
            f.write(pw)
        os.chmod(PASS_FILE, 0o600)
    else:
        pw = open(PASS_FILE, encoding='utf-8').read().strip()
    if not pw:
        print('[失败] 口令为空')
        sys.exit(1)

    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    key = pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, ITERATIONS, dklen=32)
    resources = resource_bundle(DATA_DIR, read_json(PREPS_FILE, {'preps': []}))
    assets_dir = os.path.join(OUT_DIR, 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    current_assets = set()
    for resource in resources.values():
        if 'data' not in resource:
            continue
        binary_iv = secrets.token_bytes(12)
        encrypted = AESGCM(key).encrypt(binary_iv, base64.b64decode(resource.pop('data')), None)
        name = sha256(encrypted).hexdigest() + '.bin'
        current_assets.add(name)
        with open(os.path.join(assets_dir, name), 'wb') as f:
            f.write(encrypted)
        resource.update(binaryUrl='assets/' + name, binaryIv=base64.b64encode(binary_iv).decode())
    payload, snap_date = build_payload(resources)
    gz = gzip.compress(payload.encode('utf-8'), compresslevel=9, mtime=0)
    ct = AESGCM(key).encrypt(iv, gz, None)

    payload_name = ''
    if not args.inline_payload:
        payload_name = sha256(ct).hexdigest() + '.bin'
        current_assets.add(payload_name)
        with open(os.path.join(assets_dir, payload_name), 'wb') as f:
            f.write(ct)
    out = (WRAPPER
           .replace('__SNAP_DATE__', snap_date)
           .replace('__SALT__', base64.b64encode(salt).decode())
           .replace('__IV__', base64.b64encode(iv).decode())
           .replace('__CT__', base64.b64encode(ct).decode() if args.inline_payload else '')
           .replace('__PAYLOAD_URL__', 'assets/' + payload_name if payload_name else '')
           .replace('__ITER__', str(ITERATIONS)))
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(out)
    for name in os.listdir(assets_dir):
        if re.fullmatch(r'[0-9a-f]{64}\.bin', name) and name not in current_assets:
            os.remove(os.path.join(assets_dir, name))
    # Explicit allowlist: stage only the wrapper and encrypted originals, never credentials.
    stage = os.path.join(OUT_DIR, '.stage')
    if os.path.exists(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)
    shutil.copy2(OUT_FILE, os.path.join(stage, 'index.html'))
    os.makedirs(os.path.join(stage, 'assets'))
    for name in current_assets:
        shutil.copy2(os.path.join(assets_dir, name), os.path.join(stage, 'assets', name))

    size = os.path.getsize(OUT_FILE) / 1024
    print(f'[完成] {OUT_FILE}（{size:.0f} KB，明文快照 {len(payload.encode("utf-8"))//1024} KB）')
    print(f'  数据截至：{snap_date}；口令文件：{PASS_FILE}')
    print('  已生成干净部署目录 .stage（仅首页及加密附件）；按 docs/首次使用与部署.md 发布，构建不自动部署。')


if __name__ == '__main__':
    with data_lock(DATA_DIR, shared=True):
        main()
