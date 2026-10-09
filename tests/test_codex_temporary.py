"""The mapping runner must release request/answer files on every exit path."""
import json, subprocess, sys, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import codex_mapping

class TemporaryMappingTests(unittest.TestCase):
    def exercise(self, outcome):
        directories=[]
        def run(command, **kwargs):
            directory=Path(kwargs['cwd']);directories.append(directory)
            self.assertIn('--ephemeral',command)
            self.assertIn('--ignore-user-config',command)
            self.assertTrue((directory/'schema.json').is_file())
            if outcome=='timeout': raise subprocess.TimeoutExpired(command,1)
            if outcome=='failure': return SimpleNamespace(returncode=1,stdout='',stderr='private provider log')
            (directory/'answer.json').write_text('{invalid' if outcome=='invalid' else json.dumps({'mappings':[]}))
            return SimpleNamespace(returncode=0,stdout='',stderr='')
        with patch.multiple(codex_mapping,codex_binary=lambda:'fixture-codex',codex_environment=lambda:{},chatgpt_login=lambda *a:{'available':True},codex_status=lambda:{'available':True,'models':[{'id':'fixture-model','effort':'low'}]}),patch('codex_mapping.subprocess.run',side_effect=run):
            if outcome=='success':codex_mapping._run_codex({}, {'type':'object'}, 'synthetic task', 'fixture-model',1)
            else:
                with self.assertRaises(ValueError) as caught:codex_mapping._run_codex({}, {'type':'object'}, 'synthetic task', 'fixture-model',1)
                self.assertNotIn('private provider log',str(caught.exception))
        self.assertEqual(len(directories),1)
        self.assertFalse(directories[0].exists())
    def test_success(self):self.exercise('success')
    def test_timeout(self):self.exercise('timeout')
    def test_failure(self):self.exercise('failure')
    def test_invalid_answer(self):self.exercise('invalid')

if __name__=='__main__':unittest.main()
