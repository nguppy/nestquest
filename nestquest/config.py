"""Model, key and budget settings shared by every NestQuest agent.

NestQuest uses ONE model, gpt-6-luna, reached through the Portkey gateway with
the course key PORTKEY_API_KEY. This is the only place a model is configured:
every agent calls build_model(), so no agent can drift onto another model.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic_ai.usage import UsageLimits

PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = PACKAGE_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
PROMPTS_DIR = PACKAGE_DIR / "prompts"

# The .env lives in the repo folder, or one folder above it (where the teaching
# staff keep theirs). load_dotenv never overrides a value that is already set,
# so the repo's own .env wins when both exist.
for folder in (PROJECT_DIR, PROJECT_DIR.parent):
    if (folder / ".env").is_file():
        load_dotenv(folder / ".env")

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

MODEL_NAME = "gpt-6-luna"  # fixed: the course key allows this model only
PORTKEY_BASE_URL = "https://api.portkey.ai/v1"

# gpt-6-luna list prices in USD per 1M tokens (OpenAI model page, via genai-prices).
PRICE_PER_MTOK = {"input": 0.10, "cached_input": 0.01, "output": 0.50}

# Spending caps. One planning run (all agents together) and one refinement turn
# each get their own budget; a run that hits the cap stops with a clear message.
PLAN_LIMITS = UsageLimits(request_limit=16, total_tokens_limit=120_000)
REFINE_LIMITS = UsageLimits(request_limit=8, total_tokens_limit=60_000)
# Session-wide cap: after this many tokens a browser session must start over.
SESSION_TOKEN_CAP = 400_000


class MissingKeyError(RuntimeError):
    pass


def require_api_key() -> str:
    key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not key:
        raise MissingKeyError(
            "PORTKEY_API_KEY is missing. Put it in a .env file in this folder "
            "or in the folder above it (see .env.example)."
        )
    return key


@lru_cache(maxsize=1)
def build_model():
    """gpt-6-luna via Portkey's OpenAI-compatible Responses API."""
    from openai import AsyncOpenAI
    from pydantic_ai.models.openai import OpenAIResponsesModel
    from pydantic_ai.providers.openai import OpenAIProvider

    key = require_api_key()
    client = AsyncOpenAI(
        base_url=PORTKEY_BASE_URL,
        api_key=key,
        default_headers={"x-portkey-api-key": key},
        timeout=120,
    )
    return OpenAIResponsesModel(MODEL_NAME, provider=OpenAIProvider(openai_client=client))


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()


def usd_cost(input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    """Dollar cost of a run. input_tokens includes the cached ones."""
    fresh = max(input_tokens - cached_tokens, 0)
    return (
        fresh * PRICE_PER_MTOK["input"]
        + cached_tokens * PRICE_PER_MTOK["cached_input"]
        + output_tokens * PRICE_PER_MTOK["output"]
    ) / 1_000_000
