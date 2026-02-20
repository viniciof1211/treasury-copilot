"""OpenRouter LLM with automatic free-tier fallback.

When the primary model fails (credits exhausted, rate-limited, 4xx/5xx),
the wrapper transparently retries with the next free model in the same
capability tier.  Uses LangChain's native `with_fallbacks()` so that
bind_tools, streaming, and all other ChatOpenAI features work seamlessly.

Tiers (Feb 2026):
  - "reasoning"  : heavy agentic / tool-use workloads
  - "coding"     : code generation, analytics
  - "lightweight": small / fast tasks
"""

import os
import time
import logging
import threading
from typing import Optional, List, Dict, Any

from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Free-tier fallback chains per capability tier
# ---------------------------------------------------------------------------
FALLBACK_CHAINS: Dict[str, List[str]] = {
    "reasoning": [
        "deepseek/deepseek-r1:free",                  # 128K ctx, strong reasoning
        "google/gemini-2.0-flash-exp:free",            # 1M ctx, agentic workflows
        "meta-llama/llama-3.3-70b:free",               # general purpose
    ],
    "coding": [
        "google/gemini-2.0-flash-exp:free",            # 1M ctx, good at code
        "deepseek/deepseek-r1:free",                   # 128K ctx, reasoning+code
        "meta-llama/llama-3.3-70b:free",               # general purpose
    ],
    "lightweight": [
        "google/gemini-2.5-flash-image-preview:free",  # fast multimodal
        "google/gemini-2.0-flash-exp:free",            # 1M ctx
        "meta-llama/llama-3.3-70b:free",               # general purpose
    ],
}

# Map primary models → capability tier for automatic tier detection
MODEL_TIER_MAP: Dict[str, str] = {
    "gpt-oss-120b":           "reasoning",
    "openai/gpt-4o-mini":     "lightweight",
    "openai/gpt-4o":          "reasoning",
    "x-ai/grok-3-mini-beta":  "reasoning",
    "anthropic/claude-3.5-sonnet": "reasoning",
}

# ---------------------------------------------------------------------------
# Global fallback tracking (for health/status endpoints)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_fallback_active: bool = False
_fallback_model: Optional[str] = None
_fallback_tier: Optional[str] = None
_fallback_activated_at: float = 0.0
_FALLBACK_TTL_SECONDS: float = 2 * 60 * 60  # 2 hours


def _get_tier(model_name: str) -> str:
    """Resolve the capability tier for a model."""
    return MODEL_TIER_MAP.get(model_name, "reasoning")


def get_fallback_status() -> Dict[str, Any]:
    """Return current fallback state for health endpoints."""
    with _lock:
        remaining = 0.0
        if _fallback_active and _fallback_activated_at:
            elapsed = time.time() - _fallback_activated_at
            remaining = max(0, _FALLBACK_TTL_SECONDS - elapsed)
        return {
            "fallback_active": _fallback_active,
            "fallback_model": _fallback_model,
            "fallback_tier": _fallback_tier,
            "fallback_remaining_seconds": round(remaining),
        }


# ---------------------------------------------------------------------------
# LLM builder helpers
# ---------------------------------------------------------------------------

def _build_openrouter_llm(
    model: str,
    temperature: float = 0.1,
    max_tokens: int = 4096,
    streaming: bool = True,
) -> ChatOpenAI:
    """Build a single ChatOpenAI instance pointing at OpenRouter."""
    return ChatOpenAI(
        model=model,
        openai_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        openai_api_base="https://openrouter.ai/api/v1",
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
    )


# ---------------------------------------------------------------------------
# Internal: resolve model + tier defaults
# ---------------------------------------------------------------------------

def _resolve_defaults(primary_model, tier):
    if primary_model is None:
        primary_model = os.environ.get("OPENROUTER_MODEL", "gpt-oss-120b")
    if tier is None:
        tier = _get_tier(primary_model)
    return primary_model, tier


# ---------------------------------------------------------------------------
# Factory — plain LLM with fallbacks (no tools)
# ---------------------------------------------------------------------------

def create_fallback_llm(
    primary_model: Optional[str] = None,
    tier: Optional[str] = None,
    temperature: float = 0.1,
    max_tokens: int = 4096,
    streaming: bool = True,
):
    """Create a ChatOpenAI with automatic free-tier fallback chain.

    Returns primary_llm.with_fallbacks([...]) — a RunnableWithFallbacks.
    Use `create_fallback_llm_with_tools()` if you need `.bind_tools()`.
    """
    primary_model, tier = _resolve_defaults(primary_model, tier)

    primary_llm = _build_openrouter_llm(
        model=primary_model,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
    )

    chain = FALLBACK_CHAINS.get(tier, FALLBACK_CHAINS["reasoning"])
    fallback_llms = [
        _build_openrouter_llm(
            model=fb_model,
            temperature=temperature,
            max_tokens=max_tokens,
            streaming=False,
        )
        for fb_model in chain
    ]

    if not fallback_llms:
        return primary_llm

    logger.info(
        "LLM created: primary=%s tier=%s fallbacks=%s",
        primary_model, tier, chain,
    )
    return primary_llm.with_fallbacks(fallback_llms)


# ---------------------------------------------------------------------------
# Factory — LLM with tools + fallbacks (bind_tools on each before chaining)
# ---------------------------------------------------------------------------

def create_fallback_llm_with_tools(
    tools: list,
    primary_model: Optional[str] = None,
    tier: Optional[str] = None,
    temperature: float = 0.1,
    max_tokens: int = 4096,
    streaming: bool = True,
):
    """Create a ChatOpenAI.bind_tools() chain with automatic fallback.

    Binds tools to *each* LLM individually, then chains them via
    with_fallbacks().  This is necessary because RunnableWithFallbacks
    does not expose bind_tools().

    Returns a Runnable that can be used directly in LangGraph nodes.
    """
    primary_model, tier = _resolve_defaults(primary_model, tier)

    primary_llm = _build_openrouter_llm(
        model=primary_model,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
    ).bind_tools(tools)

    chain = FALLBACK_CHAINS.get(tier, FALLBACK_CHAINS["reasoning"])
    fallback_llms = [
        _build_openrouter_llm(
            model=fb_model,
            temperature=temperature,
            max_tokens=max_tokens,
            streaming=False,
        ).bind_tools(tools)
        for fb_model in chain
    ]

    if not fallback_llms:
        return primary_llm

    logger.info(
        "LLM+tools created: primary=%s tier=%s fallbacks=%s tools=%d",
        primary_model, tier, chain, len(tools),
    )
    return primary_llm.with_fallbacks(fallback_llms)
