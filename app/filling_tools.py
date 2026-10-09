"""Read-only filling profile/export utilities shared by the App and Agent CLI.

Form recognition, corrections and sessions belong to the browser extension.
The native helper supplies only the user-selected Codex mapping operation.
"""
import io
import json
import os
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

import filling_profile

EXTENSION_FILES = (
    'agent-config.js', 'filling-aliases.js', 'filling-core.js', 'filling-workflow.js', 'manifest.json', 'interface.css', 'interface-motion.js',
    'options.css', 'options.html', 'options.js', 'profile-library.js', 'profile-view.js', 'sync-core.js', 'popup.css', 'popup.html',
    'popup.js', 'panel-host.js', 'panel-worker.js', 'worker.js',
)


def extension_bundle():
    root = Path(__file__).resolve().parent
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name in EXTENSION_FILES:
            path = root / 'browser-extension' / name
            if path.is_symlink():
                raise ValueError('Extension source must not be a symbolic link')
            bundle.writestr('TouDi-filling/' + name, path.read_bytes())
        for name, source in [('form-adapters.js', 'form-adapters.js'), ('form-engine.js', 'form-engine.js'), ('logo.svg', 'favicon.svg')]:
            bundle.writestr('TouDi-filling/' + name, (root / 'assets' / source).read_bytes())
    return output.getvalue()


def profile_status(workspace, profile_id='general'):
    try:
        profile = filling_profile.load_profile(workspace, profile_id)
        result = filling_profile.profile_summary(profile)
        result['available'] = profile['sourceVersion'] != 'missing'
    except FileNotFoundError:
        result = {'available': False, 'sourceName': '网申信息库.json / 填报资料/资料.json',
                  'message': '尚未提供填报资料；请让 Agent 整理已确认的信息', 'profiles': []}
    return {**result, 'protocol': 1, 'localOnly': True}


def _write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.filling-', dir=path.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _validate_scan(scan):
    if not isinstance(scan, dict) or scan.get('protocol') != 1:
        raise ValueError('不支持的表单快照版本')
    origin = urlsplit(str(scan.get('origin', '')))
    if origin.scheme not in {'https', 'http'} or not origin.netloc or origin.username or origin.password or origin.path or origin.query or origin.fragment:
        raise ValueError('表单来源无效')
    path = scan.get('path', '')
    if not isinstance(path, str) or not path.startswith('/') or '?' in path or '#' in path or len(path) > 1000:
        raise ValueError('表单路径无效；不要传入查询参数或登录凭据')
    if not isinstance(scan.get('fingerprint'), str) or not 1 <= len(scan['fingerprint']) <= 150:
        raise ValueError('缺少表单结构指纹')
    fields = scan.get('fields')
    if not isinstance(fields, list) or len(fields) > 500:
        raise ValueError('字段数量超出本次填报范围')
    ids = set()
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get('id'), str) or len(field['id']) > 300 or not field['id'] or field['id'] in ids:
            raise ValueError('字段 id 必须唯一且有效')
        ids.add(field['id'])
        for name in ('label', 'groupLabel', 'recordHint'):
            if not isinstance(field.get(name, ''), str) or len(field.get(name, '')) > 1000:
                raise ValueError('字段上下文过长或无效')
        if field.get('type') in {'password', 'hidden'}:
            raise ValueError('不要传入密码或隐藏字段')
        if len(json.dumps(field, ensure_ascii=False)) > 24000:
            raise ValueError('单项字段内容超出限制')
    return scan
