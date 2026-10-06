"""Active export/CLI utilities and Codex boundaries, using synthetic facts only."""
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
import filling_profile
from filling_tools import extension_bundle, _validate_scan, profile_status
from codex_mapping import map_with_codex


class FillingToolsTests(unittest.TestCase):
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
        self.scan = {'protocol':1,'origin':'https://recruit.example.invalid','path':'/application','title':'合成表单','fingerprint':'schema-a','fields':[
            {'id':'email','label':'电子邮箱','module':'personal','type':'email','value':'','options':[],'groupLabel':'个人信息'},
            {'id':'name','label':'姓名','module':'personal','type':'text','value':'用户已有名字','options':[],'groupLabel':'个人信息'},
            {'id':'unknown','label':'所在区域','module':'personal','type':'text','value':'','options':[],'groupLabel':'个人信息'},
        ]}


    def tearDown(self):
        self.temp.cleanup()


    def test_scan_rejects_credential_and_hidden_content(self):
        for scan in ({**self.scan,'path':'/form?secret=synthetic'}, {**self.scan,'origin':'https://user:secret@example.invalid'},
                     {**self.scan,'fields':[{'id':'p','type':'password'}]}, {**self.scan,'fields':self.scan['fields']*2}):
            with self.assertRaises(ValueError):_validate_scan(scan)


    def test_agent_payload_contains_keys_not_personal_fact_values(self):
        plan=filling_profile.plan_fields(filling_profile.load_profile(self.root), self.scan)
        state={'profile':filling_profile.load_profile(self.root), 'plan':plan}
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
        plan=filling_profile.plan_fields(filling_profile.load_profile(self.root), self.scan)
        state={'profile':filling_profile.load_profile(self.root), 'plan':plan}
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
        plan=filling_profile.plan_fields(filling_profile.load_profile(self.root), self.scan);state={'profile':filling_profile.load_profile(self.root), 'plan':plan}
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
        plan=filling_profile.plan_fields(filling_profile.load_profile(self.root), self.scan);state={'profile':filling_profile.load_profile(self.root), 'plan':plan}
        with patch('codex_mapping.codex_binary',return_value='codex'), patch('codex_mapping.chatgpt_login',return_value={'available':True}), \
             patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'gpt-5.5','default':True,'effort':'low'}]}), \
             patch('codex_mapping.subprocess.run') as execute:
            for model in ('','unlisted-model'):
                with self.subTest(model=model), self.assertRaises(ValueError):
                    map_with_codex(state['profile'],self.scan,state['plan'],model=model)
            execute.assert_not_called()


    def test_user_selected_catalog_model_is_allowed_without_lightweight_restriction(self):
        plan=filling_profile.plan_fields(filling_profile.load_profile(self.root), self.scan);state={'profile':filling_profile.load_profile(self.root), 'plan':plan}
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
            self.assertEqual(len(names),14)
            self.assertIn('TouDi-filling/profile-library.js',names)
            self.assertIn('TouDi-filling/form-engine.js',names)
            manifest=json.loads(bundle.read('TouDi-filling/manifest.json'))
            self.assertEqual(manifest['permissions'],['activeTab','scripting','storage','nativeMessaging'])
            self.assertNotIn('host_permissions',manifest)
            self.assertIn('TouDi-filling/options.html',names)
            self.assertIn('TouDi-filling/filling-core.js',names)
            self.assertIn('TouDi-filling/agent-config.js',names)
            self.assertNotIn('content_scripts',manifest)


if __name__=='__main__':unittest.main()
