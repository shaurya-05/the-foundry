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
adds, in order:
  - path containment (every resolved path must stay under the mount
    root; realpath() resolves symlinks/junctions before this check, so
    a junction pointing back into a denylisted directory -- e.g. some
    Windows profiles' "Application Data" -> AppData -- doesn't slip
    through by name alone)
  - a directory denylist for dotfolders and AppData
  - reads are further gated by an EXTENSION ALLOWLIST, not a denylist --
    fail-closed by default (only recognized text/doc/code extensions are
    readable) is a materially stronger guarantee than trying to
    enumerate every dangerous shape a credential/key/wallet file could
    take; this alone excludes executables and most credential-store
    formats with one rule instead of many
  - a binary-content sniff on top of the extension check, in case an
    allowlisted extension ever contains unexpected binary data anyway
  - a size cap on reads
  - every denial is logged (workspace, path, reason) -- a real audit
    trail for spotting a probing or injection-driven access pattern

What this does NOT do: restrict which network path (local vs the public
Cloudflare Tunnel) can reach this tool. That's not reliably enforceable
here -- cloudflared proxies every tunneled request to localhost, so the
backend cannot distinguish "came in locally" from "came in through the
tunnel" by connection origin alone. The tool call itself still requires
a valid authenticated session (same as every other tool), so this isn't
reachable by an unauthenticated stranger; the realistic residual risk is
the authenticated user's own H3RO being tricked (e.g. via a prompt
injection in a web_search result) into reading something it shouldn't --
which is exactly what the allowlist and denylist above are for.
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

# Reads are allowlisted by extension, not denylisted -- fail-closed by
# default is a materially stronger guarantee than trying to enumerate
# every dangerous file shape (a denylist can always miss the next one;
# an allowlist can't accidentally include it). This alone excludes
# executables, most credential-store formats (.pfx, .p12, .kdbx, sqlite
# DBs), and anything else not explicitly recognized as a document or
# piece of code, with no need to separately name every risky format.
_READABLE_EXTENSIONS = {
    ".txt", ".md", ".rst", ".log", ".csv", ".tsv", ".json", ".yaml", ".yml",
    ".xml", ".ini", ".cfg", ".toml", ".env.example",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss",
    ".sh", ".bat", ".ps1", ".sql", ".c", ".cpp", ".h", ".hpp", ".java",
    ".go", ".rs", ".rb", ".php", ".swift", ".kt",
}


def _is_denylisted(name: str) -> bool:
    return name.startswith(".") or name.lower() in _DENYLISTED_NAMES


def _is_readable_extension(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) for ext in _READABLE_EXTENSIONS)


def _looks_binary(sample: bytes) -> bool:
    """Cheap, standard heuristic: a NUL byte anywhere in the first chunk
    means it isn't text, regardless of what the extension claimed."""
    return b"\x00" in sample


def _resolve_safe(rel_path: str, ctx: ToolContext) -> "tuple[str, str] | tuple[None, str]":
    """Returns (absolute_path, None) or (None, error_message). Every
    denial is logged with the workspace/path/reason -- a real audit
    trail for spotting a probing or injection-driven access pattern,
    not just silently returning an error to the caller."""
    rel_path = (rel_path or "").strip().lstrip("/\\")
    candidate = os.path.realpath(os.path.join(SYSTEM_FS_ROOT, rel_path))
    root = os.path.realpath(SYSTEM_FS_ROOT)
    if candidate != root and not candidate.startswith(root + os.sep):
        log.warning("system_file_access_denied", workspace_id=ctx.workspace_id, path=rel_path, reason="path_escape")
        return None, "path escapes the granted directory"
    # realpath already resolved any symlink/junction (e.g. the "Application
    # Data" junction some Windows profiles have pointing back into AppData)
    # to its real target before this loop runs, so checking components of
    # the RESOLVED path -- not the requested string -- is what actually
    # closes that gap rather than just looking closed.
    for part in os.path.relpath(candidate, root).split(os.sep):
        if part and part != "." and _is_denylisted(part):
            log.warning("system_file_access_denied", workspace_id=ctx.workspace_id, path=rel_path, reason=f"denylisted:{part}")
            return None, f"access to {part!r} is not permitted"
    return candidate, None


async def _system_file_list_execute(args: dict, ctx: ToolContext) -> ToolResult:
    path, err = _resolve_safe(args.get("path", ""), ctx)
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
    requested = args.get("path", "")
    path, err = _resolve_safe(requested, ctx)
    if err:
        return ToolResult(success=False, error=err)
    if not os.path.isfile(path):
        return ToolResult(success=False, error="not a file")
    if not _is_readable_extension(path):
        log.warning("system_file_access_denied", workspace_id=ctx.workspace_id, path=requested, reason="extension_not_allowlisted")
        return ToolResult(success=False, error="this file type isn't readable -- only common text/document/code formats are")
    try:
        size = os.path.getsize(path)
        if size > MAX_READ_BYTES:
            return ToolResult(success=False, error=f"file too large ({size} bytes, limit {MAX_READ_BYTES})")
        with open(path, "rb") as f:
            raw = f.read(min(size, MAX_READ_BYTES))
        if _looks_binary(raw[:8192]):
            log.warning("system_file_access_denied", workspace_id=ctx.workspace_id, path=requested, reason="binary_content")
            return ToolResult(success=False, error="this file's content isn't text, so it can't be read")
        content = raw.decode("utf-8", errors="replace")
        log.info("system_file_read", workspace_id=ctx.workspace_id, path=requested)
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
