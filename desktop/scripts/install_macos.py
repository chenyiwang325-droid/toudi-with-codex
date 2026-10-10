#!/usr/bin/env python3
"""Install one verified macOS App; archive rollback copies instead of extra .apps."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
from local_signing import initialize_identity, load_identity, sign_app

IDENTIFIER='io.github.chenyiwang325-droid.toudi'

def run(*args):
    subprocess.run([str(arg) for arg in args],check=True)

def identity(app):
    value=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if value.get('CFBundleIdentifier')!=IDENTIFIER: raise ValueError('Package is not TouDi; no App was replaced')
    return value.get('CFBundleShortVersionString','unknown')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=Path)
    parser.add_argument('--destination',type=Path,default=Path.home()/'Applications/TouDi.app')
    parser.add_argument('--backup-dir',type=Path,default=Path.home()/'Library/Application Support/TouDi/install-backups')
    parser.add_argument('--setup-local-signing',action='store_true',help='Explicitly create a local code-signing identity; requires user approval of certificate setup')
    args=parser.parse_args()
    if sys.platform!='darwin': raise ValueError('This installer is for macOS')
    package=args.package.resolve();target=args.destination.expanduser().absolute()
    if not package.is_file() or package.suffix.lower()!='.zip': raise ValueError('A built TouDi ZIP is required')
    if target.is_symlink() or target.name!='TouDi.app': raise ValueError('Destination must be a regular TouDi.app')
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.toudi-install-',suffix='.noindex',dir=target.parent) as temporary:
        staging=Path(temporary);run('ditto','-x','-k',package,staging)
        candidate=staging/'TouDi.app';version=identity(candidate)
        run('codesign','--verify','--deep','--strict',candidate)
        signing=initialize_identity() if args.setup_local_signing else load_identity()
        if signing:
            sign_app(candidate,signing)
            print('Persistent local signing identity verified; future installs reuse this identity.')
        previous=staging/'previous.app'
        if target.exists():
            old_version=identity(target);args.backup_dir.mkdir(parents=True,exist_ok=True)
            backup=args.backup_dir/f'TouDi_{old_version}_before_{version}.zip'
            pending=backup.with_suffix('.pending.zip');pending.unlink(missing_ok=True)
            run('ditto','-c','-k','--sequesterRsrc','--keepParent',target,pending);pending.replace(backup)
            os.replace(target,previous)
        try:
            os.replace(candidate,target);run('codesign','--verify','--deep','--strict',target)
        except BaseException:
            if target.exists(): shutil.rmtree(target)
            if previous.exists(): os.replace(previous,target)
            raise
        register=Path('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister')
        if register.exists():run(register,'-f',target)
    print(f'Installed TouDi {version}: {target}; workspace and saved materials preserved. If already running, finish editing and restart once to load the new program.')

if __name__=='__main__':main()
