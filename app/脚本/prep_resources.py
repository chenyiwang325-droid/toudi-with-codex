"""Only expose files explicitly linked by active preparation records."""
import base64
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
import subprocess
import zipfile
import xml.etree.ElementTree as ET

LINK = re.compile(r'\[[^\]]+\]\(([^)\s]+)\)')
ALLOWED = {'.md', '.txt', '.json', '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg'}

def resource_paths(data_dir, preps):
    root = Path(data_dir).resolve().parent
    found = {}
    for prep in preps.get('preps', []):
        doc = (root / prep.get('mdPath', '')).resolve()
        if not doc.is_relative_to(root):
            continue
        source = prep.get('headerNote', '') + '\n' + '\n'.join(s.get('md', '') for s in prep.get('sections', []))
        for href in LINK.findall(source):
            url = urlsplit(href)
            if url.scheme or url.netloc or not url.path:
                continue
            path = (doc.parent / unquote(url.path)).resolve()
            if not path.is_relative_to(root) or any(p.startswith('.') for p in path.relative_to(root).parts):
                continue
            if path.suffix.lower() not in ALLOWED or not path.is_file():
                continue
            found[path.relative_to(root).as_posix()] = path
    return found

def resource_payload(path):
    payload = {'name': path.name, 'mime': mimetypes.guess_type(path.name)[0] or 'application/octet-stream'}
    if path.suffix.lower() in {'.md', '.txt', '.json'}:
        payload.update(kind='markdown' if path.suffix.lower() == '.md' else 'text', text=path.read_text(encoding='utf-8'))
    else:
        payload.update(kind='file', data=base64.b64encode(path.read_bytes()).decode('ascii'))
        if path.suffix.lower() == '.pdf':
            try:
                payload['text'] = subprocess.run(['pdftotext', '-enc', 'UTF-8', str(path), '-'], check=True, capture_output=True, text=True).stdout
            except (FileNotFoundError, subprocess.CalledProcessError):
                try:
                    from pypdf import PdfReader
                    payload['text'] = '\n\n'.join(page.extract_text() or '' for page in PdfReader(path).pages)
                    if not payload['text'].strip(): payload['text'] = '该 PDF 没有可提取的文字，请查看原件。'
                except Exception:
                    payload['text'] = 'PDF 正文未能提取，请查看原件。'
        if path.suffix.lower() == '.docx':
            with zipfile.ZipFile(path) as z:
                doc = ET.fromstring(z.read('word/document.xml'))
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            payload['text'] = '\n\n'.join(''.join(n.text or '' for n in p.findall('.//w:t', ns)) for p in doc.findall('.//w:p', ns))
    return payload

def resource_bundle(data_dir, preps):
    return {key: resource_payload(path) for key, path in resource_paths(data_dir, preps).items()}
