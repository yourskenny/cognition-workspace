"""Windows user-scoped DPAPI storage. Secrets never enter workspace snapshots."""
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import tempfile


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def _crypt(raw: bytes, decrypt=False) -> bytes:
    if os.name != 'nt':
        raise RuntimeError('当前凭据存储仅支持 Windows DPAPI')
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        fn = crypt.CryptUnprotectData
        fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        fn = crypt.CryptProtectData
        fn.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(source), 'Cognition Workspace', None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise RuntimeError('Windows 无法处理本机凭据，请重新设置密钥')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


class Credentials:
    def __init__(self, root: Path):
        self.path = root / 'credentials.json'
        root.mkdir(parents=True, exist_ok=True)

    def read(self, reveal=False):
        data = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}
        result = {'provider': 'deepseek', 'model': data.get('model', 'deepseek-flash'), 'configured': bool(data.get('secret'))}
        if reveal:
            result['api_key'] = _crypt(base64.b64decode(data['secret']), True).decode() if data.get('secret') else ''
        return result

    def save(self, api_key: str, model: str):
        previous = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}
        data = {'model': model, 'secret': base64.b64encode(_crypt(api_key.encode())).decode() if api_key else previous.get('secret', '')}
        fd, name = tempfile.mkstemp(dir=self.path.parent, suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(data, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        return self.read()

    def delete(self):
        self.path.unlink(missing_ok=True)
        return self.read()
