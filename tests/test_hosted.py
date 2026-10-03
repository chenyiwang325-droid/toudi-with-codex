"""Isolated hosted-mode authentication, conflict and material-scope checks."""
import base64
import hashlib
import http.client
import importlib.util
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://workbench.example.invalid'
# Ephemeral credentials, never source credentials.
PASSWORD = 'fixture-owner-' + 'x' * 24
TOKEN = 'fixture-agent-' + 'y' * 40


class Hosted(unittest.TestCase):
    def test_authenticated_hosted_workspace(self):
        with tempfile.TemporaryDirectory(prefix='toudi-hosted-') as tmp:
            work = Path(tmp)
            sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]; sock.close()
            env = {**os.environ, 'TOUDI_MODE': 'hosted', 'TOUDI_PUBLIC_URL': ORIGIN,
                   'TOUDI_PASSWORD': PASSWORD, 'TOUDI_SESSION_SECRET': 'fixture-session-'+ 'z'*40,
                   'TOUDI_AGENT_TOKEN': TOKEN, 'TOUDI_WORKSPACE': tmp, 'TOUDI_PORT': str(port)}
            proc = subprocess.Popen([sys.executable, str(ROOT/'run.py')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            def request(path, method='GET', value=None, headers=None):
                body = json.dumps(value).encode() if isinstance(value, dict) else value
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                conn.request(method, urllib.parse.quote(path, safe='/?:&=%'), body=body, headers={'Host': 'workbench.example.invalid', 'Content-Type': 'application/json', **(headers or {})})
                r = conn.getresponse(); result = r.status, dict(r.getheaders()), r.read(); conn.close(); return result
            agent = {'Authorization': 'Bearer '+TOKEN}
            def material(name, text, base='missing'):
                return {'path': name, 'base': base, 'contentBase64': base64.b64encode(text.encode()).decode()}
            try:
                for _ in range(100):
                    try:
                        if request('/healthz')[0] == 200: break
                    except OSError: pass
                    time.sleep(.02)
                self.assertEqual(request('/')[0], 303)
                self.assertEqual(request('/api/edits')[0], 401)
                self.assertEqual(request('/api/agent/files')[0], 401)
                self.assertEqual(request('/api/edits', headers={'Host':'attacker.example.invalid', **agent})[0],403)
                self.assertEqual(request('/api/edits', headers={'Origin':'https://attacker.example.invalid', **agent})[0],403)
                self.assertIn('打开你的工作台', request('/auth/login')[2].decode())
                self.assertEqual(request('/auth/login', 'POST', 'password=invalid', {'Origin': ORIGIN})[0],401)
                status, headers, _ = request('/auth/login', 'POST', 'password='+PASSWORD, {'Origin': ORIGIN})
                self.assertEqual(status,303); cookie=headers['Set-Cookie'].split(';',1)[0]
                self.assertIn('HttpOnly', headers['Set-Cookie']);self.assertIn('Secure', headers['Set-Cookie']);self.assertIn('SameSite=Strict', headers['Set-Cookie'])
                browser={'Cookie':cookie}
                page=request('/',headers=browser)[2].decode();self.assertIn('__TOUDI_SERVICE__',page)
                self.assertEqual(request('/api/agent/files',headers=browser)[0],403)
                self.assertEqual(request('/用户编辑数据.json',headers=browser)[0],404)
                self.assertEqual(request('/api/agent/files?path=投递数据/.passcode',headers=agent)[0],400)
                records=[{'名称':'{公司}','岗位':'{岗位}','归并类型':'{归并依据}','归并来源':[{'名称':'{来源主体}','公告链接':'https://example.invalid/source','编辑键':'{独立来源键}'}]}]
                payload={'changes':[material('投递数据/投递记录.json',json.dumps(records)), material('面试准备/{稿}.md','# {标题}\n{正文}') ]}
                self.assertEqual(request('/api/agent/files','POST',payload,agent)[0],200)
                published=json.loads((work/'投递数据/投递记录.json').read_text())
                self.assertEqual(published,records)
                malformed={'changes':[material('投递数据/投递记录.json',json.dumps([{'名称':'{公司}','归并来源':[{'名称':'{来源}','编辑键':[]}]}]),hashlib.sha256((work/'投递数据/投递记录.json').read_bytes()).hexdigest())]}
                self.assertEqual(request('/api/agent/files','POST',malformed,agent)[0],400)
                self.assertEqual(json.loads((work/'投递数据/投递记录.json').read_text()),records)
                self.assertEqual(request('/api/agent/files','POST',payload,agent)[0],409)
                manifest=json.loads(request('/api/agent/files',headers=agent)[2]);self.assertEqual(len(manifest['files']),2)
                # Exercise the actual CLI workflow against this isolated service.
                spec=importlib.util.spec_from_file_location('remote_workspace',ROOT/'app/脚本/remote_workspace.py')
                client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)
                def transport(method='GET',query='',payload=None):
                    code,_,body=request('/api/agent/files'+query,method,payload,agent)
                    if code!=200:raise ValueError('Remote API returned HTTP '+str(code))
                    return json.loads(body)
                mirror=work/'agent-mirror'
                def cli(command,*options):
                    with patch.object(client,'request',side_effect=transport),patch.dict(os.environ,{'TOUDI_REMOTE_URL':ORIGIN}),patch.object(sys,'argv',['remote_workspace.py',command,'--workspace',str(mirror),*options]),patch('sys.stdout',new_callable=io.StringIO) as out:
                        client.main();return out.getvalue()
                cli('pull');draft=mirror/'面试准备/{稿}.md';draft.write_text('# {标题}\n{更新后的正文}')
                self.assertIn('面试准备/{稿}.md',cli('status'))
                cli('push','--only','面试准备/{稿}.md')
                self.assertEqual((work/'面试准备/{稿}.md').read_text(),draft.read_text())
                self.assertIn('No material changes',cli('push'))
                baseline=(mirror/'.toudi-remote.json').read_text()
                draft.write_text('# {本地候选}')
                (work/'面试准备/{稿}.md').write_text('# {其他客户端已更新}')
                with self.assertRaisesRegex(ValueError,'409'):cli('push')
                self.assertEqual(draft.read_text(),'# {本地候选}')
                self.assertEqual((mirror/'.toudi-remote.json').read_text(),baseline)
                with self.assertRaisesRegex(ValueError,'unpushed changes'):cli('pull')
                self.assertIn('{公司}', request('/',headers=browser)[2].decode())
                self.assertEqual(request('/api/agent/files','POST',{'changes':[material('../escape.md','x')]},agent)[0],400)
                self.assertEqual(request('/api/agent/files','POST',{'changes':[material('投递数据/投递记录.json','[]',base=manifest['files'][1]['version'])]},agent)[0],400)
                (work/'投递数据/.passcode').write_text('private fixture')
                (work/'面试准备/leak.md').symlink_to(work/'投递数据/.passcode')
                self.assertEqual(request('/api/agent/files?path=面试准备/leak.md',headers=agent)[0],400)
                current=json.loads(request('/api/edits',headers=browser)[2])
                saved_personal={'edits':{'{公司}':{'status':'面试','note':'{个人备注}','starred':True}},
                                'pref':{'industries':['{行业}'],'education':['硕士及以上']}}
                payload={**saved_personal,'base':current['version']}
                self.assertEqual(request('/api/edits','POST',payload,browser)[0],403)
                browser['Origin']=ORIGIN;self.assertEqual(request('/api/edits','POST',payload,browser)[0],200)
                self.assertEqual(request('/api/edits','POST',payload,browser)[0],409)
                saved_collections={
                    '/api/questionbank':('categories',[{'id':'{分类}','name':'{分类名称}',
                        'items':[{'id':'{条目}','q':'{问题}','a':'{用户编辑的答案}'}]}]),
                    '/api/reviews':('sessions',[{'id':'{场次}','company':'{公司}',
                        'summary':{'strengths':'{用户编辑的全场要点}'},'questions':[]}])}
                for path,(key,value) in saved_collections.items():
                    collection=json.loads(request(path,headers=browser)[2])
                    change={key:value,'base':collection['version']}
                    self.assertEqual(request(path,'POST',change,browser)[0],200)
                    self.assertEqual(request(path,'POST',change,browser)[0],409)
                    self.assertEqual(json.loads(request(path,headers=browser)[2])[key],value)
                # Audit the current boundary: company Markdown has no browser write endpoint.
                self.assertEqual(request('/api/preps','POST',{'preps':[]},browser)[0],405)
                self.assertEqual(request('/api/prospects','POST',{'prospects':[]},browser)[0],404)
                agent_personal=json.loads(request('/api/agent/files?path='+urllib.parse.quote('投递数据/用户编辑数据.json'),headers=agent)[2])
                self.assertEqual(json.loads(base64.b64decode(agent_personal['contentBase64'])),saved_personal)
                self.assertEqual(request('/auth/logout','POST','',browser)[0],303)
                # Material files survive service restarts; credentials do not go into those files.
                proc.terminate();proc.wait(timeout=5)
                proc=subprocess.Popen([sys.executable,str(ROOT/'run.py')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                for _ in range(100):
                    try:
                        if request('/healthz')[0]==200:break
                    except OSError:pass
                    time.sleep(.02)
                self.assertEqual(len(json.loads(request('/api/agent/files',headers=agent)[2])['files']),5)
                # A fresh browser session reads durable data; it does not depend on browser storage.
                code,new_headers,_=request('/auth/login','POST','password='+PASSWORD,{'Origin':ORIGIN})
                self.assertEqual(code,303)
                fresh_browser={'Cookie':new_headers['Set-Cookie'].split(';',1)[0]}
                after=json.loads(request('/api/edits',headers=fresh_browser)[2])
                self.assertEqual({k:after[k] for k in saved_personal},saved_personal)
                for path,(key,value) in saved_collections.items():
                    self.assertEqual(json.loads(request(path,headers=fresh_browser)[2])[key],value)
            finally:
                proc.terminate();proc.wait(timeout=5)

    def test_batch_failure_restores_previous_files(self):
        sys.path.insert(0,str(ROOT/'app'));sys.path.insert(0,str(ROOT/'app/脚本'))
        import remote_files
        from publish_records import validate
        import io
        with tempfile.TemporaryDirectory() as tmp:
            work=Path(tmp);folder=work/'面试准备';folder.mkdir();(folder/'a.md').write_text('before a');(folder/'b.md').write_text('before b')
            changes=[{'path':'面试准备/'+n+'.md','base':remote_files.version(folder/(n+'.md')),'contentBase64':base64.b64encode(('after '+n).encode()).decode()} for n in ['a','b']]
            body=json.dumps({'changes':changes}).encode()
            class Request:
                headers={'Content-Length':str(len(body))};rfile=io.BytesIO(body)
                def _send_json(self,*args):pass
            original=remote_files.os.replace;count=0
            def fail_once(src,dest):
                nonlocal count
                count+=1
                if count==2:raise OSError('fixture write interruption')
                return original(src,dest)
            with patch.object(remote_files.os,'replace',side_effect=fail_once):
                with self.assertRaises(OSError):remote_files.serve_post(Request(),tmp,validate)
            self.assertEqual((folder/'a.md').read_text(),'before a');self.assertEqual((folder/'b.md').read_text(),'before b')

    def test_hosted_configuration_fails_closed(self):
        env={**os.environ,'TOUDI_MODE':'hosted','TOUDI_PASSWORD':'','TOUDI_SESSION_SECRET':'','TOUDI_PUBLIC_URL':ORIGIN}
        p=subprocess.run([sys.executable,str(ROOT/'run.py')],env=env,capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0)
        self.assertIn('hosted mode requires',p.stderr)
