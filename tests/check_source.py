"""Check source files Git would publish; ignored workspaces are never scanned."""
from pathlib import Path
import ast
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_JSON = {
    'app/browser-extension/manifest.json',
    'desktop/package.json',
    'desktop/package-lock.json',
    'desktop/src-tauri/tauri.conf.json',
    'desktop/src-tauri/capabilities/default.json',
}
GENERATED_PARTS = {'runtime', '.venv', 'venv', '__pycache__', 'node_modules', '.toolchain', '.stage', '.wrangler'}
GENERATED_ROOTS = ('desktop/build/', 'desktop/dist/', 'desktop/src-tauri/target/',
                   'desktop/src-tauri/icons/', 'desktop/src-tauri/gen/', 'desktop/ui/assets/',
                   'diagnostics/', 'backups/')
TEXT_SUFFIXES = {'.py', '.html', '.md', '.svg', '.yml', '.yaml', '.txt', '.js', '.css', '.rs', '.toml', '.json'}
errors = []
# Union includes new source files awaiting staging and deduplicates staged files.
result = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                        check=True, capture_output=True, text=True)
names = sorted(set(filter(None, result.stdout.split('\0'))))
for name in names:
    path = ROOT / name
    if not path.exists():
        continue  # Locally deleted tracked files are not in the next source tree.
    if path.is_symlink():
        errors.append(name + ': symlink not allowed in source release')
        continue
    if not path.is_file():
        continue
    rel = Path(name)
    generated = any(part in GENERATED_PARTS for part in rel.parts) or name.startswith(GENERATED_ROOTS)
    if generated:
        errors.append(name + ': generated/private file would be published by Git')
        continue
    if (path.suffix in {'.bin', '.pdf', '.docx', '.key', '.pem', '.zip', '.dmg', '.exe', '.msi'}
            or (path.suffix == '.json' and name not in ALLOWED_JSON)
            or path.name in {'.passcode', '.cf_token', '.env'} or path.name.startswith('.env.')):
        errors.append(name + ': private/generated file in source release')
    if path.suffix not in TEXT_SUFFIXES:
        continue
    text = path.read_text(encoding='utf-8')
    if path.suffix == '.py':
        ast.parse(text, filename=name)
    for pattern in [r'/' + r'(?:Users|home)/[^/\s"<>]+/', r'[A-Za-z]:[\\/]Users[\\/][^\\/\s"<>]+[\\/]',
                    r'https?://[^\s"<>]+\.' + r'(?:feishu\.cn|larksuite\.com)', r'toudi-' + r'zhongkong',
                    r'(?i)(?:api_token|secret|password|agent_token|api_key)\s*[:=]\s*[\"\'][A-Za-z0-9_-]{20,}',
                    r'-----BEGIN ' + r'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                    r'gh[pousr]_' + r'[A-Za-z0-9]{30,}']:
        if re.search(pattern, text):
            errors.append(name + ': private source/credential pattern')
    if path.suffix == '.md':
        for href in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
            if href.startswith(('http:', 'https:', '#')):
                continue
            target = (path.parent / href.split('#')[0]).resolve()
            if not target.exists():
                errors.append(name + ': missing link ' + href)
html = (ROOT / 'app/投递管理.html').read_text(encoding='utf-8')
if 'const RAW_DATA = [];' not in html:
    errors.append('template RAW_DATA not empty')
pref = re.search(r'const DEFAULT_PREF\s*=\s*\{(.*?)\};', html, re.S)
for field in ('natures', 'industries', 'education'):
    selected = re.search(field+r'\s*:\s*\[([^\]]*)\]', pref.group(1)) if pref else None
    if not selected or selected.group(1).strip():
        errors.append('template must not preset personal preference: '+field)
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS {len(names)} Git source files: structure, empty template, private-pattern scan and internal links')
