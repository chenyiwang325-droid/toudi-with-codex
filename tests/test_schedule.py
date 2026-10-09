"""Schedule persistence, source identity migration, old backups and RFC5545 boundaries."""
import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
import schedule_store
import workbench


def event(**overrides):
    return {'id':'synthetic-item', 'title':'合成企业 · 面试', 'type':'interview',
            'status':'planned', 'start':'2026-10-09T10:00:00+08:00',
            'end':'2026-10-09T11:00:00+08:00', 'allDay':False,
            'timeZone':'Asia/Shanghai', 'notes':'完整原文；不截断。',
            'syncToCalendar':False, **overrides}


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.w=workbench.Workbench(Path(self.tmp.name))
    def tearDown(self): self.tmp.cleanup()
    def save(self, **payload):
        return self.w.mutate({'module':'schedule','base':self.w.get('schedule')['version'], **payload})
    def test_empty_workspace_and_crud_restart_conflict(self):
        self.assertEqual(self.w.read('schedule'), schedule_store.empty())
        before=self.w.inventory()
        result=self.save(action='upsert',item=event(notes='全文'*5000))
        base=result['version']
        self.assertEqual(workbench.Workbench(self.w.root).read('schedule')['events'][0]['notes'], '全文'*5000)
        self.save(action='upsert',item={'id':'synthetic-item','start':'2026-10-10T10:00:00+08:00','end':'2026-10-10T11:00:00+08:00'})
        with self.assertRaises(workbench.Conflict):
            self.w.mutate({'module':'schedule','base':base,'action':'upsert','item':event(title='旧标签页')})
        self.assertEqual(self.w.read('schedule')['events'][0]['start'], '2026-10-10T10:00:00+08:00')
        self.save(action='delete',item={'id':'synthetic-item'})
        self.assertEqual(self.w.read('schedule')['events'][0]['status'],'cancelled')
        self.assertEqual({k:v for k,v in self.w.inventory().items() if k!=schedule_store.PATH},before)
    def test_company_key_migration_keeps_whole_schedule(self):
        self.w.mutate({'module':'records','base':self.w.get('records')['version'],'action':'replace','data':[{'名称':'Synthetic Alpha','公告链接':'https://example.invalid/a'}]})
        self.save(action='upsert',item=event(companyKey='Synthetic Alpha',prepId='old-material'))
        self.w.mutate({'module':'records','base':self.w.get('records')['version'],'action':'upsert','item':{'id':'Synthetic Alpha','record':{'名称':'Synthetic Beta','公告链接':'https://example.invalid/b'}}})
        result=self.w.read('schedule')['events'][0]
        self.assertEqual(result['companyKey'],'Synthetic Beta')
        self.assertEqual(result['notes'],event()['notes'])
        self.assertEqual(result['prepId'],'old-material')
    def test_invalid_input_leaves_disk_unchanged(self):
        self.save(action='upsert',item=event());before=self.w.inventory()
        for changes in ({'start':'2026-02-30T10:00:00Z'}, {'start':'2026-10-09T10:00:00'}, {'end':'2026-10-09T09:00:00+08:00'}, {'timeZone':'bad/zone'}, {'priority':True}, {'url':'https://name:password@example.invalid/'}, {'id':'../escape'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError): self.save(action='upsert',item=event(**changes))
        self.assertEqual(self.w.inventory(),before)
        with self.assertRaises(ValueError): self.w.validate('schedule',{**schedule_store.empty(),'events':[event(),event()]})
    def test_unplanned_and_point_dates_preserve_precision(self):
        self.save(action='upsert',item=event(start=None,end=None))
        self.assertEqual(self.w.read('schedule')['events'][0]['start'],None)
        pack=self.w.read('schedule');self.assertNotIn(b'BEGIN:VEVENT',schedule_store.export_ics(pack,'synthetic'))
        self.save(action='upsert',item=event(end=None))
        content=schedule_store.export_ics(self.w.read('schedule'),'synthetic').decode()
        self.assertIn('DTSTART:20261009T020000Z',content);self.assertNotIn('DTEND:',content)
    def test_ics_dates_unicode_folding_alarm_stable_uid(self):
        pack={**schedule_store.empty(),'events':[event(id='day',start='2026-10-09',end='2026-10-12',allDay=True,title='中文'*100,notes='a,b;c\\d\n下一行',reminderMinutes=30),event(id='cancel',status='cancelled')]}
        raw=schedule_store.export_ics(pack,'synthetic');content=raw.decode()
        self.assertEqual(content.count('BEGIN:VEVENT'),1)
        self.assertIn('DTSTART;VALUE=DATE:20261009',content);self.assertIn('DTEND;VALUE=DATE:20261012',content)
        self.assertIn('DESCRIPTION:a\\,b\\;c\\\\d\\n下一行',content)
        self.assertIn('TRIGGER:-PT30M',content)
        self.assertTrue(all(len(line)<=75 for line in raw.split(b'\r\n')))
        uid=next(line for line in content.splitlines() if line.startswith('UID:'))
        self.assertIn(uid,schedule_store.export_ics(pack,'synthetic').decode())
        self.assertNotIn(uid,schedule_store.export_ics(pack,'another-workspace').decode())
    def test_backup_restores_schedule_and_legacy_preserves_new_data(self):
        old=self.w.backup();self.save(action='upsert',item=event());latest=self.w.backup()
        with zipfile.ZipFile(io.BytesIO(old)) as archive:
            files={name:archive.read(name) for name in archive.namelist()};manifest=json.loads(files['manifest.json']);manifest.pop('scheduleScope',None);files['manifest.json']=json.dumps(manifest).encode()
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as archive:
            for name,contents in files.items():archive.writestr(name,contents)
        self.assertIn(schedule_store.PATH,self.w.restore(raw.getvalue(),None,True)['preserved'])
        self.w.restore(raw.getvalue(),self.w.version());self.assertEqual(len(self.w.read('schedule')['events']),1)
        self.save(action='delete',item={'id':'synthetic-item'})
        self.w.restore(latest,self.w.version());self.assertEqual(self.w.read('schedule')['events'][0]['status'],'planned')
    def test_revision_signal_detects_external_update(self):
        before=self.w.refresh_revisions()['schedule'];self.save(action='upsert',item=event())
        self.assertNotEqual(self.w.refresh_revisions()['schedule'],before)


if __name__=='__main__': unittest.main()
