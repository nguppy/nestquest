"""How the agents hand work to each other.

plan_project():  Guard -> Intake -> Designer (+tools) -> NestQuest tools -> Advisor
refine_design(): Guard -> Refiner (+tools) -> NestQuest tools

Every agent in a run shares one usage counter, so PLAN_LIMITS / REFINE_LIMITS
cap the whole run, not each agent separately.
"""

from __future__ import annotations

import json
import time

from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import RunUsage

from nestquest import tools
from nestquest.agents import (
    Deps, advisor_agent, designer_agent, intake_agent, refiner_agent,
)
from nestquest.config import PLAN_LIMITS, PROJECT_DIR, REFINE_LIMITS, usd_cost
from nestquest.drawing import elevation_svg, floor_plan_svg, model_3d
from nestquest.guard import allowed_amounts, is_injection, screen_text
from nestquest.models import DesignOption, ProjectInput


class BudgetExceeded(RuntimeError):
    pass


USAGE_LOG = PROJECT_DIR / "logs" / "usage.jsonl"


def log_usage(kind: str, events: list[dict], total: dict, **extra):
    """Append one run's token usage (per agent and total) to logs/usage.jsonl."""
    per_agent = [{"agent": e["agent"], **e["usage"], "seconds": e["seconds"]} for e in events if e["kind"] == "done"]
    USAGE_LOG.parent.mkdir(exist_ok=True)
    with USAGE_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": kind,
                            "agents": per_agent, "total": total, **extra}) + "\n")


def usage_dict(u: RunUsage) -> dict:
    cached = u.cache_read_tokens or 0
    return {
        "requests": u.requests,
        "input_tokens": u.input_tokens,
        "cached_input_tokens": cached,
        "output_tokens": u.output_tokens,
        "total_tokens": u.input_tokens + u.output_tokens,
        "cost_usd": round(usd_cost(u.input_tokens, cached, u.output_tokens), 6),
    }


async def _run_agent(agent, name: str, prompt: str, deps: Deps, usage: RunUsage, limits):
    deps.agent = name
    before = usage_dict(usage)
    deps.log("start")
    t0 = time.time()
    try:
        result = await agent.run(prompt, deps=deps, usage=usage, usage_limits=limits)
    except UsageLimitExceeded as e:
        deps.log("error", summary=f"Token budget reached: {e}")
        raise BudgetExceeded(
            "This run hit NestQuest's spending cap and was stopped. Try a simpler request."
        ) from e
    after = usage_dict(usage)
    deps.log("done", seconds=round(time.time() - t0, 1),
             usage={k: after[k] - before[k] for k in ("requests", "input_tokens", "cached_input_tokens", "output_tokens")})
    return result.output


def render_option(project: ProjectInput, design: DesignOption) -> dict:
    """Design + every computed number + drawings, ready for the browser."""
    ev = tools.evaluate(project, design)
    floors = sorted({r.floor for r in design.rooms})
    return {
        "design": design.model_dump(),
        **ev,
        "plans": {str(f): floor_plan_svg(design, ev["sizing"], f) for f in floors},
        "elevation": elevation_svg(design, ev["sizing"], project.style),
        "model3d": model_3d(design, ev["sizing"], project.style, tools.lot_3d(project, ev["sizing"]),
                            project.interior.model_dump()),
    }



async def plan_project(project: ProjectInput, events: list[dict]) -> dict:
    usage = RunUsage()
    deps = Deps(project=project, events=events)

    # 1. Guard: drop injected instructions from the notes before any agent sees them.
    deps.agent = "guard"
    clean_notes, removed = screen_text(project.notes)
    if removed:
        deps.log("guard", summary=f"Removed {len(removed)} suspicious sentence(s) from the notes")
    project_for_agents = project.model_copy(update={"notes": clean_notes})
    form = {"flow": "home", **project_for_agents.model_dump(exclude={"notes"})}

    # 2. Intake
    brief = await _run_agent(
        intake_agent, "intake",
        f"Project form:\n{json.dumps(form)}\n\n<user_notes>\n{clean_notes or '(none)'}\n</user_notes>",
        deps, usage, PLAN_LIMITS,
    )

    # 3. Designer (tests its own drafts with evaluate_design)
    design_set = await _run_agent(
        designer_agent, "designer",
        f"Project brief:\n{brief.model_dump_json()}\n\nProject form:\n{json.dumps(form)}",
        deps, usage, PLAN_LIMITS,
    )

    # 4. NestQuest tools: the authoritative numbers and drawings for each option
    deps.agent = "tools"
    options = [render_option(project, d) for d in design_set.options]
    deps.log("tool", tool="evaluate x3", summary="Final cost, fit and code checks for all three options")

    # 5. Advisor: plain-language verdicts, using only the computed numbers
    deps.allowed = allowed_amounts(options, project.budget_total)
    facts = [
        {"name": o["design"]["name"], "tier": o["design"]["tier"], "tagline": o["design"]["tagline"],
         "stories": o["design"]["stories"], "finished_sqft": o["sizing"]["finished_sqft"],
         "rooms": [f'{r["name"]} ({r["kind"]}, floor {r["floor"]}, {r["area_sqft"]} sq ft)' for r in o["design"]["rooms"]],
         "garage_cars": o["design"]["garage_cars"], "features": o["design"]["features"],
         "exterior": o["design"]["exterior"], "interior": o["design"]["interior"],
         "cost": {k: v for k, v in o["cost"].items() if k not in ("house_phases", "factors")},
         "budget": project.budget_total, "checks": o["checks"]}
        for o in options
    ]
    advice = await _run_agent(
        advisor_agent, "advisor",
        f"Project brief:\n{brief.model_dump_json()}\n\nComputed results for the three options:\n{json.dumps(facts)}",
        deps, usage, PLAN_LIMITS,
    )

    by_name = {a.name: a.model_dump() for a in advice.options}
    for o, a in zip(options, advice.options):
        o["advice"] = by_name.get(o["design"]["name"], a.model_dump())

    log_usage("plan", events, usage_dict(usage), state=project.state_code,
              guard_removed=len(removed), seconds=round(events[-1]["t"] - events[0]["t"], 1))
    return {
        "brief": brief.model_dump(),
        "envelope": tools.site_envelope(project),
        "options": options,
        "advisor": {"overview": advice.overview, "recommended": advice.recommended,
                    "next_questions": advice.next_questions},
        "guard_removed": removed,
        "usage": usage_dict(usage),
    }


async def refine_design(project: ProjectInput, design: DesignOption, brief: dict,
                        message: str, events: list[dict]) -> dict:
    deps = Deps(project=project, events=events)
    deps.agent = "guard"
    if is_injection(message):
        deps.log("guard", summary="Blocked a chat message that tried to override NestQuest's rules")
        return {
            "blocked": True,
            "reply": "I can only help refine your home design, so I've left it unchanged. "
                     "Try something like \"add a home office\" or \"make the kitchen bigger\".",
            "usage": usage_dict(RunUsage()),
        }

    before = tools.evaluate(project, design)
    deps.baseline = [before]
    deps.allowed = allowed_amounts([before], project.budget_total)
    usage = RunUsage()
    form = {"flow": "home", **project.model_dump(exclude={"notes"})}
    prompt = (
        f"Project form:\n{json.dumps(form)}\n\nProject brief:\n{json.dumps(brief)}\n\n"
        f"Current design:\n{design.model_dump_json()}\n"
        f"Current total cost: ${before['cost']['total']:,} (budget ${project.budget_total:,.0f})\n\n"
        f"<user_message>\n{message}\n</user_message>"
    )
    out = await _run_agent(refiner_agent, "refiner", prompt, deps, usage, REFINE_LIMITS)
    after = render_option(project, out.design)
    log_usage("refine", events, usage_dict(usage))
    return {
        "blocked": False,
        "reply": out.reply,
        "changes": out.changes,
        "declined": out.declined,
        "option": after,
        "delta": after["cost"]["total"] - before["cost"]["total"],
        "usage": usage_dict(usage),
    }


# ================================================================ multi-family developments

def render_scheme(project, scheme) -> dict:
    """Scheme + every computed number + site plan and 3D model, ready for the browser."""
    from nestquest import multifamily as mf
    ev = mf.evaluate_scheme(project, scheme)
    return {
        "scheme": scheme.model_dump(),
        **ev,
        "site_svg": mf.site_plan_svg(project, scheme, ev["layout"], ev["envelope"]),
        "site_svg_small": mf.site_plan_svg(project, scheme, ev["layout"], ev["envelope"], compact=True),
        "model3d": mf.site_model_3d(project, ev["layout"], ev["envelope"]),
    }


def _scheme_facts(o: dict, budget: float) -> dict:
    sc = o["scheme"]
    return {
        "name": sc["name"], "tier": sc["tier"], "tagline": sc["tagline"], "product": sc["product"],
        "buildings": sc["buildings"], "stories": sc["stories"], "unit_types": sc["unit_types"],
        "parking": f'{sc["parking_spaces"]} {sc["parking_type"]}', "amenities": sc["amenities"],
        "units": o["sizing"]["units"], "gross_sqft": o["sizing"]["gross_sqft"],
        "cost": {k: v for k, v in o["cost"].items() if k != "factors"},
        "returns": o["returns"], "budget": budget, "checks": o["checks"],
    }


async def plan_development(project, events: list[dict]) -> dict:
    from nestquest import multifamily as mf
    from nestquest.dev_agents import dev_advisor_agent, dev_designer_agent

    usage = RunUsage()
    deps = Deps(project=project, events=events)
    deps.agent = "guard"
    clean_notes, removed = screen_text(project.notes)
    if removed:
        deps.log("guard", summary=f"Removed {len(removed)} suspicious sentence(s) from the notes")
    form = {"flow": "development", **project.model_dump(exclude={"notes"})}

    brief = await _run_agent(
        intake_agent, "intake",
        f"Project form:\n{json.dumps(form)}\n\n<user_notes>\n{clean_notes or '(none)'}\n</user_notes>",
        deps, usage, PLAN_LIMITS,
    )
    scheme_set = await _run_agent(
        dev_designer_agent, "designer",
        f"Project brief:\n{brief.model_dump_json()}\n\nProject form:\n{json.dumps(form)}",
        deps, usage, PLAN_LIMITS,
    )
    deps.agent = "tools"
    options = [render_scheme(project, s) for s in scheme_set.options]
    deps.log("tool", tool="evaluate x3", summary="Final layout, cost, returns and zoning checks for all three plans")

    evals = [{k: o[k] for k in ("cost", "returns")} for o in options]
    deps.allowed = mf.dev_allowed_amounts(evals, project.budget_total)
    facts = [_scheme_facts(o, project.budget_total) for o in options]
    advice = await _run_agent(
        dev_advisor_agent, "advisor",
        f"Project brief:\n{brief.model_dump_json()}\n\nComputed results for the three plans:\n{json.dumps(facts)}",
        deps, usage, PLAN_LIMITS,
    )
    by_name = {a.name: a.model_dump() for a in advice.options}
    for o, a in zip(options, advice.options):
        o["advice"] = by_name.get(o["scheme"]["name"], a.model_dump())

    log_usage("plan_development", events, usage_dict(usage), state=project.state_code,
              guard_removed=len(removed), seconds=round(events[-1]["t"] - events[0]["t"], 1))
    return {
        "brief": brief.model_dump(),
        "envelope": mf.dev_envelope(project),
        "options": options,
        "advisor": {"overview": advice.overview, "recommended": advice.recommended,
                    "next_questions": advice.next_questions},
        "guard_removed": removed,
        "usage": usage_dict(usage),
    }


async def refine_scheme(project, scheme, brief: dict, message: str, events: list[dict]) -> dict:
    from nestquest import multifamily as mf
    from nestquest.dev_agents import dev_refiner_agent

    deps = Deps(project=project, events=events)
    deps.agent = "guard"
    if is_injection(message):
        deps.log("guard", summary="Blocked a chat message that tried to override NestQuest's rules")
        return {"blocked": True,
                "reply": "I can only help refine your development plan, so I've left it unchanged. "
                         "Try something like \"add a playground\" or \"swap some 1BRs for 2BRs\".",
                "usage": usage_dict(RunUsage())}
    before = mf.evaluate_scheme(project, scheme)
    deps.baseline = [before]
    deps.allowed = mf.dev_allowed_amounts([before], project.budget_total)
    usage = RunUsage()
    form = {"flow": "development", **project.model_dump(exclude={"notes"})}
    prompt = (
        f"Project form:\n{json.dumps(form)}\n\nProject brief:\n{json.dumps(brief)}\n\n"
        f"Current scheme:\n{scheme.model_dump_json()}\n"
        f"Current total development cost: ${before['cost']['total']:,} (budget ${project.budget_total:,.0f})\n"
        f"Current returns: {json.dumps(before['returns'])}\n\n"
        f"<user_message>\n{message}\n</user_message>"
    )
    out = await _run_agent(dev_refiner_agent, "refiner", prompt, deps, usage, REFINE_LIMITS)
    after = render_scheme(project, out.scheme)
    log_usage("refine_development", events, usage_dict(usage))
    return {"blocked": False, "reply": out.reply, "changes": out.changes, "declined": out.declined,
            "option": after, "delta": after["cost"]["total"] - before["cost"]["total"],
            "usage": usage_dict(usage)}
