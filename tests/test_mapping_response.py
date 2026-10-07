import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'app'))
from codex_mapping import validate_mapping_entries, map_with_codex

class MappingResponseTests(unittest.TestCase):
    def check(self, entries):
        return validate_mapping_entries(entries, {'one','two'}, {'a','b'})

    def test_mixed_result_keeps_valid_and_rejects_invalid(self):
        mapping, review=self.check([{'fieldId':'one','factKey':'a'}, {'fieldId':'two','factKey':'invented'}, {'fieldId':'unknown','factKey':'b'}])
        self.assertEqual(mapping,{'one':'a'})
        self.assertEqual(review['rejected'],[{'fieldId':'two','reason':'unknown-fact'}])
        self.assertEqual(review['ignored'],1)
        self.assertNotIn('invented',str(review))
        self.assertNotIn('unknown',str(review['ignored']))

    def test_identical_duplicates_are_idempotent(self):
        mapping, review=self.check([{'fieldId':'one','factKey':'a'}]*2)
        self.assertEqual(mapping,{'one':'a'});self.assertEqual(review['duplicates'],1)
        self.assertFalse(review['rejected'])

    def test_conflict_rejects_whole_field_regardless_of_order(self):
        for keys in (['a','b','a'],['b','a','b']):
            mapping, review=self.check([{'fieldId':'one','factKey':k} for k in keys]+[{'fieldId':'two','factKey':'b'}])
            self.assertEqual(mapping,{'two':'b'})
            self.assertEqual(review['rejected'][0]['reason'],'conflicting-mappings')

    def test_bad_types_and_extra_properties_never_escape(self):
        for bad in (None, [], {}, '', 17):
            mapping,review=self.check([{'fieldId':'one','factKey':bad},{'fieldId':'two','factKey':'b'}])
            self.assertEqual(mapping,{'two':'b'})
        mapping,_=self.check([{'fieldId':'one','factKey':'a','value':'injected'}, {'fieldId':['one'],'factKey':'a'}, None])
        self.assertEqual(mapping,{})
        for invalid in ({}, None, 'text'):
            with self.assertRaises(ValueError):self.check(invalid)

    def test_invalid_then_valid_same_field_stays_rejected(self):
        for keys in (['missing','a'],['a','missing']):
            mapping,_=self.check([{'fieldId':'one','factKey':k} for k in keys])
            self.assertEqual(mapping,{})

    def test_generation_constrains_ids_and_keeps_private_values_local(self):
        profile={'facts':[{'key':'a','label':'学习形式','value':'PRIVATE_VALUE','module':'education'}]}
        scan={'fields':[{'id':'one','label':'学历类型','module':'education','type':'text'}]}
        plan={'rows':[{'fieldId':'one','status':'missing'}]}
        with patch('codex_mapping._run_codex',return_value=({'mappings':[{'fieldId':'one','factKey':'a'}]*2},{'called':True})) as run:
            mapping,provider=map_with_codex(profile,scan,plan,model='fixture-model')
        schema=run.call_args.args[1]['properties']['mappings']['items']['properties']
        self.assertEqual(schema['fieldId']['enum'],['one']);self.assertEqual(schema['factKey']['enum'],['a'])
        self.assertNotIn('PRIVATE_VALUE',run.call_args.args[2]);self.assertEqual(mapping,{'one':'a'})
        self.assertEqual(provider['mappingReview']['duplicates'],1)

if __name__=='__main__':unittest.main()
