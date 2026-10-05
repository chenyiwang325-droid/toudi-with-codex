"""Self-contained desktop service and Agent CLI. No system Python needed after packaging."""
import json
import os
import signal
import sys
import threading
from pathlib import Path

APP_VERSION = '0.3.9'
HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE / '脚本')]


def default_workspace():
    from workspace_link import resolve_workspace
    return resolve_workspace()


def parent_alive(pid):
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.GetExitCodeProcess.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    code = wintypes.DWORD()
    try:
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
    finally:
        kernel.CloseHandle(handle)


def serve():
    os.environ.setdefault('TOUDI_WORKSPACE', str(default_workspace()))
    os.environ['TOUDI_MODE'] = 'desktop'
    os.environ['TOUDI_PORT'] = '0'
    import server
    from http.server import ThreadingHTTPServer
    # The independent browser helper no longer connects to an App HTTP port.
    # Each launch owns an OS-selected loopback port and an ephemeral session token.
    listener = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    server.PORT = listener.server_address[1]
    listener.timeout = 1
    print(json.dumps({'event': 'ready', 'port': server.PORT, 'version': APP_VERSION}), flush=True)
    stopped = threading.Event()

    def stop():
        if not stopped.is_set():
            stopped.set()
            listener.shutdown()

    def controls():
        for line in sys.stdin:
            if line.strip() == 'shutdown':
                stop()
                return

    def monitor():
        parent = int(os.environ.get('TOUDI_PARENT_PID', '0'))
        while not stopped.wait(1):
            if parent and not parent_alive(parent):
                stop()
                return

    threading.Thread(target=controls, daemon=True).start()
    threading.Thread(target=monitor, daemon=True).start()
    if os.name != 'nt':
        signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=stop, daemon=True).start())
    try:
        listener.serve_forever(poll_interval=.25)
    finally:
        stopped.set()
        listener.server_close()


def export_reading(output):
    import importlib.util
    import tempfile
    import zipfile
    os.environ.setdefault('TOUDI_WORKSPACE', str(default_workspace()))
    source = HERE / '脚本' / '10_手机版快照.py'
    spec = importlib.util.spec_from_file_location('toudi_reading', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    previous = sys.argv
    try:
        sys.argv = [str(source)]
        module.main()
    finally:
        sys.argv = previous
    stage = Path(module.OUT_DIR) / '.stage'
    if not stage.is_dir():
        raise ValueError('Encrypted reading export did not produce a verified stage')
    fd, temporary = tempfile.mkstemp(prefix='.toudi-reading-', suffix='.zip', dir=output.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(stage.rglob('*')):
                if path.is_file():
                    bundle.write(path, path.relative_to(stage).as_posix())
        with open(temporary, 'rb+') as finished:
            os.fsync(finished.fileno())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    print(json.dumps({'ok': True, 'output': str(output), 'passcodeFile': str(module.PASS_FILE), 'readonly': True}), flush=True)


def main(argv=None):
    # Agent tools always exchange UTF-8, including Windows redirected stdout.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == 'filling':
        from filling_cli import main as filling_main
        return filling_main(args[1:])
    if args and args[0] == 'workspace':
        from workspace_link import main as workspace_main
        return workspace_main(args[1:])
    if args == ['serve']:
        return serve()
    if args and args[0] == 'export-reading':
        if len(args) != 2:
            raise ValueError('export-reading requires an output ZIP path')
        return export_reading(Path(args[1]))
    import workbench
    if not any(arg == '--workspace' or arg.startswith('--workspace=') for arg in args):
        args = ['--workspace', os.environ.get('TOUDI_WORKSPACE', str(default_workspace()))] + args
    return workbench.main(args)


if __name__ == '__main__':
    sys.exit(main())
