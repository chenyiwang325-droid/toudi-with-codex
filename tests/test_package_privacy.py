import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('package_privacy',ROOT/'desktop/scripts/privacy.py')
privacy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class PackagePrivacyTests(unittest.TestCase):
    def test_interpreter_build_metadata_is_sanitized_without_changing_flags(self):
        hook_spec=importlib.util.spec_from_file_location('sysconfig_hook',ROOT/'desktop/scripts/sysconfig_hook.py')
        hook=importlib.util.module_from_spec(hook_spec);hook_spec.loader.exec_module(hook)
        source="build_time_vars={'prefix':'/fixture/Private Builder/python','FLAGS':'-O2','SIZE':8}"
        code=hook.sanitize(compile(source,'/fixture/Private Builder/config.py','exec'),'/fixture/Private Builder')
        namespace={};exec(code,namespace)
        self.assertEqual(code.co_filename,'/toudi-python-build/config.py')
        self.assertEqual(namespace['build_time_vars'],{'prefix':'/toudi-python-build/python','FLAGS':'-O2','SIZE':8})

    def test_staging_excludes_caches_private_files_and_ignored_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'source';stage=Path(tmp)/'stage'
            names=['app/desktop_runtime.py','app/投递管理.html','AGENTS.md',
                   'app/脚本/tool.py','app/脚本/__pycache__/tool.pyc',
                   'app/runtime/record.py','app/private.json','docs/backup.zip','docs/usage.md']
            for name in names:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('fixture')
            copied=privacy.stage_resources(root,stage,names)
            self.assertEqual(sorted(copied),sorted(['app/desktop_runtime.py','app/投递管理.html','AGENTS.md','app/脚本/tool.py','docs/usage.md']))
            (stage/'stale-secret.txt').write_text('stale')
            privacy.stage_resources(root,stage,names)
            self.assertFalse((stage/'stale-secret.txt').exists())

    def test_rust_remapping_preserves_flags_and_paths_with_spaces(self):
        env={'RUSTFLAGS':'--cfg feature_test'}
        with patch.object(privacy.Path,'home',return_value=Path('/fixture/build home')):
            privacy.rust_flags(env,Path('/fixture/source tree'))
        self.assertNotIn('RUSTFLAGS',env)
        flags=env['CARGO_ENCODED_RUSTFLAGS'].split('\x1f')
        self.assertEqual(flags[:2],['--cfg','feature_test'])
        self.assertIn('/fixture/build home=/toudi-build',flags)
        self.assertIn('/fixture/source tree=/toudi-source',flags)

    def test_bundle_gate_catches_binary_and_compressed_bytecode_paths(self):
        import importlib.util
        if importlib.util.find_spec('PyInstaller') is None:
            self.skipTest('PyInstaller is installed in the desktop build environment')
        import marshal,zipfile
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'safe.bin').write_bytes(b'neutral build')
            self.assertEqual(privacy.audit_bundle(root,['/fixture/private build'])['files'],1)
            (root/'leak.bin').write_bytes(b'prefix /fixture/private build/project/file.rs suffix')
            with self.assertRaisesRegex(ValueError,'personal build path'):
                privacy.audit_bundle(root,['/fixture/private build'])
            (root/'leak.bin').unlink()
            code=compile('value=1','/fixture/private build/module.py','exec')
            with zipfile.ZipFile(root/'library.zip','w',zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('module.pyc',b'\x00'*16+marshal.dumps(code))
            with self.assertRaisesRegex(ValueError,'personal build path'):
                privacy.audit_bundle(root,['/fixture/private build'])


if __name__=='__main__':unittest.main()
