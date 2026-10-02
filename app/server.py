#!/usr/bin/env python3
"""TouDi 本地服务 · 本地服务

作用：
1. 静态服务本目录（投递管理.html 等文件）
2. 提供 /api/edits 接口，把页面的编辑数据（进度/备注/收藏/不适合/偏好）
   自动落盘到本目录的 用户编辑数据.json
3. 提供 /api/reviews 接口，把面试复盘数据（场次/逐题复盘/弱项追踪）
   自动落盘到本目录的 面试复盘数据.json
4. 提供 /api/questionbank 接口，把关键问题逐字稿（问答库：大类/题目/要点）
   自动落盘到本目录的 逐字稿数据.json
5. 提供只读 /api/preps 接口，展示脚本/9_面试准备导入.py 从 Markdown
   母本生成的 面试准备数据.json

通常无需手动运行本脚本：
- 运行仓库根的 python3 run.py；macOS/Linux 支持本地文件锁
"""
import sys
import glob
import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

CODE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(CODE_DIR, '脚本'))
from urllib.parse import urlsplit, parse_qs, unquote
from prep_resources import resource_paths, resource_payload
from prospect_catalog import read_catalog, safe_path
from publish_records import validate
from update_common import data_lock
WORKSPACE = os.path.abspath(os.environ.get('TOUDI_WORKSPACE', os.path.join(os.path.dirname(CODE_DIR), 'runtime')))
BASE_DIR = os.path.join(WORKSPACE, '投递数据')
os.makedirs(BASE_DIR, exist_ok=True)
DATA_FILE = os.path.join(BASE_DIR, '用户编辑数据.json')
REVIEWS_FILE = os.path.join(BASE_DIR, '面试复盘数据.json')
QBANK_FILE = os.path.join(BASE_DIR, '逐字稿数据.json')
PREPS_FILE = os.path.join(BASE_DIR, '面试准备数据.json')
PROSPECTS_DIR = os.path.join(os.path.dirname(BASE_DIR), '岗位探查')
PORT = int(os.environ.get('TOUDI_PORT', '8327'))
# 编辑数据版本并发控制（2026-09-07 旧标签页覆盖事故后固化）：
# GET 返回 version=文件 mtime_ns；POST 必须带 base=页面所持版本，不一致即 409，
# 页面收到409保留当前标签页草稿与原始base，拒绝盲保存；不得自动覆盖。
EDITS_LOCK = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _local_request_allowed(self):
        host = self.headers.get('Host', '')
        allowed = {f'127.0.0.1:{PORT}', f'localhost:{PORT}', f'[::1]:{PORT}'}
        origin = self.headers.get('Origin')
        return host in allowed and (not origin or origin in {'http://' + value for value in allowed})

    def do_GET(self):
        if not self._local_request_allowed():
            return self._send_json({'error': 'same-origin local workspace only'}, 403)
        if any(part.startswith('.') for part in unquote(urlsplit(self.path).path).split('/') if part):
            return self._send_json({'error': 'private workspace file'}, 403)
        with data_lock(BASE_DIR):
            return self._serve_GET()

    def _serve_GET(self):
        if urlsplit(self.path).path in ('/', '/投递管理.html'):
            try:
                path = os.path.join(BASE_DIR, '投递记录.json')
                rows = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else []
                validate(rows)
                template = open(os.path.join(CODE_DIR, '投递管理.html'), encoding='utf-8').read()
                body = template.replace('const RAW_DATA = [];', 'const RAW_DATA = ' + json.dumps(rows, ensure_ascii=False).replace('<', chr(92) + 'u003c') + ';', 1).encode()
            except (ValueError, OSError) as exc:
                return self._send_json({'error': str(exc)}, 503)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body); return
        if urlsplit(self.path).path in ('/assets/favicon.svg', '/assets/logo.svg'):
            name = os.path.basename(urlsplit(self.path).path)
            body = open(os.path.join(CODE_DIR, 'assets', name), 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'image/svg+xml')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body); return
        if self.path in ('/api/workspace', '/api/agent'):
            config_path = os.path.join(BASE_DIR, '工作区配置.json')
            try:
                with open(config_path, encoding='utf-8') as f:
                    config = json.load(f)
            except (OSError, ValueError):
                config = {'schemaVersion': 1, 'sourcePolicy': '用户指定信源与资料目录，尚未提供独立约定'}
            paths = {'data': BASE_DIR, 'records': os.path.join(BASE_DIR, '投递记录.json'),
                     'edits': DATA_FILE, 'qbank': QBANK_FILE, 'preps': PREPS_FILE,
                     'reviews': REVIEWS_FILE, 'prospects': PROSPECTS_DIR}
            result = {'protocol': 1, 'mode': 'local', 'root': BASE_DIR, 'paths': paths,
                      'config': config, 'sameOriginOnly': True,
                      'recordSource': '投递记录.json injected into clean template in memory',
                      'missing': [key for key, path in paths.items() if key != 'prospects' and not os.path.exists(path)]}
            if self.path == '/api/agent':
                guide = os.path.join(os.path.dirname(CODE_DIR), 'docs', '流程协作.md')
                try:
                    with open(guide, encoding='utf-8') as f:
                        result['guide'] = f.read()
                except OSError:
                    return self._send_json({'error': 'Agent guide missing'}, 503)
            return self._send_json(result)
        if self.path == '/api/update-status':
            return self._send_json({'protocol': 1, 'root': BASE_DIR})
        if self.path == '/api/edits':
            d = self._read_data()
            if d is None:
                return self._send_json({'ok': False, 'error': 'data file temporarily unreadable'}, 503)
            return self._send_json(d)
        if self.path == '/api/reviews':
            d = self._read_reviews()
            if d is None:
                return self._send_json({'ok': False, 'error': 'reviews file temporarily unreadable'}, 503)
            return self._send_json(d)
        if self.path == '/api/questionbank':
            d = self._read_qbank()
            if d is None:
                return self._send_json({'ok': False, 'error': 'question bank temporarily unreadable'}, 503)
            return self._send_json(d)
        if urlsplit(self.path).path == '/api/prep-resource':
            key = parse_qs(urlsplit(self.path).query).get('path', [''])[0]
            preps = self._read_preps()
            if preps is None:
                return self._send_json({'error': '准备数据暂时无法读取'}, 503)
            paths = resource_paths(BASE_DIR, preps)
            if key not in paths:
                return self._send_json({'error': '资料不存在或未在当前准备稿中引用'}, 404)
            payload = resource_payload(paths[key])
            payload['availableKeys'] = list(paths)
            return self._send_json(payload)
        if self.path == '/api/preps':
            d = self._read_preps()
            if d is None:
                return self._send_json({'ok': False, 'error': 'preps file temporarily unreadable'}, 503)
            return self._send_json(d)
        if self.path == '/api/prospects':
            try:
                return self._send_json(self._read_prospects())
            except (ValueError, OSError, KeyError) as exc:
                return self._send_json({'error': '探查目录需要修复: '+str(exc)}, 503)
        if urlsplit(self.path).path == '/api/prospect-file':
            try:
                relative = parse_qs(urlsplit(self.path).query).get('path', [''])[0]
                catalog = self._read_prospects()
                registered = {p['filename'] for p in catalog['prospects']} | {a['file'] for p in catalog['prospects'] for a in p.get('attachments', [])} | {a['file'] for a in catalog.get('archives', [])}
                if relative not in registered: raise ValueError('未登记的探查资料')
                path = safe_path(PROSPECTS_DIR, relative)
                if path.suffix.lower() != '.md': raise ValueError('只允许探查文档')
                body = path.read_bytes()
            except (ValueError, OSError):
                return self._send_json({'error':'文档不存在或路径无效'}, 404)
            self.send_response(200)
            self.send_header('Content-Type','text/plain; charset=utf-8')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers(); self.wfile.write(body)
            return
        if self.path == '/__clean__':
            # 一次性清理页：清除本来源下残留的浏览器缓存（调试用）
            body = b'<meta charset="utf-8"><script>localStorage.removeItem("toudiEdits");localStorage.removeItem("toudiPref");document.write("\\u5df2\\u6e05\\u9664\\u6d4f\\u89c8\\u5668\\u7f13\\u5b58\\uff0c\\u53ef\\u5173\\u95ed\\u672c\\u9875")</script>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        if not self._local_request_allowed():
            return self._send_json({"error": "same-origin local workspace only"}, 403)
        if self.path == '/api/edits':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                payload = json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(payload, dict):
                    raise ValueError('payload must be a JSON object')
                edits = payload.get('edits') or {}
                if not isinstance(edits, dict) or any(not isinstance(v, dict) for v in edits.values()) or not isinstance(payload.get('pref') or {}, dict):
                    raise ValueError('edits and pref must be objects')
                print(f'[保存] {len(edits)} 条 base={payload.get("base")} <- {self.headers.get("User-Agent","?")[:60]}')
                with EDITS_LOCK, data_lock(BASE_DIR):
                    current = str(self._data_version())
                    base = payload.get('base')
                    base = str(base) if base is not None else None
                    if base != current:
                        d = self._read_data() or {'edits': {}, 'pref': {}}
                        print(f'[409] 版本冲突 base={base} current={current}，拒绝覆盖')
                        return self._send_json({'ok': False, 'error': 'version_conflict',
                                                'version': current, 'data': d}, 409)
                    self._write_data({'edits': edits, 'pref': payload.get('pref') or {}})
                    new_version = str(self._data_version())
                return self._send_json({'ok': True, 'version': new_version})
            except Exception as e:
                return self._send_json({'ok': False, 'error': str(e)}, 400)
        if self.path == '/api/reviews':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                payload = json.loads(self.rfile.read(length) or b'{}')
                sessions = payload.get('sessions')
                if not isinstance(sessions, list):
                    raise ValueError('payload must contain a sessions array')
                print(f'[保存] 复盘 {len(sessions)} 场 base={payload.get("base")} <- {self.headers.get("User-Agent","?")[:60]}')
                with EDITS_LOCK, data_lock(BASE_DIR):
                    conflict = self._check_collection_base(payload, REVIEWS_FILE, self._read_reviews)
                    if conflict:
                        return self._send_json(conflict, 409)
                    self._write_reviews({'sessions': sessions})
                    new_version = str(self._file_version(REVIEWS_FILE))
                return self._send_json({'ok': True, 'version': new_version})
            except Exception as e:
                return self._send_json({'ok': False, 'error': str(e)}, 400)
        if self.path == '/api/questionbank':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                payload = json.loads(self.rfile.read(length) or b'{}')
                categories = payload.get('categories')
                if not isinstance(categories, list):
                    raise ValueError('payload must contain a categories array')
                # 防护：拒绝包含已知测试垃圾标记的数据，避免污染真实数据
                blob = json.dumps(categories, ensure_ascii=False)
                if '测试备注' in blob or '冒烟测试' in blob:
                    print(f'[拒绝] 问答库测试数据 <- {self.headers.get("User-Agent","?")[:60]}')
                    return self._send_json({'ok': False, 'error': 'rejected test data'}, 400)
                n = sum(len(c.get('items') or []) for c in categories if isinstance(c, dict))
                print(f'[保存] 问答库 {len(categories)} 类 {n} 条 base={payload.get("base")} <- {self.headers.get("User-Agent","?")[:60]}')
                with EDITS_LOCK, data_lock(BASE_DIR):
                    conflict = self._check_collection_base(payload, QBANK_FILE, self._read_qbank)
                    if conflict:
                        return self._send_json(conflict, 409)
                    self._write_qbank({'categories': categories})
                    new_version = str(self._file_version(QBANK_FILE))
                return self._send_json({'ok': True, 'version': new_version})
            except Exception as e:
                return self._send_json({'ok': False, 'error': str(e)}, 400)
        if self.path == '/api/preps':
            return self._send_json({'ok': False, 'error': 'preps_are_read_only; edit Markdown and run the import script'}, 405)
        self.send_error(404)

    def _file_version(self, path):
        try:
            return os.stat(path).st_mtime_ns
        except OSError:
            return 0

    def _check_collection_base(self, payload, path, reader):
        current = str(self._file_version(path))
        base = payload.get('base')
        base = str(base) if base is not None else None
        if base == current:
            return None
        data = reader()
        if data is None:
            data = {'version': current}
        print(f'[409] 版本冲突 base={base} current={current}，拒绝覆盖 {os.path.basename(path)}')
        return {'ok': False, 'error': 'version_conflict',
                'version': current, 'data': data}

    def _data_version(self):
        return self._file_version(DATA_FILE)

    def _read_data(self):
        for attempt in range(3):
            try:
                with open(DATA_FILE, encoding='utf-8') as f:
                    d = json.load(f)
                if isinstance(d, dict):
                    return {'edits': d.get('edits') or {}, 'pref': d.get('pref') or {},
                            'version': str(self._data_version())}
                raise ValueError('data file root must be an object')
            except FileNotFoundError:
                return {'edits': {}, 'pref': {}, 'version': '0'}
            except Exception:
                time.sleep(0.05)  # 写入窗口读到半截文件，稍候重试
        return None  # 持续不可读：503，绝不让页面误以为"磁盘为空"而反推旧缓存

    def _write_data(self, d):
        tmp = DATA_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, DATA_FILE)  # 原子写入，避免中途断电损坏文件

    def _read_reviews(self):
        return self._read_collection(REVIEWS_FILE, 'sessions')

    def _write_reviews(self, d):
        if os.path.exists(REVIEWS_FILE):  # 覆盖前自动备份
            try:
                import shutil
                shutil.copy2(REVIEWS_FILE, REVIEWS_FILE + '.bak_auto')
            except Exception:
                pass
        tmp = REVIEWS_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, REVIEWS_FILE)  # 原子写入

    def _read_qbank(self):
        return self._read_collection(QBANK_FILE, 'categories')

    def _write_qbank(self, d):
        if os.path.exists(QBANK_FILE):  # 覆盖前自动备份
            try:
                import shutil
                shutil.copy2(QBANK_FILE, QBANK_FILE + '.bak_auto')
            except Exception:
                pass
        tmp = QBANK_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, QBANK_FILE)  # 原子写入

    def _read_preps(self):
        return self._read_collection(PREPS_FILE, 'preps')

    def _read_collection(self, path, key):
        for _ in range(3):
            try:
                with open(path, encoding='utf-8') as f:
                    d = json.load(f)
                if isinstance(d, dict) and isinstance(d.get(key), list):
                    return {key: d[key], 'version': str(self._file_version(path))}
                raise ValueError(f'{os.path.basename(path)} must contain a {key} array')
            except FileNotFoundError:
                return {key: [], 'version': '0'}
            except Exception:
                time.sleep(0.05)
        return None

    def _read_prospects(self):
        edits = self._read_data().get('edits', {})
        return read_catalog(PROSPECTS_DIR, edits)

    def _write_preps(self, d):
        if os.path.exists(PREPS_FILE):  # 覆盖前自动备份
            try:
                import shutil
                shutil.copy2(PREPS_FILE, PREPS_FILE + '.bak_auto')
            except Exception:
                pass
        tmp = PREPS_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, PREPS_FILE)  # 原子写入

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._local_request_allowed():
            return self._send_json({'error': 'same-origin local workspace only'}, 403)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):  # 静默访问日志
        pass


def main():
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        print(f'端口 {PORT} 已被占用，服务多半已在运行。')
        return
    print(f'投递中控台已启动: http://127.0.0.1:{PORT}/投递管理.html')
    print(f'编辑数据自动保存到: {DATA_FILE}')
    print('按 Ctrl+C 停止服务')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
