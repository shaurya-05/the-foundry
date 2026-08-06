"""Phase 6c — unit checks for allowlist validation + registration gating."""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_validate():
    from app.services.system_action_tool import validate_system_action_args

    ok, err, norm = validate_system_action_args({"action": "open_app", "target": "notepad"})
    assert ok and norm == {"action": "open_app", "target": "notepad"}, (ok, err, norm)

    ok, err, _ = validate_system_action_args({"action": "open_app", "target": "C:\\Windows\\System32\\cmd.exe"})
    assert not ok and err and ("must be one of" in err or "allowlist" in err.lower()), err

    ok, err, _ = validate_system_action_args({"action": "open_app", "target": "powershell"})
    assert not ok, err

    ok, err, _ = validate_system_action_args({"action": "lock_screen", "target": "x"})
    assert not ok and "no parameters" in (err or "").lower(), err

    ok, err, norm = validate_system_action_args({"action": "lock_screen"})
    assert ok and norm == {"action": "lock_screen"}, (ok, err, norm)

    ok, err, norm = validate_system_action_args({"action": "open_url", "target": "https://example.com/x"})
    assert ok and norm["target"] == "https://example.com/x"

    ok, err, _ = validate_system_action_args({"action": "open_url", "target": "file:///etc/passwd"})
    assert not ok, err

    ok, err, _ = validate_system_action_args({"action": "rm_rf", "target": "/"})
    assert not ok, err

    print("validate_ok")


def test_registration_gate():
    # Fresh registry simulation: import agent_tools then conditionally register
    os.environ["ENABLE_SYSTEM_ACTIONS"] = "0"
    from app.services import agent_tools

    # Clear any prior registration of system_action from other imports
    agent_tools.TOOL_REGISTRY.pop("system_action", None)

    flag = os.getenv("ENABLE_SYSTEM_ACTIONS", "0").lower()
    if flag not in ("0", "false", "no", "off", ""):
        from app.services import system_action_tool
        system_action_tool.register_system_action_tool()

    assert "system_action" not in agent_tools.TOOL_REGISTRY
    print("gate_off_ok")

    os.environ["ENABLE_SYSTEM_ACTIONS"] = "1"
    from app.services import system_action_tool
    system_action_tool.register_system_action_tool()
    assert "system_action" in agent_tools.TOOL_REGISTRY
    spec = agent_tools.TOOL_REGISTRY["system_action"]
    assert spec.kind == "async_frontend"
    assert spec.execute is None
    enum = spec.input_schema["properties"]["action"]["enum"]
    assert set(enum) == {"open_app", "lock_screen", "open_url"}
    print("gate_on_ok", enum)

    # Reset env
    os.environ["ENABLE_SYSTEM_ACTIONS"] = "0"
    agent_tools.TOOL_REGISTRY.pop("system_action", None)


def test_compose_clean():
    repo = ROOT.parent
    for name in ("docker-compose.yml", "docker-compose.local-prod.yml", "docker-compose.prod.yml"):
        path = repo / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        assert "ENABLE_SYSTEM_ACTIONS" not in text, name
    print("compose_clean_ok")


if __name__ == "__main__":
    test_validate()
    test_registration_gate()
    test_compose_clean()
    print("PHASE6C_BACKEND_OK")
