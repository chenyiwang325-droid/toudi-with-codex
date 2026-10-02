#!/usr/bin/env python3
"""面试复盘导入脚本：把 仓库流程文档 产出的单场详版 md 解析为结构化 JSON，
upsert 进 投递数据/面试复盘数据.json（中控台「复盘」板块的数据源）。

用法：
    python3 app/脚本/6_复盘导入.py runtime/复盘/{日期}_{公司}_{轮次}.md
    # 公司/岗位/轮次无法从文件名推断时显式指定：
    python3 app/脚本/6_复盘导入.py <md路径> --company "{公司}" --position 产品运营 --round 一面

规则（固定流程的一部分，勿即兴改动）：
- 解析依赖 仓库固定模板（## 一~五 分节、### Q{n}、- 考察意图： 等固定前缀）；
  模板不符时打印缺失位置并非零退出，不猜不编。
- 同 id（文件名主干）重复导入 = 覆盖该场次，先打印警告（页内编辑会丢）。
- 写入前自动备份 面试复盘数据.json.bak_auto；原子写入。
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
REVIEWS_FILE = os.path.join(DATA_DIR, '面试复盘数据.json')
STRUCT_FILE = os.path.join(DATA_DIR, '投递记录.json')

ROUNDS = ['一面', '二面', '三面', '四面', 'HR面', 'hr面', '电话面', '视频面', '群面', '终面', '笔试']
STATUS_WORDS = ['已克服', '复发', '改善', '新增', '未考察', '未出现', '待观察']
DIAG_DIMS = ['结构化', '完整性', '匹配度', '说服力']


def fail(msg):
    print(f'[导入失败] {msg}')
    sys.exit(1)


def read_text(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def split_sections(text):
    """按 ## 一、... ## 五、 分节，返回 {序号: 内容}。"""
    parts = {}
    marks = list(re.finditer(r'^##\s+([一二三四五])、', text, re.M))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        parts[m.group(1)] = text[m.start():end]
    return parts


def parse_field(block, name):
    """从题目块中提取 '- {name}：' 字段，内容延续到下一个 '- 字段：' 或块尾。"""
    m = re.search(rf'^-\s*{re.escape(name)}[：:]\s*(.*?)(?=^-\s*(?:本题判断|考察意图|当时的回答|面试官信号|诊断|改进版回答|追问)[：:]|^###\s|\Z)',
                  block, re.M | re.S)
    return m.group(1).strip() if m else ''


def parse_questions(sec):
    """解析 ## 二、逐题复盘 中的 ### Q{n} 块。"""
    heads = list(re.finditer(r'^###\s+Q(\d+)[：:](.*?)(?:（([^）]*)）)?\s*$', sec, re.M))
    if not heads:
        fail('「## 二、逐题复盘」中未找到任何 ### Q{n} 题目块（模板不符）')
    questions = []
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(sec)
        block = sec[h.start():end]
        diag_raw = parse_field(block, '诊断')
        diag = {}
        for dim in DIAG_DIMS:
            dm = re.search(rf'{dim}[：:]\s*([^\n]+)', diag_raw)
            diag[dim] = dm.group(1).strip(' ；;。') if dm else ''
        followups = re.findall(r'^-\s*追问[：:]\s*(.+)$', block, re.M)
        questions.append({
            'n': int(h.group(1)),
            'question': (h.group(2) or '').strip(),
            'timestamp': (h.group(3) or '').strip(),
            'followups': [f.strip() for f in followups],
            'intent': parse_field(block, '考察意图'),
            'originalAnswer': parse_field(block, '当时的回答'),
            'signals': parse_field(block, '面试官信号'),
            'diagnosis': diag,
            'diagnosisRaw': diag_raw,
            'improvedAnswer': parse_field(block, '改进版回答'),
        })
        assessment = parse_field(block, '本题判断')
        if assessment:
            questions[-1]['assessment'] = assessment
        answer = questions[-1]['improvedAnswer']
        if '回答处理：原答保留与可选调整' in answer:
            questions[-1]['answerMode'] = 'preserve'
        elif '回答处理：针对性补充' in answer:
            questions[-1]['answerMode'] = 'supplement'
    return questions


def parse_tracking_line(line):
    """从一行文本里提取 弱项名/状态/证据题号；提不出弱项名则返回 None。"""
    if any(w in line for w in ('历史弱项', '新增弱项', '状态机', '弱项追踪')):
        return None
    m = re.search(r'([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff·/]{1,20}?)\s*[（(：:]', line)
    if not m:
        return None
    status = next((w for w in STATUS_WORDS if w in line), '')
    evidence = '、'.join(re.findall(r'Q\d+', line))
    return {'weakness': m.group(1).strip(), 'status': status, 'evidence': evidence}


def parse_tracking(sec):
    entries = []
    for line in sec.splitlines():
        line = line.strip().lstrip('-').strip()
        if not line or line.startswith('>'):  # blockquote 为判定基准等说明文字，不参与弱项解析
            continue
        if not line or line.startswith('|') and set(line) <= set('|-: '):
            continue
        if line.startswith('|'):  # 状态机更新表的一行
            cells = [c.strip() for c in line.strip('|').split('|')]
            if len(cells) >= 2 and cells[0] and cells[0] not in ('弱项', '---'):
                status = next((w for w in STATUS_WORDS if w in cells[1:]), '')
                evidence = '、'.join(re.findall(r'Q\d+', ' '.join(cells)))
                entries.append({'weakness': cells[0], 'status': status, 'evidence': evidence})
            continue
        e = parse_tracking_line(line)
        if e:
            entries.append(e)
    # 按弱项名去重，保留首个
    seen, out = set(), []
    for e in entries:
        if e['weakness'] and e['weakness'] not in seen:
            seen.add(e['weakness'])
            out.append(e)
    return out


def parse_summary(sec):
    type_dist = {}
    for m in re.finditer(r'(自我介绍|项目深挖|行为题|动机题|开放题|其他)\D{0,4}?(\d+)\s*道?', sec):
        if '追踪' not in sec[max(0, m.start() - 20):m.start()]:
            type_dist[m.group(1)] = int(m.group(2))
    hm = re.search(r'追问热点[：:]\s*(.*?)(?=^-\s*本场共性问题|\Z)', sec, re.M | re.S)
    cm = re.search(r'本场共性问题[：:]\s*(.*)', sec, re.M | re.S)
    common = []
    if cm:
        for line in cm.group(1).splitlines():
            line = line.strip().lstrip('-').strip()
            if not line:
                continue
            ev = '、'.join(re.findall(r'Q\d+', line))
            name = re.sub(r'[（(].*?[Qq].*?[)）]', '', line).strip(' ：:，,。')
            if name:
                common.append({'name': name, 'evidence': ev})
    return {
        'typeDist': type_dist,
        'hotspots': hm.group(1).strip() if hm else '',
        'commonIssues': common,
        'raw': sec.strip(),
    }


def parse_header(text, path):
    title = re.search(r'^#\s+(.+?)面试复盘（([^，,]+)[，,]([^）]*)）', text, re.M)
    date = ''
    if title:
        date = title.group(2).strip()
    im = re.search(r'^>\s*面试官[：:]\s*(.+?)\s*[｜|]\s*逐字稿来源[：:]\s*(.+)$', text, re.M)
    stem = os.path.splitext(os.path.basename(path))[0]
    fm = re.match(r'(\d{8})_(.+)', stem)
    if not date and fm:
        d = fm.group(1)
        date = f'{d[:4]}-{d[4:6]}-{d[6:]}'
    if not date:
        fail('无法从标题或文件名取得日期（期望 # ...面试复盘（YYYY-MM-DD，时长）或文件名 YYYYMMDD_ 前缀）')
    return {
        'date': date,
        'duration': title.group(3).strip() if title else '',
        'interviewer': im.group(1).strip() if im else '',
        'source': im.group(2).strip() if im else '',
    }


def split_company_position(rest, company_names):
    """rest = {公司}{岗位}，用投递表名称列做最长前缀匹配拆出公司。"""
    best = ''
    for name in company_names:
        if name and rest.startswith(name) and len(name) > len(best):
            best = name
    if best:
        return best, rest[len(best):]
    # 退化1：名称列没有精确前缀，试包含关系（如名称与文档标题存在同主体前缀）
    for name in sorted(company_names, key=len, reverse=True):
        short = re.split(r'[（(]', name)[0]
        if short and len(short) >= 2 and rest.startswith(short):
            return short, rest[len(short):]
    # 退化2：按岗位关键词切（公司不在投递表，如早期面试）
    m = re.search(r'(产品经理|产品运营|产品|运营|管培生|管培|实习生|实习|研究员|分析师|工程师|策划)', rest)
    if m and m.start() >= 2:
        return rest[:m.start()], rest[m.start():]
    return '', rest


def find_company_key(company, rows):
    """在投递表中找编辑键：唯一名命中→名称；多行→名称｜公告链接（取第一条并提示）。"""
    hits = [r for r in rows if r.get('名称') == company]
    if not hits:
        contains = [r for r in rows if company and company in (r.get('名称') or '')]
        if len(contains) == 1:
            return contains[0].get('名称'), '包含匹配'
        return '', '无匹配'
    if len(hits) == 1:
        return hits[0].get('名称'), '精确匹配'
    return '', f'该公司共 {len(hits)} 行，请用--key明确关联'


def main():
    ap = argparse.ArgumentParser(description='面试复盘 md → 中控台 JSON 导入')
    ap.add_argument('md', help='单场详版 md 路径')
    ap.add_argument('--company', default='')
    ap.add_argument('--position', default='')
    ap.add_argument('--round', dest='round_', default='')
    ap.add_argument('--key', default='', help='直接指定投递表编辑键（多家同名公司时消歧）')
    args = ap.parse_args()

    if not os.path.exists(args.md):
        fail(f'文件不存在：{args.md}')
    text = read_text(args.md)
    stem = os.path.splitext(os.path.basename(args.md))[0]

    header = parse_header(text, args.md)
    sections = split_sections(text)
    missing = [s for s in '一二三四五' if s not in sections]
    if missing:
        fail(f'模板分节缺失：{"、".join(missing)}（需包含 ## 一、~## 五、 全部五节）')

    questions = parse_questions(sections['二'])
    counter_intel = re.sub(r'^##.*$', '', sections['三'], flags=re.M).strip()
    summary = parse_summary(sections['四'])
    tracking = parse_tracking(sections['五'])

    # 公司/岗位/轮次：CLI 优先，否则从文件名 {YYYYMMDD}_{公司}{岗位}_{轮次} 推断
    company, position, round_ = args.company, args.position, args.round_
    fm = re.match(r'\d{8}_(.+)', stem)
    rest = fm.group(1) if fm else ''
    if not round_ and rest:
        for r in ROUNDS:
            if rest.endswith('_' + r):
                round_ = r
                rest = rest[:-(len(r) + 1)]
                break
    rows = []
    try:
        rows = json.load(open(STRUCT_FILE, encoding='utf-8'))
        if isinstance(rows, dict):
            rows = rows.get('rows') or rows.get('data') or []
    except Exception as e:
        print(f'[警告] 无法读取 {STRUCT_FILE}（{e}），公司关联将留空')
    if not company and rest:
        names = sorted({(r.get('名称') or '') for r in rows if isinstance(r, dict)})
        company, position = split_company_position(rest, names)
    if not company:
        fail('无法推断公司名，请用 --company/--position 显式指定')

    if args.key:
        company_key, how = args.key, '手动指定'
    elif rows:
        company_key, how = find_company_key(company, rows)
    else:
        company_key, how = '', ''

    session = {
        'id': stem,
        'date': header['date'],
        'company': company,
        'position': position,
        'round': round_,
        'duration': header['duration'],
        'interviewer': header['interviewer'],
        'source': header['source'],
        'companyKey': company_key,
        'questionTree': re.sub(r'^##.*$', '', sections['一'], flags=re.M).strip(),
        'questions': questions,
        'counterIntel': counter_intel,
        'summary': summary,
        'tracking': tracking,
        'importedAt': datetime.now().isoformat(timespec='seconds'),
        'mdPath': os.path.relpath(os.path.abspath(args.md), os.path.dirname(DATA_DIR)),
    }

    # upsert + 备份 + 原子写入
    data = {'sessions': []}
    if os.path.exists(REVIEWS_FILE):
        try:
            data = json.load(open(REVIEWS_FILE, encoding='utf-8'))
            if not isinstance(data.get('sessions'), list):
                data = {'sessions': []}
        except Exception as e:
            fail(f'{REVIEWS_FILE} 读取失败：{e}（请先人工检查该文件）')
    old = next((s for s in data['sessions'] if s.get('id') == stem), None)
    if old:
        print(f'[警告] 场次 {stem} 已存在（导入于 {old.get("importedAt", "?")}），本次导入将覆盖其页内编辑')
        data['sessions'] = [s for s in data['sessions'] if s.get('id') != stem]
    data['sessions'].append(session)
    data['sessions'].sort(key=lambda s: s.get('date', ''), reverse=True)

    if os.path.exists(REVIEWS_FILE):
        shutil.copy2(REVIEWS_FILE, REVIEWS_FILE + '.bak_auto')
    tmp = REVIEWS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, REVIEWS_FILE)

    print('[导入完成]')
    print(f'  场次：{company} {position} {round_}（{header["date"]}，{header["duration"] or "时长未知"}）')
    print(f'  题目：{len(questions)} 题；追问记录 {sum(len(q["followups"]) for q in questions)} 条')
    print(f'  反问情报：{len(counter_intel)} 字；题型分布 {summary["typeDist"] or "未解析"}；弱项 {len(tracking)} 条')
    print(f'  投递表关联：{company_key or "（未匹配，可在页内手动关联）"}{" — " + how if how else ""}')
    print(f'  当前库内共 {len(data["sessions"])} 场')


if __name__ == '__main__':
    with data_lock(DATA_DIR):
        main()
