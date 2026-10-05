"""Inspect confirmed filling facts or build the extension; no browser submission commands."""
import argparse
import json
import os
from pathlib import Path


def main(argv=None):
    from workspace_link import resolve_workspace
    from filling_profile import load_profile, profile_summary, plan_fields, export_profile_pack
    from filling_service import extension_bundle, _validate_scan, _write_private
    parser = argparse.ArgumentParser(description='TouDi 本地辅助填报资料工具（试用）')
    parser.add_argument('--workspace', default=str(resolve_workspace()))
    commands = parser.add_subparsers(dest='command', required=True)
    summary = commands.add_parser('profile', help='只读检查来源、字段数和填写规则，不输出个人值')
    summary.add_argument('--profile', choices=['general', 'state', 'ai-product'], default='general')
    extension = commands.add_parser('extension', help='打包加载到 Chrome 的本地扩展')
    extension.add_argument('--output', required=True)
    export = commands.add_parser('export', help='导出私人插件资料包；含个人值，只保存到仓库外')
    export.add_argument('--output', required=True)
    preview = commands.add_parser('plan', help='Agent 只读核对表单快照，默认只输出脱敏计划')
    preview.add_argument('--profile', choices=['general', 'state', 'ai-product'], default='general')
    preview.add_argument('--scan', required=True)
    preview.add_argument('--mappings', help='已核对的 fieldId 到 factKey JSON 文件')
    preview.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    if args.command == 'export':
        target=Path(args.output).resolve()
        source=Path(__file__).resolve().parent.parent
        if target==source or source in target.parents:
            raise ValueError('私人资料包必须导出到公开源码仓库之外')
        _write_private(target,export_profile_pack(args.workspace))
        print(json.dumps({'ok':True,'output':str(target),'personalDataIncluded':True}))
    elif args.command == 'extension':
        target = Path(args.output).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(extension_bundle())
        print(json.dumps({'ok': True, 'output': str(target), 'personalDataIncluded': False}))
    else:
        profile = load_profile(args.workspace, args.profile)
        if args.command == 'profile':
            print(json.dumps(profile_summary(profile), ensure_ascii=False, indent=2))
        else:
            scan = _validate_scan(json.loads(Path(args.scan).read_text(encoding='utf-8')))
            mappings = json.loads(Path(args.mappings).read_text(encoding='utf-8')) if args.mappings else None
            plan = plan_fields(profile, scan, mappings)
            plan.pop('actions', None)
            for row in plan['rows']:
                row.pop('value', None); row.pop('expectedValue', None)
            target = Path(args.output).resolve()
            _write_private(target, plan)
            print(json.dumps({'ok': True, 'output': str(target), 'statusCounts': plan['statusCounts'], 'submitted': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
