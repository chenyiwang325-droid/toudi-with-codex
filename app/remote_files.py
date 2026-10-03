"""Bounded Agent material API, with content versions and batch rollback."""
import base64
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DATA_FILES = {
    '投递记录.json': None, '用户编辑数据.json': 'edits', '逐字稿数据.json': 'categories',
    '面试准备数据.json': 'preps', '面试复盘数据.json': 'sessions', '工作区配置.json': 'schemaVersion',
}
MATERIAL_DIRS = {'面试准备', '岗位探查', '复盘'}
EXTENSIONS = {'.md', '.txt', '.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp'}
MAX_FILE = 20 * 1024 * 1024


def allowed_path(root, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in {'.', '..'} or p.startswith('.') for p in parts):
        raise ValueError('invalid material path')
    legal = (len(parts) == 2 and parts[0] == '投递数据' and parts[1] in DATA_FILES) or (
        len(parts) >= 2 and parts[0] in MATERIAL_DIRS and (Path(relative).suffix.lower() in EXTENSIONS or (relative == '岗位探查/探查目录.json')))
    cursor = root
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink(): raise ValueError('symlink material paths are not supported')
    path = (root / relative).resolve()
    if not legal or not path.is_relative_to(root.resolve()):
        raise ValueError('path is outside supported material files')
    return path


def version(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else 'missing'


def files(root):
    candidates = [root / '投递数据' / name for name in DATA_FILES]
    for directory in MATERIAL_DIRS:
        folder = root / directory
        if folder.is_dir():
            candidates.extend(p for p in folder.rglob('*') if p.is_file())
    result = []
    for path in candidates:
        try:
            relative = path.relative_to(root).as_posix()
            safe = allowed_path(root, relative)
            if not safe.is_file(): continue
            result.append({'path': relative, 'version': version(safe), 'size': safe.stat().st_size})
        except (ValueError, OSError):
            continue
    return sorted(result, key=lambda row: row['path'])


def check_content(relative, content, validate_records):
    if len(content) > MAX_FILE:
        raise ValueError('material exceeds 20 MiB')
    if relative.startswith('投递数据/') or relative == '岗位探查/探查目录.json':
        d = json.loads(content)
        key = DATA_FILES.get(Path(relative).name, 'companies')
        if Path(relative).name == '投递记录.json':
            validate_records(d)
        elif not isinstance(d, dict):
            raise ValueError('JSON material root must be an object')
        elif key == 'edits':
            if not isinstance(d.get('edits'), dict) or not isinstance(d.get('pref'), dict) or any(not isinstance(v, dict) for v in d['edits'].values()):
                raise ValueError('edits and pref must be objects')
        elif key != 'schemaVersion' and not isinstance(d.get(key), list):
            raise ValueError(f'JSON material requires a {key} array')
    elif Path(relative).suffix in {'.md', '.txt'}:
        content.decode('utf-8')


def serve_get(handler, workspace):
    root = Path(workspace)
    relative = parse_qs(urlsplit(handler.path).query).get('path', [''])[0]
    if not relative:
        return handler._send_json({'protocol': 1, 'files': files(root)})
    path = allowed_path(root, relative)
    if not path.is_file():
        return handler._send_json({'error': 'material_missing'}, 404)
    raw = path.read_bytes()
    if len(raw) > MAX_FILE:
        return handler._send_json({'error': 'material_exceeds_download_limit'}, 413)
    return handler._send_json({'path': relative, 'version': hashlib.sha256(raw).hexdigest(), 'contentBase64': base64.b64encode(raw).decode()})


def serve_post(handler, workspace, validate_records):
    root = Path(workspace)
    payload = json.loads(handler.rfile.read(int(handler.headers.get('Content-Length', 0))))
    changes = payload.get('changes') if isinstance(payload, dict) else None
    if not isinstance(changes, list) or not changes or len(changes) > 100:
        raise ValueError('changes must contain 1–100 material files')
    staged, conflicts, seen = [], [], set()
    for change in changes:
        if not isinstance(change, dict) or not isinstance(change.get('path'), str) or not isinstance(change.get('base'), str):
            raise ValueError('each change requires path and string base')
        relative = change['path']
        if relative in seen: raise ValueError('duplicate change path')
        seen.add(relative)
        path = allowed_path(root, relative)
        current = version(path)
        if current != change['base']:
            conflicts.append({'path': relative, 'version': current})
        content = base64.b64decode(change.get('contentBase64', ''), validate=True)
        check_content(relative, content, validate_records)
        if relative == '投递数据/投递记录.json' and not json.loads(content) and not payload.get('allowEmptyRecords'):
            raise ValueError('empty records require allowEmptyRecords=true')
        staged.append((relative, path, content))
    if conflicts:
        return handler._send_json({'error': 'version_conflict', 'conflicts': conflicts}, 409)
    # The caller holds the same data_lock as the browser APIs. Prepare every file before replacing any.
    data = root / '投递数据'; backup_root = data / '.remote-backups'; backup_root.mkdir(parents=True, exist_ok=True)
    transaction = Path(tempfile.mkdtemp(prefix='update-', dir=backup_root))
    replacements, applied = [], []
    try:
        for relative, path, content in staged:
            old = transaction / 'before' / relative
            if path.exists():
                old.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, old)
            candidate = transaction / 'candidate' / relative
            candidate.parent.mkdir(parents=True, exist_ok=True); candidate.write_bytes(content)
            replacements.append((relative, path, old, candidate))
        for relative, path, old, candidate in replacements:
            path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(candidate, path); applied.append((path, old))
    except Exception:
        for path, old in reversed(applied):
            if old.exists(): os.replace(old, path)
            else: path.unlink(missing_ok=True)
        raise
    return handler._send_json({'ok': True, 'files': [{'path': relative, 'version': version(path)} for relative, path, _, _ in replacements]})
