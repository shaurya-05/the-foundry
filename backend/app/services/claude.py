import anthropic
import os
from typing import AsyncGenerator

client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

MODEL = "claude-sonnet-4-5"

async def stream_claude(
    system: str,
    user: str,
    max_tokens: int = 1500,
) -> AsyncGenerator[str, None]:
    """Stream Claude response as text chunks."""
    async with client.messages.stream(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        async for text in stream.text_stream:
            yield text

async def complete_claude(
    system: str,
    user: str,
    max_tokens: int = 800,
) -> str:
    """Non-streaming Claude call, returns full text."""
    message = await client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return message.content[0].text

async def stream_sse(
    system: str,
    user: str,
    max_tokens: int = 1500,
) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted strings for FastAPI StreamingResponse."""
    import json
    async for text in stream_claude(system, user, max_tokens):
        payload = json.dumps({"type": "text_delta", "text": text})
        yield f"data: {payload}\n\n"
    yield "data: {\"type\": \"done\"}\n\n"
