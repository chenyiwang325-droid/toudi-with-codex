"""An opt-in, persistent signing identity for one user's local TouDi installs.

This identity is not a Developer ID and must not be used for public releases.
The private key stays in the user's keychain. Only codesign is trusted to use it;
certificate trust is restricted to code signing by that application.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import tempfile

IDENTIFIER = 'io.github.chenyiwang325-droid.toudi'
LABEL = 'TouDi Local Code Signing'


def profile_directory():
    return Path.home()/'Library/Application Support/TouDi/local-signing'


def run(args, *, env=None, secret=None):
    result = subprocess.run([str(value) for value in args], env=env,
                            capture_output=True, text=True)
    if result.returncode:
        message = result.stderr.strip()
        if secret:
            message = message.replace(secret, '[redacted]')
        # Never include command arguments: a transient import password may be present.
        raise ValueError(Path(str(args[0])).name+' failed: '+message)
    return result


def load_identity(root=None):
    root = Path(root) if root is not None else profile_directory()
    path = root/'identity.json'
    if any(part.is_symlink() for part in [path, *path.parents]):
        raise ValueError('Local signing profile must not use symbolic links')
    if not path.exists():
        if root.exists() and (not root.is_dir() or any(root.iterdir())):
            raise ValueError('Local signing metadata is missing; preserve the existing profile and repair, do not fall back to temporary signing')
        return None
    info = json.loads(path.read_text())
    if (not isinstance(info, dict) or info.get('schemaVersion') != 1 or info.get('bundleIdentifier') != IDENTIFIER
            or not re.fullmatch(r'[A-F0-9]{40}', info.get('fingerprint', ''))
            or not isinstance(info.get('keychain'), str)
            or not Path(info['keychain']).is_absolute()):
        raise ValueError('Invalid local signing profile; preserve it and repair, do not regenerate')
    return info


def persist_identity(root, info):
    pending = root/'identity.pending.json'
    with os.fdopen(os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as handle:
        json.dump(info, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    pending.replace(root/'identity.json')


def finish_trust(root, info):
    if info.get('ready') is True:
        return info
    if info.get('imported') is not True:
        raise ValueError('Private-key import was interrupted; preserve and repair this identity, do not regenerate')
    certificate = root/'certificate.der'
    if (not certificate.is_file() or certificate.is_symlink()
            or hashlib.sha1(certificate.read_bytes()).hexdigest().upper() != info['fingerprint']):
        raise ValueError('Incomplete signing setup; preserve the identity and repair its certificate')
    # Scope trust to codeSign policy invoked by codesign, not TLS or system-wide roots.
    run(['/usr/bin/security', 'add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign',
         '-a', '/usr/bin/codesign', '-k', info['keychain'], certificate])
    info = {**info, 'ready': True}
    persist_identity(root, info)
    return info


def initialize_identity(root=None):
    """Explicit setup only. Never rotate an existing identity on an error."""
    root = Path(root) if root is not None else profile_directory()
    existing = load_identity(root)
    if existing:
        return finish_trust(root, existing)
    if any(part.is_symlink() for part in [root, *root.parents]):
        raise ValueError('Local signing profile must not use symbolic links')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    keychain = run(['/usr/bin/security', 'default-keychain', '-d', 'user']).stdout.strip().strip('"')
    if not Path(keychain).is_absolute():
        raise ValueError('No user keychain available for local signing')
    password = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix='toudi-signing-', suffix='.noindex') as tmp:
        temporary = Path(tmp)
        os.chmod(temporary, 0o700)
        config = temporary/'certificate.cnf'
        config.write_text('[req]\nprompt = no\ndistinguished_name = subject\nx509_extensions = signing\n'
                          '[subject]\nCN = '+LABEL+'\n[signing]\nbasicConstraints = critical,CA:true,pathlen:0\n'
                          'keyUsage = critical,digitalSignature,keyCertSign\nextendedKeyUsage = codeSigning\n')
        key, cert, der, archive = [temporary/name for name in ('key.pem', 'cert.pem', 'cert.der', 'identity.p12')]
        run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
             '-keyout', key, '-out', cert, '-days', '3650', '-config', config])
        os.chmod(key, 0o600)
        run(['/usr/bin/openssl', 'x509', '-in', cert, '-outform', 'der', '-out', der])
        fingerprint = hashlib.sha1(der.read_bytes()).hexdigest().upper()
        # macOS security import requires the compatible PKCS12 container algorithms.
        run(['/usr/bin/openssl', 'pkcs12', '-export', '-inkey', key, '-in', cert, '-out', archive,
             '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1',
             '-passout', 'env:TOUDI_SIGNING_IMPORT_PASSWORD'],
            env={**os.environ, 'TOUDI_SIGNING_IMPORT_PASSWORD': password}, secret=password)
        os.chmod(archive, 0o600)
        certificate = root/'certificate.der'
        with os.fdopen(os.open(certificate, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
            handle.write(der.read_bytes())
        info = {'schemaVersion': 1, 'bundleIdentifier': IDENTIFIER,
                'fingerprint': fingerprint, 'keychain': keychain,
                'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'ready': False, 'imported': False}
        persist_identity(root, info)
        run(['/usr/bin/security', 'import', archive, '-k', keychain, '-P', password,
             '-T', '/usr/bin/codesign'], secret=password)
        info = {**info, 'imported': True}
        # Keep the imported identity before a user cancels certificate trust. A retry
        # resumes the same certificate; it never silently makes another identity.
        persist_identity(root, info)
        return finish_trust(root, info)


def sign_app(app, identity):
    if identity.get('ready') is not True:
        raise ValueError('Complete the explicit local signing setup before installing')
    app = Path(app)
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != IDENTIFIER:
        raise ValueError('Local signing is restricted to the TouDi App')
    signed = run(['/usr/bin/codesign', '-d', '--entitlements', ':-', app]).stdout
    entitlements = plistlib.loads(signed.encode())
    if entitlements.get('com.apple.security.personal-information.calendars') is not True:
        raise ValueError('Candidate App is missing its Calendar entitlement')
    fingerprint = identity['fingerprint']
    requirement = 'identifier "'+IDENTIFIER+'" and certificate leaf = H"'+fingerprint+'"'
    with tempfile.TemporaryDirectory(prefix='toudi-entitlements-', suffix='.noindex') as tmp:
        plist = Path(tmp)/'entitlements.plist'
        plist.write_bytes(plistlib.dumps(entitlements))
        run(['/usr/bin/codesign', '--force', '--sign', fingerprint,
             '--keychain', identity['keychain'], '--timestamp=none', '--options', 'runtime',
             '--entitlements', plist, '--requirements', '=designated => '+requirement, app])
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R', '='+requirement, app])
    return requirement
