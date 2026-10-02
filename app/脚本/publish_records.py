#!/usr/bin/env python3
"""Publish only a canonical recruitment-record array prepared by the user's Agent.
This is a validation/atomic-write boundary, not an importer or source scraper.
"""
import argparse
import json
import os
import shutil
from pathlib import Path
from update_common import data_lock, digest, atomic_write
ROOT = Path(os.environ.get('TOUDI_WORKSPACE', str(Path(__file__).resolve().parents[2] / 'runtime'))).resolve()
FIELDS = {'名称', '校招类型', '行业', '性质', '录入时间', '截止时间', '岗位', '地点', '应届生', '学历要求', '公告链接', '网申链接/邮箱'}

def validate(rows):
    if not isinstance(rows, list):
        raise ValueError('record root must be an array')
    for i, row in enumerate(rows):
        if not isinstance(row, dict) or not isinstance(row.get('名称'), str) or not row['名称'].strip():
            raise ValueError(f'record {i}: a nonempty 名称 is required')
        if any(k not in FIELDS or not isinstance(v, str) for k, v in row.items()):
            raise ValueError(f'record {i}: only documented string fields are allowed')
    return rows

def main():
    ap = argparse.ArgumentParser(description='验证并原子发布Agent已生成的规范投递记录')
    ap.add_argument('candidate', type=Path)
    ap.add_argument('--base', required=True, help='Current file SHA-256, or missing for a new workspace')
    ap.add_argument('--allow-empty', action='store_true', help='Explicitly allow replacing records with an empty array')
    args = ap.parse_args()
    rows = validate(json.loads(args.candidate.read_text()))
    if not rows and not args.allow_empty: ap.error('empty replacement requires --allow-empty')
    data = ROOT / '投递数据'; data.mkdir(parents=True, exist_ok=True)
    target = data / '投递记录.json'
    with data_lock(data):
        if (digest(target) or 'missing') != args.base:
            raise SystemExit('记录版本已变，取消发布；重新读取与对账，不强行覆盖')
        if target.exists(): shutil.copy2(target, data / '投递记录.json.bak_auto')
        atomic_write(target, json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
        # Mark files are deliberately never rewritten by a record publication.
    print(f'published {len(rows)} records; SHA-256 {digest(target)}; existing edits/pref preserved')

if __name__ == '__main__': main()
