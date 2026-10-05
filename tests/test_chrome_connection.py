import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).parents[1]/'app'), str(Path(__file__).parents[1]/'app/脚本')]
import chrome_connection
import codex_connection


class ChromeConnectionTests(unittest.TestCase):
    def request(self, value):
        payload=json.dumps(value).encode()
        return io.BytesIO(struct.pack('=I',len(payload))+payload)

    def test_protocol_only_returns_connection_to_known_extension(self):
        output=io.BytesIO()
        connection={'protocol':1,'url':'http://127.0.0.1:34567','token':'a'*64}
        with patch('chrome_connection.bound_connection',return_value=connection) as read:
            result=chrome_connection.serve(chrome_connection.extension_origin(),self.request({'op':'connect','protocol':1}),output)
            self.assertEqual(result,0);read.assert_called_once()
        response=output.getvalue()
        self.assertEqual(struct.unpack('=I',response[:4])[0],len(response[4:]))
        self.assertEqual(json.loads(response[4:]),connection)

    def test_other_extension_and_commands_cannot_read_workspace(self):
        with patch('chrome_connection.bound_connection') as read:
            out=io.BytesIO()
            self.assertEqual(chrome_connection.serve('chrome-extension://'+'a'*32+'/',self.request({'op':'connect','protocol':1}),out),1)
            self.assertEqual(out.getvalue(),b'')
            for payload in ({'op':'read','file':'网申信息库.json'},{'op':'connect','protocol':1,'workspace':'/tmp/other'}):
                out=io.BytesIO()
                chrome_connection.serve(chrome_connection.extension_origin(),self.request(payload),out)
                self.assertIn('error',json.loads(out.getvalue()[4:]))
            read.assert_not_called()

    def test_bad_frames_are_bounded_and_do_not_expose_paths(self):
        with patch('chrome_connection.bound_connection',side_effect=OSError('/private/sensitive/path')) as read:
            out=io.BytesIO()
            self.assertEqual(chrome_connection.serve(chrome_connection.extension_origin(),io.BytesIO(struct.pack('=I',4097)),out),1)
            read.assert_not_called()
            chrome_connection.serve(chrome_connection.extension_origin(),self.request({'op':'connect','protocol':1}),out)
            self.assertNotIn(b'/private/sensitive/path',out.getvalue())

    def test_finder_lookup_prefers_desktop_cli_to_old_shell_cli(self):
        def is_file(path):
            return str(path)=='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
        with patch('codex_connection.sys.platform','darwin'),patch('codex_connection.Path.is_file',is_file), \
             patch('codex_connection.os.access',return_value=True),patch('codex_connection.shutil.which',return_value='/old/codex'):
            self.assertEqual(codex_connection.codex_binary(),'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex')

    def test_app_update_refreshes_only_an_existing_authorized_host(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp' if sys.platform=='darwin' else None) as folder:
            file=Path(folder)/'host.json'
            with patch('chrome_connection.manifest_path',return_value=file),patch('chrome_connection.sys.frozen',True,create=True):
                chrome_connection.refresh_registration()
                self.assertFalse(file.exists())
                original={'name':chrome_connection.HOST,'path':'/old/TouDi.app/runtime','allowed_origins':[chrome_connection.extension_origin()]}
                file.write_text(json.dumps(original))
                chrome_connection.refresh_registration()
                updated=json.loads(file.read_text())
                self.assertEqual(updated['path'],str(Path(sys.executable).resolve()))
                self.assertEqual(updated['allowed_origins'],original['allowed_origins'])
                file.write_text(json.dumps({**original,'allowed_origins':['chrome-extension://'+'a'*32+'/']}))
                chrome_connection.refresh_registration()
                self.assertEqual(json.loads(file.read_text())['path'],'/old/TouDi.app/runtime')


if __name__=='__main__':unittest.main()
