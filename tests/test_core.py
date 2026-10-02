"""Temporary structural fixtures only; no runtime examples or source credentials."""
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

class Core(unittest.TestCase):
    def test_clean_workspace_to_snapshot(self):
        with tempfile.TemporaryDirectory(prefix='toudi-check-') as tmp:
            work = Path(tmp); data = work / '投递数据'; data.mkdir()
            env = {**os.environ, 'TOUDI_WORKSPACE': tmp, 'PYTHONDONTWRITEBYTECODE': '1'}
            sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port=sock.getsockname()[1]; sock.close()
            env['TOUDI_PORT'] = str(port)
            proc = subprocess.Popen([sys.executable, str(ROOT/'run.py')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            origin = f'http://127.0.0.1:{port}'
            def request(path, payload=None, extra=None):
                req=urllib.request.Request(origin+path, data=json.dumps(payload).encode() if payload is not None else None, headers={'Content-Type':'application/json',**(extra or {})})
                try:
                    with urllib.request.urlopen(req) as r:return r.status,r.read()
                except urllib.error.HTTPError as e:
                    body=e.read();code=e.code;e.close();return code,body
            def cmd(script, *args, expected=0):
                p=subprocess.run([sys.executable,str(ROOT/'app/脚本'/script),*map(str,args)], env=env, capture_output=True, text=True)
                self.assertEqual(p.returncode,expected,p.stdout+p.stderr);return p.stdout
            try:
                for _ in range(100):
                    try:
                        if request('/')[0]==200:break
                    except OSError:pass
                    time.sleep(.05)
                self.assertIn(b'const RAW_DATA = [];',request('/')[1])
                for path,key in [('/api/preps','preps'),('/api/reviews','sessions'),('/api/questionbank','categories'),('/api/prospects','prospects')]:self.assertEqual(json.loads(request(path)[1])[key],[])
                self.assertEqual(request('/.passcode')[0],403)
                self.assertEqual(request('/api/edits',extra={'Origin':'https://invalid.example'})[0],403)
                initial=json.loads(request('/api/edits')[1]);self.assertEqual(initial['version'],'0')
                payload={'edits':{'{公司}':{'starred':True}},'pref':{},'base':initial['version']}
                self.assertEqual(request('/api/edits',payload)[0],200)
                self.assertEqual(request('/api/edits',payload)[0],409)
                candidate=work/'candidate.json';candidate.write_text(json.dumps([{'名称':'{公司}','岗位':'<原文>','公告链接':'https://example.invalid/record','地点':'{地点}'}]))
                before=(data/'用户编辑数据.json').read_bytes()
                cmd('publish_records.py',candidate,'--base','missing')
                cmd('publish_records.py',candidate,'--base','missing',expected=1)
                self.assertEqual((data/'用户编辑数据.json').read_bytes(),before)
                self.assertIn('{公司}',request('/')[1].decode())
                embedded=re.search(r'const RAW_DATA = (.*);',request('/')[1].decode()).group(1)
                self.assertEqual(json.loads(embedded)[0]['岗位'],'<原文>')
                self.assertIn('const RAW_DATA = [];',(ROOT/'app/投递管理.html').read_text())
                prep=work/'面试准备/{公司}{岗位}面试准备.md';prep.parent.mkdir();prep.write_text('# {公司}{岗位}（{批次}）面试准备\n## {背景}\n{说明}\n### {问题}\n{主答}\n**备答**\n{备答}\n')
                check=json.loads(cmd('content_preflight.py','--kind','prep','--file',prep,'--root',work,'--json'));self.assertTrue(check['ok']);self.assertEqual(check['association']['companyKey'],'{公司}')
                cmd('9_面试准备导入.py',prep,'--company','{公司}','--position','{岗位}')
                preps=json.loads(request('/api/preps')[1]);self.assertEqual(preps['preps'][0]['companyKey'],'{公司}')
                prospect=work/'岗位探查';prospect.mkdir();(prospect/'report.md').write_text('## {总体结论}\n{证据边界}')
                (prospect/'探查目录.json').write_text(json.dumps({'companies':[{'id':'{id}','company':'{公司}','file':'report.md','researchedAt':'2000-01-01'}]}))
                self.assertEqual(json.loads(request('/api/prospects')[1])['prospects'][0]['company'],'{公司}')
                review=work/'复盘/20000101_{公司}{岗位}_一面.md';review.parent.mkdir();review.write_text('# {公司}{岗位}面试复盘（2000-01-01，时长未知）\n## 一、问答树\n{全场}\n## 二、逐题复盘\n### Q1：{问题}\n- 考察意图：{意图}\n- 当时的回答：{原答}\n- 诊断：结构化：{依据}\n- 追问：{追问}\n## 三、反问\n{原文}\n## 四、全场分析\n{分析}\n## 五、弱项追踪\n{追踪}')
                cmd('6_复盘导入.py',review,'--company','{公司}','--position','{岗位}','--round','一面','--key','{公司}')
                self.assertEqual(json.loads(request('/api/reviews')[1])['sessions'][0]['companyKey'],'{公司}')
                for path,key in [('/api/reviews','sessions'),('/api/questionbank','categories')]:
                    collection=json.loads(request(path)[1]);payload={key:collection[key],'base':collection['version']}
                    self.assertEqual(request(path,payload)[0],200)
                    self.assertEqual(request(path,payload)[0],409)
                # Encryption build and decryption use only this temporary fixture.
                cmd('10_手机版快照.py')
                mobile=data/'手机版';stage=mobile/'.stage';files=[f for f in stage.rglob('*') if f.is_file()];self.assertEqual(len(files),2)
                html=(stage/'index.html').read_text();self.assertNotIn('{公司}',html);self.assertNotIn('.passcode',[f.name for f in files])
                from cryptography.hazmat.primitives.ciphers.aead import AESGCM
                import base64,gzip
                salt=re.search(r"var SALT='([^']+)'",html).group(1);iv=re.search(r"IV='([^']+)'",html).group(1)
                password=(mobile/'.passcode').read_text().strip();key=hashlib.pbkdf2_hmac('sha256',password.encode(),base64.b64decode(salt),150000,32)
                binary=next(f for f in files if f.suffix=='.bin');decoded=gzip.decompress(AESGCM(key).decrypt(base64.b64decode(iv),binary.read_bytes(),None)).decode()
                self.assertIn('{公司}',decoded);self.assertIn('toudiPreps',decoded);self.assertIn('window.__SNAPSHOT__',decoded)
                bad=data/'逐字稿数据.json';bad.write_text('{broken');self.assertEqual(request('/api/questionbank')[0],503)
                candidate.write_text('[]');cmd('publish_records.py',candidate,'--base','missing',expected=2)
            finally:
                proc.terminate();proc.wait(timeout=5)

if __name__=='__main__':unittest.main()
