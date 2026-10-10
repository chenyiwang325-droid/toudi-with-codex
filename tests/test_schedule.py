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
        for changes in ({'start':'2026-02-30T10:00:00Z'}, {'start':'2026-10-09T10:00:00'}, {'end':'2026-10-09T09:00:00+08:00'}, {'timeZone':'bad/zone'}, {'priority':True}, {'url':'https://name:password@example.invalid/'}, {'meetingInfo':123456789}, {'meetingInfo':'x'*2049}, {'id':'../escape'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError): self.save(action='upsert',item=event(**changes))
        self.assertEqual(self.w.inventory(),before)
        with self.assertRaises(ValueError): self.w.validate('schedule',{**schedule_store.empty(),'events':[event(),event()]})
    def test_meeting_number_and_instructions_survive_save_restart_and_backup(self):
        info='会议号：123 456 789\n入会密码：0123\n请提前五分钟进入会议。'
        self.save(action='upsert',item=event(meetingInfo=info,url=''))
        self.assertEqual(workbench.Workbench(self.w.root).read('schedule')['events'][0]['meetingInfo'],info)
        backup=self.w.backup()
        self.save(action='upsert',item={'id':'synthetic-item','meetingInfo':'修改后的会议号'})
        self.w.restore(backup,self.w.version())
        self.assertEqual(self.w.read('schedule')['events'][0]['meetingInfo'],info)
    def test_meeting_information_exports_as_description_not_invalid_url(self):
        info='123 456 789\n密码：0123；保留原文'
        self.save(action='upsert',item=event(meetingInfo=info,url=''))
        content=schedule_store.export_ics(self.w.read('schedule'),'synthetic').decode().replace('\r\n ','')
        self.assertIn('DESCRIPTION:'+schedule_store.text(event()['notes']+'\n\n入会信息：'+info),content)
        self.assertNotIn('\r\nURL:',content)
    def test_legacy_url_and_new_url_information_remain_exportable(self):
        link='https://example.invalid/join?meeting=123456789'
        self.save(action='upsert',item=event(url=link))
        content=schedule_store.export_ics(self.w.read('schedule'),'synthetic').decode().replace('\r\n ','')
        self.assertIn('URL:'+link,content)
        self.assertNotIn('meetingInfo',self.w.read('schedule')['events'][0])
        self.save(action='upsert',item={'id':'synthetic-item','meetingInfo':link})
        result=workbench.Workbench(self.w.root).read('schedule')['events'][0]
        self.assertEqual(result['url'],link)
        self.assertEqual(result['meetingInfo'],link)
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
    def test_whole_schedule_policy_persists_without_rewriting_legacy_events(self):
        legacy={**schedule_store.empty(), 'calendar':{'enabled':True,'calendarId':'synthetic-calendar'},
                'events':[event(),event(id='other',syncToCalendar=True)]}
        self.save(action='replace',data=legacy)
        self.assertNotIn('syncAll',self.w.read('schedule')['calendar'])
        enabled={**legacy,'calendar':{**legacy['calendar'],'syncAll':True}}
        self.save(action='replace',data=enabled)
        fresh=workbench.Workbench(self.w.root).read('schedule')
        self.assertTrue(fresh['calendar']['syncAll'])
        self.assertEqual(fresh['events'],legacy['events'])
        backup=self.w.backup()
        self.save(action='replace',data={**enabled,'calendar':{**enabled['calendar'],'enabled':False}})
        self.w.restore(backup,self.w.version())
        self.assertEqual(self.w.read('schedule')['calendar'],enabled['calendar'])
        before=self.w.inventory()
        for invalid in ('true',1,None):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                self.save(action='replace',data={**enabled,'calendar':{**enabled['calendar'],'syncAll':invalid}})
        self.assertEqual(self.w.inventory(),before)


if __name__=='__main__': unittest.main()
