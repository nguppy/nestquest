"""Safety checks that run in plain Python, before and after the model.

1. screen_text(): catches prompt-injection attempts in anything the user types
   (project notes, chat messages) before it reaches an agent.
2. unverified_amounts(): finds dollar amounts in an agent's answer that the
   cost calculator never produced, so an agent cannot invent a price.
"""

from __future__ import annotations

import re

INJECTION_PATTERNS = [
    r"ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|prompts?|directions)",
    r"disregard\s+(all\s+|the\s+|your\s+)?(previous|prior|above|system)?\s*(instructions|rules|prompt)",
    r"forget\s+(everything|all|your)\s+(you|instructions|rules)",
    r"(reveal|show|print|repeat|leak|output)\s+(me\s+)?(your|the)\s+(system\s+|hidden\s+|initial\s+)?(prompt|instructions|rules)",
    r"system\s+prompt",
    r"you\s+are\s+now\s+(a|an|in)\b",
    r"\b(developer|dan|god|jailbreak)\s+mode\b",
    r"\bjailbreak\b",
    r"(api|secret|portkey|openai)[\s_-]*(key|token)",
    r"\.env\b",
    r"<\|?(system|im_start|endoftext)\|?>",
    r"\[\s*(system|inst)\s*\]",
    r"pretend\s+(to\s+be|you\s+are)",
    r"(set|make|change)\s+(the\s+)?(price|cost|total|estimate)s?\s+(to|=)\s*\$?\d",
]
_INJECTION = re.compile("|".join(f"(?:{p})" for p in INJECTION_PATTERNS), re.IGNORECASE)


def screen_text(text: str) -> tuple[str, list[str]]:
    """Split text into sentences; drop the ones that look like injected instructions.

    Returns (clean_text, removed_sentences).
    """
    if not text.strip():
        return "", []
    sentences = re.split(r"(?<=[.!?\n])\s+", text.strip())
    keep, removed = [], []
    for s in sentences:
        (removed if _INJECTION.search(s) else keep).append(s.strip())
    return " ".join(k for k in keep if k), [r for r in removed if r]


def is_injection(text: str) -> bool:
    return bool(_INJECTION.search(text))


# ---------------------------------------------------------------- invented numbers

_MONEY = re.compile(r"\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|K|m|M|million|thousand)?")


def dollar_amounts(text: str) -> list[float]:
    out = []
    for num, suffix in _MONEY.findall(text):
        v = float(num.replace(",", ""))
        if suffix in ("k", "K", "thousand"):
            v *= 1_000
        elif suffix in ("m", "M", "million"):
            v *= 1_000_000
        out.append(v)
    return out


def unverified_amounts(text: str, allowed: set[float]) -> list[float]:
    """Dollar amounts in text that don't match (within rounding) any computed number.

    Small amounts (under $100, e.g. "$240 per sq ft" rounded) must match within $3;
    larger ones within 2% or $1,500, which covers "$412k" style rounding.
    """
    bad = []
    for v in dollar_amounts(text):
        tol = 3 if v < 100 else max(1_500, 0.02 * v)
        if not any(abs(v - a) <= tol for a in allowed):
            bad.append(v)
    return bad


def allowed_amounts(evaluations: list[dict], budget: float) -> set[float]:
    """Every dollar figure NestQuest computed, plus gaps to the budget and between options."""
    vals: set[float] = {budget}
    totals = []
    for ev in evaluations:
        c = ev["cost"]
        for k in ("cost_per_sqft", "house", "garage", "builder_overhead_profit", "contingency", "land", "total"):
            vals.add(c[k])
        vals.update(f["cost"] for f in c["features"])
        vals.update(abs(f["cost"]) for f in c.get("interior", []) + c.get("site_work", []))
        vals.update(ph["cost"] for ph in c["house_phases"])
        vals.add(abs(c["total"] - budget))
        totals.append(c["total"])
    for a in totals:
        for b in totals:
            vals.add(abs(a - b))
    return {v for v in vals if v}
