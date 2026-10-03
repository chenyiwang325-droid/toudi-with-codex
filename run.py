#!/usr/bin/env python3
"""Launch a local or authenticated hosted workspace; no sample data."""
import os
import runpy
import sys
from pathlib import Path
root = Path(__file__).resolve().parent
sys.path[:0] = [str(root / 'app'), str(root / 'app' / '脚本')]
from workspace_link import resolve_workspace
os.environ.setdefault('TOUDI_WORKSPACE', str(resolve_workspace(root / 'runtime')))
runpy.run_path(str(root / 'app' / 'server.py'), run_name='__main__')
