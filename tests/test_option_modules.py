"""Real JS request -> native validator contract; all fixtures are synthetic."""
import json,subprocess,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from browser_helper import validate_request
class OptionModuleBoundaryTests(unittest.TestCase):
 def request(self):
  root=Path(__file__).resolve().parents[1]
  script=r"""
const C=require('./app/browser-extension/filling-core.js');
const p=C.profile(C.validatePack({schemaVersion:1,profiles:[{id:'general',label:'合成资料'}],rules:[],facts:[
 {key:'highest',module:'personal',label:'最高学历',value:'硕士'},
 {key:'highestDegree',module:'personal',label:'最高学位',value:'硕士'},
 {key:'m.degree',module:'education',recordId:'m',recordHint:'硕士',label:'学历',value:'硕士'},
 {key:'m.end',module:'education',recordId:'m',recordHint:'硕士',label:'结束日期',value:'2027-06-30'},
 {key:'b.degree',module:'education',recordId:'b',recordHint:'本科',label:'学历',value:'本科'},
 {key:'b.end',module:'education',recordId:'b',recordHint:'本科',label:'结束日期',value:'2024-06-30'},
 {key:'work.tasks',module:'internship',recordId:'work',label:'职责',value:'合成完整职责'},
 {key:'private',module:'personal',label:'手机',value:'13900000000',sensitive:true}
]}));
const fields=[{id:'m',label:'专业人数',module:'education',recordHint:'硕士'},
 {id:'b',label:'专业人数',module:'education',recordHint:'本科'},
 {id:'high',label:'最高学历',module:'education'},
 {id:'grad',label:'毕业日期',module:'personal'},
 {id:'work',label:'工作职责',module:'work'},
 {id:'phone',label:'手机',module:'personal'}].map(f=>({...f,type:'text',value:''}));
const scan={protocol:1,origin:'https://fixture.invalid',path:'/apply',fingerprint:'f',fields};
const plan={rows:fields.map(f=>({fieldId:f.id,status:'missing'}))};
const request=C.agentRequest(p,scan,plan,'fixture-model');request.requestId=1;
if(Object.keys(C.safeAgentMappings(p,scan,{m:'highest',b:'highestDegree'}).accepted).length)throw Error('cross-module scope escaped');
process.stdout.write(JSON.stringify(request));
"""
  result=subprocess.run(['node','-e',script],cwd=root,text=True,capture_output=True,check=True)
  return json.loads(result.stdout)
 def test_js_native_agree_on_field_modules_and_highest_scope(self):
  request=self.request();validate_request(request)
  facts={f['key']:f for f in request['allowedFacts']}
  for field in request['fields']:
   self.assertTrue(all(facts[k]['module']==field['module'] for k in field['factKeys']))
   if field['id'] in {'m','b'}:self.assertFalse({'highest','highestDegree'}&set(field['factKeys']))
  by_id={f['id']:f for f in request['fields']}
  self.assertEqual(by_id['high']['module'],'personal');self.assertEqual(by_id['high']['factKeys'],['highest'])
  self.assertEqual(by_id['grad']['module'],'education');self.assertEqual(by_id['grad']['factKeys'],['m.end'])
  self.assertEqual(by_id['work']['module'],'internship');self.assertNotIn('phone',by_id)
  self.assertNotIn('13900000000',json.dumps(request))
 def test_actual_cross_module_and_old_end_date_loophole_stay_rejected(self):
  req=self.request();field=next(f for f in req['fields'] if f['id']=='m');field['factKeys']=['highest']
  with self.assertRaisesRegex(ValueError,'跨模块'):validate_request(req)
  req=self.request();field=next(f for f in req['fields'] if f['id']=='grad');field['module']='personal'
  with self.assertRaisesRegex(ValueError,'跨模块'):validate_request(req)
 def test_sensitive_value_cannot_be_injected_under_same_module(self):
  req=self.request();fact=next(f for f in req['allowedFacts'] if f['key']=='m.end');fact['value']='13900000000'
  with self.assertRaisesRegex(ValueError,'敏感'):validate_request(req)
if __name__=='__main__':unittest.main()
