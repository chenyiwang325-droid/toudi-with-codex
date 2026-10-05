import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
import preference_rules
from workbench import Workbench


def rules():
    return {'schemaVersion': 1, 'directionMatch': 'any', 'dimensions': {
        'natures': {'groups': []},
        'industries': {'separator': '/', 'aliases': {'A alias': 'A'},
                       'groups': [{'name': 'Own category', 'values': ['A', 'B']}]},
        'education': {'groups': []}}}


class PreferenceRulesTests(unittest.TestCase):
    def test_catalog_does_not_predict_source_meaning(self):
        records = [{'行业': 'A alias/B', '学历要求': '本科及研究生'}, {'行业': 'Unknown'}]
        raw = preference_rules.catalog(records, {})
        self.assertFalse(raw['initialized'])
        self.assertEqual(raw['dimensions']['industries']['values'][0]['raw'], 'A alias/B')
        configured = preference_rules.catalog(records, {'preferenceRules': rules()})
        self.assertEqual(configured['dimensions']['industries']['values'][0]['unmapped'], [])
        self.assertEqual(configured['dimensions']['education']['values'][1]['unmapped'], ['本科及研究生'])

    def test_invalid_mapping_does_not_reach_workspace(self):
        for modify in [
            lambda r: r.update(directionMatch='guess'),
            lambda r: r['dimensions'].pop('education'),
            lambda r: r['dimensions']['industries'].update(aliases={'A': 'B', 'B': 'C'}),
            lambda r: r['dimensions']['industries']['groups'].append({'name': 'Other', 'values': ['A alias']}),
            lambda r: r['dimensions']['education'].update(separator=['/']),
        ]:
            candidate = rules(); modify(candidate)
            with self.assertRaises(ValueError): preference_rules.validate_rules(candidate)

    def test_cli_and_display_share_persisted_rules(self):
        with tempfile.TemporaryDirectory() as temporary:
            wb = Workbench(temporary)
            wb.mutate({'module':'records','base':wb.get('records')['version'],'action':'replace',
                       'data':[{'名称':'Synthetic source','行业':'A alias/B'}]})
            wb.mutate({'module':'edits','base':wb.get('edits')['version'],'action':'replace',
                       'data':{'edits':{'Synthetic source':{'starred':True}},'pref':{'industries':['A alias']}}})
            before = copy.deepcopy(wb.read('edits'))
            config = {'schemaVersion':1,'display':{'density':'compact'},'preferenceRules':rules()}
            wb.mutate({'module':'settings','base':wb.get('settings')['version'],'action':'replace','data':config})
            self.assertEqual(Workbench(temporary).read('settings'), config)
            self.assertEqual(wb.read('edits'), before)
            command = [sys.executable,str(Path(__file__).resolve().parents[1]/'app/workbench.py'),
                       '--workspace',temporary,'preference-catalog']
            result = json.loads(subprocess.check_output(command))
            self.assertTrue(result['initialized'])
            self.assertEqual(result['dimensions']['industries']['values'][0]['unmapped'], [])
            history=wb.get('trash')['data']['transactions']
            self.assertEqual(history[-1]['modules'], ['edits'])
            self.assertTrue(history[-1]['createdAt'])
