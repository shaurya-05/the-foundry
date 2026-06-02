"""
Stripe webhook diagnostic tests.

Run with:  python3 -m unittest tests.test_stripe_webhook -v
These tests use no real Stripe connection and no database.
They verify the webhook handler logic, signature verification, and
failure modes that would otherwise be silent.
"""
import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

TEST_WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests_only"


def _sign_payload(payload: str, secret: str, ts: int = None) -> str:
    """Reproduce Stripe's HMAC-SHA256 signature scheme."""
    if ts is None:
        ts = int(time.time())
    signed = f"{ts}.{payload}"
    mac = hmac.new(
        secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"t={ts},v1={mac}"


def _make_checkout_event(workspace_id: str = "ws-abc-123", plan_id: str = "pro") -> dict:
    return {
        "id": "evt_test_1",
        "object": "event",
        "api_version": "2023-10-16",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_1",
                "object": "checkout.session",
                "metadata": {
                    "workspace_id": workspace_id,
                    "plan_id": plan_id,
                },
                "subscription": "sub_test_1",
            }
        },
    }


class TestStripeBillingWebhookGuards(unittest.IsolatedAsyncioTestCase):
    """billing.py — /api/billing/webhook"""

    async def _call_handler(self, payload_dict: dict, secret: str, configured_secret: str):
        """Helper: call stripe_billing_webhook with a signed payload."""
        import stripe
        from fastapi import Request

        payload_str = json.dumps(payload_dict)
        sig = _sign_payload(payload_str, secret)

        mock_request = MagicMock(spec=Request)
        mock_request.body = AsyncMock(return_value=payload_str.encode())
        mock_request.headers = {"stripe-signature": sig}

        mock_settings = MagicMock()
        mock_settings.STRIPE_WEBHOOK_SECRET = configured_secret

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value="UPDATE 1")
        mock_pool = MagicMock()
        mock_pool.acquire = MagicMock(return_value=_async_ctx(mock_conn))

        with patch("app.routers.billing.settings", mock_settings), \
             patch("app.routers.billing.get_pool", AsyncMock(return_value=mock_pool)), \
             patch("app.routers.billing.cache_invalidate", AsyncMock()):
            from app.routers.billing import stripe_billing_webhook
            return await stripe_billing_webhook(mock_request), mock_conn

    async def test_missing_secret_returns_500(self):
        """Missing STRIPE_WEBHOOK_SECRET must raise — not silently succeed."""
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as ctx:
            await self._call_handler(_make_checkout_event(), TEST_WEBHOOK_SECRET, "")
        self.assertEqual(ctx.exception.status_code, 500)

    async def test_bad_signature_returns_400(self):
        """Wrong signature must return 400, not 200."""
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as ctx:
            await self._call_handler(
                _make_checkout_event(),
                secret="wrong_secret",
                configured_secret=TEST_WEBHOOK_SECRET,
            )
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_valid_checkout_upgrades_workspace(self):
        """Happy path: valid event must call UPDATE workspaces SET plan='growth'."""
        result, mock_conn = await self._call_handler(
            _make_checkout_event(workspace_id="ws-abc-123"),
            secret=TEST_WEBHOOK_SECRET,
            configured_secret=TEST_WEBHOOK_SECRET,
        )
        self.assertEqual(result, {"ok": True})
        mock_conn.execute.assert_called_once()
        call_args = mock_conn.execute.call_args
        self.assertIn("UPDATE workspaces", call_args[0][0])
        self.assertIn("growth", call_args[0][0])
        self.assertEqual(call_args[0][1], "ws-abc-123")

    async def test_missing_workspace_id_does_not_crash(self):
        """checkout.session.completed with no workspace_id must return 200 with warning — not crash."""
        event = _make_checkout_event()
        event["data"]["object"]["metadata"] = {}  # no workspace_id
        result, mock_conn = await self._call_handler(
            event,
            secret=TEST_WEBHOOK_SECRET,
            configured_secret=TEST_WEBHOOK_SECRET,
        )
        # Must not call DB update
        mock_conn.execute.assert_not_called()
        # Must warn, not crash
        self.assertIn("warning", result)


class TestStripeServiceHandleWebhook(unittest.IsolatedAsyncioTestCase):
    """stripe_service.py — handle_webhook"""

    async def test_missing_secret_raises_not_silently_returns(self):
        """STRIPE_WEBHOOK_SECRET unset must raise ValueError (→ 400 to Stripe), not return 200."""
        from app.services import stripe_service
        original = stripe_service.STRIPE_WEBHOOK_SECRET
        stripe_service.STRIPE_WEBHOOK_SECRET = ""
        try:
            with self.assertRaises(ValueError):
                await stripe_service.handle_webhook(b'{"type":"test"}', "t=1,v1=abc")
        finally:
            stripe_service.STRIPE_WEBHOOK_SECRET = original

    async def test_bad_signature_raises_value_error(self):
        """Invalid signature must raise ValueError (handler maps this to 400)."""
        from app.services import stripe_service
        original = stripe_service.STRIPE_WEBHOOK_SECRET
        stripe_service.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
        try:
            with self.assertRaises(ValueError):
                await stripe_service.handle_webhook(b'{"type":"test"}', "t=1,v1=badsig")
        finally:
            stripe_service.STRIPE_WEBHOOK_SECRET = original

    async def test_checkout_completed_calls_activate(self):
        """checkout.session.completed must call _activate_subscription with correct args."""
        from app.services import stripe_service

        event = _make_checkout_event(workspace_id="ws-xyz", plan_id="forge_team")
        payload_str = json.dumps(event)
        sig = _sign_payload(payload_str, TEST_WEBHOOK_SECRET)

        original = stripe_service.STRIPE_WEBHOOK_SECRET
        stripe_service.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
        try:
            with patch.object(stripe_service, "_activate_subscription", AsyncMock()) as mock_activate:
                await stripe_service.handle_webhook(payload_str.encode(), sig)
                mock_activate.assert_called_once_with("ws-xyz", "forge_team", "sub_test_1")
        finally:
            stripe_service.STRIPE_WEBHOOK_SECRET = original


class _async_ctx:
    """Minimal async context manager wrapping a mock connection."""
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *_):
        pass


if __name__ == "__main__":
    unittest.main()
