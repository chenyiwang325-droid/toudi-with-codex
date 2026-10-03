#!/usr/bin/env python3
"""Pull a versioned material mirror; push only changed files to the owner's HTTPS instance."""
import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_RESPONSE = 32 * 1024 * 1024


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else 'missing'


def request(method='GET', query='', payload=None):
    origin = os.environ.get('TOUDI_REMOTE_URL', '').rstrip('/')
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('TOUDI_REMOTE_URL must be the HTTPS origin of your instance')
    token = os.environ.get('TOUDI_AGENT_TOKEN', '')
    if len(token) < 32: raise ValueError('Set TOUDI_AGENT_TOKEN in the Agent environment')
    body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = urllib.request.Request(origin+'/api/agent/files'+query, data=body, method=method,
                                 headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read(MAX_RESPONSE+1)
            if len(raw) > MAX_RESPONSE: raise ValueError('response exceeds supported material size')
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            detail = json.loads(exc.read(MAX_RESPONSE))
            raise ValueError('Remote materials changed; preserve your draft, pull a new copy and reconcile: '+json.dumps(detail.get('conflicts', []), ensure_ascii=False)) from None
        raise ValueError(f'Remote API returned HTTP {exc.code}; check the instance URL and Agent permission') from None


def validate_relative(name):
    parts = Path(name).parts
    if not parts or Path(name).is_absolute() or any(p in {'.', '..'} or p.startswith('.') for p in parts):
        raise ValueError('unsafe remote material path')
    return name


def main():
    ap = argparse.ArgumentParser(description='同步云端工作台与 Agent 的资料副本')
    ap.add_argument('command', choices=['pull', 'status', 'push'])
    ap.add_argument('--workspace', type=Path, required=True)
    ap.add_argument('--allow-empty-records', action='store_true')
    ap.add_argument('--only', action='append', default=[], help='Sync only these exact relative paths; repeat for a related batch')
    args = ap.parse_args(); root = args.workspace.resolve(); state_path = root/'.toudi-remote.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if args.command == 'pull':
        if root.exists() and any(root.iterdir()):
            if not state: raise ValueError('Choose an empty material mirror directory')
            if any(digest(root/validate_relative(name)) != sha for name, sha in state['versions'].items()):
                raise ValueError('This mirror has unpushed changes; preserve them or pull to another directory')
            # Untracked files can also be drafts; do not replace them.
        manifest = request(); versions, downloads = {}, []
        for entry in manifest['files']:
            name = validate_relative(entry['path']); result = request(query='?path='+urllib.parse.quote(name))
            content = base64.b64decode(result['contentBase64'], validate=True)
            if hashlib.sha256(content).hexdigest() != result['version'] or result['version'] != entry['version']:
                raise ValueError('Remote changed during pull; retry into a fresh mirror')
            target = root/name
            if target.exists() and (not state or name not in state['versions']):
                raise ValueError('New remote file conflicts with a local draft: '+name)
            downloads.append((target, content)); versions[name] = result['version']
        # A deleted/removed remote file is not silently retained as something push would resurrect.
        if state and set(state['versions'])-set(versions):
            raise ValueError('Remote file set changed; pull to a new mirror and reconcile')
        root.mkdir(parents=True, exist_ok=True)
        for target, content in downloads:
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)
        state_path.write_text(json.dumps({'origin': os.environ['TOUDI_REMOTE_URL'].rstrip('/'), 'versions': versions}, ensure_ascii=False, indent=2))
        print(f'Pulled {len(versions)} files; use this folder as TOUDI_WORKSPACE for preparation/import tools')
        return
    if not state or state['origin'] != os.environ.get('TOUDI_REMOTE_URL', '').rstrip('/'):
        raise ValueError('Pull this instance before editing or publishing a mirror')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from remote_files import files
    available = {entry['path']: entry['version'] for entry in files(root)}
    deleted = [name for name in state['versions'] if name not in available]
    if deleted: raise ValueError('Missing mirror files; deletion is not supported by sync: '+', '.join(deleted))
    changed = [name for name, sha in available.items() if sha != state['versions'].get(name, 'missing')]
    if args.only:
        unknown = set(args.only)-set(available)
        if unknown: raise ValueError('Unknown --only paths: '+', '.join(sorted(unknown)))
        changed = [name for name in changed if name in args.only]
    if args.command == 'status':
        print(json.dumps({'changed': changed}, ensure_ascii=False, indent=2)); return
    if not changed:
        print('No material changes to publish'); return
    changes = [{'path': name, 'base': state['versions'].get(name, 'missing'), 'contentBase64': base64.b64encode((root/name).read_bytes()).decode()} for name in changed]
    payload = {'changes': changes, 'allowEmptyRecords': args.allow_empty_records}
    if len(changes)>100 or len(json.dumps(payload, ensure_ascii=False).encode())>MAX_RESPONSE:
        raise ValueError('Sync batch exceeds the request limit; select a related batch with --only')
    result = request('POST', payload=payload)
    for item in result['files']: state['versions'][item['path']] = item['version']
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    print(f'Published {len(changes)} changed files; unrelated materials were preserved')


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, KeyError) as exc:
        print(str(exc), file=sys.stderr); raise SystemExit(1)
