"""Email service using Resend. Falls back to console logging if RESEND_API_KEY is not set."""
import os
import structlog

log = structlog.get_logger()

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
FROM_EMAIL = os.getenv("EMAIL_FROM", "The FOUND3RY <noreply@foundry.dev>")

_client = None

def _get_client():
    global _client
    if _client is None and RESEND_API_KEY:
        import resend
        resend.api_key = RESEND_API_KEY
        _client = resend
    return _client


async def send_verification_email(to: str, token: str):
    link = f"{FRONTEND_URL}/verify-email?token={token}"
    subject = "Verify your email — The FOUND3RY"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="color:#0A0C12">Welcome to The FOUND3RY</h2>
        <p style="color:#374151">Click below to verify your email address:</p>
        <a href="{link}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#E8231F,#C81E1C);color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            Verify Email
        </a>
        <p style="color:#9CA3AF;font-size:13px;margin-top:24px">Or copy this link: {link}</p>
        <p style="color:#9CA3AF;font-size:12px">This link expires in 24 hours.</p>
    </div>
    """
    await _send(to, subject, html, "verification")


async def send_password_reset_email(to: str, token: str):
    link = f"{FRONTEND_URL}/reset-password?token={token}"
    subject = "Reset your password — The FOUND3RY"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="color:#0A0C12">Password Reset</h2>
        <p style="color:#374151">Click below to reset your password:</p>
        <a href="{link}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#E8231F,#C81E1C);color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            Reset Password
        </a>
        <p style="color:#9CA3AF;font-size:13px;margin-top:24px">Or copy this link: {link}</p>
        <p style="color:#9CA3AF;font-size:12px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    </div>
    """
    await _send(to, subject, html, "password_reset")


async def send_workspace_invite_email(to: str, token: str, workspace_name: str, invited_by: str):
    link = f"{FRONTEND_URL}/join?token={token}"
    subject = f"You're invited to {workspace_name} — The FOUND3RY"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="color:#0A0C12">You're invited!</h2>
        <p style="color:#374151"><strong>{invited_by}</strong> invited you to join <strong>{workspace_name}</strong> on The FOUND3RY.</p>
        <a href="{link}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#E8231F,#C81E1C);color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            Accept Invitation
        </a>
        <p style="color:#9CA3AF;font-size:13px;margin-top:24px">Or copy this link: {link}</p>
        <p style="color:#9CA3AF;font-size:12px">This invitation expires in 7 days.</p>
    </div>
    """
    await _send(to, subject, html, "workspace_invite")


async def _send(to: str, subject: str, html: str, email_type: str):
    client = _get_client()
    if client:
        try:
            client.Emails.send({
                "from": FROM_EMAIL,
                "to": [to],
                "subject": subject,
                "html": html,
            })
            log.info("email_sent", type=email_type, to=to)
        except Exception as e:
            log.error("email_send_failed", type=email_type, to=to, error=str(e))
    else:
        log.info("email_dev_mode", type=email_type, to=to, subject=subject,
                 message="No RESEND_API_KEY set — email logged instead of sent")
