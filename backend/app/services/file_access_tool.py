"""
File-access tools — Phase 3, Stage 3. Second registered tool (after
memory), and the first async_frontend one actually wired end-to-end.

Both tools have kind="async_frontend" and no execute() at all -- there is
nothing for the backend to call. The real work happens in the browser
(frontend/lib/fileAccess.ts) against the FileSystemDirectoryHandle the
user granted; this module only defines what the planner sees (name,
description, input schema) so it can decide to use them. The actual
round-trip mechanics (create_pending_call/await_frontend_response) live
in agent_tools.py and are invoked by whatever calls these tools -- the
Stage-4 loop eventually, a test endpoint for now.

Read-only in this phase: there is no write/delete tool defined here, and
none of frontend/lib/fileAccess.ts's exports can modify a file either.
That's a phase-scope decision, not a gap to fill in later without
revisiting the constraint that put it there.
"""
from app.services.agent_tools import ToolSpec, register_tool

LIST_FILES_TOOL = ToolSpec(
    name="list_files",
    description=(
        "List the files and subfolders in the user's connected local folder "
        "(or a subfolder of it). Returns names, types, and sizes only -- not "
        "file content. Use this to find a relevant file before reading it."
    ),
    kind="async_frontend",
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path relative to the connected folder's root. Empty string or omitted lists the root itself.",
            },
        },
    },
)

READ_FILE_TOOL = ToolSpec(
    name="read_file",
    description=(
        "Read the full text content of one specific file in the user's "
        "connected local folder. Read-only -- this cannot modify, create, "
        "or delete anything on the user's filesystem."
    ),
    kind="async_frontend",
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to the file, relative to the connected folder's root.",
            },
        },
        "required": ["path"],
    },
)

register_tool(LIST_FILES_TOOL)
register_tool(READ_FILE_TOOL)
