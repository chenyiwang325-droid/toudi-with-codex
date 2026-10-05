import io
import json
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import browser_helper as helper


class BrowserHelperTests(unittest.TestCase):
    def request(self, **kw):
        return {'protocol':1,'requestId':1,'op':'map','model':'gpt-6-luna',
                'fields':[{'id':'f','label':'Contact address','type':'text','module':'personal','options':[]}],
                'allowedFacts':[{'key':'personal.city','label':'现居地','module':'personal','aliases':['居住地']}],**kw}

    def test_rejects_personal_values_commands_files_and_model_fallback(self):
        for change in ({'model':''},{'model':'--shell-command'},{'path':'a-file'}, {'op':'read'},
                       {'fields':[{'id':'f','label':'Email','type':'text','value':'private@example.invalid'}]},
                       {'allowedFacts':[{'key':'f','label':'姓名','module':'personal','value':'Private Person'}]}):
            with self.subTest(change=change),self.assertRaises(ValueError):helper.validate_request(self.request(**change))

    def test_mapping_uses_explicit_user_model_and_semantic_keys(self):
        with patch('codex_mapping.map_with_codex',return_value=({'f':'personal.city'},{'called':True,'model':'gpt-6-luna'})) as model:
            answer=helper.operation(self.request(model='fixture-user-model'))
        self.assertEqual(model.call_args.kwargs,{'model':'fixture-user-model'})
        self.assertNotIn('value',model.call_args.args[0]['facts'][0])
        self.assertEqual(answer['mappings'],{'f':'personal.city'})

    def test_open_workbench_never_accepts_a_caller_path(self):
        with self.assertRaises(ValueError):helper.validate_request({'protocol':1,'requestId':1,'op':'open-workbench','path':'arbitrary'})
        self.assertEqual(helper.validate_request({'protocol':1,'requestId':1,'op':'open-workbench'})['op'],'open-workbench')

    def test_port_accepts_multiple_frames_and_rejects_other_extensions(self):
        requests=[{'protocol':1,'requestId':i,'op':'status'} for i in (1,2)]
        raw=b''.join(struct.pack('=I',len(p))+p for p in [json.dumps(r).encode() for r in requests])
        output=io.BytesIO()
        with patch('browser_helper.operation',return_value={'independent':True}) as op:
            self.assertEqual(helper.serve(helper.ORIGIN,io.BytesIO(raw),output),0)
            self.assertEqual(op.call_count,2)
            denied=io.BytesIO();self.assertEqual(helper.serve('chrome-extension://'+'a'*32+'/',io.BytesIO(raw),denied),1)
            self.assertEqual(denied.getvalue(),b'')
        encoded=output.getvalue();n=struct.unpack('=I',encoded[:4])[0]
        self.assertEqual(json.loads(encoded[4:4+n])['requestId'],1)
        self.assertEqual(json.loads(encoded[8+n:])['requestId'],2)

    def test_oversized_and_truncated_frames_do_not_invoke_model(self):
        with patch('browser_helper.operation') as op:
            for raw in (struct.pack('=I',helper.MAX_MESSAGE+1),struct.pack('=I',10)+b'{}'):
                self.assertEqual(helper.serve(helper.ORIGIN,io.BytesIO(raw),io.BytesIO()),1)
            op.assert_not_called()


if __name__=='__main__':unittest.main()
