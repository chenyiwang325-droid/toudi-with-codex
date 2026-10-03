"""Single-owner HTTPS deployment boundary; local mode keeps its loopback contract."""
import base64
import hashlib
import hmac
import html
import json
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit

MODE = os.environ.get('TOUDI_MODE', 'local')
PUBLIC_URL = (os.environ.get('TOUDI_PUBLIC_URL') or os.environ.get('RENDER_EXTERNAL_URL', '')).rstrip('/')
PASSWORD = os.environ.get('TOUDI_PASSWORD', '')
SESSION_SECRET = os.environ.get('TOUDI_SESSION_SECRET', '')
AGENT_TOKEN = os.environ.get('TOUDI_AGENT_TOKEN', '')
DESKTOP_TOKEN = os.environ.get('TOUDI_DESKTOP_TOKEN', '')
_failures = {}
_guard = threading.Lock()
SESSION_SECONDS = 12 * 3600
MAX_BODY = 32 * 1024 * 1024


def validate_configuration():
    if MODE not in {'local', 'hosted', 'desktop'}:
        raise ValueError('TOUDI_MODE must be local, hosted or desktop')
    if MODE == 'desktop' and len(DESKTOP_TOKEN) < 32:
        raise ValueError('desktop mode requires an ephemeral TOUDI_DESKTOP_TOKEN')
    if MODE == 'hosted':
        u = urlsplit(PUBLIC_URL)
        if u.scheme != 'https' or not u.netloc or u.username or u.password or u.path or u.query or u.fragment:
            raise ValueError('hosted mode requires TOUDI_PUBLIC_URL (HTTPS origin), or RENDER_EXTERNAL_URL')
        if len(PASSWORD) < 16 or len(SESSION_SECRET) < 32:
            raise ValueError('hosted mode requires TOUDI_PASSWORD (16+ chars) and TOUDI_SESSION_SECRET (32+ chars)')
        if AGENT_TOKEN and len(AGENT_TOKEN) < 32:
            raise ValueError('TOUDI_AGENT_TOKEN must contain at least 32 characters')
        if AGENT_TOKEN and hmac.compare_digest(AGENT_TOKEN.encode(), PASSWORD.encode()):
            raise ValueError('Agent token and browser password must be different')


def origin_allowed(handler, port):
    host, origin = handler.headers.get('Host', ''), handler.headers.get('Origin')
    if MODE in {'local', 'desktop'}:
        allowed = {f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'}
        return host in allowed and (not origin or origin in {'http://' + h for h in allowed})
    return host == urlsplit(PUBLIC_URL).netloc and (not origin or origin == PUBLIC_URL)


def is_agent(handler):
    if MODE == 'desktop':
        header = handler.headers.get('Authorization', '')
        return header.startswith('Bearer ') and bool(DESKTOP_TOKEN) and hmac.compare_digest(header[7:].encode(), DESKTOP_TOKEN.encode())
    if MODE != 'hosted' or not AGENT_TOKEN:
        return False
    header = handler.headers.get('Authorization', '')
    return header.startswith('Bearer ') and hmac.compare_digest(header[7:].encode(), AGENT_TOKEN.encode())


def _session():
    payload = f'{int(time.time())}.{secrets.token_hex(16)}'
    return payload + '.' + hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _has_session(handler):
    try:
        cookie = SimpleCookie(); cookie.load(handler.headers.get('Cookie', ''))
        value = cookie['toudi_session'].value
        stamp, nonce, signature = value.split('.')
        elapsed = time.time() - int(stamp)
        payload = stamp + '.' + nonce
        return -60 <= elapsed < SESSION_SECONDS and hmac.compare_digest(signature, hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest())
    except (KeyError, ValueError, TypeError, CookieError):
        return False


def _page(error=''):
    # Use the dashboard's established palette and platform fonts.
    return '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TouDi · 登录</title><style>
:root{color-scheme:light dark;--bg:#f4f6f7;--card:#fff;--text:#243338;--muted:#62767c;--border:#d5dfe2;--accent:#386a70;--on:#fff}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.login{width:min(400px,calc(100% - 40px));padding:32px;background:var(--card);border:1px solid var(--border);border-radius:10px}.brand{display:flex;gap:10px;align-items:center;font-weight:600}.brand svg{width:26px;height:26px}h1{font-size:24px;line-height:1.4;margin:28px 0 8px}p{color:var(--muted);margin:0 0 24px}label{display:block;margin-bottom:8px}input{display:block;width:100%;height:44px;padding:10px 12px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:5px;font:inherit}input:focus{outline:2px solid var(--accent);outline-offset:2px}button{width:100%;height:44px;margin-top:20px;background:var(--accent);color:var(--on);border:0;border-radius:5px;font:inherit;cursor:pointer}.error{color:#a45750;margin:12px 0 0}.foot{margin:24px 0 0;font-size:12px}@media(prefers-color-scheme:dark){:root{--bg:#172025;--card:#202b31;--text:#e4eaed;--muted:#b3c1c7;--border:#405057;--accent:#8ebfc0;--on:#172025}}</style><main class="login"><div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent)"/><g fill="var(--on)"><rect x="8" y="8" width="16" height="3" rx="1"/><rect x="8" y="13" width="3" height="11" rx="1"/><rect x="14" y="14" width="10" height="3" rx="1"/><rect x="14" y="21" width="10" height="3" rx="1"/></g></svg>TouDi 投递中控台</div><h1>打开你的工作台</h1><p>登录后查看资料、更新投递进度和继续准备。</p><form action="/auth/login" method="post"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus>''' + (f'<p class="error" role="alert">{html.escape(error)}</p>' if error else '') + '''<button>登录</button></form><p class="foot">个人工作台 · 资料保存在你的部署实例中</p></main></html>'''


def _reply(handler, body, code=200, content_type='text/html; charset=utf-8', headers=()):
    body = body.encode() if isinstance(body, str) else body
    handler.send_response(code)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(len(body)))
    for k, v in headers:
        handler.send_header(k, v)
    handler.end_headers(); handler.wfile.write(body)


def authorize(handler, port):
    """True means proceed. False means the request has already been answered."""
    path = urlsplit(handler.path).path
    if MODE == 'hosted' and path == '/healthz' and handler.command == 'GET':
        _reply(handler, '{"ok":true}', content_type='application/json'); return False
    if not origin_allowed(handler, port):
        handler._send_json({'error': 'same_origin_required'}, 403); return False
    if handler.command == 'POST':
        try:
            size = int(handler.headers.get('Content-Length', '0'))
            if size < 0 or size > MAX_BODY or handler.headers.get('Transfer-Encoding'):
                raise ValueError()
        except ValueError:
            handler._send_json({'error': 'invalid_or_excessive_body_size'}, 413); return False
    if MODE == 'local':
        return True
    if MODE == 'desktop':
        if is_agent(handler): return True
        handler._send_json({'error': 'desktop_session_required'}, 401)
        return False
    if handler.command == 'POST' and not is_agent(handler) and handler.headers.get('Origin') != PUBLIC_URL:
        handler._send_json({'error': 'same_origin_required'}, 403); return False
    if path == '/auth/login' and handler.command == 'GET':
        _reply(handler, _page()); return False
    if path == '/auth/login' and handler.command == 'POST':
        from urllib.parse import parse_qs
        with _guard:
            now = time.time()
            # The instance is single-owner. A short global limit also bounds proxy/IP ambiguity.
            recent = [t for t in _failures.get('login', []) if now-t < 600]
            _failures['login'] = recent
            if len(recent) >= 8:
                _reply(handler, _page('尝试次数较多，请十分钟后重试。'), 429); return False
            size = int(handler.headers.get('Content-Length', 0))
            if size > 4096:
                handler._send_json({'error': 'login_body_too_large'}, 413); return False
            password = parse_qs(handler.rfile.read(size).decode('utf-8', errors='replace')).get('password', [''])[0]
            if not hmac.compare_digest(password.encode(), PASSWORD.encode()):
                recent.append(now)
                _reply(handler, _page('密码不正确，请重新输入。'), 401); return False
            _failures['login'] = []
        _reply(handler, '', 303, headers=[('Location', '/'), ('Set-Cookie', f'toudi_session={_session()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={SESSION_SECONDS}')]); return False
    if path == '/auth/logout' and handler.command == 'POST':
        _reply(handler, '', 303, headers=[('Location', '/auth/login'), ('Set-Cookie', 'toudi_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0')]); return False
    if _has_session(handler) or (path.startswith('/api/') and is_agent(handler)):
        return True
    if path.startswith('/api/') or handler.command != 'GET':
        handler._send_json({'error': 'authentication_required'}, 401)
    else:
        _reply(handler, '', 303, headers=[('Location', '/auth/login')])
    return False
