"""Recover an existing local publisher's bounded transaction under the shared data lock."""
import hashlib
import json
from pathlib import Path
from update_common import atomic_write

FILES = {'投递管理.html', '用户编辑数据.json', '27届校招_结构化.json',
         '27届校招_结构化.csv', '投递记录.json', '面试准备数据.json', '面试复盘数据.json'}


def digest(path):
    if path.is_symlink(): raise ValueError('symlink legacy transaction file denied')
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def recover(data):
    data=Path(data).resolve(); journal=data/'.update-transaction.json'
    if not journal.exists(): return False
    if journal.is_symlink(): raise ValueError('symlink legacy journal denied')
    record=json.loads(journal.read_text(encoding='utf-8'))
    run=Path(record['run'])
    if run.is_symlink() or not run.resolve().is_relative_to(data/'.update-runs'):
        raise ValueError('legacy recovery directory is outside its workspace')
    files=record['files']
    if not isinstance(files,dict) or not files or set(files)-FILES:
        raise ValueError('unsupported legacy transaction files')
    if record['state'] not in {'publishing','committed'}: raise ValueError('invalid legacy transaction state')
    for name,expected in files.items():
        for value in (expected['before'],expected['after']):
            if value is not None and (not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value)):
                raise ValueError('invalid legacy transaction hash')
        if digest(data/name) not in (expected['before'],expected['after']):
            raise ValueError('legacy recovery found an external modification: '+name)
        if record['state']=='publishing' and digest(run/'baseline'/name)!=expected['before']:
            raise ValueError('legacy recovery baseline changed: '+name)
    if record['state']=='publishing':
        for name,expected in files.items():
            source=run/'baseline'/name
            if expected['before'] is not None: atomic_write(data/name,source.read_bytes())
            else: (data/name).unlink(missing_ok=True)
    journal.unlink()
    return True
