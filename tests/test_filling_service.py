"""Local bridge protections and source/readback boundaries, using synthetic facts only."""
import json
import os
import sys
import tempfile
import unittest
import zipfile
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from filling_service import FillingService, FillingConflict, bridge_origin_allowed, extension_bundle, map_with_codex, _validate_scan


class FillingServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / '填报资料/资料.json'
        self.source.parent.mkdir()
        self.source.write_text(json.dumps({'schemaVersion':1, 'rules':['仅填写确认事实'], 'facts':[
            {'key':'personal.email','label':'电子邮箱','value':'fixture@example.invalid','module':'personal'},
            {'key':'personal.name','label':'姓名','value':'合成候选甲','module':'personal'},
            {'key':'personal.city','label':'现居地','value':'合成城市','module':'personal'},
        ]}, ensure_ascii=False))
        self.service = FillingService(self.root, 18336)
        self.scan = {'protocol':1,'origin':'https://recruit.example.invalid','path':'/application','title':'合成表单','fingerprint':'schema-a','fields':[
            {'id':'email','label':'电子邮箱','module':'personal','type':'email','value':'','options':[],'groupLabel':'个人信息'},
            {'id':'name','label':'姓名','module':'personal','type':'text','value':'用户已有名字','options':[],'groupLabel':'个人信息'},
            {'id':'unknown','label':'所在区域','module':'personal','type':'text','value':'','options':[],'groupLabel':'个人信息'},
        ]}

    def tearDown(self):
        self.temp.cleanup()

    def test_preview_and_report_never_store_personal_values(self):
        before = self.source.read_bytes()
        plan = self.service.plan(self.scan)
        text = json.dumps(plan, ensure_ascii=False)
        self.assertNotIn('fixture@example.invalid', text)
        self.assertNotIn('用户已有名字', text)
        self.assertNotIn('合成候选甲', text)
        self.assertNotIn('actions', plan)
        self.assertEqual(plan['rows'][1]['status'], 'conflict')
        with self.assertRaises(ValueError):
            self.service.confirm(plan['planId'], ['name'], [])
        approved = self.service.confirm(plan['planId'], ['email','name'], ['name'])
        self.assertEqual(approved['actions'][1]['expectedValue'], '用户已有名字')
        self.assertTrue(approved['actions'][1]['overwrite'])
        self.assertEqual(approved['actions'][0]['value'], 'fixture@example.invalid')
        report = self.service.report(plan['planId'], {'results':[{'fieldId':'email','status':'verified','reason':'fixture@example.invalid','actualValue':'fixture@example.invalid'}]})
        self.assertEqual(report['summary']['failed'], 1)  # An omitted result is never counted as success.
        self.assertEqual(report['summary']['verified'], 1)
        self.assertFalse(report['submitted'])
        self.assertEqual(report['saveState'], 'unconfirmed')
        raw = (self.root / '填报资料/最近核验.json').read_text()
        self.assertNotIn('fixture@example.invalid',raw)
        self.assertNotIn('用户已有名字',raw)
        self.assertEqual(self.source.read_bytes(), before)
        with self.assertRaises(FillingConflict):self.service.confirm(plan['planId'],[],[])

    def test_profile_change_and_expired_plan_stop_confirm(self):
        plan = self.service.plan(self.scan)
        self.source.write_text(self.source.read_text() + ' ')
        with self.assertRaises(FillingConflict):self.service.confirm(plan['planId'], ['email'], [])
        plan = self.service.plan(self.scan)
        self.service.plans[plan['planId']]['time'] -= 601
        with self.assertRaises(FillingConflict):self.service.confirm(plan['planId'], ['email'], [])

    def test_remembered_mapping_uses_exact_page_structure_and_profile(self):
        plan = self.service.plan(self.scan)
        changed = self.service.remap(plan['planId'], {'unknown':'personal.city'}, remember=True)
        self.assertEqual(changed['rows'][2]['status'],'ready')
        self.assertEqual(self.service.plan(self.scan)['rows'][2]['status'],'ready')
        self.assertEqual(self.service.plan({**self.scan,'path':'/another'})['rows'][2]['status'],'missing')
        self.assertEqual(self.service.plan({**self.scan,'fingerprint':'schema-b'})['rows'][2]['status'],'missing')
        self.assertEqual(self.service.plan(self.scan,'state')['rows'][2]['status'],'missing')
        with self.assertRaises(ValueError):self.service.remap(plan['planId'], {'email':'unknown-private-fact'})
        with self.assertRaises(ValueError):self.service.confirm(plan['planId'], ['unknown-field'], [])

    def test_token_rotation_and_origin_scope(self):
        code=json.loads(self.service.connect()['connection'])
        self.assertTrue(self.service.authorized('Bearer '+code['token']))
        self.assertFalse(self.service.authorized('Bearer '+'0'*64))
        if os.name!='nt':self.assertEqual((self.root/'填报资料/.browser-token.json').stat().st_mode & 0o777,0o600)
        self.service.connect(reset=True)
        self.assertFalse(self.service.authorized('Bearer '+code['token']))
        handler=SimpleNamespace(client_address=('127.0.0.1',123),headers={'Host':'127.0.0.1:18336','Origin':'chrome-extension://'+'a'*32})
        self.assertTrue(bridge_origin_allowed(handler,18336))
        handler.headers['Origin']='https://evil.example.invalid'
        self.assertFalse(bridge_origin_allowed(handler,18336))
        handler.headers['Origin']='chrome-extension://'+'a'*32;handler.client_address=('203.0.113.2',123)
        self.assertFalse(bridge_origin_allowed(handler,18336))

    def test_scan_rejects_credential_and_hidden_content(self):
        for scan in ({**self.scan,'path':'/form?secret=synthetic'}, {**self.scan,'origin':'https://user:secret@example.invalid'},
                     {**self.scan,'fields':[{'id':'p','type':'password'}]}, {**self.scan,'fields':self.scan['fields']*2}):
            with self.assertRaises(ValueError):_validate_scan(scan)

    def test_agent_payload_contains_keys_not_personal_fact_values(self):
        plan=self.service.plan(self.scan)
        task=self.service.agent_task(plan['planId'])['task']
        self.assertIn('personal.city',task)
        self.assertNotIn('fixture@example.invalid',task)
        self.assertNotIn('合成城市',task)
        self.assertNotIn('用户已有名字',task)
        state=self.service.plans[plan['planId']]
        def fake_run(command, **kwargs):
            self.assertIn('shell_tool',command)
            self.assertIn('--ignore-user-config',command)
            self.assertNotIn('fixture@example.invalid',kwargs['input'])
            target=Path(command[command.index('-o')+1])
            target.write_text(json.dumps({'mappings':[{'fieldId':'unknown','factKey':'personal.city'}]}))
            return SimpleNamespace(returncode=0,stdout='',stderr='')
        with patch('codex_mapping.codex_binary',return_value='codex'), patch('codex_mapping.chatgpt_login',return_value={'available':True}), \
             patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'fixture-luna','default':True,'effort':'low'}]}), \
             patch('codex_mapping.subprocess.run',side_effect=fake_run):
            mapping, provider=map_with_codex(state['profile'],self.scan,state['plan'],model='fixture-luna')
        self.assertEqual(mapping,{'unknown':'personal.city'});self.assertTrue(provider['called'])
        self.assertEqual(provider['billing'],'codex-plan')

    def test_api_login_and_unavailable_model_never_start_inference(self):
        plan=self.service.plan(self.scan)
        state=self.service.plans[plan['planId']]
        with patch('codex_mapping.codex_binary',return_value='codex'), \
             patch('codex_mapping.chatgpt_login',return_value={'available':False,'message':'API login blocked'}), \
             patch('codex_mapping.subprocess.run') as execute:
            with self.assertRaisesRegex(ValueError,'API login blocked'):
                map_with_codex(state['profile'],self.scan,state['plan'],model='fixture-luna')
            execute.assert_not_called()
        with patch('codex_mapping.codex_binary',return_value='codex'), patch('codex_mapping.chatgpt_login',return_value={'available':True}), \
             patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'fixture-luna','default':True,'effort':'low'}]}), \
             patch('codex_mapping.subprocess.run') as execute:
            with self.assertRaisesRegex(ValueError,'不会自动替换'):
                map_with_codex(state['profile'],self.scan,state['plan'],model='gpt-6-luna')
            execute.assert_not_called()

    def test_inference_forces_subscription_and_removes_api_environment(self):
        plan=self.service.plan(self.scan);state=self.service.plans[plan['planId']]
        def fake_run(command,**kwargs):
            self.assertIn('forced_login_method="chatgpt"',command)
            self.assertIn('model_provider="openai"',command)
            self.assertNotIn('OPENAI_API_KEY',kwargs['env']);self.assertNotIn('CODEX_API_KEY',kwargs['env'])
            Path(command[command.index('-o')+1]).write_text('{"mappings":[]}')
            return SimpleNamespace(returncode=0,stdout='',stderr='')
        with patch.dict(os.environ,{'OPENAI_API_KEY':'synthetic-secret','CODEX_API_KEY':'synthetic-secret'}), \
             patch('codex_mapping.codex_binary',return_value='codex'),patch('codex_mapping.chatgpt_login',return_value={'available':True}), \
             patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'fixture-luna','default':True,'effort':'low'}]}), \
             patch('codex_mapping.subprocess.run',side_effect=fake_run):
            map_with_codex(state['profile'],self.scan,state['plan'],model='fixture-luna')

    def test_missing_or_unlisted_model_never_uses_cli_default(self):
        plan=self.service.plan(self.scan);state=self.service.plans[plan['planId']]
        with patch('codex_mapping.codex_binary',return_value='codex'), patch('codex_mapping.chatgpt_login',return_value={'available':True}), \
             patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'gpt-5.5','default':True,'effort':'low'}]}), \
             patch('codex_mapping.subprocess.run') as execute:
            for model in ('','unlisted-model'):
                with self.subTest(model=model), self.assertRaises(ValueError):
                    map_with_codex(state['profile'],self.scan,state['plan'],model=model)
            execute.assert_not_called()

    def test_user_selected_catalog_model_is_allowed_without_lightweight_restriction(self):
        plan=self.service.plan(self.scan);state=self.service.plans[plan['planId']]
        def execute(command,**kwargs):
            self.assertEqual(command[command.index('-m')+1],'fixture-user-model')
            Path(command[command.index('-o')+1]).write_text('{"mappings":[]}')
            return SimpleNamespace(returncode=0,stdout='',stderr='')
        with patch('codex_mapping.codex_binary',return_value='codex'), patch('codex_mapping.chatgpt_login',return_value={'available':True}), \
             patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'fixture-user-model','default':False,'effort':'low'}]}), \
             patch('codex_mapping.subprocess.run',side_effect=execute):
            _,provider=map_with_codex(state['profile'],self.scan,state['plan'],model='fixture-user-model')
            self.assertEqual(provider['model'],'fixture-user-model')

    def test_extension_bundle_contains_only_code_and_shared_engine(self):
        with zipfile.ZipFile(io.BytesIO(extension_bundle())) as bundle:
            names=bundle.namelist()
            self.assertEqual(len(names),13)
            self.assertIn('TouDi-filling/form-engine.js',names)
            manifest=json.loads(bundle.read('TouDi-filling/manifest.json'))
            self.assertEqual(manifest['permissions'],['activeTab','scripting','storage','nativeMessaging'])
            self.assertNotIn('host_permissions',manifest)
            self.assertIn('TouDi-filling/options.html',names)
            self.assertIn('TouDi-filling/filling-core.js',names)
            self.assertIn('TouDi-filling/agent-config.js',names)
            self.assertNotIn('content_scripts',manifest)


if __name__=='__main__':unittest.main()
