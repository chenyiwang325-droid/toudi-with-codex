#!/usr/bin/env python3
"""Build a standalone extension and optional native Codex helper, without TouDi App."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--python',default=str(ROOT/'desktop/.venv/bin/python'))
    parser.add_argument('--output',default=str(ROOT/'browser-tools/dist'))
    parser.add_argument('--skip-helper',action='store_true')
    options=parser.parse_args()
    subprocess.run([sys.executable,str(ROOT/'tests/check_source.py')],check=True)
    output=Path(options.output).resolve();output.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(ROOT/'app'))
    from filling_tools import extension_bundle
    from browser_helper import VERSION
    extension=output/'TouDi-filling'
    if extension.is_symlink():raise ValueError('Generated extension must not be a symbolic link')
    if extension.exists():shutil.rmtree(extension)
    archive=output/'TouDi-filling-extension.zip';archive.write_bytes(extension_bundle())
    with zipfile.ZipFile(archive) as bundle:bundle.extractall(output)
    if not options.skip_helper:
        build=ROOT/'browser-tools/build';build.mkdir(parents=True,exist_ok=True)
        env=dict(os.environ);env['PYINSTALLER_CONFIG_DIR']=str(build/'cache')
        hooks=build/'privacy-hooks';hooks.mkdir(exist_ok=True)
        config_name=subprocess.check_output([options.python,'-c',"import sysconfig; print(sysconfig._get_sysconfigdata_name())"],text=True).strip()
        shutil.copy2(ROOT/'desktop/scripts/sysconfig_hook.py',hooks/('hook-'+config_name+'.py'))
        subprocess.run([options.python,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','toudi-browser-helper','--distpath',str(output/'native'),'--workpath',str(build/'pyinstaller'),'--specpath',str(build),'--paths',str(ROOT/'app'),'--additional-hooks-dir',str(hooks),str(ROOT/'app/browser_helper.py')],check=True,env=env)
        subprocess.run([options.python,str(ROOT/'desktop/scripts/privacy.py'),'--deny-root',str(ROOT),'--deny-root',str(Path.home()),str(output/'native/toudi-browser-helper')],check=True)
        if sys.platform=='darwin':
            app=output/'TouDi 浏览器连接.app'
            if app.is_symlink():raise ValueError('Generated connector must not be a symbolic link')
            if app.exists():shutil.rmtree(app)
            contents=app/'Contents';mac=contents/'MacOS';mac.mkdir(parents=True)
            (contents/'Resources').mkdir(exist_ok=True)
            resources=output/'native/toudi-browser-helper'
            shutil.copytree(resources,contents/'Resources/helper')
            launcher=mac/'install';launcher.write_text('#!/bin/sh\nexec "$(dirname "$0")/../Resources/helper/toudi-browser-helper" "$@"\n');launcher.chmod(0o755)
            plist={'CFBundleIdentifier':'app.toudi.browser-connector','CFBundleName':'TouDi 浏览器连接','CFBundleDisplayName':'TouDi 浏览器连接','CFBundleExecutable':'install','CFBundleVersion':VERSION,'CFBundleShortVersionString':VERSION,'CFBundlePackageType':'APPL','LSUIElement':True}
            icon=ROOT/'desktop/src-tauri/icons/icon.icns'
            if icon.is_file():shutil.copy2(icon,contents/'Resources/icon.icns');plist['CFBundleIconFile']='icon.icns'
            (contents/'Info.plist').write_bytes(plistlib.dumps(plist))
            subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True)
        shutil.copy2(ROOT/'docs/辅助填报.md',output/'使用说明.md')
        package=output/'TouDi-browser-macos-arm64.zip' if sys.platform=='darwin' else output/'TouDi-browser-tools.zip'
        with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as bundle:
            targets=[extension,output/'使用说明.md']
            targets.append(output/'TouDi 浏览器连接.app' if sys.platform=='darwin' else output/'native/toudi-browser-helper')
            for target in targets:
                for file in ([target] if target.is_file() else sorted(target.rglob('*'))):
                    if file.is_file():bundle.write(file,str(Path('TouDi-browser')/file.relative_to(output)))
        print('Built '+str(package))
    print('Extension '+str(extension))


if __name__=='__main__':main()
