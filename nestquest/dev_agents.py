"""Agents for multi-family developments (gpt-6-luna via Portkey, like the home agents).

Dev Designer -> proposes three site plans, testing them with the tools  (dev_site_rules, amenity_catalog, evaluate_scheme)
Dev Advisor  -> explains what each plan can and cannot do                (no tools; numbers checked after)
Dev Refiner  -> edits the chosen plan from chat messages                 (same tools as the Designer)
The Intake agent is shared with the home flow.
"""

from __future__ import annotations

from pydantic_ai import Agent, RunContext

from nestquest import multifamily as mf
from nestquest.agents import Deps, _no_invented_money
from nestquest.config import build_model, load_prompt
from nestquest.models import AdvisorReport


def dev_site_rules(ctx: RunContext[Deps]) -> dict:
    """Buildable area, height and density limits of the site, plus each building type's typical size and depth."""
    env = mf.dev_envelope(ctx.deps.project)
    ctx.deps.log("tool", tool="dev_site_rules", summary=(
        f'{env["buildable_width_ft"]:.0f} x {env["buildable_depth_ft"]:.0f} ft buildable, max {env["max_stories"]} stories, '
        f'up to {env["max_units"]} units at {env["max_units_per_acre"]:g}/acre'))
    products = {k: {"label": v["label"], "typical_units_per_building": v["units_per_building"],
                    "building_depth_ft": v["depth_ft"], "max_units_per_acre_default": v["default_density"]}
                for k, v in mf.mf_model()["products"].items()}
    return {**env, "building_types": products,
            "note": "max_units uses the user's density if given, else the highest default (garden apartments); "
                    "evaluate_scheme applies the chosen type's default."}


def amenity_catalog(ctx: RunContext[Deps]) -> dict[str, str]:
    """Amenity keys allowed in a scheme's `amenities` list."""
    ctx.deps.log("tool", tool="amenity_catalog", summary=f"{len(mf.amenity_catalog())} amenities available")
    return {k: v["label"] for k, v in mf.amenity_catalog().items()}


def evaluate_scheme(ctx: RunContext[Deps], scheme: mf.Scheme) -> dict:
    """Lay out, price and check one scheme against the budget, site, zoning and the user's requests."""
    ev = mf.evaluate_scheme(ctx.deps.project, scheme)
    ctx.deps.allowed |= mf.dev_allowed_amounts([ev], ctx.deps.project.budget_total)
    fails = sum(1 for c in ev["checks"] if c["status"] == "fail")
    ctx.deps.log("tool", tool="evaluate_scheme", summary=(
        f'{scheme.name}: {ev["sizing"]["units"]} units, ${ev["cost"]["total"]:,.0f}, {fails} failing check(s)'))
    out = {
        "total_development_cost": ev["cost"]["total"], "budget": ctx.deps.project.budget_total,
        "cost_per_unit": ev["cost"]["per_unit"], "units": ev["sizing"]["units"],
        "gross_sqft": ev["sizing"]["gross_sqft"],
        "building_size_ft": f'{ev["sizing"]["building_width_ft"]:.0f} x {ev["sizing"]["building_depth_ft"]:.0f}',
        "site_depth_needed_ft": ev["layout"]["depth_needed_ft"],
        "returns": ev["returns"],
        "checks": [f'{c["status"].upper()}: {c["label"]} - {c["detail"]}' for c in ev["checks"]],
    }
    return out


dev_designer_agent = Agent(
    build_model(), name="dev_designer", deps_type=Deps, output_type=mf.SchemeSet, retries=3,
    instructions=lambda: load_prompt("dev_designer"),
    tools=[dev_site_rules, amenity_catalog, evaluate_scheme],
)

dev_advisor_agent = Agent(
    build_model(), name="dev_advisor", deps_type=Deps, output_type=AdvisorReport, retries=3,
    instructions=lambda: load_prompt("dev_advisor"),
)

dev_refiner_agent = Agent(
    build_model(), name="dev_refiner", deps_type=Deps, output_type=mf.DevRefinementReply, retries=3,
    instructions=lambda: load_prompt("dev_refiner"),
    tools=[dev_site_rules, amenity_catalog, evaluate_scheme],
)


@dev_advisor_agent.output_validator
def _check_dev_advisor(ctx: RunContext[Deps], out: AdvisorReport) -> AdvisorReport:
    _no_invented_money(ctx, out.model_dump_json())
    return out


@dev_refiner_agent.output_validator
def _check_dev_refiner(ctx: RunContext[Deps], out: mf.DevRefinementReply) -> mf.DevRefinementReply:
    ev = mf.evaluate_scheme(ctx.deps.project, out.scheme)
    ctx.deps.allowed |= mf.dev_allowed_amounts([ev, *ctx.deps.baseline], ctx.deps.project.budget_total)
    _no_invented_money(ctx, " ".join([out.reply, out.declined, *out.changes]))
    return out
