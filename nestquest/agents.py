"""The four NestQuest agents, all on gpt-6-luna via Portkey.

Intake    -> turns the form + notes into a project brief          (no tools)
Designer  -> proposes three homes, testing them with the tools    (site_rules, feature_catalog, evaluate_design)
Advisor   -> explains what each option can and cannot do          (no tools; numbers checked after)
Refiner   -> edits the chosen design from chat messages           (site_rules, feature_catalog, evaluate_design)
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

from pydantic_ai import Agent, ModelRetry, RunContext

from nestquest import tools
from nestquest.config import build_model, load_prompt
from nestquest.guard import allowed_amounts, unverified_amounts
from nestquest.models import (
    AdvisorReport, DesignOption, DesignSet, ProjectBrief, ProjectInput, RefinementReply,
)


@dataclass
class Deps:
    """Shared state for one run: the project and a live trace of what each agent did."""
    project: ProjectInput
    events: list[dict] = field(default_factory=list)
    allowed: set[float] = field(default_factory=set)  # dollar figures an agent may quote
    baseline: list[dict] = field(default_factory=list)  # refinement: the design before this edit
    agent: str = ""

    def log(self, kind: str, **data):
        self.events.append({"t": round(time.time(), 2), "agent": self.agent, "kind": kind, **data})


def _compact(ev: dict) -> dict:
    """What the agent sees from evaluate_design: just the numbers it needs."""
    c, s = ev["cost"], ev["sizing"]
    return {
        "total_cost": c["total"],
        "budget": None,
        "finished_sqft": s["finished_sqft"],
        "cost_per_sqft": c["cost_per_sqft"],
        "footprint": f'{s["total_width_ft"]:.0f} x {s["total_depth_ft"]:.0f} ft, garage {s["garage_placement"]}',
        "checks": [f'{x["status"].upper()}: {x["label"]} - {x["detail"]}' for x in ev["checks"]],
    }


# ---------------------------------------------------------------- shared tools

def site_rules(ctx: RunContext[Deps]) -> dict:
    """Buildable area of the user's lot after setbacks, the max footprint and the max stories."""
    env = tools.site_envelope(ctx.deps.project)
    ctx.deps.log("tool", tool="site_rules", summary=(
        f'{env["buildable_width_ft"]:.0f} x {env["buildable_depth_ft"]:.0f} ft buildable, '
        f'max {env["max_stories"]} stories, max footprint {env["max_footprint_sqft"]:,} sq ft'))
    return env


def feature_catalog(ctx: RunContext[Deps]) -> dict[str, str]:
    """Feature keys allowed in a design's `features` list, with what each one is."""
    ctx.deps.log("tool", tool="feature_catalog", summary=f"{len(tools.feature_catalog())} features available")
    return {k: v["label"] for k, v in tools.feature_catalog().items()}


def evaluate_design(ctx: RunContext[Deps], design: DesignOption) -> dict:
    """Size, price and check one design against the user's budget, lot and requests."""
    ev = tools.evaluate(ctx.deps.project, design)
    ctx.deps.allowed |= allowed_amounts([ev], ctx.deps.project.budget_total)
    out = _compact(ev)
    out["budget"] = ctx.deps.project.budget_total
    fails = sum(1 for x in ev["checks"] if x["status"] == "fail")
    ctx.deps.log("tool", tool="evaluate_design", summary=(
        f'{design.name}: {ev["sizing"]["finished_sqft"]:,} sq ft, ${ev["cost"]["total"]:,.0f}, '
        f'{fails} failing check(s)'))
    return out


# ---------------------------------------------------------------- agents

intake_agent = Agent(
    build_model(), name="intake", deps_type=Deps, output_type=ProjectBrief, retries=2,
    instructions=lambda: load_prompt("intake"),
)

designer_agent = Agent(
    build_model(), name="designer", deps_type=Deps, output_type=DesignSet, retries=3,
    instructions=lambda: load_prompt("designer"),
    tools=[site_rules, feature_catalog, evaluate_design],
)

advisor_agent = Agent(
    build_model(), name="advisor", deps_type=Deps, output_type=AdvisorReport, retries=3,
    instructions=lambda: load_prompt("advisor"),
)

refiner_agent = Agent(
    build_model(), name="refiner", deps_type=Deps, output_type=RefinementReply, retries=3,
    instructions=lambda: load_prompt("refiner"),
    tools=[site_rules, feature_catalog, evaluate_design],
)


def _no_invented_money(ctx: RunContext[Deps], text: str) -> None:
    bad = unverified_amounts(text, ctx.deps.allowed)
    if bad:
        figs = ", ".join(f"${b:,.0f}" for b in bad[:4])
        ctx.deps.log("guard", summary=f"Blocked unverified dollar figure(s): {figs}; agent asked to retry")
        raise ModelRetry(
            f"These dollar amounts are not in NestQuest's computed data: {figs}. "
            "Use only the amounts given to you (rounded to the nearest thousand at most), or describe it in words."
        )


@advisor_agent.output_validator
def _check_advisor(ctx: RunContext[Deps], out: AdvisorReport) -> AdvisorReport:
    _no_invented_money(ctx, out.model_dump_json())
    return out


@refiner_agent.output_validator
def _check_refiner(ctx: RunContext[Deps], out: RefinementReply) -> RefinementReply:
    # The reply may quote the new design's numbers, so evaluate it before checking.
    ev = tools.evaluate(ctx.deps.project, out.design)
    ctx.deps.allowed |= allowed_amounts([ev, *ctx.deps.baseline], ctx.deps.project.budget_total)
    _no_invented_money(ctx, " ".join([out.reply, out.declined, *out.changes]))
    return out


def as_json(obj) -> str:
    return json.dumps(obj, indent=1, default=str)
