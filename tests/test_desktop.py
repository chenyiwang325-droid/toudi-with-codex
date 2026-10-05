"""Desktop transport and file authority use isolated material, never a personal workspace."""
import json
import os
import secrets
import subprocess
import sys
import tempfile
import unittest
import zipfile
import io
import urllib.error
import urllib.request
from urllib.parse import quote
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMAND = [os.environ['TOUDI_TEST_RUNTIME']] if os.environ.get('TOUDI_TEST_RUNTIME') else [sys.executable, str(ROOT/'app/desktop_runtime.py')]


class DesktopRuntimeTests(unittest.TestCase):
    def test_authenticated_transport_cli_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            token = secrets.token_hex(32)
            env = {**os.environ, 'TOUDI_WORKSPACE': tmp, 'TOUDI_DESKTOP_TOKEN': token,
                   'TOUDI_PARENT_PID': str(os.getpid())}
            def start():
                process = subprocess.Popen(COMMAND + ['serve'],
                    env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                ready = json.loads(process.stdout.readline())
                self.assertEqual(ready['event'], 'ready')
                return process, ready['port']
            def stop(process):
                process.stdin.write('shutdown\n'); process.stdin.flush()
                process.wait(timeout=5)
                self.assertEqual(process.returncode, 0)
                process.stdin.close(); process.stdout.close()
            def request(path, payload=None, authenticated=True, origin=None):
                headers = {'Authorization': 'Bearer '+token} if authenticated else {}
                if origin: headers['Origin'] = origin
                if payload is not None: headers['Content-Type'] = 'application/json'
                req = urllib.request.Request(f'http://127.0.0.1:{port}'+quote(path, safe='/?:=&'),
                    data=None if payload is None else json.dumps(payload).encode(), headers=headers)
                try:
                    with urllib.request.urlopen(req, timeout=5) as response:
                        return response.status, response.read()
                except urllib.error.HTTPError as error:
                    with error: return error.code, error.read()
            process, port = start()
            try:
                self.assertEqual(request('/api/manage?module=records', authenticated=False)[0], 401)
                self.assertEqual(request('/api/manage?module=records', origin='https://example.invalid')[0], 403)
                current = json.loads(request('/api/manage?module=records')[1])
                candidate = {'module': 'records', 'action': 'upsert', 'base': current['version'],
                             'item': {'record': {'名称': '{隔离公司}', '岗位': '{岗位}'}}}
                self.assertEqual(request('/api/manage', candidate)[0], 200)
                page = request('/投递管理.html')[1].decode()
                self.assertIn('{隔离公司}', page)
                self.assertIn('/assets/workbench.js', page)
                self.assertEqual(request('/assets/workbench.js')[0], 200)
                status, preferences = request('/assets/preference-defaults.js')
                self.assertEqual(status, 200)
                self.assertIn('window.__TOUDI_PREFERENCE_DEFAULTS__=', preferences.decode())
                self.assertIn('硕士', preferences.decode())
                self.assertEqual(request('/assets/filling.js')[0], 200)
                scope=json.loads(request('/api/edits')[1])['workspaceKey']
                self.assertEqual(len(scope),64)
                self.assertIn(scope,page)
                self.assertEqual(request('/assets/workspace-storage.js')[0],200)
                for retired in ('connect','chrome','bridge','plan'):
                    self.assertEqual(request('/api/filling/'+retired,{})[0],404)
                    self.assertEqual(request('/api/filling/'+retired,{},origin='chrome-extension://'+'a'*32)[0],403)
                status=json.loads(request('/api/filling')[1])
                self.assertNotIn('chromeConnection',status)
                self.assertNotIn('lastReport',status)
                with zipfile.ZipFile(io.BytesIO(request('/api/filling/extension')[1])) as bundle:
                    self.assertIn('TouDi-filling/worker.js',bundle.namelist())
                for name in ('.desktop-endpoint.json','.browser-token.json'):
                    self.assertFalse((Path(tmp)/'填报资料'/name).exists())
                cli = subprocess.run(COMMAND + ['--workspace', tmp, 'read', 'records'], env=env, encoding='utf-8', capture_output=True, check=True)
                self.assertEqual(json.loads(cli.stdout)['data'][0]['名称'], '{隔离公司}')
            finally: stop(process)
            process, port = start()
            try:
                self.assertEqual(json.loads(request('/api/edits')[1])['workspaceKey'],scope)
                self.assertEqual(json.loads(request('/api/manage?module=records')[1])['data'][0]['名称'], '{隔离公司}')
                path=Path(tmp)/'投递数据/用户编辑数据.json'
                for bad in ({'edits':[],'pref':{}},{'edits':{},'pref':[]},{'edits':{'broken':None},'pref':{}},None):
                    path.write_text(json.dumps(bad),encoding='utf-8')
                    self.assertEqual(request('/api/edits')[0],503)
                    self.assertEqual(request('/api/prospects')[0],503)
                for route,name,key in [('questionbank','逐字稿数据.json','categories'),('reviews','面试复盘数据.json','sessions'),('preps','面试准备数据.json','preps')]:
                    (Path(tmp)/'投递数据'/name).write_text(json.dumps({key:[None]}),encoding='utf-8')
                    self.assertEqual(request('/api/'+route)[0],503)
            finally: stop(process)

    def test_desktop_without_session_token_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, 'TOUDI_WORKSPACE': tmp, 'TOUDI_DESKTOP_TOKEN': ''}
            result = subprocess.run(COMMAND + ['serve'],
                env=env, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('ephemeral TOUDI_DESKTOP_TOKEN', result.stderr)

    def test_encrypted_export_omits_material_and_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root/'reading.zip'
            result = subprocess.run(COMMAND + ['export-reading', str(output)],
                env={**os.environ, 'TOUDI_WORKSPACE': tmp}, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            with zipfile.ZipFile(output) as bundle:
                names = bundle.namelist()
                self.assertIn('index.html', names)
                self.assertTrue(all(name == 'index.html' or name.startswith('assets/') and name.endswith('.bin') for name in names))
            password = (root/'投递数据/手机版/.passcode').read_text().strip()
            self.assertTrue(password)
            self.assertNotIn(password, result.stdout)
            self.assertNotIn(password, result.stderr)


if __name__ == '__main__':
    unittest.main()
