#!/usr/bin/env python3
"""Launch a local or authenticated hosted workspace; no sample data."""
import os
import runpy
from pathlib import Path
root = Path(__file__).resolve().parent
os.environ.setdefault('TOUDI_WORKSPACE', str(root / 'runtime'))
runpy.run_path(str(root / 'app' / 'server.py'), run_name='__main__')
