"""UI review boundaries: private captures cannot become public source or facts."""
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from ui_review import create_bundle, image_info, private_destination, state_from_ax

MANAGEMENT_AX = '''Window: "TouDi", App: TouDi.
2 HTML content Description: TouDi
3 button ‹, Help: 收起侧栏
4 toggle button 浅色, Value: on
5 search text field (settable) 搜索投递记录, Placeholder: 搜索公司、岗位…
6 table
7 text private-person@example.invalid
8 text PRIVATE_SOURCE_AND_PREFERENCE
'''
DETAIL_AX = '''Window: "TouDi", App: TouDi.
2 HTML content Description: TouDi
3 heading 招聘信息, Value: 3
4 heading 投递跟进, Value: 3
5 heading 相关材料, Value: 3
6 heading 日程安排, Value: 3
7 button (disabled) 上一条
8 button 下一条
9 summary 企业信息与招聘来源, Value: off
10 summary 跟进记录, Value: on
11 text PRIVATE_NOTE_AND_RECORD
'''
PNG = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 800, 600) + b'\x08\x02\x00\x00\x00' + b'\x00' * 4


class UIReviewTests(unittest.TestCase):
    def test_pixels_identified_from_bytes_not_extension(self):
        self.assertEqual(image_info(PNG), ({'width': 800, 'height': 600}, '.png'))
        jpeg = b'\xff\xd8\xff\xe0\x00\x04AB\xff\xc0\x00\x11\x08\x02\x58\x03\x20' + b'\x00' * 40
        self.assertEqual(image_info(jpeg), ({'width': 800, 'height': 600}, '.jpg'))
        with self.assertRaises(ValueError):
            image_info(b'not an image' * 10)

    def test_control_state_drops_business_values(self):
        state = state_from_ax('management', MANAGEMENT_AX)
        self.assertEqual(state['appearance'], 'light')
        self.assertTrue(state['sidebarExpanded'])
        encoded = json.dumps(state)
        self.assertNotIn('PRIVATE', encoded)
        self.assertNotIn('example.invalid', encoded)
        detail = state_from_ax('detail', DETAIL_AX)
        self.assertFalse(detail['previousEnabled'])
        self.assertTrue(detail['nextEnabled'])
        self.assertTrue(detail['notesExpanded'])
        self.assertFalse(detail['sourceExpanded'])

    def test_loading_is_not_ready(self):
        self.assertFalse(state_from_ax('detail', DETAIL_AX + '正在读取日程…')['dataReady'])
        with self.assertRaises(ValueError):
            state_from_ax('detail', 'TouDi HTML content')

    def test_git_and_workspace_escape_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root)
            repo = workspace / 'public'; repo.mkdir(); (repo / '.git').mkdir()
            with self.assertRaises(ValueError):
                private_destination(repo / 'shots', workspace)
            (workspace / 'shortcut').symlink_to(repo, target_is_directory=True)
            with self.assertRaises(ValueError):
                private_destination(workspace / 'shortcut/shots', workspace)
            with self.assertRaises(ValueError):
                private_destination(workspace.parent / 'outside-review', workspace)

    def test_bundle_hashes_and_immutable_private_output(self):
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root); captures = workspace / 'captures'; captures.mkdir()
            for page, ax in (('management', MANAGEMENT_AX), ('detail', DETAIL_AX)):
                (captures / (page + '.png')).write_bytes(PNG)
                (captures / (page + '.ax.txt')).write_text(ax, encoding='utf-8')
            output = workspace / 'private-review'
            result = create_bundle(workspace, captures, output, '0.6.12')
            self.assertFalse(result['live'])
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(manifest['captures'][0]['sha256'], hashlib.sha256(PNG).hexdigest())
            self.assertEqual(manifest['captures'][0]['image'], 'private-review/management.png')
            self.assertEqual(len(list(output.iterdir())), 4)
            self.assertNotIn('PRIVATE_SOURCE', json.dumps(manifest))
            self.assertNotIn(str(workspace), json.dumps(manifest))
            with self.assertRaises(ValueError):
                create_bundle(workspace, captures, output, '0.6.12')
            os.utime(captures / 'detail.ax.txt', (1, 1))
            with self.assertRaises(ValueError):
                create_bundle(workspace, captures, workspace / 'mismatch', '0.6.12')
            self.assertFalse((workspace / 'mismatch').exists())


if __name__ == '__main__':
    unittest.main()
