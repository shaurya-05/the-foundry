"""JWT utilities and password hashing for THE FOUNDRY auth system."""
import os
from datetime import datetime, timedelta, timezone
import bcrypt
from jose import jwt, JWTError  # python-jose[cryptography] already in requirements

SECRET_KEY = os.getenv("JWT_SECRET", "change_me_in_production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # short-lived access token
REFRESH_TOKEN_EXPIRE_DAYS = 30

if SECRET_KEY == "change_me_in_production":
    import warnings
    warnings.warn(
        "JWT_SECRET is using the default value! Set a strong secret via environment variable.",
        stacklevel=2,
    )


def hash_password(password: str) -> str:
    """Bcrypt hash with automatic salt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, stored: str) -> bool:
    """Verify against bcrypt hash. Also supports legacy SHA-256 format for migration."""
    try:
        # New bcrypt format (starts with $2b$)
        if stored.startswith("$2b$") or stored.startswith("$2a$"):
            return bcrypt.checkpw(password.encode(), stored.encode())
        # Legacy SHA-256 format: salt:hash — verify and signal for re-hash
        import hashlib
        salt, h = stored.split(":", 1)
        return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest() == h
    except Exception:
        return False


def needs_rehash(stored: str) -> bool:
    """Check if password hash uses legacy format and needs bcrypt upgrade."""
    return not (stored.startswith("$2b$") or stored.startswith("$2a$"))


def create_token(user_id: str, workspace_id: str, email: str) -> str:
    """Create a short-lived access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "workspace_id": workspace_id, "email": email, "exp": expire, "type": "access"},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def create_refresh_token(user_id: str, workspace_id: str, email: str) -> str:
    """Create a long-lived refresh token."""
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "workspace_id": workspace_id, "email": email, "exp": expire, "type": "refresh"},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_token(token: str, expected_type: str = "access") -> dict:
    """Raises JWTError if invalid, expired, or wrong type."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type", "access") != expected_type:
        raise JWTError(f"Expected {expected_type} token")
    return payload
