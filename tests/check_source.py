"""Source-only release check. Generated personal workspaces are never an input."""
from pathlib import Path
import ast
import re
import subprocess
ROOT=Path(__file__).resolve().parents[1]
errors=[]
for path in ROOT.rglob('*'):
    if not path.is_file():continue
    rel=path.relative_to(ROOT)
    if any(p in {'runtime','.git','.venv','__pycache__','node_modules'} for p in rel.parts):continue
    if path.suffix in {'.bin','.json','.pdf','.docx','.key','.pem'} or path.name in {'.passcode','.cf_token'}:errors.append(str(rel)+': private/generated file in source release')
    if path.suffix not in {'.py','.html','.md','.svg','.yml','.txt'}:continue
    text=path.read_text()
    if path.suffix=='.py':ast.parse(text,filename=str(rel))
    for pattern in [r'/'+r'Users/',r'https?://[^\s"<>]+\.'+r'feishu\.cn',r'toudi-'+r'zhongkong',r'(?i)(?:api_token|secret)\s*=\s*[\"\'][A-Za-z0-9_-]{20,}']:
        if re.search(pattern,text):errors.append(str(rel)+': private source/credential pattern')
    if path.suffix=='.md':
        for href in re.findall(r'\[[^\]]*\]\(([^)]+)\)',text):
            if href.startswith(('http:','https:','#')):continue
            target=(path.parent/href.split('#')[0]).resolve()
            if not target.exists():errors.append(str(rel)+': missing link '+href)
html=(ROOT/'app/投递管理.html').read_text()
if 'const RAW_DATA = [];' not in html:errors.append('template RAW_DATA not empty')
# A normal clone has .git, and local use may create an ignored runtime directory.
# Check what Git would publish instead of rejecting either local directory.
if (ROOT/'.git').exists():
    tracked=subprocess.run(['git','-C',str(ROOT),'ls-files','-z'],check=True,capture_output=True,text=True).stdout.split('\0')
    for name in filter(None,tracked):
        if any(p in {'runtime','.venv','__pycache__','node_modules'} for p in Path(name).parts):
            errors.append(name+': generated/private file is tracked by Git')
if errors:raise SystemExit('\n'.join(errors))
print('PASS source structure, empty template, private-pattern scan and internal file links')
