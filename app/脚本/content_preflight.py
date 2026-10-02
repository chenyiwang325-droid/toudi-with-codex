#!/usr/bin/env python3
"""单篇内容只读预检：解析、关联、覆盖风险和证据定位；绝不写入业务文件。"""
import os
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import re
import sys
from pathlib import Path


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def safe_target(root, raw):
    root = root.resolve()
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    resolved = path.resolve(strict=True)
    if root != resolved and root not in resolved.parents:
        raise ValueError('目标文件超出项目根目录')
    if not resolved.is_file() or resolved.suffix.lower() != '.md':
        raise ValueError('目标必须是项目内现有 Markdown 文件')
    return resolved


def read_json(path, collection):
    if not path.exists(): return {collection: []}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        raise ValueError(f'母本损坏或不可读：{path.name}：{exc}') from exc
    if not isinstance(data, dict) or not isinstance(data.get(collection), list):
        raise ValueError(f'母本 schema 无效：{path.name} 缺少 {collection} 数组')
    return data


def load_rows(root):
    path = root / '投递数据/投递记录.json'
    rows = json.loads(path.read_text()) if path.exists() else []
    if not isinstance(rows, list): raise ValueError('投递记录.json不是数组')
    return rows


def row_key_pairs(rows):
    """按页面/准备导入器的规则生成稳定编辑键，不读取或修改其他文件。"""
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
    if not company or company not in {target, normalized_target}:
        return False, f'指定 key 属于“{target}”，与材料公司“{company}”不一致'
    return True, '手动指定并已核验'


def comparable_prep(prep):
    return {k: prep.get(k) for k in ('id', 'company', 'position', 'cohort', 'titleMid', 'headerNote', 'sections', 'companyKey', 'mdPath')}


def review_session_changes(old, candidate):
    """列出整场替换会新增、修改或删除的内容；仅忽略导入时间。"""
    changes = []

    def record(path, kind):
        changes.append({'path': path, 'kind': kind})

    old_questions = {q.get('n'): q for q in old.get('questions', []) if isinstance(q, dict)}
    new_questions = {q.get('n'): q for q in candidate.get('questions', []) if isinstance(q, dict)}
    question_numbers = sorted(set(old_questions) | set(new_questions), key=lambda value: (value is None, str(value)))
    for number in question_numbers:
        path = f'Q{number}' if number is not None else 'questions[未编号]'
        old_question = old_questions.get(number)
        new_question = new_questions.get(number)
        if old_question is None:
            record(path, 'added')
            continue
        if new_question is None:
            record(path, 'deleted')
            continue
        for field in sorted(set(old_question) | set(new_question)):
            field_path = f'{path}.{field}'
            if field not in old_question:
                record(field_path, 'added')
            elif field not in new_question:
                record(field_path, 'deleted')
            elif old_question.get(field) != new_question.get(field):
                record(field_path, 'modified')

    ignored = {'importedAt', 'questions'}
    for field in sorted((set(old) | set(candidate)) - ignored):
        if field not in old:
            record(field, 'added')
        elif field not in candidate:
            record(field, 'deleted')
        elif old.get(field) != candidate.get(field):
            record(field, 'modified')
    return changes


def prep_report(root, target, key):
    mod = load_module(Path(__file__).parent / '9_面试准备导入.py', 'prep_importer_for_preflight')
    rows = load_rows(root)
    stem, title_rest, cohort, title_mid, header_note, sections = mod.parse_doc(str(target), rows)
    names = sorted({r.get('名称', '') for r in rows})
    rest = re.sub(r'面试准备$', '', stem)
    company, position = mod.split_company_position(rest, names)
    if not position and company and title_rest.startswith(company):
        position = title_rest[len(company):]
    errors, warnings, manual = [], [], []
    company_key, association = '', '无匹配'
    if not company:
        errors.append('无法从文件名与当前投递表推断公司')
    elif key:
        valid, association = mod.validate_company_key(company, key, rows)
        if valid:
            company_key = key
        else:
            errors.append(association)
    else:
        company_key, association = mod.find_company_key(company, rows)
        if association.startswith('歧义：'):
            errors.append(association)
    rel = target.relative_to(root).as_posix()
    candidate = {'id': stem, 'company': company, 'position': position, 'cohort': cohort,
                 'titleMid': title_mid, 'headerNote': header_note, 'sections': sections,
                 'companyKey': company_key, 'mdPath': rel}
    master = read_json(root / '投递数据/面试准备数据.json', 'preps')
    old = next((p for p in master['preps'] if p.get('id') == stem), None)
    if old:
        old_cmp = comparable_prep(old)
        new_cmp = comparable_prep(candidate)
        changed = [k for k in new_cmp if old_cmp.get(k) != new_cmp.get(k)]
        impact = {'action': 'would_replace_same_id', 'changed_fields': changed,
                  'existing_mdPath': old.get('mdPath', ''), 'existing_importedAt': old.get('importedAt', '')}
        if old.get('mdPath') and old.get('mdPath') != rel:
            errors.append(f'同 id 来自不同路径：{old.get("mdPath")} 与 {rel}')
        identity_changes = [field for field in ('company', 'position') if field in changed]
        if identity_changes:
            errors.append('同 id 的身份字段将变化：' + '、'.join(identity_changes) + '；正式导入前须显式核对公司与岗位参数')
            manual.append('保留已有记录身份，或在确认材料主体后用正式导入脚本的 --company/--position 指定；预检不会替你选择')
    else:
        impact = {'action': 'would_add', 'changed_fields': []}
    if not header_note:
        warnings.append('头部没有信源/缺口说明')
    if association == '无匹配':
        warnings.append('公司未关联到当前投递表；正式导入前需核对公司、岗位和记录 key')
    return {'master': '投递数据/面试准备数据.json', 'parsed': {'sections': len(sections)},
            'association': {'company': company, 'companyKey': company_key, 'status': association},
            'impact': impact, 'errors': errors, 'warnings': warnings, 'manual_review': manual}


def review_report(root, target, key):
    mod = load_module(Path(__file__).parent / '6_复盘导入.py', 'review_importer_for_preflight')
    text = target.read_text(encoding='utf-8')
    header = mod.parse_header(text, str(target))
    sections = mod.split_sections(text)
    errors, warnings, manual = [], [], []
    missing = [s for s in '一二三四五' if s not in sections]
    if missing:
        errors.append('缺少分节：' + '、'.join(missing))
        questions = []
    else:
        questions = mod.parse_questions(sections['二'])
    numbers = [q['n'] for q in questions]
    if len(numbers) != len(set(numbers)):
        errors.append('存在重复题号')
    required = {'intent': '考察意图', 'originalAnswer': '当时的回答', 'signals': '面试官信号', 'improvedAnswer': '改进版回答'}
    for q in questions:
        for field, label in required.items():
            if not q.get(field):
                warnings.append(f'Q{q["n"]} 缺少{label}')
        for dim, value in q.get('diagnosis', {}).items():
            if not value:
                warnings.append(f'Q{q["n"]} 诊断缺少{dim}')
    stem = target.stem
    master = read_json(root / '投递数据/面试复盘数据.json', 'sessions')
    old = next((s for s in master['sessions'] if s.get('id') == stem), None)
    impact = {'action': 'would_replace_same_id' if old else 'would_add',
              'existing_importedAt': old.get('importedAt', '') if old else ''}
    rows = load_rows(root)
    match = re.match(r'\d{8}_(.+)', stem)
    rest = match.group(1) if match else ''
    round_ = ''
    for round_name in mod.ROUNDS:
        if rest.endswith('_' + round_name):
            round_ = round_name
            rest = rest[:-(len(round_name) + 1)]
            break
    names = sorted({r.get('名称', '') for r in rows})
    parsed_company, position = mod.split_company_position(rest, names)
    company = parsed_company
    association_company = company
    if not association_company and old and old.get('company'):
        association_company = old.get('company')
        manual.append('文件名无法直接匹配当前投递表公司，以下关联沿用已有场次信息，正式重导前需核对主体关系')
    company_key = ''
    if key:
        valid, association = validate_company_key(association_company, key, rows)
        if not valid:
            errors.append(association)
        else:
            company_key = key
    else:
        hits = [r for r in rows if r.get('名称') == association_company]
        association = '歧义：同名多行，禁止默认取第一条' if len(hits) > 1 else ('精确匹配' if len(hits) == 1 else '无匹配')
        if len(hits) > 1:
            errors.append(association)
        elif len(hits) == 1:
            company_key = association_company
        elif old and old.get('companyKey') in {pair[0] for pair in row_key_pairs(rows)}:
            company_key = old.get('companyKey')
            association = '沿用已有场次关联；当前投递表无同名公司，需人工核对主体关系'
            warnings.append(association)
        else:
            warnings.append('公司未关联到当前投递表；正式导入前需核对公司、岗位和记录 key')
    candidate = {
        'id': stem,
        'date': header['date'],
        'company': company,
        'position': position,
        'round': round_,
        'duration': header['duration'],
        'interviewer': header['interviewer'],
        'source': header['source'],
        'companyKey': company_key,
        'questionTree': re.sub(r'^##.*$', '', sections.get('一', ''), flags=re.M).strip(),
        'questions': questions,
        'counterIntel': re.sub(r'^##.*$', '', sections.get('三', ''), flags=re.M).strip(),
        'summary': mod.parse_summary(sections.get('四', '')),
        'tracking': mod.parse_tracking(sections.get('五', '')),
        'mdPath': target.relative_to(root).as_posix(),
    }
    if old:
        changes = review_session_changes(old, candidate)
        impact['field_changes'] = changes
        impact['fields_that_would_change'] = [change['path'] for change in changes]
        impact['change_counts'] = {
            kind: sum(change['kind'] == kind for change in changes)
            for kind in ('added', 'modified', 'deleted')
        }
        if changes:
            manual.append('已有 JSON 场次含与 Markdown 不同或将被删除的内容；导入会整场覆盖，需先人工合并')
    return {'master': '投递数据/面试复盘数据.json', 'parsed': {'sections': len(sections), 'questions': len(questions)},
            'association': {'company': association_company, 'companyKey': company_key, 'status': association}, 'impact': impact,
            'header': header, 'errors': errors, 'warnings': warnings, 'manual_review': manual}


def prospect_report(root, target):
    text = target.read_text(encoding='utf-8')
    errors, warnings, manual = [], [], []
    links = re.findall(r'https?://[^\s)>）]+', text)
    refs = re.findall(r'\bE\d+\b', text)
    if not links:
        warnings.append('未发现直接链接；链接存在也不代表正文已读')
    if not re.search(r'^##\s+.*(?:结论|总评)', text, re.M):
        warnings.append('未发现结论型二级标题')
    if re.search(r'未检索到[^\n]*(?:无任何负面|没有负面)', text):
        manual.append('“未检索到”不能推出“无任何负面舆情”，需收紧措辞')
    if re.search(r'按\s*12\s*薪|若\s*14\s*薪|\d+[—-]\d+\s*万', text):
        manual.append('年包数字需逐项保留薪数假设、样本类型和置信度')
    for line_no, line in enumerate(text.splitlines(), 1):
        if '仅摘要' in line or '未读正文' in line or '访问受限' in line:
            manual.append(f'第 {line_no} 行为未读正文/访问受限证据，只能作为线索')
    return {'master': 'docs/流程协作.md', 'parsed': {'links': len(links), 'evidence_refs': len(refs)},
            'association': {'status': '不进入面试准备导入'}, 'impact': {'action': 'read_only_report'},
            'errors': errors, 'warnings': warnings, 'manual_review': list(dict.fromkeys(manual))}


def main():
    parser = argparse.ArgumentParser(description='准备/复盘/岗位探查单篇只读预检')
    parser.add_argument('--kind', choices=('prep', 'review', 'prospect'), required=True)
    parser.add_argument('--file', required=True)
    parser.add_argument('--root', default=os.environ.get('TOUDI_WORKSPACE', str(Path(__file__).resolve().parents[2] / 'runtime')))
    parser.add_argument('--key', default='')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = {'kind': args.kind, 'write_performed': False}
    try:
        root = Path(args.root).resolve(strict=True)
        target = safe_target(root, args.file)
        before = hashlib.sha256(target.read_bytes()).hexdigest()
        result.update({'target': target.relative_to(root).as_posix(), 'sha256': before})
        with contextlib.redirect_stdout(io.StringIO()):
            detail = prep_report(root, target, args.key) if args.kind == 'prep' else review_report(root, target, args.key) if args.kind == 'review' else prospect_report(root, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != before:
            raise RuntimeError('输入在预检期间发生变化')
        result.update(detail)
    except (ValueError, RuntimeError, FileNotFoundError, SystemExit) as exc:
        result.setdefault('errors', []).append(str(exc) or '解析器拒绝该材料')
    result.setdefault('warnings', [])
    result.setdefault('manual_review', [])
    result['ok'] = not result.get('errors')
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result)
    return 0 if result['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
