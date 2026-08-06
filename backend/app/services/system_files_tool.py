"""
Real, direct filesystem access for H3RO -- distinct from
file_access_tool.py's browser-mediated list_files/read_file, which stays
in place unchanged for users who prefer the browser's own File System
Access API picker. This is the backend reading disk directly, through a
read-only Docker bind mount (see docker-compose.local-prod.yml), for
users who explicitly chose full system access over the browser's
sandboxed grant.

No API keys, no external service -- this is plain local disk I/O against
the mounted path, deliberately kept that way ("least amount of APIs").

Security model, stated plainly rather than assumed: the mount is scoped
to the user's own home directory, not the whole C: drive, and mounted
:ro so the container cannot write or delete regardless of what this
tool's own checks do. On top of that structural guarantee, this module
adds:
  - path containment (every resolved path must stay under the mount root)
  - a denylist for dotfiles/dotfolders and other credential-shaped paths
  - a size cap on reads

What this does NOT do: restrict which network path (local vs the public
Cloudflare Tunnel) can reach this tool. That's not reliably enforceable
here -- cloudflared proxies every tunneled request to localhost, so the
backend cannot distinguish "came in locally" from "came in through the
tunnel" by connection origin alone. The tool call itself still requires
a valid authenticated session (same as every other tool), so this isn't
reachable by an unauthenticated stranger; the realistic residual risk is
the authenticated user's own H3RO being tricked (e.g. via a prompt
injection in a web_search result) into reading something it shouldn't --
which is exactly what the denylist below is for.
"""
import os

import structlog

from app.services.agent_tools import ToolContext, ToolResult, ToolSpec, register_tool

log = structlog.get_logger()

SYSTEM_FS_ROOT = "/host_fs"
MAX_READ_BYTES = 2 * 1024 * 1024  # 2MB -- generous for real docs/code, not a bulk-dump vector
MAX_LIST_ENTRIES = 500

# Case-insensitive top-level-name denylist for known credential-shaped
# directories, on top of the blanket dotfile/dotfolder rule below.
# AppData alone holds browser cookie/credential stores, saved app tokens,
# and crypto-wallet files for effectively every installed application --
# blocked outright rather than trying to enumerate what's sensitive inside it.
_DENYLISTED_NAMES = {"appdata"}


def _is_denylisted(name: str) -> bool:
    return name.startswith(".") or name.lower() in _DENYLISTED_NAMES


def _resolve_safe(rel_path: str) -> "tuple[str, str] | tuple[None, str]":
    """Returns (absolute_path, None) or (None, error_message)."""
    rel_path = (rel_path or "").strip().lstrip("/\\")
    candidate = os.path.realpath(os.path.join(SYSTEM_FS_ROOT, rel_path))
    root = os.path.realpath(SYSTEM_FS_ROOT)
    if candidate != root and not candidate.startswith(root + os.sep):
        return None, "path escapes the granted directory"
    for part in os.path.relpath(candidate, root).split(os.sep):
        if part and part != "." and _is_denylisted(part):
            return None, f"access to {part!r} is not permitted"
    return candidate, None


async def _system_file_list_execute(args: dict, ctx: ToolContext) -> ToolResult:
    path, err = _resolve_safe(args.get("path", ""))
    if err:
        return ToolResult(success=False, error=err)
    if not os.path.isdir(path):
        return ToolResult(success=False, error="not a directory")
    try:
        entries = []
        with os.scandir(path) as it:
            for entry in it:
                if _is_denylisted(entry.name):
                    continue
                try:
                    is_dir = entry.is_dir()
                    size = None if is_dir else entry.stat().st_size
                except OSError:
                    continue
                entries.append({"name": entry.name, "is_dir": is_dir, "size": size})
                if len(entries) >= MAX_LIST_ENTRIES:
                    break
        entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
        return ToolResult(success=True, content=entries)
    except OSError as e:
        return ToolResult(success=False, error=f"could not list directory: {e}")


async def _system_file_read_execute(args: dict, ctx: ToolContext) -> ToolResult:
    path, err = _resolve_safe(args.get("path", ""))
    if err:
        return ToolResult(success=False, error=err)
    if not os.path.isfile(path):
        return ToolResult(success=False, error="not a file")
    try:
        size = os.path.getsize(path)
        if size > MAX_READ_BYTES:
            return ToolResult(success=False, error=f"file too large ({size} bytes, limit {MAX_READ_BYTES})")
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        log.info("system_file_read", workspace_id=ctx.workspace_id, path=args.get("path", ""))
        return ToolResult(success=True, content=content)
    except OSError as e:
        return ToolResult(success=False, error=f"could not read file: {e}")


SYSTEM_FILE_LIST_TOOL = ToolSpec(
    name="system_file_list",
    description=(
        "List files and folders directly on the founder's real computer, under their "
        "home directory (Desktop, Documents, Downloads, etc.) -- granted only when the "
        "founder chose full system access. Returns names, types, and sizes, not content. "
        "Some paths (dotfiles/dotfolders, AppData) are not accessible and will error if tried."
    ),
    kind="sync",
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path relative to the user's home directory. Empty lists the home directory itself.",
            },
        },
    },
    execute=_system_file_list_execute,
)

SYSTEM_FILE_READ_TOOL = ToolSpec(
    name="system_file_read",
    description=(
        "Read a file's real content directly from the founder's computer -- granted only "
        "when the founder chose full system access, as an alternative to the browser-granted "
        "read_file tool. Text files only, 2MB max. Some paths (dotfiles/dotfolders, AppData) "
        "are not accessible and will error if tried."
    ),
    kind="sync",
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to the file, relative to the user's home directory.",
            },
        },
        "required": ["path"],
    },
    execute=_system_file_read_execute,
)

register_tool(SYSTEM_FILE_LIST_TOOL)
register_tool(SYSTEM_FILE_READ_TOOL)
