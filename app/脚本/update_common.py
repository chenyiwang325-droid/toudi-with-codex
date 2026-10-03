"""更新运行目录、文件锁与原子写入。仅使用 Python 标准库。"""
import contextlib
try:
    import fcntl
except ImportError:
    fcntl = None
    import msvcrt
import hashlib
import json
import os
import tempfile
from pathlib import Path



def digest(path):
    path = Path(path)
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(content.encode('utf-8') if isinstance(content, str) else content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        # Persist the rename itself where directory fsync is supported.
        if hasattr(os, 'O_DIRECTORY'):
            directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory_fd)
            finally: os.close(directory_fd)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_json(path, value):
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


@contextlib.contextmanager
def data_lock(root, shared=False, blocking=True):
    """server 与发布器共用同一文件锁；原子替换数据文件不会改变锁文件。"""
    Path(root).mkdir(parents=True, exist_ok=True)
    path = Path(root) / '.update-data.lock'
    with path.open('a') as f:
        if fcntl:
            flags = fcntl.LOCK_SH if shared else fcntl.LOCK_EX
            if not blocking: flags |= fcntl.LOCK_NB
            fcntl.flock(f, flags)
        else:
            f.seek(0); f.write('0'); f.flush(); f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK, 1)
        try:
            yield
        finally:
            if fcntl: fcntl.flock(f, fcntl.LOCK_UN)
            else:
                f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)



def raw_rows(path):
    import re
    m = re.search(r'const RAW_DATA = (\[.*?\]);\s*\n', Path(path).read_text(), re.S)
    if not m:
        raise ValueError('RAW_DATA 未找到')
    return json.loads(m.group(1))


def runtime_keys(rows):
    from collections import Counter
    counts = Counter(r['名称'] for r in rows)
    return [r['名称'] if counts[r['名称']] == 1 else
            f"{r['名称']}｜{r.get('公告链接') or ('#' + str(i + 1))}"
            for i, r in enumerate(rows)]
