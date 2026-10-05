"""Stage public resources and reject personal build paths in native packages."""
import argparse
import marshal
import os
import re
import shutil
import subprocess
import types
import zipfile
from pathlib import Path

RESOURCE_TYPES = {'.py', '.html', '.js', '.css', '.md', '.svg', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.yml', '.yaml'}
EXCLUDED_PARTS = {'__pycache__', 'runtime', '.venv', 'venv', 'node_modules', '.git', 'diagnostics', 'backups'}


def stage_resources(root, stage, names=None):
    """Copy only publishable source names; caches and workspaces never enter the bundle."""
    root, stage = Path(root).resolve(), Path(stage)
    if names is None:
        output = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        names = output.decode().split('\0')
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    copied = []
    for name in sorted(set(filter(None, names))):
        rel = Path(name)
        if rel.is_absolute() or '..' in rel.parts or set(rel.parts) & EXCLUDED_PARTS:
            continue
        eligible = name == 'AGENTS.md' or (rel.parts[0] in {'app', 'docs'} and rel.suffix.lower() in RESOURCE_TYPES)
        if name in ('app/browser-extension/manifest.json', 'app/assets/preference-defaults.json'):
            eligible = True
        if not eligible:
            continue
        source = root/rel
        if not source.exists():
            continue
        if source.is_symlink() or not source.resolve().is_relative_to(root):
            raise ValueError('Resource must be an ordinary source file: '+name)
        if not source.is_file():
            continue
        destination = stage/rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(name)
    for required in ('app/desktop_runtime.py', 'app/投递管理.html', 'AGENTS.md'):
        if required not in copied:
            raise ValueError('Missing required public resource: '+required)
    return copied


def rust_flags(env, root):
    """Pass distinct arguments without shell quoting or space-sensitive path parsing."""
    import shlex
    flags = env.get('CARGO_ENCODED_RUSTFLAGS')
    items = flags.split('\x1f') if flags else shlex.split(env.get('RUSTFLAGS', ''))
    items += ['--remap-path-prefix', str(Path.home())+'=/toudi-build',
              '--remap-path-prefix', str(Path(root).resolve())+'=/toudi-source']
    env.pop('RUSTFLAGS', None)
    env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join(items)


def audit_bundle(bundle, denied_roots):
    """Inspect raw resources, nested ZIPs and compressed Python code metadata."""
    from PyInstaller.archive.readers import CArchiveReader
    bundle = Path(bundle)
    markers = set()
    for root in denied_roots:
        value = str(Path(root).resolve())
        if len(value) > 3:
            for variant in (value, value.replace('\\', '/'), value.replace('/', '\\')):
                markers.update((variant.encode(), variant.encode('utf-16le')))
    errors, code_count = set(), 0

    def inspect_bytes(data, label):
        if any(marker in data for marker in markers):
            errors.add(label+': personal build path')
        if re.search(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})', data):
            errors.add(label+': credential pattern')

    def inspect_code(code, label):
        nonlocal code_count
        if not isinstance(code, types.CodeType):
            return
        code_count += 1
        inspect_bytes(code.co_filename.encode(), label)
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                inspect_code(value, label)
            elif isinstance(value, str):
                inspect_bytes(value.encode(), label)
            elif isinstance(value, bytes):
                inspect_bytes(value, label)

    files = sorted(p for p in bundle.rglob('*') if p.is_file()) if bundle.is_dir() else [bundle]
    for path in files:
        label = path.relative_to(bundle).as_posix() if bundle.is_dir() else path.name
        if '__pycache__' in path.parts or path.name in {'.DS_Store', '.env', 'connection.json'}:
            errors.add(label+': generated/private resource')
        inspect_bytes(path.read_bytes(), label)
        if path.suffix == '.zip':
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    if name.endswith('/'):
                        continue
                    data = archive.read(name)
                    inspect_bytes(data, label+'!'+name)
                    if name.endswith('.pyc'):
                        inspect_code(marshal.loads(data[16:]), label+'!'+name)
        if path.name in {'toudi-runtime', 'toudi-runtime.exe', 'toudi-browser-helper', 'toudi-browser-helper.exe'}:
            archive = CArchiveReader(str(path))
            for name, entry in archive.toc.items():
                kind = entry[-1]
                if kind in {'s', 'm', 'M'}:
                    inspect_code(marshal.loads(archive.extract(name)), label+'!'+name)
                elif kind == 'z':
                    embedded = archive.open_embedded_archive(name)
                    for module in embedded.toc:
                        value = embedded.extract(module)
                        if isinstance(value, types.CodeType):
                            inspect_code(value, label+'!'+module)
                        elif isinstance(value, bytes):
                            inspect_bytes(value, label+'!'+module)
    if errors:
        raise ValueError('Package privacy check failed:\n'+'\n'.join(sorted(errors)))
    return {'files':len(files), 'python_code_objects':code_count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--deny-root', action='append', required=True)
    args = parser.parse_args()
    result = audit_bundle(args.bundle, args.deny_root)
    print('PASS package privacy: '+str(result['files'])+' files, '+str(result['python_code_objects'])+' Python code objects')


if __name__ == '__main__':
    main()
