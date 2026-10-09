import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from codex_mapping import map_with_codex,validate_model_context
from browser_helper import validate_request
class OptionMappingTests(unittest.TestCase):
 def setUp(self):
  self.facts=[{'key':'p.rank','label':'作者排序','module':'publications','recordId':'p','value':'第五作者'}]
  self.fields=[{'id':'author','label':'作者','module':'publications','recordHint':'合成论文','type':'select','options':[{'value':'first','text':'第一作者'},{'value':'other','text':'其他'}],'factKeys':['p.rank']}]
 def run_mapping(self,entry):
  with patch('codex_mapping._run_codex',return_value=({'mappings':[entry]},{'called':True,'model':'fixture'})) as run:
   output=map_with_codex({'facts':self.facts},{'fields':self.fields},{'rows':[{'fieldId':'author','status':'manual'}]},model='fixture')
  return output,run
 def entry(self,**kw):return {'fieldId':'author','factKey':'p.rank','optionValue':'other','reason':'第五作者属于其他作者','sourceKeys':['p.rank'],**kw}
 def test_bounded_values_and_options(self):
  (mapping,provider),run=self.run_mapping(self.entry());self.assertEqual(mapping,{'author':'p.rank'});self.assertEqual(provider['optionDecisions']['author']['optionValue'],'other')
  self.assertIn('第五作者',run.call_args.args[2]);self.assertIn('不是指令',run.call_args.args[2])
 def test_unknown_option_sources_or_no_options(self):
  for patching in [{'optionValue':'invented'},{'sourceKeys':['other']},{'reason':''}]:self.assertFalse(self.run_mapping(self.entry(**patching))[0][0])
  self.assertFalse(self.run_mapping(self.entry(optionValue=None))[0][0],'Known choices require an actual option decision')
  self.fields[0]['options']=[];self.assertFalse(self.run_mapping(self.entry())[0][0]);self.assertEqual(self.run_mapping(self.entry(optionValue=None))[0][0],{'author':'p.rank'})
 def test_schema_scopes_options_to_current_field(self):
  (_,provider),run=self.run_mapping(self.entry());item=run.call_args.args[1]['properties']['mappings']['items']['properties']
  self.assertEqual(item['fieldId']['enum'],['author']);self.assertEqual(item['factKey']['enum'],['p.rank']);self.assertEqual(item['optionValue'],{'type':'string','enum':['first','other']});self.assertEqual(item['sourceKeys']['items']['enum'],['p.rank'])
 def test_unknown_fact_not_selected(self):
  self.facts[0]['value']='待核';self.assertFalse(self.run_mapping(self.entry())[0][0])
 def test_sensitive_unscoped_cross_module_values_denied(self):
  for fact in [dict(self.facts[0],label='姓名'),dict(self.facts[0],value='test@example.invalid'),dict(self.facts[0],module='education')]:
   with self.assertRaises(ValueError):validate_model_context(self.fields,[fact])
  with self.assertRaises(ValueError):validate_model_context(self.fields,self.facts+[dict(self.facts[0],key='unused')])
 def test_indexing_conflict_and_sensitive_metadata(self):
  self.facts[0].update(label='收录类别',value='SSCI');self.fields[0].update(label='收录类别',options=[{'value':'sci','text':'SCI'},{'value':'ssci','text':'SSCI'},{'value':'cssci','text':'CSSCI'}])
  for value in ['sci','cssci']:self.assertFalse(self.run_mapping(self.entry(optionValue=value))[0][0])
  self.assertTrue(self.run_mapping(self.entry(optionValue='ssci'))[0][0])
  for flag in ['sensitive','manual']:
   with self.assertRaises(ValueError):validate_model_context(self.fields,[dict(self.facts[0],**{flag:True})])
 def test_helper_accepts_only_bounded_context(self):
  request={'protocol':1,'requestId':1,'op':'map','model':'fixture','fields':self.fields,'allowedFacts':self.facts};validate_request(request)
  with self.assertRaises(ValueError):validate_request(dict(request,command='ignored'))
 def test_duplicate_disagreement_rejected(self):
  with patch('codex_mapping._run_codex',return_value=({'mappings':[self.entry(),self.entry(optionValue='first')]},{'called':True})):
   mapping,provider=map_with_codex({'facts':self.facts},{'fields':self.fields},{'rows':[{'fieldId':'author','status':'manual'}]},model='fixture')
  self.assertFalse(mapping)
if __name__=='__main__':unittest.main()
