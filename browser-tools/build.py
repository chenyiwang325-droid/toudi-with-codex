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
    output=Path(options.output).resolve();output.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(ROOT/'app'))
    from filling_service import extension_bundle
    extension=output/'TouDi-filling';extension.mkdir(exist_ok=True)
    archive=output/'TouDi-filling-extension.zip';archive.write_bytes(extension_bundle())
    with zipfile.ZipFile(archive) as bundle:bundle.extractall(output)
    if not options.skip_helper:
        build=ROOT/'browser-tools/build';build.mkdir(parents=True,exist_ok=True)
        env=dict(os.environ);env['PYINSTALLER_CONFIG_DIR']=str(build/'cache')
        subprocess.run([options.python,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','toudi-browser-helper','--distpath',str(output/'native'),'--workpath',str(build/'pyinstaller'),'--specpath',str(build),'--paths',str(ROOT/'app'),str(ROOT/'app/browser_helper.py')],check=True,env=env)
        if sys.platform=='darwin':
            app=output/'TouDi 浏览器连接.app';contents=app/'Contents';mac=contents/'MacOS';mac.mkdir(parents=True,exist_ok=True)
            (contents/'Resources').mkdir(exist_ok=True)
            resources=output/'native/toudi-browser-helper'
            shutil.copytree(resources,contents/'Resources/helper',dirs_exist_ok=True)
            launcher=mac/'install';launcher.write_text('#!/bin/sh\nexec "$(dirname "$0")/../Resources/helper/toudi-browser-helper" "$@"\n');launcher.chmod(0o755)
            plist={'CFBundleIdentifier':'app.toudi.browser-connector','CFBundleName':'TouDi 浏览器连接','CFBundleDisplayName':'TouDi 浏览器连接','CFBundleExecutable':'install','CFBundleVersion':'0.2.0','CFBundleShortVersionString':'0.2.0','CFBundlePackageType':'APPL','LSUIElement':True}
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
