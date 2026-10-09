"""Bounded local filling data shared by the App, Agent CLI and browser connector."""
import copy
import hashlib
import json
import math
import re
from pathlib import Path

PROFILE_PATH = '填报资料/资料.json'
LEGACY_PATH = '网申信息库.json'
MAX_BYTES = 450 * 1024  # Also fits Chrome native messaging's response limit.


def empty_pack():
    return {'schemaVersion': 1, 'kind': 'toudi-filling-profile', 'name': '个人填报资料',
            'profiles': [{'id': 'general', 'label': '默认资料'}], 'facts': [], 'rules': [],
            'warnings': [], 'supplements': []}


def safe_path(root, relative):
    if relative not in (PROFILE_PATH, LEGACY_PATH):
        raise ValueError('不支持的填报资料文件。')
    root = Path(root).resolve()
    path = root / relative
    for part in (path, *path.parents):
        if part == root: break
        if part.is_symlink(): raise ValueError('填报资料不能通过符号链接读取或保存。')
    return path


def validate_pack(value):
    from filling_profile import validate_date_policy
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('填报资料需要 schemaVersion 1。')
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > MAX_BYTES:
        raise ValueError('填报资料超过 450 KB，请减少重复内容；附件应单独保留。')
    profiles = value.get('profiles')
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 20:
        raise ValueError('需要 1 到 20 个资料版本。')
    ids = set()
    for profile in profiles:
        if (not isinstance(profile, dict) or not isinstance(profile.get('id'), str)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', profile['id'])
                or profile['id'] in ids or not isinstance(profile.get('label'), str)
                or not profile['label'].strip() or len(profile['label']) > 80):
            raise ValueError('资料版本名称或标识无效。')
        ids.add(profile['id'])
    facts = value.get('facts')
    if not isinstance(facts, list) or len(facts) > 1500:
        raise ValueError('填报资料需要 facts 数组，最多 1500 项。')
    seen = set()
    for fact in facts:
        if not isinstance(fact, dict): raise ValueError('填报字段格式无效。')
        for key, limit in [('key', 300), ('label', 1000)]:
            if not isinstance(fact.get(key), str) or not fact[key] or len(fact[key]) > limit:
                raise ValueError('填报字段名称或标识无效。')
        if fact['key'] in seen: raise ValueError('填报字段标识重复。')
        seen.add(fact['key'])
        content = fact.get('value')
        if (isinstance(content, bool) or not isinstance(content, (str, int, float))
                or isinstance(content, float) and not math.isfinite(content) or len(str(content)) > 24000):
            raise ValueError('填报字段内容无效。')
        if fact.get('module') not in {'personal', 'education', 'internship', 'project', 'language', 'campus-role', 'awards', 'publications', 'family'}:
            raise ValueError('填报资料模块无效。')
        members = fact.get('profiles')
        if not isinstance(members, list) or not members or any(not isinstance(p, str) or p not in ids for p in members):
            raise ValueError('字段必须属于已有的资料版本。')
        for key in ('recordId', 'recordLabel', 'recordHint'):
            if not isinstance(fact.get(key, ''), str) or len(fact.get(key, '')) > 1000:
                raise ValueError('经历标识无效。')
        aliases = fact.get('aliases', [])
        if not isinstance(aliases, list) or len(aliases) > 80 or any(not isinstance(a, str) or not a.strip() or len(a) > 1000 for a in aliases):
            raise ValueError('字段别名无效。')
        if 'answerSource' in fact and not isinstance(fact['answerSource'],bool):raise ValueError('问答资料许可需要为布尔值。')
        validate_date_policy(fact)
    rules = value.get('rules', [])
    if not isinstance(rules, list) or any(not isinstance(r, str) or len(r) > 12000 for r in rules):
        raise ValueError('填写要求格式无效。')
    for name in ('warnings', 'supplements'):
        items = value.get(name, [])
        expected = str if name == 'warnings' else dict
        if not isinstance(items, list) or any(not isinstance(item, expected) for item in items):
            raise ValueError('填写补充信息格式无效。')
    return value


def compatible_pack(value):
    """Normalize only established legacy omissions, without rewriting the source."""
    value = copy.deepcopy(value)
    if not isinstance(value, dict) or not isinstance(value.get('facts'), list):
        return validate_pack(value)
    if 'profiles' not in value:
        ids = ['general']
        for fact in value['facts']:
            members = fact.get('profiles', []) if isinstance(fact, dict) else []
            if not isinstance(members, list) or any(not isinstance(p, str) for p in members):
                raise ValueError('资料版本格式无效。')
            ids.extend(p for p in members if p not in ids)
        value['profiles'] = [{'id': key, 'label': '默认资料' if key == 'general' else '导入资料 '+str(i)} for i, key in enumerate(ids)]
    for fact in value['facts']:
        if isinstance(fact, dict):
            fact.setdefault('profiles', [p['id'] for p in value['profiles'] if isinstance(p, dict) and 'id' in p])
    return validate_pack(value)


def read_data(root):
    path = safe_path(root, PROFILE_PATH)
    if path.exists():
        value = json.loads(path.read_text(encoding='utf-8'))
        return compatible_pack(value)
    if safe_path(root, LEGACY_PATH).exists():
        from filling_profile import export_profile_pack
        value = export_profile_pack(root)
        validate_pack(value)
        return value
    return empty_pack()


def revision(root):
    # Include the old source in first adoption's optimistic version check.
    paths = [PROFILE_PATH] if safe_path(root, PROFILE_PATH).exists() else [LEGACY_PATH]
    entries = [(p, hashlib.sha256(safe_path(root, p).read_bytes()).hexdigest()
                if safe_path(root, p).is_file() else 'missing') for p in paths]
    return hashlib.sha256(json.dumps(entries, ensure_ascii=False).encode()).hexdigest()


def workspace_key(root):
    return hashlib.sha256(str(Path(root).resolve()).encode()).hexdigest()


def read(root):
    from workbench import Workbench
    state = Workbench(root).get('profile')
    pack = copy.deepcopy(state['data']) if state['exists'] else None
    if pack is not None:
        pack['sourceVersion'] = state['version']
        pack['sourceName'] = PROFILE_PATH if not state['legacySource'] else LEGACY_PATH
    return {'workspaceKey': workspace_key(root), 'version': state['version'], 'pack': pack,
            'legacySource': state['legacySource']}


def write(root, base, pack, key):
    from workbench import Workbench, Conflict
    if key != workspace_key(root): raise Conflict('工作区已改变，当前资料已保留；请重新连接并核对。')
    Workbench(root).mutate({'module': 'profile', 'action': 'replace', 'base': base, 'data': pack})
    return read(root)
