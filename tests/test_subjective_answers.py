import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import browser_helper
import codex_mapping

class SubjectiveAnswerTests(unittest.TestCase):
    def payload(self):
        return {'question':{'label':'个人评价','module':'personal','maxLength':30},'profileId':'general','sourceVersion':'fixture-v1','sources':[{'key':'project.description','label':'项目职责','module':'project','recordLabel':'合成项目','value':'整理需求并完成原型评审'}]}

    def test_mock_generation_keeps_selected_model_and_sources(self):
        payload=self.payload();result={'answer':'我善于整理需求并推进原型评审。','sourceKeys':['project.description'],'uncertainties':['缺少效果数据']}
        with patch('codex_mapping._run_codex',return_value=(result,{'model':'fixture-model','called':True})) as run:
            value=browser_helper.operation({'protocol':1,'requestId':1,'op':'answer','model':'fixture-model',**payload})
        self.assertEqual(value['answer'],result)
        self.assertEqual(run.call_args.args[3],'fixture-model')
        self.assertIn('不编造',run.call_args.args[2])

    def test_hobbies_skills_and_strengths_are_supported_without_fabrication(self):
        for label in ('兴趣爱好','专业技能','优劣势'):
            p=self.payload();p['question']['label']=label
            self.assertEqual(codex_mapping.validate_answer_request(p)['question']['label'],label)
        with patch('codex_mapping._run_codex',return_value=({'answer':'资料未提供兴趣爱好。','sourceKeys':['project.description'],'uncertainties':['请补充真实爱好']},{})) as run:
            codex_mapping.answer_with_codex(self.payload(),model='fixture-model')
        self.assertIn('兴趣爱好不可推测',run.call_args.args[2])

    def test_rejects_sensitive_or_unbounded_requests(self):
        for change in ({'path':'/tmp/private'},{'question':{'label':'家庭成员描述','module':'personal','maxLength':30}},{'sources':[{'key':'personal.name','label':'姓名','module':'personal','recordLabel':'','value':'合成姓名'}]},{'sources':[{'key':'project.description','label':'职责','module':'project','recordLabel':'','value':'联系 13900000000'}]}):
            p=self.payload();p.update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):codex_mapping.validate_answer_request(p)
        with self.assertRaises(ValueError):browser_helper.validate_request({'protocol':1,'requestId':1,'op':'answer','model':'fixture-model',**self.payload(),'command':'echo'})

    def test_rejects_invented_sources_and_overlength_answers(self):
        for answer in ({'answer':'x'*31,'sourceKeys':['project.description'],'uncertainties':[]},{'answer':'回答','sourceKeys':['unknown'],'uncertainties':[]},{'answer':'回答','sourceKeys':[],'uncertainties':[]}):
            with self.subTest(answer=answer),self.assertRaises(ValueError):codex_mapping.validate_subjective_answer(self.payload(),answer)

if __name__=='__main__':unittest.main()
