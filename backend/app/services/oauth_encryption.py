"""
OAuth token encryption.

Per the Phase 2 brief §4.1.2, third-party OAuth tokens (GitHub, Linear,
Notion) are stored encrypted at rest. The `oauth_connections` table
holds Fernet ciphertext only.

Key management:
    The Fernet key is read from the OAUTH_TOKEN_KEY env var. If unset
    in development, a deterministic warning key is used so engineers
    can run flows locally without ceremony — but production REFUSES to
    start without the env var (raises at first call).

Generate a production key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Then set in Railway:
    OAUTH_TOKEN_KEY=<the-44-char-base64-string>
"""
from __future__ import annotations

import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

# A clearly-fake dev key so misconfigured local environments don't blow up
# on every request, but production explicitly errors below.
_DEV_FALLBACK_KEY = b"vDoZRtAGCnSDVjLcwLLBxR2eSWcMcOXFcwGcRBxqkBI="  # 44-char base64, all zero entropy


class OAuthEncryptionError(RuntimeError):
    """Raised when encryption is misconfigured or ciphertext is invalid."""


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    raw = os.getenv("OAUTH_TOKEN_KEY")
    env = (os.getenv("ENVIRONMENT") or "development").lower()
    if not raw:
        if env == "production":
            raise OAuthEncryptionError(
                "OAUTH_TOKEN_KEY is unset in production. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\" and set it in Railway."
            )
        # Dev fallback — emits a clear notice in logs at first use.
        import structlog

        structlog.get_logger().warning(
            "oauth_encryption_using_dev_key",
            message="OAUTH_TOKEN_KEY unset; using insecure dev key. Do not deploy.",
        )
        return Fernet(_DEV_FALLBACK_KEY)
    try:
        return Fernet(raw.encode() if isinstance(raw, str) else raw)
    except (ValueError, TypeError) as e:
        raise OAuthEncryptionError(
            f"OAUTH_TOKEN_KEY is malformed: {e}. Expected a 44-char base64 Fernet key."
        ) from e


def encrypt_token(plaintext: str) -> str:
    """Encrypt an OAuth access/refresh token for storage. Returns base64 text."""
    if not plaintext:
        raise OAuthEncryptionError("Cannot encrypt empty token")
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a token from `oauth_connections.access_token_encrypted`."""
    if not ciphertext:
        raise OAuthEncryptionError("Cannot decrypt empty ciphertext")
    try:
        return _get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        # Could be wrong key, tampered ciphertext, or corruption.
        raise OAuthEncryptionError("OAuth token decryption failed (invalid token)") from e


def is_configured() -> bool:
    """Returns True if a real (non-dev-fallback) key is configured."""
    return bool(os.getenv("OAUTH_TOKEN_KEY"))
