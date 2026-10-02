#!/usr/bin/env python3
"""面试准备导入脚本：把 仓库流程文档 产出的 {公司}{岗位}面试准备.md 解析为结构化 JSON，
upsert 进 投递数据/面试准备数据.json（中控台「准备」板块的数据源）。

用法：
    python3 app/脚本/9_面试准备导入.py 面试准备/{公司}{岗位}准备.md
    python3 app/脚本/9_面试准备导入.py --all          # 递归扫描 面试准备/（跳过非准备资料目录）
    # 公司/岗位无法从文件名推断时显式指定：
    python3 app/脚本/9_面试准备导入.py <md路径> --company "{公司}" --position 产品经理

规则（固定流程的一部分，勿即兴改动）：
- 分节只依赖 '^## ' 标题（仓库模板固定输出 ## 一、~## 附、），节内容保留原始 markdown，
  渲染由页面端完成；解析不到任何 ## 节或标题不符时非零退出，不猜不编。
- 头部 blockquote（信源纪律等说明）原样保留为 headerNote，页面单独展示。
- 同 id（文件名主干）重复导入 = 覆盖该篇（准备文档真源是 md，覆盖即刷新），先打印提示。
- 写入前自动备份 面试准备数据.json.bak_auto；原子写入。
"""
from update_common import data_lock
import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.environ.get('TOUDI_WORKSPACE', str(Path(__file__).resolve().parents[2] / 'runtime')), '投递数据')
os.makedirs(DATA_DIR, exist_ok=True)
PREPS_FILE = os.path.abspath(os.environ.get('TOUDI_PREPS_FILE', os.path.join(DATA_DIR, '面试准备数据.json')))
HTML_FILE = os.path.abspath(os.environ.get('TOUDI_HTML_FILE', str(Path(__file__).resolve().parents[1] / '投递管理.html')))
STRUCT_FILE = os.path.abspath(os.environ.get('TOUDI_STRUCT_FILE', os.path.join(DATA_DIR, '投递记录.json')))
PREP_DIR = os.path.abspath(os.environ.get('TOUDI_PREP_DIR', os.path.join(os.path.dirname(DATA_DIR), '面试准备')))


def fail(msg):
    print(f'[导入失败] {msg}')
    sys.exit(1)


def discover_prep_paths(prep_dir):
    """递归发现正式准备稿；归档、素材、通用目录不参与批量导入。"""
    paths = []
    skip_dirs = {'归档', '素材', '通用'}
    for root, dirs, files in os.walk(prep_dir):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
        paths.extend(os.path.join(root, f) for f in files if f.endswith('准备.md'))
    return sorted(paths)


def duplicate_document_ids(paths):
    by_id = {}
    for path in paths:
        stem = os.path.splitext(os.path.basename(path))[0]
        by_id.setdefault(stem, []).append(os.path.abspath(path))
    return {stem: found for stem, found in by_id.items() if len(found) > 1}


def row_key_pairs(rows):
    counts = {}
    for row in rows:
        name = row.get('名称') or ''
        counts[name] = counts.get(name, 0) + 1
    pairs = []
    for index, row in enumerate(rows):
        name = row.get('名称') or ''
        key = name if counts.get(name) == 1 else f"{name}｜{row.get('公告链接') or ('#' + str(index + 1))}"
        pairs.append((key, row))
    return pairs


def validate_company_key(company, key, rows):
    hit = next((row for row_key, row in row_key_pairs(rows) if row_key == key), None)
    if hit is None:
        return False, '指定 key 不存在于当前投递表'
    target = hit.get('名称') or ''
    normalized_target = re.sub(r'[（(]统一投递[）)]$', '', target).strip()
    if not company or not target or company not in {target, normalized_target}:
        return False, f'指定 key 属于“{target}”，与准备稿公司“{company}”不一致'
    return True, '手动指定并已核验'


def split_company_position(rest, company_names):
    """rest = {公司}{岗位}，用投递表名称列做最长前缀匹配拆出公司（与脚本6同逻辑）。"""
    best = ''
    for name in company_names:
        if name and rest.startswith(name) and len(name) > len(best):
            best = name
    if best:
        return best, rest[len(best):]
    for name in sorted(company_names, key=len, reverse=True):
        short = re.split(r'[（(]', name)[0]
        if short and len(short) >= 2 and rest.startswith(short):
            return short, rest[len(short):]
    m = re.search(r'(产品经理|产品运营|产品|运营|管培生|管培|实习生|实习|研究员|分析师|工程师|策划)', rest)
    if m and m.start() >= 2:
        return rest[:m.start()], rest[m.start():]
    return '', rest


def find_company_key(company, rows):
    """在投递表中找编辑键；同名多行必须由调用者用 --key 明确消歧。"""
    hits = [r for r in rows if r.get('名称') == company]
    if not hits:
        contains = [r for r in rows if company and company in (r.get('名称') or '')]
        if len(contains) == 1:
            return contains[0].get('名称'), '包含匹配'
        return '', '无匹配'
    if len(hits) == 1:
        return hits[0].get('名称'), '精确匹配'
    return '', f'歧义：该公司共 {len(hits)} 行，必须用 --key 指定目标投递记录'


def parse_doc(path, rows):
    text = open(path, encoding='utf-8').read()
    stem = os.path.splitext(os.path.basename(path))[0]

    # 标题：# {公司}{岗位}（{届别}）...准备（结尾可能是 面试准备/环节准备 等）
    tm = re.search(r'^#\s+(.+?)（([^）]+)）(.*?)准备\s*$', text, re.M)
    if not tm:
        fail(f'{path}：标题不符（期望 # {{公司}}{{岗位}}（{{届别}}）...准备）')
    title_rest, cohort, title_mid = tm.group(1).strip(), tm.group(2).strip(), tm.group(3).strip()

    # 头部 blockquote（信源纪律/归档说明等，原样保留）
    head_end = text.find('\n## ')
    head_zone = text[tm.end():head_end if head_end > 0 else len(text)]
    header_note = '\n'.join(l for l in head_zone.splitlines() if l.strip().startswith('>')).strip()

    # 分节：^## 标题（含 六·扩展 / 附： 等变体）
    marks = list(re.finditer(r'^##\s+(.+?)\s*$', text, re.M))
    if not marks:
        fail(f'{path}：未找到任何 ## 分节（模板不符）')
    sections = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        sections.append({'title': m.group(1), 'md': text[m.end():end].strip()})

    # 公司/岗位：CLI 优先，否则文件名 {公司}{岗位}面试准备 推断
    return stem, title_rest, cohort, title_mid, header_note, sections


def import_one(path, args, rows, names):
    stem, title_rest, cohort, title_mid, header_note, sections = parse_doc(path, rows)

    company, position = args.company, args.position
    rest = re.sub(r'面试准备$', '', stem)
    if not company:
        company, position = split_company_position(rest, names)
    if not company:
        fail(f'{path}：无法推断公司名，请用 --company/--position 显式指定')
    # 标题中的 {公司}{岗位} 与文件名不一致时，以标题为准补全岗位名（如 携程AI产品经理）
    if not position and title_rest.startswith(company):
        position = title_rest[len(company):]

    if args.key:
        valid, how = validate_company_key(company, args.key, rows)
        if not valid:
            fail(f'{path}：{how}')
        company_key = args.key
    elif rows:
        company_key, how = find_company_key(company, rows)
        if how.startswith('歧义：'):
            fail(f'{path}：{how}')
    else:
        company_key, how = '', ''

    stat = os.stat(path)
    return {
        'id': stem,
        'company': company,
        'position': position,
        'cohort': cohort,
        'titleMid': title_mid,          # 标题里届别后的补充（如「AI面试环节」）
        'headerNote': header_note,
        'sections': sections,
        'companyKey': company_key,
        'updatedAt': datetime.fromtimestamp(stat.st_mtime).isoformat(timespec='seconds'),
        'importedAt': datetime.now().isoformat(timespec='seconds'),
        'mdPath': os.path.relpath(os.path.abspath(path), os.path.dirname(DATA_DIR)),
    }, how


def main():
    ap = argparse.ArgumentParser(description='面试准备 md → 中控台 JSON 导入')
    ap.add_argument('md', nargs='?', default='', help='准备文档 md 路径；--all 时忽略')
    ap.add_argument('--all', action='store_true', help='递归导入 面试准备/ 下名称以“准备.md”结尾的文档，跳过 归档/素材/通用/')
    ap.add_argument('--company', default='')
    ap.add_argument('--position', default='')
    ap.add_argument('--key', default='', help='直接指定投递表编辑键（多家同名公司时消歧）')
    args = ap.parse_args()

    if args.all and (args.company or args.position or args.key):
        ap.error('--all 不能与 --company、--position 或 --key 共用；批量导入不得把单篇身份参数套到全部文档')

    paths = []
    if args.all:
        if not os.path.isdir(PREP_DIR):
            fail(f'目录不存在：{PREP_DIR}')
        paths = discover_prep_paths(PREP_DIR)
        if not paths:
            fail(f'{PREP_DIR} 下没有 md 文件')
    elif args.md:
        if not os.path.exists(args.md):
            fail(f'文件不存在：{args.md}')
        paths = [args.md]
    else:
        ap.error('请给出 md 路径或使用 --all')

    duplicates = duplicate_document_ids(paths)
    if duplicates:
        details = '; '.join(f'{stem}: ' + ', '.join(found) for stem, found in sorted(duplicates.items()))
        fail(f'发现重复文档 id，未写入任何数据：{details}')

    # All modules share the runtime canonical records, never the empty source template.
    try:
        rows = json.load(open(STRUCT_FILE, encoding='utf-8')) if os.path.exists(STRUCT_FILE) else []
        if not isinstance(rows, list): fail('投递记录.json must be an array')
    except (ValueError, OSError) as exc:
        fail('投递记录.json不可读，未导入：' + str(exc))
    names = sorted({(r.get('名称') or '') for r in rows if isinstance(r, dict)})

    data = {'preps': []}
    if os.path.exists(PREPS_FILE):
        try:
            data = json.load(open(PREPS_FILE, encoding='utf-8'))
            if not isinstance(data.get('preps'), list):
                fail('准备母本缺少preps数组，拒绝覆盖')
        except Exception as e:
            fail(f'{PREPS_FILE} 读取失败：{e}（请先人工检查该文件）')

    for path in paths:
        prep, how = import_one(path, args, rows, names)
        old = next((p for p in data['preps'] if p.get('id') == prep['id']), None)
        if old:
            print(f'[覆盖] {prep["id"]}（原导入于 {old.get("importedAt", "?")}）')
            data['preps'] = [p for p in data['preps'] if p.get('id') != prep['id']]
        data['preps'].append(prep)
        print(f'[导入] {prep["company"]} {prep["position"]}（{prep["cohort"]}）：{len(prep["sections"])} 节'
              f'；投递表关联：{prep["companyKey"] or "（未匹配）"}{" — " + how if how else ""}')

    data['preps'].sort(key=lambda p: p.get('updatedAt', ''), reverse=True)
    if os.path.exists(PREPS_FILE):
        shutil.copy2(PREPS_FILE, PREPS_FILE + '.bak_auto')
    tmp = PREPS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PREPS_FILE)
    print(f'[完成] 库内共 {len(data["preps"])} 篇 → {PREPS_FILE}')


if __name__ == '__main__':
    with data_lock(DATA_DIR):
        main()
