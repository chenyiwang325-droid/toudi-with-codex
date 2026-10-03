import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from workbench import Workbench
from legacy_update import recover


class LegacyUpdateTests(unittest.TestCase):
    def test_app_read_recovers_interrupted_records_and_marks_together(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); wb=Workbench(root); run=wb.data/'.update-runs'/'isolated'
            (run/'baseline').mkdir(parents=True)
            before={'投递记录.json':json.dumps([{'名称':'before'}]).encode(),
                    '用户编辑数据.json':b'{"edits":{"before":{"starred":true}},"pref":{}}'}
            after={'投递记录.json':json.dumps([{'名称':'after'}]).encode(),
                   '用户编辑数据.json':b'{"edits":{},"pref":{}}'}
            hashes={}
            for name,raw in before.items():
                (run/'baseline'/name).write_bytes(raw); (wb.data/name).write_bytes(after[name])
                hashes[name]={'before':hashlib.sha256(raw).hexdigest(),'after':hashlib.sha256(after[name]).hexdigest()}
            (wb.data/'.update-transaction.json').write_text(json.dumps({'state':'publishing','run':str(run),'files':hashes}))
            self.assertEqual(wb.get('records')['data'][0]['名称'],'before')
            self.assertTrue(wb.read('edits')['edits']['before']['starred'])
            self.assertFalse((wb.data/'.update-transaction.json').exists())

    def test_recovery_rejects_arbitrary_paths_and_untracked_external_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); run=root/'.update-runs'/'isolated'; (run/'baseline').mkdir(parents=True)
            journal=root/'.update-transaction.json'
            journal.write_text(json.dumps({'state':'publishing','run':str(run),'files':{'../outside':{'before':None,'after':'0'*64}}}))
            with self.assertRaises(ValueError): recover(root)
            target=root/'投递记录.json'; target.write_text('external')
            journal.write_text(json.dumps({'state':'publishing','run':str(run),'files':{target.name:{'before':None,'after':'0'*64}}}))
            with self.assertRaises(ValueError): recover(root)
            self.assertEqual(target.read_text(),'external')
            self.assertTrue(journal.exists())
