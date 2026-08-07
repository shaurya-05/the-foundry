"""
H3RO communication-style preferences (Phase 11).

Stored on users.preferences.h3ro_style (not agent_memory) so the preference
cannot fall out of memory_read's truncation window. Detection is a backend
post-turn hook — keyword pre-filter, then one CLASSIFIER-tier call, fail-closed.
No confirmation gate (same shape as conversation_digest appends).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

import structlog

from app.db.postgres import get_pool

log = structlog.get_logger()

VERBOSITY = ("concise", "moderate", "detailed")
TONE = ("casual", "neutral", "formal")
TECHNICAL_DEPTH = ("plain", "moderate", "technical")

DEFAULT_STYLE: dict[str, Any] = {
    "verbosity": "moderate",
    "tone": "neutral",
    "technical_depth": "moderate",
    "notes": None,
    "updated_at": None,
}

# Tight keyword pre-filter — only fire the classifier when the message
# plausibly contains style feedback. Weak content words (shorter/formal/…)
# alone are not enough; require a meta cue or a stronger style phrase.
_STYLE_HINT_RE = re.compile(
    r"(?i)\b("
    r"shorter|longer|concise|brief|verbose|"
    r"more\s+detail(?:ed)?|less\s+detail|in[\s-]?depth|too\s+long|too\s+short|"
    r"casual|formal|neutral|friendlier|more\s+professional|too\s+casual|too\s+formal|"
    r"too\s+technical|less\s+technical|more\s+technical|simpler|simplify|plain(?:er)?|"
    r"from\s+now\s+on|going\s+forward|"
    r"your\s+(?:answers|responses|style|replies)|"
    r"keep\s+(?:it\s+|them\s+|your\s+answers?\s+)?(?:short|brief|concise)|"
    r"be\s+more|talk\s+(?:like|to\s+me)"
    r")\b"
)

_STYLE_META_RE = re.compile(
    r"(?i)\b("
    r"from\s+now\s+on|going\s+forward|"
    r"your\s+(?:answers|responses|style|replies)|"
    r"keep\s+(?:it|them|your)|"
    r"be\s+more|talk\s+(?:like|to\s+me)|"
    r"too\s+(?:long|short|technical|casual|formal|verbose)|"
    r"h3ro"
    r")\b"
)

_STYLE_STRONG_RE = re.compile(
    r"(?i)\b("
    r"concise|verbose|verbosity|"
    r"more\s+detail(?:ed)?|less\s+detail|in[\s-]?depth|"
    r"too\s+technical|less\s+technical|more\s+technical|"
    r"friendlier|more\s+professional|plain(?:er)?\s+(?:english|language)"
    r")\b"
)

_CLASSIFIER_PROMPT = """You detect whether the founder is giving lasting feedback about how H3RO should communicate from now on (verbosity, tone, or technical depth).

Founder message:
\"\"\"{message}\"\"\"

Reply with ONLY a single JSON object, no markdown fences, no commentary. Schema:
{{
  "update": true or false,
  "verbosity": "concise" | "moderate" | "detailed" | null,
  "tone": "casual" | "neutral" | "formal" | null,
  "technical_depth": "plain" | "moderate" | "technical" | null,
  "notes": short string or null
}}

Dimension mapping (use exactly these):
- verbosity=concise ← shorter, brief, concise, less detail, keep answers short
- verbosity=detailed ← longer, more detail, in depth, more thorough
- tone=casual ← casual, friendlier, less formal
- tone=formal ← formal, more professional, less casual
- technical_depth=plain ← simpler, less technical, plain language
- technical_depth=technical ← more technical, deeper jargon OK

Rules:
- Set update=false if this is NOT durable style feedback about how H3RO talks (e.g. "shorter meeting agenda", "formal proposal draft", "more detail on this one answer only").
- When update=true, set ONLY the dimension(s) they clearly asked to change; leave others null.
- "keep answers shorter/concise" → verbosity=concise (NOT tone).
- notes: at most one short sentence capturing nuance, or null. Do not invent preferences they did not state.
- Enum values must match exactly. Invalid or ambiguous → update=false."""


def style_feedback_prefilter(message: str) -> bool:
    """Cheap keyword gate — True only if a CLASSIFIER call is worth making."""
    text = (message or "").strip()
    if not text or len(text) < 4:
        return False
    if not _STYLE_HINT_RE.search(text):
        return False
    # Avoid "shorter meeting" / "formal proposal" false positives.
    if _STYLE_META_RE.search(text) or _STYLE_STRONG_RE.search(text):
        return True
    return False


def normalize_style(raw: Any) -> dict[str, Any]:
    """Coerce stored JSON into a full style dict with safe defaults."""
    out = dict(DEFAULT_STYLE)
    if not isinstance(raw, dict):
        return out
    v = raw.get("verbosity")
    if v in VERBOSITY:
        out["verbosity"] = v
    t = raw.get("tone")
    if t in TONE:
        out["tone"] = t
    d = raw.get("technical_depth")
    if d in TECHNICAL_DEPTH:
        out["technical_depth"] = d
    notes = raw.get("notes")
    if isinstance(notes, str) and notes.strip():
        out["notes"] = notes.strip()[:240]
    else:
        out["notes"] = None
    ua = raw.get("updated_at")
    out["updated_at"] = ua if isinstance(ua, str) else None
    return out


def format_style_prompt_block(style: Optional[dict[str, Any]] = None) -> str:
    s = normalize_style(style or DEFAULT_STYLE)
    notes_bit = ""
    if s.get("notes"):
        notes_bit = f" Extra note from the founder: {s['notes']}."
    return (
        "Communication style for this founder, learned from their own feedback: "
        f"{s['verbosity']} answers, {s['tone']} tone, {s['technical_depth']} technical depth."
        f"{notes_bit} "
        "Follow this unless it would conflict with clarity, safety, or correctness."
    )


def _parse_prefs(raw: Any) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw) if raw.strip() else {}
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


async def get_user_h3ro_style(user_id: str) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT preferences FROM users WHERE id=$1", user_id)
    if not row:
        return dict(DEFAULT_STYLE)
    prefs = _parse_prefs(row.get("preferences") if isinstance(row, dict) else row["preferences"])
    return normalize_style(prefs.get("h3ro_style"))


async def set_user_h3ro_style(user_id: str, style: dict[str, Any]) -> dict[str, Any]:
    """Merge h3ro_style into users.preferences (replace whole preferences JSON)."""
    normalized = normalize_style(style)
    normalized["updated_at"] = datetime.now(timezone.utc).isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT preferences FROM users WHERE id=$1", user_id)
        prefs = _parse_prefs(row["preferences"] if row else None)
        prefs["h3ro_style"] = normalized
        await conn.execute(
            "UPDATE users SET preferences=$2::jsonb WHERE id=$1",
            user_id,
            json.dumps(prefs),
        )
    return normalized


async def clear_user_h3ro_style(user_id: str) -> dict[str, Any]:
    """Reset to defaults (writes explicit default object so Settings stays honest)."""
    return await set_user_h3ro_style(user_id, dict(DEFAULT_STYLE))


def _parse_classifier_json(text: str) -> Optional[dict]:
    raw = (text or "").strip()
    if not raw:
        return None
    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            return None
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


async def maybe_update_h3ro_style_from_message(user_id: str, user_message: str) -> Optional[dict[str, Any]]:
    """
    Post-turn hook: pre-filter → one CLASSIFIER call → fail-closed merge.
    Returns the new style dict if updated, else None.
    """
    if not style_feedback_prefilter(user_message):
        return None

    try:
        from app.services.model_provider import MODEL_REGISTRY

        provider = MODEL_REGISTRY.get("CLASSIFIER")
        if provider is None or not provider.is_configured():
            log.warning("h3ro_style_classifier_unavailable")
            return None

        prompt = _CLASSIFIER_PROMPT.format(message=(user_message or "")[:1500])
        messages = [{"role": "user", "content": prompt}]
        parts: list[str] = []
        async for chunk in provider.complete(
            messages, stream=False, max_tokens=180, timeout_s=20.0
        ):
            if chunk.error:
                log.warning("h3ro_style_classifier_error", error=chunk.error)
                return None
            if chunk.content:
                parts.append(chunk.content)
        parsed = _parse_classifier_json("".join(parts))
        if not parsed or parsed.get("update") is not True:
            log.info("h3ro_style_no_update", reason="declined_or_unparsed")
            return None

        current = await get_user_h3ro_style(user_id)
        changed = False
        v = parsed.get("verbosity")
        if v in VERBOSITY and v != current["verbosity"]:
            current["verbosity"] = v
            changed = True
        t = parsed.get("tone")
        if t in TONE and t != current["tone"]:
            current["tone"] = t
            changed = True
        d = parsed.get("technical_depth")
        if d in TECHNICAL_DEPTH and d != current["technical_depth"]:
            current["technical_depth"] = d
            changed = True
        notes = parsed.get("notes")
        if isinstance(notes, str) and notes.strip():
            note = notes.strip()[:240]
            if note != current.get("notes"):
                current["notes"] = note
                changed = True
        elif notes is None and "notes" in parsed and current.get("notes"):
            # Explicit null from classifier clears notes only when key present
            current["notes"] = None
            changed = True

        if not changed:
            log.info("h3ro_style_no_update", reason="no_valid_dimension_change")
            return None

        saved = await set_user_h3ro_style(user_id, current)
        log.info(
            "h3ro_style_updated",
            user_id=user_id,
            verbosity=saved["verbosity"],
            tone=saved["tone"],
            technical_depth=saved["technical_depth"],
        )
        return saved
    except Exception as e:
        log.warning("h3ro_style_update_failed", error=str(e)[:200])
        return None
