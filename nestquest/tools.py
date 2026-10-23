"""NestQuest's deterministic tools: site rules, sizing, cost and feasibility.

The agents never invent a number. Every dimension, dollar amount and pass/fail
verdict in the app comes from these functions, which read the cited data in
data/. The agents decide WHAT to build; these tools say what it costs and
whether it fits.
"""

from __future__ import annotations

import csv
import json
import math
from functools import lru_cache

from nestquest.config import DATA_DIR
from nestquest.models import MAX_STORIES, CheckItem, DesignOption, ProjectInput

CIRCULATION = 1.10          # walls + hallways on top of the listed room areas
FLOOR_TO_FLOOR_FT = 10      # typical residential story height
ROOF_HEIGHT_FT = {"modern": 2, "ranch": 6, "mediterranean": 6}  # others: 8
GARAGE_DEPTH_FT = 22
HABITABLE = {"bedroom", "primary_bedroom", "living", "dining", "office", "family", "flex", "gym", "theater", "game", "bonus"}
BEDROOM_KINDS = {"bedroom", "primary_bedroom"}
# Smallest comfortable size by room type (NestQuest livability guideline, not code).
COMFORT_MIN_SQFT = {"kitchen": 120, "living": 200, "family": 180, "primary_bedroom": 180,
                    "bedroom": 100, "dining": 100, "office": 80}


# ---------------------------------------------------------------- data

@lru_cache(maxsize=1)
def cost_model() -> dict:
    return json.loads((DATA_DIR / "cost_model.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def state_factors() -> dict[str, dict]:
    with (DATA_DIR / "state_cost_factors.csv").open(encoding="utf-8") as f:
        return {
            row["state_code"].upper(): {"name": row["state_name"], "factor": float(row["factor"])}
            for row in csv.DictReader(f)
        }


def feature_catalog() -> dict[str, dict]:
    return cost_model()["features"]


def _v(key: str):
    """Value of a cost-model entry (entries carry their source next to the value)."""
    entry = cost_model()[key]
    return entry["value"] if isinstance(entry, dict) and "value" in entry else entry


# ---------------------------------------------------------------- site & rules

def site_envelope(p: ProjectInput) -> dict:
    """Where on the lot a house may go, after setbacks, coverage and height limits."""
    d = _v("zoning_defaults")
    z = p.zoning
    front = z.front_setback_ft if z.front_setback_ft is not None else d["front_setback_ft"]
    side = z.side_setback_ft if z.side_setback_ft is not None else d["side_setback_ft"]
    rear = z.rear_setback_ft if z.rear_setback_ft is not None else d["rear_setback_ft"]
    height = z.max_height_ft if z.max_height_ft is not None else d["max_height_ft"]
    coverage = z.max_lot_coverage_pct if z.max_lot_coverage_pct is not None else d["max_lot_coverage_pct"]

    lot_area = p.lot_width_ft * p.lot_depth_ft
    bw = max(p.lot_width_ft - 2 * side, 0)
    bd = max(p.lot_depth_ft - front - rear, 0)
    ex = p.existing
    keep_fp = 0
    if p.owns_land and ex.structure == "keep" and ex.existing_sqft:
        # Assume the existing building stays at the back of the lot, roughly square and one story.
        keep_fp = ex.existing_sqft
        bd = max(bd - math.sqrt(keep_fp) - 10, 0)
    max_footprint = max(min(bw * bd, lot_area * coverage / 100 - keep_fp), 0)
    if height is None:
        max_stories = MAX_STORIES
    else:
        first = p.interior.ceiling_ft + 1
        max_stories = 0 if height < first + 6 else 1 + int((height - 6 - first) // FLOOR_TO_FLOOR_FT)
    used_defaults = [
        k for k, val in z.model_dump().items() if val is None
    ]
    return {
        "lot_area_sqft": round(lot_area),
        "buildable_width_ft": round(bw, 1),
        "buildable_depth_ft": round(bd, 1),
        "max_footprint_sqft": round(max_footprint),
        "max_height_ft": height,
        "height_checked": height is not None,
        "max_stories": min(max_stories, MAX_STORIES),
        "existing_kept_sqft": keep_fp,
        "setbacks_ft": {"front": front, "side": side, "rear": rear},
        "max_lot_coverage_pct": coverage,
        "rules_source": "your entries" if not used_defaults else
                        "typical single-family defaults (confirm with your town)" if len(used_defaults) == 5 else
                        "your entries + typical defaults",
    }


def lot_3d(project: ProjectInput, sizing: dict) -> dict:
    """The lot, its setbacks, and where the house sits on it (feet, street at y = depth)."""
    env = site_envelope(project)
    sb = env["setbacks_ft"]
    tw, td = sizing["total_width_ft"], sizing["total_depth_ft"]
    return {
        "w": project.lot_width_ft, "d": project.lot_depth_ft,
        "setbacks": sb,
        "place_x": round(sb["side"] + max(env["buildable_width_ft"] - tw, 0) / 2, 2),
        "place_y": round(max(project.lot_depth_ft - sb["front"] - td, sb["rear"]), 2),
        "existing": _kept_building(project, sb),
    }


def _kept_building(project: ProjectInput, sb: dict) -> dict | None:
    """Footprint of an existing building that stays (drawn at the back of the lot)."""
    ex = project.existing
    if not (project.owns_land and ex.structure == "keep" and ex.existing_sqft):
        return None
    side = math.sqrt(ex.existing_sqft)
    return {"x": round((project.lot_width_ft - side) / 2, 1), "y": sb["rear"], "w": round(side, 1), "h": round(side, 1)}


# ---------------------------------------------------------------- sizing

def size_design(design: DesignOption, env: dict, style: str, ceiling_ft: int = 9) -> dict:
    """Finished area per floor and a footprint shape that fits the buildable area."""
    floors: dict[int, int] = {}
    for r in design.rooms:
        floors[r.floor] = floors.get(r.floor, 0) + r.area_sqft
    gross = {f: round(a * CIRCULATION) for f, a in sorted(floors.items())}
    living = sum(gross.values())
    house_fp = max(gross.values()) if gross else 0

    garage_w = 0 if design.garage_cars == 0 else design.garage_cars * 11 + 2
    garage_area = garage_w * GARAGE_DEPTH_FT
    bw, bd = env["buildable_width_ft"], env["buildable_depth_ft"]

    # Prefer a 1.3:1 house, wider along the street, with the garage beside it.
    # On a narrow lot, squeeze the house (down to 20 ft wide); narrower than that,
    # the garage moves to the front of the house.
    w = math.sqrt(house_fp * 1.3) if house_fp else 0
    placement = "side"
    if garage_w and w + garage_w > bw:
        if bw - garage_w >= 20:
            w = bw - garage_w
        else:
            placement = "front"
            w = min(max(w, garage_w), bw) if bw > 0 else w
    d = house_fp / w if w else 0
    side = placement == "side"
    return {
        "finished_sqft": living,
        "floor_areas": gross,
        "house_width_ft": round(w, 1),
        "house_depth_ft": round(d, 1),
        "garage_width_ft": garage_w,
        "garage_area_sqft": garage_area,
        "footprint_sqft": round(house_fp + garage_area),
        "garage_placement": placement if garage_w else "none",
        "total_width_ft": round(w + garage_w if side else max(w, garage_w), 1),
        "total_depth_ft": round(max(d, GARAGE_DEPTH_FT if garage_w else 0) if side else d + GARAGE_DEPTH_FT, 1),
        "height_ft": (ceiling_ft + 1) + (design.stories - 1) * FLOOR_TO_FLOOR_FT + ROOF_HEIGHT_FT.get(style, 8),
    }


# ---------------------------------------------------------------- cost

def price_design(p: ProjectInput, design: DesignOption, sizing: dict) -> dict:
    """Cost estimate for one design, with every factor shown."""
    cm = cost_model()
    st = state_factors().get(p.state_code.upper())
    if st is None:
        raise ValueError(f"Unknown state code {p.state_code}")

    base = _v("national_cost_per_sqft")
    finish = cm["finish_multipliers"][p.finish_level]
    constr = cm["construction_multipliers"][p.construction]
    style = cm["style_multipliers"][p.style]
    story = cm["story_multipliers"][str(min(design.stories, MAX_STORIES))]
    psf = base * st["factor"] * finish * constr * style * story

    house = psf * sizing["finished_sqft"]
    garage = base * st["factor"] * _v("garage_cost_ratio") * sizing["garage_area_sqft"]

    features = []
    first_floor = sizing["floor_areas"].get(1, 0)
    for key in design.features:
        f = feature_catalog().get(key)
        if not f:
            continue
        if f["type"] == "fixed":
            amt = f["value"] * st["factor"]
        elif f["type"] == "pct_of_house":
            amt = house * f["value"]
        else:  # area_ratio: area x base rate x ratio
            area = first_floor if f.get("area") == "first_floor" else f.get("area_sqft", 0)
            amt = area * base * st["factor"] * f["value"]
        features.append({"key": key, "label": f["label"], "cost": round(amt)})
    feature_total = sum(x["cost"] for x in features)

    # Interior selections (relative to the standard package)
    ic, ip = cm["interior_costs"], p.interior
    interior_items = []
    for key, val in (("flooring", ip.flooring), ("ceiling_ft", str(ip.ceiling_ft)), ("countertops", ip.countertops),
                     ("kitchen_style", ip.kitchen_style), ("appliances", ip.appliances)):
        rule = ic[key][val]
        amt = house * rule["pct"] if "pct" in rule else rule["fixed"] * st["factor"]
        if round(amt):
            interior_items.append({"key": f"{key}:{val}", "label": INTERIOR_LABELS[key][val], "cost": round(amt)})
    interior_total = sum(x["cost"] for x in interior_items)

    # Work on land the user already owns
    ep, ex = cm["existing_property"], p.existing
    site_items = []
    if p.owns_land:
        if ex.structure == "teardown" and ex.existing_sqft:
            site_items.append({"label": f"Demolish existing {ex.existing_sqft:,} sq ft building",
                               "cost": round(ex.existing_sqft * ep["demolition_per_sqft"]["value"] * st["factor"])})
        slope_pct = ep["slope_site_work_pct"]["value"][ex.slope]
        if slope_pct:
            site_items.append({"label": f"Extra site work for a {ex.slope} slope", "cost": round(house * slope_pct)})
        if ex.utilities == "well_septic":
            site_items.append({"label": "Private well and septic system", "cost": round(ep["well_septic"]["value"] * st["factor"])})
    site_total = sum(x["cost"] for x in site_items)

    construction = house + garage + feature_total + interior_total + site_total
    overhead = construction * _v("builder_overhead_profit_pct")
    contingency = (construction + overhead) * _v("contingency_pct")
    land = 0 if p.owns_land else p.land_cost
    total = construction + overhead + contingency + land

    shares = _v("construction_breakdown_shares")
    phases = [{"phase": k.replace("_", " ").title(), "cost": round(house * s)} for k, s in shares.items()]

    return {
        "cost_per_sqft": round(psf),
        "house": round(house),
        "garage": round(garage),
        "features": features,
        "interior": interior_items,
        "site_work": site_items,
        "builder_overhead_profit": round(overhead),
        "contingency": round(contingency),
        "land": round(land),
        "total": round(total),
        "house_phases": phases,
        "factors": {
            "national_base_per_sqft": base,
            "state": st["name"],
            "state_factor": st["factor"],
            "finish": finish,
            "construction": constr,
            "style": style,
            "stories": story,
        },
    }


# ---------------------------------------------------------------- feasibility

def _bath_count(design: DesignOption) -> float:
    return sum(0.5 if r.area_sqft < 40 else 1 for r in design.rooms if r.kind == "bathroom")


def check_design(p: ProjectInput, design: DesignOption, env: dict, sizing: dict, cost: dict) -> list[CheckItem]:
    checks: list[CheckItem] = []

    def add(status, label, detail):
        checks.append(CheckItem(status=status, label=label, detail=detail))

    # Budget
    total, budget = cost["total"], p.budget_total
    gap = total - budget
    if gap <= 0:
        add("ok", "Within budget", f"${total:,.0f} estimated vs ${budget:,.0f} budget (${-gap:,.0f} to spare).")
    elif gap <= 0.10 * budget:
        add("warn", "Slightly over budget", f"${total:,.0f} estimated, ${gap:,.0f} over your ${budget:,.0f} budget.")
    else:
        add("fail", "Over budget", f"${total:,.0f} estimated, ${gap:,.0f} over your ${budget:,.0f} budget.")

    # Lot fit
    bw, bd = env["buildable_width_ft"], env["buildable_depth_ft"]
    if sizing["total_width_ft"] > bw + 0.1 or sizing["total_depth_ft"] > bd + 0.1:
        add("fail", "Does not fit the lot",
            f"Needs about {sizing['total_width_ft']:.0f} x {sizing['total_depth_ft']:.0f} ft; "
            f"the buildable area is {bw:.0f} x {bd:.0f} ft after setbacks.")
    elif sizing["footprint_sqft"] > env["max_footprint_sqft"]:
        add("fail", "Covers too much of the lot",
            f"Footprint {sizing['footprint_sqft']:,} sq ft; limit is {env['max_footprint_sqft']:,} sq ft "
            f"({env['max_lot_coverage_pct']:.0f}% lot coverage).")
    else:
        add("ok", "Fits the lot",
            f"About {sizing['total_width_ft']:.0f} x {sizing['total_depth_ft']:.0f} ft inside a "
            f"{bw:.0f} x {bd:.0f} ft buildable area.")

    # Height (only checked when the user entered their town's limit)
    if not env["height_checked"]:
        if design.stories >= 3:
            add("warn", "Confirm your height limit",
                f"{design.stories} stories, about {sizing['height_ft']} ft tall. Many towns limit home height; check yours.")
    elif design.stories > env["max_stories"]:
        add("fail", "Too tall for the height limit",
            f"{design.stories} stories (about {sizing['height_ft']} ft); a {env['max_height_ft']:.0f} ft limit allows about {env['max_stories']}.")
    else:
        add("ok", "Within the height limit", f"{design.stories} story home under the {env['max_height_ft']:.0f} ft limit.")
    if design.stories >= 3 and "elevator" not in design.features:
        add("warn", "Consider an elevator", f"A {design.stories}-story home is a lot of stairs; an elevator adds accessibility.")

    # Room sizes (IRC R304: habitable rooms at least 70 sq ft)
    min_room = _v("min_habitable_room_sqft")
    small = [r.name for r in design.rooms if r.kind in HABITABLE and r.area_sqft < min_room]
    if small:
        add("fail", "Rooms below code minimum",
            f"{', '.join(small)} under {min_room} sq ft (IRC R304 minimum for habitable rooms).")

    # Livability: code-legal is not the same as comfortable
    cramped = [f"{r.name} ({r.area_sqft} sq ft)" for r in design.rooms
               if r.area_sqft < COMFORT_MIN_SQFT.get(r.kind, 0) and r.area_sqft >= min_room]
    if cramped:
        add("warn", "Some rooms are smaller than typical",
            f"{', '.join(cramped[:4])}{' and more' if len(cramped) > 4 else ''} will feel tight.")

    # Program
    beds = sum(1 for r in design.rooms if r.kind in BEDROOM_KINDS)
    baths = _bath_count(design)
    if beds < p.bedrooms:
        add("fail", "Fewer bedrooms than requested", f"{beds} bedrooms vs {p.bedrooms} requested.")
    else:
        add("ok", "Bedrooms", f"{beds} bedrooms ({p.bedrooms} requested).")
    if baths + 0.01 < p.bathrooms:
        add("warn", "Fewer bathrooms than requested", f"{baths:g} bathrooms vs {p.bathrooms:g} requested.")
    else:
        add("ok", "Bathrooms", f"{baths:g} bathrooms ({p.bathrooms:g} requested).")
    if p.stories != "any" and str(design.stories) != p.stories:
        add("warn", "Different number of stories", f"{design.stories} stories vs {p.stories} requested.")
    if p.target_sqft:
        diff = sizing["finished_sqft"] / p.target_sqft - 1
        if abs(diff) > 0.15:
            add("warn", "Size differs from your target",
                f"{sizing['finished_sqft']:,} sq ft vs {p.target_sqft:,} target ({diff:+.0%}).")
    if design.garage_cars < p.garage_cars:
        add("warn", "Smaller garage", f"{design.garage_cars}-car garage vs {p.garage_cars}-car requested.")

    # Must-haves
    for mh in p.must_haves:
        met = _must_have_met(mh, design)
        if met is False:
            label = MUST_HAVES.get(mh, mh)
            add("warn", f"Missing: {label}", f"{label} is not in this design.")
    return checks


ROOM_MUST_HAVES = {
    "home_office": ("Home office", {"office"}),
    "primary_on_main": ("Primary suite on the main floor", None),
    "in_law_suite": ("In-law suite (multigenerational)", None),
    "mudroom": ("Mudroom", {"mudroom"}),
    "walk_in_pantry": ("Walk-in pantry", {"pantry"}),
    "spice_kitchen": ("Spice kitchen", {"spice_kitchen"}),
    "prayer_room": ("Prayer / meditation room", {"prayer"}),
    "home_gym": ("Home gym", {"gym"}),
    "home_theater": ("Home theater", {"theater"}),
    "game_room": ("Game / party room", {"game"}),
    "bonus_room": ("Bonus room / loft", {"bonus", "flex"}),
    "basement": ("Basement", None),
}
GROUP_LABELS = {"rooms": "Rooms & layout", "sustainability": "Sustainability", "outdoor": "Outdoor living",
                "lifestyle": "Lifestyle & comfort", "accessibility": "Accessibility"}
INTERIOR_LABELS = {
    "flooring": {"hardwood": "Solid hardwood floors", "engineered_wood": "Engineered wood floors", "lvp": "Luxury vinyl plank floors",
                 "tile": "Tile floors", "carpet_bedrooms": "Carpet in bedrooms"},
    "ceiling_ft": {"9": "9 ft ceilings", "10": "10 ft main-floor ceilings", "12": "12 ft main-floor ceilings"},
    "countertops": {"quartz": "Quartz counters", "granite": "Granite counters", "marble": "Marble counters", "butcher_block": "Butcher-block counters"},
    "kitchen_style": {"white_shaker": "White shaker cabinets", "modern_flat": "Modern flat-panel cabinets",
                      "two_tone": "Two-tone cabinets", "natural_wood": "Natural wood cabinets"},
    "appliances": {"standard": "Standard appliances", "professional": "Professional-grade appliances"},
}


def must_have_groups() -> dict[str, dict[str, str]]:
    """Every must-have the form offers, grouped for display."""
    groups = {"rooms": {k: v[0] for k, v in ROOM_MUST_HAVES.items()}}
    for key, f in feature_catalog().items():
        if key in ("unfinished_basement", "finished_basement", "in_law_kitchenette", "spice_kitchen_fitout"):
            continue  # offered through the room must-haves above
        groups.setdefault(f.get("group", "lifestyle"), {})[key] = f["label"]
    return groups


MUST_HAVES = {k: v for g in must_have_groups().values() for k, v in g.items()}


def _must_have_met(key: str, design: DesignOption) -> bool | None:
    kinds = {r.kind for r in design.rooms}
    if key in ROOM_MUST_HAVES and ROOM_MUST_HAVES[key][1]:
        return bool(ROOM_MUST_HAVES[key][1] & kinds)
    if key == "primary_on_main":
        return any(r.kind == "primary_bedroom" and r.floor == 1 for r in design.rooms)
    if key == "in_law_suite":
        main_bed = any(r.kind == "bedroom" and r.floor == 1 for r in design.rooms)
        return main_bed and ("kitchenette" in kinds or "in_law_kitchenette" in design.features)
    if key == "basement":
        return bool({"unfinished_basement", "finished_basement"} & set(design.features))
    if key in feature_catalog():
        return key in design.features
    return None  # layout preference (e.g. open kitchen): described, not checked


# ---------------------------------------------------------------- one call for agents

def evaluate(p: ProjectInput, design: DesignOption) -> dict:
    """Size, price and check a design. The single source of truth for every number."""
    env = site_envelope(p)
    sizing = size_design(design, env, p.style, p.interior.ceiling_ft)
    cost = price_design(p, design, sizing)
    checks = check_design(p, design, env, sizing, cost)
    return {"sizing": sizing, "cost": cost, "checks": [c.model_dump() for c in checks]}
