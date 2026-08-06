"""
System-action tool — Phase 6c.

Allowlisted local-machine actions executed in Electron's main process
(not here). This module only defines the planner-facing ToolSpec
(kind=async_frontend, no execute) and shared argument validation.

Registration is gated by ENABLE_SYSTEM_ACTIONS (default off). The
desktop sidecar sets it to "1"; docker-compose must never set it.

Hard constraints (do not loosen):
  - action is a fixed enum
  - open_app target is a fixed enum of seeded app names (no free-text paths)
  - open_url target must be http(s) only
  - every call still requires human confirmation in the agent loop before
    the frontend/Electron may execute anything
"""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlparse

from app.services.agent_tools import ToolSpec, register_tool

# Keep in sync with desktop/lib/system-actions.js OPEN_APP_ALLOWLIST keys.
OPEN_APP_TARGETS = ("notepad", "calculator", "explorer", "browser")
ACTIONS = ("open_app", "lock_screen", "open_url")

ACTION_LABELS = {
    "open_app": "Open application",
    "lock_screen": "Lock the screen",
    "open_url": "Open URL in browser",
}

OPEN_APP_LABELS = {
    "notepad": "Notepad",
    "calculator": "Calculator",
    "explorer": "File Explorer",
    "browser": "Default browser",
}


def describe_system_action(action: str, target: Optional[str] = None) -> str:
    if action == "open_app":
        label = OPEN_APP_LABELS.get(target or "", target or "?")
        return f"Open {label}"
    if action == "lock_screen":
        return "Lock the Windows screen"
    if action == "open_url":
        return f"Open URL: {target or '?'}"
    return f"Unknown action: {action}"


def validate_system_action_args(args: dict) -> tuple[bool, Optional[str], dict]:
    """
    Returns (ok, error, normalized_args).
    Rejects anything outside the allowlist before a confirm card is shown.
    """
    action = (args.get("action") or "").strip()
    if action not in ACTIONS:
        return False, f"action must be one of {list(ACTIONS)}, got {action!r}", {}

    if action == "lock_screen":
        if (args.get("target") or "").strip():
            return False, "lock_screen accepts no parameters", {}
        return True, None, {"action": "lock_screen"}

    if action == "open_app":
        target = (args.get("target") or "").strip().lower()
        if target not in OPEN_APP_TARGETS:
            return (
                False,
                f"open_app target must be one of {list(OPEN_APP_TARGETS)}, got {target!r}",
                {},
            )
        return True, None, {"action": "open_app", "target": target}

    if action == "open_url":
        target = (args.get("target") or args.get("url") or "").strip()
        if not target:
            return False, "open_url requires target (http/https URL)", {}
        parsed = urlparse(target)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return False, "open_url target must be an http(s) URL", {}
        return True, None, {"action": "open_url", "target": target}

    return False, f"unsupported action {action!r}", {}


SYSTEM_ACTION_TOOL = ToolSpec(
    name="system_action",
    description=(
        "Request a pre-approved local desktop action. Every call requires the "
        "founder's explicit Allow click before anything runs. "
        "Actions: open_app (notepad|calculator|explorer|browser only — never "
        "arbitrary paths), lock_screen (no parameters), open_url (http/https URL). "
        "Use only when the founder clearly asks for one of these. Do not invent "
        "actions or app names outside the allowlist."
    ),
    kind="async_frontend",
    # Human may take a moment to read the confirm card.
    frontend_timeout_s=60.0,
    input_schema={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": list(ACTIONS),
                "description": "Which allowlisted action to request.",
            },
            "target": {
                "type": "string",
                "description": (
                    "For open_app: one of notepad|calculator|explorer|browser. "
                    "For open_url: an http(s) URL. "
                    "Omit for lock_screen."
                ),
            },
        },
        "required": ["action"],
        "additionalProperties": False,
    },
)


def register_system_action_tool() -> None:
    register_tool(SYSTEM_ACTION_TOOL)
