"""The actual UI must enter Tauri's CSP asset pipeline, not a dynamic document write."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('desktop_frontend', ROOT/'desktop/scripts/frontend.py')
frontend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend)


class DesktopFrontendTests(unittest.TestCase):
    def test_build_contains_the_complete_ui_and_only_json_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'app').mkdir(); (root/'desktop/ui').mkdir(parents=True)
            original = (ROOT/'app/投递管理.html').read_text(encoding='utf-8')
            (root/'app/投递管理.html').write_text(original, encoding='utf-8')
            (root/'app/assets').mkdir()
            default_catalog = (ROOT/'app/assets/preference-defaults.json').read_text(encoding='utf-8')
            (root/'app/assets/preference-defaults.json').write_text(default_catalog, encoding='utf-8')
            html = frontend.prepare_frontend(root).read_text(encoding='utf-8')
            self.assertIn('const RAW_DATA = [];', html)
            self.assertIn('window.__TOUDI_DESKTOP_READY__.then', html)
            self.assertIn('RAW_DATA.push(...window.__TOUDI_INITIAL_RECORDS__);', html)
            self.assertEqual(original.count('onclick='), html.count('onclick='))
            self.assertIn('/assets/workbench.js', html)
            self.assertIn('/assets/filling.js', html)
            self.assertIn('/assets/filling.css', html)
            self.assertIn('/assets/preference-defaults.js', html)
            script = (root/'desktop/ui/assets/preference-defaults.js').read_text()
            self.assertEqual(json.loads(script.split('=', 1)[1][:-1]), json.loads(default_catalog))
            for selector in ('id="sidebar"', 'id="tableView"', 'id="qbView"', 'id="reviewView"'):
                self.assertIn(selector, html)
            shell = (ROOT/'desktop/ui/index.html').read_text()
            self.assertNotIn('document.write(', shell)
            self.assertIn("location.replace('/workbench.html')", shell)

    def test_csp_keeps_packaged_scripts_and_dynamic_styles_authorized(self):
        config = json.loads((ROOT/'desktop/src-tauri/tauri.conf.json').read_text())
        policy = dict((x.strip().split(' ', 1) + [''])[:2] for x in config['app']['security']['csp'].split(';'))
        self.assertEqual(policy['script-src'], "'self'")
        self.assertEqual(policy['script-src-attr'], "'unsafe-inline'")
        self.assertEqual(policy['style-src-attr'], "'unsafe-inline'")
        self.assertIn('blob:', policy['connect-src'])
        self.assertNotIn('dangerousDisableAssetCspModification', config['app']['security'])
        styles = (ROOT/'app/assets/workbench.js').read_text()
        self.assertIn("document.querySelector('style[nonce]')?.nonce", styles)
        self.assertIn('<style${nonce ?', styles)


if __name__ == '__main__':
    unittest.main()
