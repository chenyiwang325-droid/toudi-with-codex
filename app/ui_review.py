"""Prepare a private, read-only UI snapshot for an existing ChatGPT connector.

Capture pixels/AX with the user's UI tool first. This module neither operates the
App nor reads business files, and never publishes or uploads a bundle.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import tempfile
import os
import shutil

ROOT = Path(__file__).resolve().parents[1]
MAX_IMAGE_BYTES = 10 * 1024 * 1024
PAGES = ('management', 'detail')
STRUCTURE = {
    'schemaVersion': 1,
    'purpose': '投递管理与单条招聘记录详情的只读界面审查',
    'source': ['app/投递管理.html', 'docs/内容与渲染契约.md'],
    'management': [
        {'selector': '#sidebar', 'role': '全局模块导航、快捷视图、外观切换'},
        {'selector': '.topbar', 'role': '当前页面标题、表格/看板/统计切换、刷新资料'},
        {'selector': '#statsBar', 'role': '固定口径的投递状态总览；点击改变结果范围'},
        {'selector': '#searchInput', 'role': '输入公司或岗位关键词即时检索；旁边打开详细筛选'},
        {'selector': '#tableView', 'role': '结果数量、新增/导入、显示列、表格与分页；点击记录打开详情'},
    ],
    'detail': [
        {'selector': '#detailTitle', 'role': '本条记录标题与上一条/下一条/关闭'},
        {'selector': '#detailRecruitment', 'role': '岗位要求、招聘入口、行内修改、折叠企业与来源信息'},
        {'selector': '#detailFollowup', 'role': '投递状态、个人标记、可展开的跟进记录'},
        {'selector': '#detailMaterials', 'role': '跳转本公司岗位探查、面试准备、面试复盘；不在此维护通用准备'},
        {'selector': '#detailScheduleSection', 'role': '已有关联事项；添加日程先打开时间与内容编辑器'},
    ],
    'responsibilities': {
        'ChatGPT': '读取授权截图与状态、理解功能关系、规划与复核；无 App 操作或资料写入工具',
        'Codex': '获取新截图、执行经授权的界面或源码操作、验证实际结果',
    },
}


def iso_time(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def private_destination(output, workspace):
    output, workspace = Path(output).resolve(), Path(workspace).resolve()
    if not output.is_relative_to(workspace) or output == workspace:
        raise ValueError('UI review must stay in a private subdirectory of the connected workspace')
    if output.is_relative_to(ROOT) or any((p / '.git').exists() for p in (output, *output.parents)):
        raise ValueError('UI review cannot be written inside a Git repository')
    if output.exists():
        raise ValueError('Use a new output directory; existing captures are immutable')
    return output, workspace


def image_info(raw):
    if not (33 <= len(raw) <= MAX_IMAGE_BYTES):
        raise ValueError('Expected a PNG/JPEG screenshot of at most 10 MiB')
    if raw[:8] == b'\x89PNG\r\n\x1a\n' and raw[12:16] == b'IHDR':
        width, height = struct.unpack('>II', raw[16:24])
        extension = '.png'
    elif raw[:3] == b'\xff\xd8\xff':
        cursor, width, height = 2, 0, 0
        while cursor + 4 < len(raw):
            if raw[cursor] != 0xff:
                break
            while cursor < len(raw) and raw[cursor] == 0xff:
                cursor += 1
            marker = raw[cursor]
            cursor += 1
            if marker in (0xd8, 0x01) or 0xd0 <= marker <= 0xd7:
                continue
            if marker in (0xd9, 0xda):
                break
            length = int.from_bytes(raw[cursor:cursor + 2], 'big')
            if length < 2 or cursor + length > len(raw):
                break
            if marker in (0xc0, 0xc1, 0xc2):
                height, width = struct.unpack('>HH', raw[cursor + 3:cursor + 7])
                break
            cursor += length
        extension = '.jpg'
    else:
        raise ValueError('Expected PNG or JPEG screenshot bytes')
    if not (1 <= width <= 16000 and 1 <= height <= 16000):
        raise ValueError('Invalid screenshot dimensions')
    return {'width': width, 'height': height}, extension


def state_from_ax(page, text):
    """Extract only control state. Never return AX text, record values or links."""
    if 'TouDi' not in text or 'HTML content' not in text:
        raise ValueError('Capture is not a TouDi App accessibility observation')
    state = {'page': page, 'detailOpen': page == 'detail'}
    if page == 'management':
        if not re.search(r'\d+ search text field .*搜索投递记录', text) or not re.search(r'\d+ table\s*$', text, re.M):
            raise ValueError('Management capture must show the table and search control')
        modes = {'浅色': 'light', '深色': 'dark', '跟随电脑': 'system'}
        state['appearance'] = next((mode for label, mode in modes.items()
                                   if re.search(r'toggle button ' + label + r', Value: on\b', text)), 'unknown')
        state['sidebarExpanded'] = 'Help: 收起侧栏' in text
        state['presentation'] = 'table'
    else:
        for label in ('招聘信息', '投递跟进', '相关材料', '日程安排'):
            if not re.search(r'heading ' + label + r',', text):
                raise ValueError('Detail observation is missing required section: ' + label)
        for key, label in (('sourceExpanded', '企业信息与招聘来源'), ('notesExpanded', '跟进记录')):
            match = re.search(r'summary ' + label + r'(?:[^\n]*), Value: (on|off)\b', text)
            state[key] = match.group(1) == 'on' if match else None
        for key, label in (('previousEnabled', '上一条'), ('nextEnabled', '下一条')):
            match = re.search(r'button (\(disabled\) )?' + label + r'\s*$', text, re.M)
            state[key] = not bool(match.group(1)) if match else None
        state['fieldEditorOpen'] = bool(re.search(r'button .*收起修改', text))
        state['dataReady'] = '正在读取日程' not in text
    return state


def create_bundle(workspace, capture_dir, output, app_version, capture_source='native-app'):
    output, workspace = private_destination(output, workspace)
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?', app_version):
        raise ValueError('Use the observed App version, not a path or descriptive string')
    if capture_source != 'native-app':
        raise ValueError('This capture contract requires native App screenshots and accessibility state')
    capture_dir = Path(capture_dir).resolve()
    captures, images = [], {}
    for page in PAGES:
        image_path = next((capture_dir / (page + ext) for ext in ('.png', '.jpg')
                           if (capture_dir / (page + ext)).is_file()), None)
        if image_path is None:
            raise ValueError('Missing screenshot: ' + page)
        ax_path = capture_dir / (page + '.ax.txt')
        raw = image_path.read_bytes()
        dimensions, extension = image_info(raw)
        # AX is consumed locally; the exported object contains a fixed allowlist.
        state = state_from_ax(page, ax_path.read_text(encoding='utf-8'))
        if abs(image_path.stat().st_mtime - ax_path.stat().st_mtime) > 30:
            raise ValueError('Screenshot and AX must be captured together')
        captures.append({'page': page, 'image': (output / (page + extension)).relative_to(workspace).as_posix(),
                         'capturedAt': iso_time(image_path.stat().st_mtime), 'captureSource': capture_source,
                         'sha256': hashlib.sha256(raw).hexdigest(), 'pixelDimensions': dimensions, 'state': state})
        images[page + extension] = raw
    manifest = {
        'schemaVersion': 1, 'visibility': 'private', 'appVersion': app_version,
        'createdAt': iso_time(datetime.now().timestamp()),
        'readOnly': True, 'live': False,
        'structure': (output / 'structure.json').relative_to(workspace).as_posix(),
        'captures': captures,
        'readingOrder': 'Read image pixels with read_image; read structure and state separately. Do not infer hidden content or claim live access.',
        'privacy': 'Actual screenshots are authorized only for this private review. No business JSON, AX dump, preference values, source configuration or credentials are exported. Pixels may contain visible private records; never publish this directory.',
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.ui-review-', dir=output.parent))
    try:
        os.chmod(temporary, 0o700)
        for name, raw in images.items():
            (temporary / name).write_bytes(raw)
        for name, value in (('manifest.json', manifest), ('structure.json', STRUCTURE)):
            (temporary / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for path in temporary.iterdir():
            os.chmod(path, 0o600)
        temporary.rename(output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return {'ok': True, 'manifest': (output / 'manifest.json').relative_to(workspace).as_posix(),
            'pages': list(PAGES), 'private': True, 'live': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Prepare an authorized private UI snapshot for ChatGPT review')
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--capture-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--app-version', required=True)
    parser.add_argument('--capture-source', choices=('native-app',), default='native-app')
    args = parser.parse_args(argv)
    result = create_bundle(args.workspace, args.capture_dir, args.output, args.app_version, args.capture_source)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
