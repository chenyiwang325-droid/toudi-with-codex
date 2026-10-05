"""Chrome's native messaging handshake: only discover the bound App connection."""
import base64
import hashlib
import json
import os
import re
import struct
import sys
from pathlib import Path
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

HOST = 'com.toudi.filling'


def extension_origin():
    manifest = json.loads((Path(__file__).parent/'browser-extension/manifest.json').read_text(encoding='utf-8'))
    digest = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    ident = ''.join(chr(ord('a')+int(char, 16)) for char in digest)
    return 'chrome-extension://'+ident+'/'


def manifest_path():
    if sys.platform == 'darwin':
        return Path.home()/'Library/Application Support/Google/Chrome/NativeMessagingHosts'/f'{HOST}.json'
    if os.name == 'nt':
        from workspace_link import app_profile
        return app_profile()/'chrome'/f'{HOST}.json'
    return Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home()/'.config')))/'google-chrome/NativeMessagingHosts'/f'{HOST}.json'


def status():
    path = manifest_path()
    available = bool(getattr(sys, 'frozen', False))
    enabled = False
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        enabled = (value.get('name') == HOST and value.get('path') == str(Path(sys.executable).resolve())
                   and value.get('allowed_origins') == [extension_origin()] and available)
    except (OSError, ValueError):
        pass
    return {'available':available, 'enabled':enabled}


def install():
    if not getattr(sys, 'frozen', False):
        raise ValueError('Chrome 自动连接由桌面 App 提供；源码服务可使用一次连接码。')
    path = manifest_path()
    if any(item.is_symlink() for item in [path, *path.parents]):
        raise ValueError('Chrome 连接位置为符号链接，未修改。')
    from filling_service import _write_private
    _write_private(path, {'name':HOST, 'description':'TouDi local form filling connection',
                         'path':str(Path(sys.executable).resolve()), 'type':'stdio',
                         'allowed_origins':[extension_origin()]})
    if os.name == 'nt':
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, 'Software\\Google\\Chrome\\NativeMessagingHosts\\'+HOST) as key:
            winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(path))
    return {'enabled':True, 'extensionId':extension_origin().split('://')[1].rstrip('/')}


def refresh_registration():
    """Keep an already-authorized connection working when the App is moved/updated."""
    if not getattr(sys, 'frozen', False):
        return
    path = manifest_path()
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if value.get('name') == HOST and value.get('allowed_origins') == [extension_origin()]:
            install()
    except (OSError, ValueError):
        pass


def bound_connection():
    from workspace_link import resolve_workspace, safe_directory
    workspace = safe_directory(resolve_workspace())
    private = workspace/'填报资料'
    paths = [private, private/'.desktop-endpoint.json', private/'.browser-token.json']
    if any(path.is_symlink() for path in paths):
        raise ValueError('本机连接资料无效。')
    endpoint = json.loads(paths[1].read_text(encoding='utf-8'))
    token = json.loads(paths[2].read_text(encoding='utf-8')).get('token', '')
    port = endpoint.get('port')
    if type(port) is not int or not 1024 <= port <= 65535 or not re.fullmatch('[0-9a-f]{64}', token):
        raise ValueError('本机连接资料无效。')
    url = f'http://127.0.0.1:{port}'
    request = Request(url+'/api/filling/bridge', data=b'{"op":"ping"}', method='POST',
                      headers={'Content-Type':'application/json', 'Authorization':'Bearer '+token,
                               'Origin':extension_origin().rstrip('/')})
    # Loopback traffic must never follow system proxy settings or redirects.
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=3) as response:
        if response.geturl() != request.full_url or response.status != 200:
            raise ValueError('请打开 TouDi App 后重试。')
    return {'protocol':1, 'url':url, 'token':token}


def serve(origin, stream_in=None, stream_out=None):
    """One request per Chrome process. Never accept file paths, facts or commands."""
    if origin.rstrip('/') != extension_origin().rstrip('/'):
        return 1
    stream_in = stream_in or sys.stdin.buffer
    stream_out = stream_out or sys.stdout.buffer
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        header = stream_in.read(4)
        if len(header) != 4:
            return 1
        length = struct.unpack('=I', header)[0]
        if not 1 <= length <= 4096:
            return 1
        data = stream_in.read(length)
        request = json.loads(data)
        if request != {'op':'connect', 'protocol':1}:
            raise ValueError('不支持的连接请求。')
        result = bound_connection()
    except (OSError, ValueError, TypeError, KeyError):
        result = {'error':'请打开 TouDi App；首次使用请在「辅助填报」启用 Chrome 连接。'}
    payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
    stream_out.write(struct.pack('=I', len(payload))+payload)
    stream_out.flush()
    return 0
