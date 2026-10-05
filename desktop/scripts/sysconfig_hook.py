"""Build-only PyInstaller hook: replace interpreter build prefixes in metadata."""
import types
from pathlib import Path


def sanitize(value, prefix):
    if isinstance(value, types.CodeType):
        return value.replace(co_filename=sanitize(value.co_filename, prefix),
                             co_consts=tuple(sanitize(item, prefix) for item in value.co_consts))
    if isinstance(value, str):
        return value.replace(prefix, '/toudi-python-build')
    if isinstance(value, tuple):
        return tuple(sanitize(item, prefix) for item in value)
    return value


def hook(hook_api):
    # Only _sysconfigdata build-time constants are changed. This is not a runtime hook.
    if hook_api.module.code is not None:
        hook_api.module.code = sanitize(hook_api.module.code, str(Path.home()))
