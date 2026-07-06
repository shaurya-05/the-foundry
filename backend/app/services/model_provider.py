"""
Model provider layer — Phase 1 of the agentic refactor.

Every model call in the app goes through this interface. Downstream code
does not know or care whether it's talking to Claude, GPT, Perplexity,
Gemini, or a self-hosted open model — the caller sees the same shape
(ModelProvider.complete(...) yielding ModelResponse chunks).

Why this exists:
    Today ai_router.py has four hand-written adapter functions
    (stream_strategic, stream_factual, stream_research, stream_document)
    each calling a different SDK. Swapping one for an open-model backend
    would require a rewrite in each caller. With this layer, swapping
    is a config change in MODEL_REGISTRY — same shape, different
    base_url + model.

Provider taxonomy:
    OpenAICompatibleProvider — handles anything on the OpenAI wire
        format: OpenAI itself, Perplexity, Gemini (via their
        OpenAI-compat endpoint), Together AI, Fireworks, and self-hosted
        vLLM. One class, N deployments.
    AnthropicProvider — Claude's SDK is not OpenAI-wire-compatible.

Interface (all providers implement this):
    async complete(messages, *, tools=None, stream=True, max_tokens,
                   timeout_s) -> AsyncIterator[ModelResponse]
        - Streams deltas as ModelResponse(content=<piece>).
        - Terminal yield has is_final=True and populated latency_ms
          (and tokens_in/out where the provider reports them).
        - On error, terminal yield has error=<str> and no content.

    async health_check() -> bool
        - Fast credential check. Does not hit the network in v1;
          admin dashboard in Phase 2 will add optional network probe.

Phase 1 scope: no tool-calling wiring yet — the `tools` argument is
accepted and ignored so the interface is stable when Phase 3 lands.
"""
from __future__ import annotations

import asyncio
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import structlog
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

log = structlog.get_logger()


# ─── Response shape ──────────────────────────────────────────────────────────


@dataclass
class ModelResponse:
    """
    One yielded chunk from a provider. Streamed responses yield many of
    these; the final one has is_final=True and populated metadata.
    """
    content: str = ""
    model_used: str = ""
    provider: str = ""
    is_final: bool = False
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    latency_ms: Optional[float] = None
    tool_calls: Optional[list[dict[str, Any]]] = None
    error: Optional[str] = None


# ─── Provider ABC ────────────────────────────────────────────────────────────


class ModelProvider(ABC):
    """
    Abstract provider. Concrete implementations must fill:
        - provider_name  (e.g. "anthropic", "openai", "perplexity")
        - model          (the specific model id passed on the wire)
        - complete(...)  the streaming call
        - health_check() a fast readiness probe
    """

    provider_name: str = ""
    model: str = ""

    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        tools: Optional[list[dict[str, Any]]] = None,
        stream: bool = True,
        max_tokens: int = 1200,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[ModelResponse]:
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        ...


# ─── OpenAI-wire-compatible provider ─────────────────────────────────────────


class OpenAICompatibleProvider(ModelProvider):
    """
    Speaks OpenAI Chat Completions wire format. Works with:
        - OpenAI itself             (base_url=None)
        - Perplexity                (base_url=https://api.perplexity.ai)
        - Gemini via OpenAI compat  (base_url=…/generativelanguage.googleapis.com/v1beta/openai/)
        - Together AI               (base_url=https://api.together.xyz/v1)
        - Fireworks                 (base_url=https://api.fireworks.ai/inference/v1)
        - Self-hosted vLLM          (base_url=http://host:port/v1)
    """

    def __init__(
        self,
        *,
        api_key_env: str,
        model: str,
        provider_name: str,
        base_url: Optional[str] = None,
    ):
        self._api_key_env = api_key_env
        self.model = model
        self.provider_name = provider_name
        self._base_url = base_url
        self._client: Optional[AsyncOpenAI] = None

    def _client_or_none(self) -> Optional[AsyncOpenAI]:
        if self._client is not None:
            return self._client
        api_key = os.getenv(self._api_key_env)
        if not api_key:
            return None
        # base_url can also be resolved at call time for slots whose
        # config isn't finalized (e.g. the OSS classifier).
        base_url = self._base_url or None
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=30.0)
        return self._client

    def is_configured(self) -> bool:
        return bool(os.getenv(self._api_key_env))

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        tools: Optional[list[dict[str, Any]]] = None,
        stream: bool = True,
        max_tokens: int = 1200,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[ModelResponse]:
        start = time.time()
        client = self._client_or_none()
        if client is None:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=f"{self._api_key_env} not set",
                latency_ms=(time.time() - start) * 1000,
            )
            return

        try:
            if stream:
                response = await client.chat.completions.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    stream=True,
                    messages=messages,
                    timeout=timeout_s,
                )
                async for chunk in response:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield ModelResponse(
                            content=delta,
                            model_used=self.model,
                            provider=self.provider_name,
                        )
                yield ModelResponse(
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    latency_ms=(time.time() - start) * 1000,
                )
            else:
                response = await client.chat.completions.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    stream=False,
                    messages=messages,
                    timeout=timeout_s,
                )
                text = response.choices[0].message.content or ""
                usage = getattr(response, "usage", None)
                yield ModelResponse(
                    content=text,
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    tokens_in=getattr(usage, "prompt_tokens", None) if usage else None,
                    tokens_out=getattr(usage, "completion_tokens", None) if usage else None,
                    latency_ms=(time.time() - start) * 1000,
                )
        except asyncio.TimeoutError:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error="timeout",
                latency_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            log.warning(
                "provider_error",
                provider=self.provider_name, model=self.model, error=str(e)[:200],
            )
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=f"{type(e).__name__}: {str(e)[:200]}",
                latency_ms=(time.time() - start) * 1000,
            )

    async def health_check(self) -> bool:
        # Credential-only check for now; a real network probe is added
        # by the admin health endpoint in Phase 2.
        return self.is_configured() and bool(self.model)


# ─── Anthropic provider ──────────────────────────────────────────────────────


class AnthropicProvider(ModelProvider):
    """
    Claude via the native Anthropic SDK. Not OpenAI-wire-compatible
    (system prompt is a separate field, tool-call schema differs), so
    it gets its own class. Same ModelResponse output as everyone else.
    """

    def __init__(self, *, model: str, provider_name: str = "anthropic"):
        self.model = model
        self.provider_name = provider_name
        self._client: Optional[AsyncAnthropic] = None

    def _client_or_none(self) -> Optional[AsyncAnthropic]:
        if self._client is not None:
            return self._client
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            return None
        self._client = AsyncAnthropic(api_key=api_key, timeout=30.0)
        return self._client

    def is_configured(self) -> bool:
        return bool(os.getenv("ANTHROPIC_API_KEY"))

    @staticmethod
    def _split_system(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
        """Anthropic takes `system` separately; extract it from messages."""
        system_parts: list[str] = []
        user_msgs: list[dict[str, str]] = []
        for m in messages:
            if m.get("role") == "system":
                system_parts.append(m.get("content", ""))
            else:
                user_msgs.append(m)
        return "\n\n".join(p for p in system_parts if p), user_msgs

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        tools: Optional[list[dict[str, Any]]] = None,
        stream: bool = True,
        max_tokens: int = 1200,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[ModelResponse]:
        start = time.time()
        client = self._client_or_none()
        if client is None:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error="ANTHROPIC_API_KEY not set",
                latency_ms=(time.time() - start) * 1000,
            )
            return

        system, user_msgs = self._split_system(messages)

        try:
            if stream:
                async with client.messages.stream(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=user_msgs,
                ) as stream_ctx:
                    async for text in stream_ctx.text_stream:
                        if text:
                            yield ModelResponse(
                                content=text,
                                model_used=self.model,
                                provider=self.provider_name,
                            )
                yield ModelResponse(
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    latency_ms=(time.time() - start) * 1000,
                )
            else:
                response = await client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=user_msgs,
                )
                text = response.content[0].text if response.content else ""
                usage = getattr(response, "usage", None)
                yield ModelResponse(
                    content=text,
                    model_used=self.model,
                    provider=self.provider_name,
                    is_final=True,
                    tokens_in=getattr(usage, "input_tokens", None) if usage else None,
                    tokens_out=getattr(usage, "output_tokens", None) if usage else None,
                    latency_ms=(time.time() - start) * 1000,
                )
        except asyncio.TimeoutError:
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error="timeout",
                latency_ms=(time.time() - start) * 1000,
            )
        except Exception as e:
            log.warning(
                "provider_error",
                provider=self.provider_name, model=self.model, error=str(e)[:200],
            )
            yield ModelResponse(
                model_used=self.model, provider=self.provider_name,
                is_final=True, error=f"{type(e).__name__}: {str(e)[:200]}",
                latency_ms=(time.time() - start) * 1000,
            )

    async def health_check(self) -> bool:
        return self.is_configured() and bool(self.model)


# ─── Registry ────────────────────────────────────────────────────────────────
# Config, not code. Swap a provider by swapping the value; downstream
# callers see no change.
#
# CLASSIFIER_OSS is a placeholder slot for Phase 4 (open-model track).
# Set OSS_CLASSIFIER_BASE_URL / OSS_CLASSIFIER_API_KEY / OSS_CLASSIFIER_MODEL
# when the fine-tuned open model is provisioned. Until then it stays
# unconfigured; is_configured() returns False so the A/B mechanism in
# Phase 4 won't route to it.

MODEL_REGISTRY: dict[str, ModelProvider] = {
    # Sonnet 4.6 is the current production Sonnet id. `claude-sonnet-4-20250514`
    # was deprecated and returns 404 on newer API keys — that was the smoking
    # gun for the "responses stop after first message" bug.
    "STRATEGIC": AnthropicProvider(model="claude-sonnet-4-6"),
    "FACTUAL": OpenAICompatibleProvider(
        api_key_env="OPENAI_API_KEY",
        model="gpt-4o-mini",
        provider_name="openai",
    ),
    "RESEARCH": OpenAICompatibleProvider(
        api_key_env="PERPLEXITY_API_KEY",
        model="sonar",
        provider_name="perplexity",
        base_url="https://api.perplexity.ai",
    ),
    "DOCUMENT": OpenAICompatibleProvider(
        api_key_env="GEMINI_API_KEY",
        model="gemini-1.5-flash",
        provider_name="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    ),
    "CLASSIFIER": AnthropicProvider(model="claude-haiku-4-5-20251001"),
    "CLASSIFIER_OSS": OpenAICompatibleProvider(
        api_key_env="OSS_CLASSIFIER_API_KEY",
        model=os.getenv("OSS_CLASSIFIER_MODEL", "unset-oss-model"),
        provider_name="oss",
        base_url=os.getenv("OSS_CLASSIFIER_BASE_URL"),
    ),
}


def get_provider(label: str) -> ModelProvider:
    """Fetch a provider by registry label. Raises KeyError on unknown label."""
    return MODEL_REGISTRY[label]


async def registry_health() -> dict[str, dict[str, Any]]:
    """Snapshot of every provider's readiness. Used by admin dashboard."""
    out: dict[str, dict[str, Any]] = {}
    for label, provider in MODEL_REGISTRY.items():
        try:
            ok = await provider.health_check()
        except Exception as e:
            ok = False
            note = str(e)[:120]
        else:
            note = None
        out[label] = {
            "provider": provider.provider_name,
            "model": provider.model,
            "healthy": ok,
            **({"note": note} if note else {}),
        }
    return out
