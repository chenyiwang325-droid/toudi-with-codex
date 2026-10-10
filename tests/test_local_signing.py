"""A local signing identity must stay stable and never leak private key material."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_signing', ROOT/'desktop/scripts/local_signing.py')
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class LocalSigningTests(unittest.TestCase):
    def test_existing_identity_is_reused_without_key_or_trust_operations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            identity = {'schemaVersion': 1, 'bundleIdentifier': signing.IDENTIFIER,
                        'fingerprint': 'A'*40, 'keychain': '/synthetic/login.keychain-db', 'ready': True}
            (root/'identity.json').write_text(json.dumps(identity))
            with patch.object(signing, 'run', side_effect=AssertionError('must not replace an identity')):
                self.assertEqual(signing.initialize_identity(root), identity)
                self.assertEqual(signing.initialize_identity(root), identity)

    def test_invalid_profile_fails_without_creating_a_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root/'identity.json').write_text('{"schemaVersion":1}')
            with patch.object(signing, 'run', side_effect=AssertionError('must not reset identity')):
                with self.assertRaises(ValueError):
                    signing.initialize_identity(root)

    def test_missing_metadata_cannot_silently_remove_persistent_signing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            self.assertIsNone(signing.load_identity(root))
            (root/'certificate.der').write_bytes(b'synthetic-existing-certificate')
            with patch.object(signing, 'run', side_effect=AssertionError('must not create another key')):
                with self.assertRaises(ValueError):
                    signing.load_identity(root)
                with self.assertRaises(ValueError):
                    signing.initialize_identity(root)

    def test_tool_failure_never_echoes_private_command_arguments(self):
        class Result:
            returncode = 1
            stdout = ''
            stderr = 'cannot import synthetic-password'
        with patch.object(signing.subprocess, 'run', return_value=Result()):
            with self.assertRaises(ValueError) as error:
                signing.run(['security', 'import', '-P', 'synthetic-password'], secret='synthetic-password')
            self.assertNotIn('synthetic-password', str(error.exception))
            self.assertNotIn('-P', str(error.exception))

    def test_cancelled_trust_resumes_the_same_imported_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            certificate = b'synthetic-certificate'
            (root/'certificate.der').write_bytes(certificate)
            identity = {'schemaVersion': 1, 'bundleIdentifier': signing.IDENTIFIER,
                        'fingerprint': hashlib.sha1(certificate).hexdigest().upper(),
                        'keychain': '/synthetic/login.keychain-db', 'ready': False, 'imported': True}
            (root/'identity.json').write_text(json.dumps(identity))
            with patch.object(signing, 'run', side_effect=ValueError('user cancelled')):
                with self.assertRaises(ValueError):
                    signing.initialize_identity(root)
            self.assertEqual(signing.load_identity(root), identity)
            with patch.object(signing, 'run') as run:
                completed = signing.initialize_identity(root)
                arguments = run.call_args[0][0]
                self.assertEqual(arguments[arguments.index('-p')+1], 'codeSign')
                self.assertEqual(arguments[arguments.index('-a')+1], '/usr/bin/codesign')
            self.assertEqual(completed['fingerprint'], identity['fingerprint'])
            self.assertTrue(signing.load_identity(root)['ready'])

    def test_interrupted_key_import_does_not_rotate_the_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            identity = {'schemaVersion': 1, 'bundleIdentifier': signing.IDENTIFIER,
                        'fingerprint': 'B'*40, 'keychain': '/synthetic/login.keychain-db',
                        'ready': False, 'imported': False}
            (root/'identity.json').write_text(json.dumps(identity))
            with patch.object(signing, 'run', side_effect=AssertionError('must not create another key')):
                with self.assertRaises(ValueError):
                    signing.initialize_identity(root)
            self.assertEqual(signing.load_identity(root), identity)


if __name__ == '__main__':
    unittest.main()
