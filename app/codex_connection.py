"""Use the user's installed Codex and ChatGPT login; never read credentials or use API keys."""
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

_cache = None
_cache_lock = threading.Lock()


def codex_environment():
    env = dict(os.environ)
    for key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID',
                'OPENAI_PROJECT_ID', 'CODEX_ACCESS_TOKEN', 'OPENAI_ADMIN_KEY'):
        env.pop(key, None)
    # Finder-launched applications do not inherit the user's interactive shell PATH.
    folders = [Path.home()/'.npm-global/bin', Path.home()/'.local/bin',
               Path('/opt/homebrew/bin'), Path('/usr/local/bin')]
    if os.name == 'nt':
        folders.append(Path(os.environ.get('APPDATA', str(Path.home()/'AppData/Roaming')))/'npm')
    env['PATH'] = os.pathsep.join([env.get('PATH', ''), *(str(p) for p in folders if p.is_dir())])
    return env


def codex_binary():
    # Use the desktop application's own client before an older npm installation.
    # Both use the existing Codex login; no token extraction or new login flow.
    if sys.platform == 'darwin':
        for directory in (Path('/Applications'), Path.home()/'Applications'):
            for name in ('Codex.app', 'ChatGPT.app'):
                bundle = directory/name/'Contents/Resources/codex-cli/bin/codex'
                if bundle.is_file() and os.access(bundle, os.X_OK):
                    return str(bundle)
    return shutil.which('codex.cmd' if os.name == 'nt' else 'codex', path=codex_environment()['PATH'])


def chatgpt_login(binary=None, env=None):
    binary = binary or codex_binary()
    if not binary:
        return {'available': False, 'auth': 'missing', 'message': '未找到 Codex CLI；可把匹配任务交给已有的 Codex 对话。'}
    try:
        result = subprocess.run([binary, 'login', 'status'], capture_output=True, text=True,
                                timeout=8, env=env or codex_environment())
    except (OSError, subprocess.TimeoutExpired):
        return {'available': False, 'auth': 'unknown', 'message': 'Codex 登录状态未能读取；保留本地匹配计划。'}
    output = (result.stdout + result.stderr).lower()
    if result.returncode == 0 and 'logged in using chatgpt' in output:
        return {'available': True, 'auth': 'chatgpt', 'billing': 'codex-plan',
                'message': '使用现有 ChatGPT 登录与 Codex 额度。'}
    if 'api key' in output or 'api_key' in output:
        return {'available': False, 'auth': 'api', 'message': '当前 CLI 使用 API Key；自动匹配已停用。请在 Codex CLI 使用 ChatGPT 登录。'}
    return {'available': False, 'auth': 'signed-out', 'message': '请先在 Codex CLI 使用 ChatGPT 登录，随后重新检查连接。'}


def codex_status(refresh=False, timeout=18):
    """Read the official model/list protocol. A catalog is not proof of a successful inference."""
    global _cache
    with _cache_lock:
        binary = codex_binary()
        if not refresh and _cache and _cache[1] == binary and time.monotonic()-_cache[0] < 60:
            return _cache[2]
        env = codex_environment()
        status = chatgpt_login(binary, env)
        if not status['available']:
            return {**status, 'models': []}
        process = None
        try:
            with tempfile.TemporaryDirectory(prefix='toudi-codex-check-') as root:
                process = subprocess.Popen([binary, 'app-server', '--listen', 'stdio://',
                    '-c', 'model_provider="openai"'], cwd=root, env=env, text=True,
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                messages = queue.Queue()
                def receive():
                    try:
                        for line in process.stdout:
                            try: messages.put(json.loads(line))
                            except ValueError: pass
                    except (OSError, ValueError): pass
                reader = threading.Thread(target=receive, daemon=True)
                reader.start()
                deadline = time.monotonic()+timeout
                def rpc(ident, method, params):
                    process.stdin.write(json.dumps({'id':ident, 'method':method, 'params':params})+'\n')
                    process.stdin.flush()
                    while time.monotonic() < deadline:
                        try: answer = messages.get(timeout=max(.01, min(1, deadline-time.monotonic())))
                        except queue.Empty: continue
                        if answer.get('id') == ident:
                            if 'error' in answer: raise ValueError('Codex 未提供模型目录')
                            return answer['result']
                    raise TimeoutError('Codex 模型目录读取超时')
                rpc(1, 'initialize', {'clientInfo':{'name':'toudi-filling', 'title':'TouDi filling', 'version':'0.1.0'}})
                process.stdin.write('{"method":"initialized"}\n'); process.stdin.flush()
                account = rpc(2, 'account/read', {'refreshToken':False})
                if (account.get('account') or {}).get('type') != 'chatgpt':
                    return {'available':False, 'auth':'unknown', 'models':[], 'message':'Codex 未确认 ChatGPT 登录，自动匹配已停用。'}
                models = []
                cursor = None
                for _ in range(4):
                    page = rpc(3+len(models), 'model/list', {'limit':100, 'includeHidden':False, 'cursor':cursor})
                    for item in page.get('data', []):
                        if item.get('hidden'): continue
                        efforts = [x['reasoningEffort'] for x in item.get('supportedReasoningEfforts', [])]
                        models.append({'id':item['model'], 'label':item.get('displayName', item['model']),
                                       'default':bool(item.get('isDefault')), 'effort':'low' if 'low' in efforts else item.get('defaultReasoningEffort', 'medium')})
                    cursor = page.get('nextCursor')
                    if not cursor: break
                result = {**status, 'available':bool(models), 'models':models, 'catalogOnly':True}
                if not models: result['message'] = '当前 CLI 未返回可选模型；可把匹配任务交给已有的 Codex 对话。'
                _cache = (time.monotonic(), binary, result)
                return result
        except (OSError, ValueError, KeyError, TimeoutError):
            return {**status, 'available':False, 'models':[], 'message':'当前 CLI 的模型目录未能读取；可复制匹配任务到已有的 Codex 对话。'}
        finally:
            if process:
                process.terminate()
                try: process.wait(timeout=2)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
                if 'reader' in locals(): reader.join(timeout=1)
                for stream in (process.stdin, process.stdout):
                    if stream: stream.close()
