import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import browser_helper
from codex_mapping import adapt_with_codex, validate_structure_hints

CANDIDATES=[{'fieldId':'field-1','labels':[{'id':'label-1','text':'学校名称'}],'groups':[{'id':'group-1','text':'教育经历'}]}]

class StructureAssistTests(unittest.TestCase):
    def test_native_accepts_only_candidates_and_explicit_model(self):
        request={'protocol':1,'requestId':1,'op':'adapt','model':'fixture-model','candidates':CANDIDATES}
        browser_helper.validate_request(request)
        for changes in ({'value':'private'}, {'path':'/arbitrary'}, {'model':''}, {'allowedFacts':[]}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):browser_helper.validate_request({**request,**changes})
        with patch('codex_mapping.adapt_with_codex',return_value=({'field-1':{'labelId':'label-1'}},{'called':True})) as model:
            self.assertEqual(browser_helper.operation(request)['hints'],{'field-1':{'labelId':'label-1'}})
            self.assertEqual(model.call_args.args,(CANDIDATES,))
            self.assertEqual(model.call_args.kwargs,{'model':'fixture-model'})

    def test_hints_cannot_add_code_content_or_unknown_ids(self):
        valid={'field-1':{'labelId':'label-1','groupId':'group-1'}}
        self.assertEqual(validate_structure_hints(CANDIDATES,valid),valid)
        for hints in ({'field-1':{'selector':'input'}},{'field-1':{'labelId':'new-label'}},{'unknown':{'labelId':'label-1'}},{'field-1':{}},{'field-1':{'groupId':None}}):
            with self.subTest(hints=hints),self.assertRaises(ValueError):validate_structure_hints(CANDIDATES,hints)

    def test_codex_uses_existing_allowance_no_tools_or_facts(self):
        commands=[]
        def run(command,**kwargs):
            commands.append(command)
            task=json.loads(kwargs['input'].split('\n',1)[1])
            self.assertEqual(task,{'candidates':CANDIDATES})
            self.assertEqual(command[command.index('-m')+1],'fixture-model')
            self.assertIn('--ignore-user-config',command)
            self.assertIn('forced_login_method="chatgpt"',command)
            self.assertIn('shell_tool',command)
            self.assertIn('browser_use',command)
            Path(command[command.index('-o')+1]).write_text(json.dumps({'hints':[{'fieldId':'field-1','labelId':'label-1','groupId':None}]}))
            return type('Result',(),{'returncode':0,'stdout':'','stderr':''})()
        with patch('codex_mapping.codex_binary',return_value='codex'),patch('codex_mapping.chatgpt_login',return_value={'available':True}),patch('codex_mapping.codex_status',return_value={'available':True,'models':[{'id':'fixture-model','effort':'low'}]}),patch('codex_mapping.subprocess.run',side_effect=run):
            hints,provider=adapt_with_codex(CANDIDATES,model='fixture-model')
        self.assertEqual(hints,{'field-1':{'labelId':'label-1'}})
        self.assertEqual(provider['billing'],'codex-plan')
        self.assertEqual(len(commands),1)

    def test_empty_candidates_never_call_model(self):
        with patch('codex_mapping.subprocess.run') as execute:
            self.assertEqual(adapt_with_codex([],model='fixture-model')[0],{})
            execute.assert_not_called()

if __name__=='__main__':unittest.main()
