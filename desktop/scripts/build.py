#!/usr/bin/env python3
"""Build the same HTML and its self-contained Python data component into TouDi."""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from frontend import prepare_frontend
from privacy import stage_resources, rust_flags

DESKTOP = Path(__file__).resolve().parents[1]
ROOT = DESKTOP.parent


def run(args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description='Build TouDi desktop packages on the target operating system')
    parser.add_argument('--bundles', help='Tauri bundle types; default app on macOS, nsis on Windows')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--skip-runtime', action='store_true', help='Reuse an already-built data component')
    parser.add_argument('--skip-install', action='store_true', help='Reuse local build dependencies')
    args = parser.parse_args()
    os.chdir(DESKTOP)
    venv = DESKTOP / '.venv'
    python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    env = dict(os.environ)
    rust_flags(env, ROOT)
    env['PYINSTALLER_CONFIG_DIR'] = str(DESKTOP / 'build/pyinstaller-cache')
    # Optional workspace-local toolchain; ordinary source builds can use their installed Rust.
    cargo = DESKTOP / '.toolchain/cargo/bin'
    if cargo.exists():
        env['CARGO_HOME'] = str(DESKTOP / '.toolchain/cargo')
        env['RUSTUP_HOME'] = str(DESKTOP / '.toolchain/rustup')
        env['PATH'] = str(cargo) + os.pathsep + env.get('PATH', '')
    if not args.skip_install:
        if not python.exists():
            run([sys.executable, '-m', 'venv', venv])
        run([python, '-m', 'pip', 'install', '--cache-dir', DESKTOP/'build/pip-cache', 'pyinstaller>=6.16,<7', 'cryptography>=42,<47', 'pypdf>=5,<7'])
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not npm:
            raise SystemExit('Source builds require Node.js/npm. Installed app users do not need them.')
        run([npm, 'ci' if (DESKTOP/'package-lock.json').exists() else 'install', '--no-audit', '--no-fund', '--cache', DESKTOP/'.toolchain/npm-cache'], env=env)
    npx = shutil.which('npx.cmd' if os.name == 'nt' else 'npx')
    if not npx:
        raise SystemExit('Source builds require Node.js/npm')
    run([sys.executable, ROOT/'tests/check_source.py'])
    # All visual and UI assets come from the current application, without a separate design.
    ui_assets = DESKTOP/'ui/assets'
    shutil.copytree(ROOT/'app/assets', ui_assets, dirs_exist_ok=True)
    prepare_frontend(ROOT)
    run([npx, 'tauri', 'icon', ROOT/'app/assets/favicon.svg', '--output', DESKTOP/'src-tauri/icons'], env=env)
    if not args.skip_runtime:
        runtime = DESKTOP/'src-tauri/runtime'
        runtime.mkdir(parents=True, exist_ok=True)
        separator = ';' if os.name == 'nt' else ':'
        stage = DESKTOP/'build/public-resources'
        stage_resources(ROOT, stage)
        hooks = DESKTOP/'build/privacy-hooks'
        if hooks.exists():
            shutil.rmtree(hooks)
        hooks.mkdir(parents=True)
        config_name = subprocess.check_output([str(python), '-c',
            "import sysconfig; print(sysconfig._get_sysconfigdata_name() if hasattr(sysconfig, '_get_sysconfigdata_name') and hasattr(__import__('sys'), 'abiflags') else '')"], text=True).strip()
        if config_name:
            shutil.copy2(DESKTOP/'scripts/sysconfig_hook.py', hooks/('hook-'+config_name+'.py'))
        sources = [p for p in (stage/'app').iterdir() if p.name != 'desktop_runtime.py']
        command = [python, '-m', 'PyInstaller', '--noconfirm', '--clean', '--name', 'toudi-runtime',
                   '--onedir', '--distpath', runtime, '--workpath', DESKTOP/'build/pyinstaller',
                   '--specpath', DESKTOP/'build', '--paths', stage/'app', '--paths', stage/'app/脚本',
                   '--additional-hooks-dir', hooks,
                   '--collect-all', 'cryptography']
        for path in sources:
            destination = path.name if path.is_dir() else '.'
            command += ['--add-data', str(path)+separator+destination]
        command += ['--add-data', str(stage/'docs')+separator+'docs',
                    '--add-data', str(stage/'AGENTS.md')+separator+'.', stage/'app/desktop_runtime.py']
        run(command, env=env)
    bundles = args.bundles or ('app' if sys.platform=='darwin' else 'nsis' if os.name=='nt' else 'appimage')
    command = [npx, 'tauri', 'build', '--bundles', bundles]
    if args.debug:
        command.append('--debug')
    run(command, env=env)
    privacy_check = [python, DESKTOP/'scripts/privacy.py', '--deny-root', ROOT, '--deny-root', Path.home()]
    run(privacy_check+[DESKTOP/'src-tauri/runtime/toudi-runtime'], env=env)
    bundle = DESKTOP/'src-tauri/target'/('debug' if args.debug else 'release')/'bundle'
    run(privacy_check+[bundle], env=env)
    print('Built TouDi: '+str(DESKTOP/'src-tauri/target'/('debug' if args.debug else 'release')/'bundle'))


if __name__ == '__main__':
    main()
