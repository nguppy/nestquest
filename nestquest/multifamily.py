"""Multi-family development: inputs, deterministic tools, site layout and drawings.

Same principle as the single-family tools: the Designer agent picks the
program (building type, unit mix, buildings, stories, parking); everything
measurable here is computed from the cited data in data/cost_model_mf.json.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from html import escape
from typing import Literal

from pydantic import BaseModel, Field

from nestquest.config import DATA_DIR
from nestquest.models import CheckItem, ExistingProperty, Finish, Style, ZoningOverrides

MAX_DEV_STORIES = 12
from nestquest.tools import state_factors

Product = Literal["duplex", "fourplex", "townhomes", "garden_apartments"]


# ---------------------------------------------------------------- inputs / outputs

class DevZoning(ZoningOverrides):
    max_units_per_acre: float | None = None


class DevelopmentInput(BaseModel):
    state_code: str = Field(min_length=2, max_length=2)
    city: str = Field(default="", max_length=80)
    lot_width_ft: float = Field(ge=40, le=3000)
    lot_depth_ft: float = Field(ge=40, le=3000)
    owns_land: bool = True
    land_cost: float = Field(default=0, ge=0, le=500_000_000)
    budget_total: float = Field(gt=50_000, le=500_000_000)
    product: Product | Literal["any"] = "any"
    target_units: int | None = Field(default=None, ge=2, le=300)
    max_stories: int | None = Field(default=None, ge=1, le=MAX_DEV_STORIES, description="None = no limit")
    unit_types: list[Literal["studio", "1br", "2br", "3br"]] = Field(default_factory=lambda: ["1br", "2br"])
    parking_per_unit: float = Field(default=1.5, ge=0, le=3)
    finish_level: Literal["essential", "standard", "premium"] = "standard"
    style: Style = "modern"
    exit: Literal["rent", "sell"] = "rent"
    avg_rent: float | None = Field(default=None, ge=200, le=50_000)
    avg_sale_price: float | None = Field(default=None, ge=20_000, le=20_000_000)
    amenities: list[str] = Field(default_factory=list, max_length=25)
    notes: str = Field(default="", max_length=1500)
    zoning: DevZoning = Field(default_factory=DevZoning)
    existing: ExistingProperty = Field(default_factory=ExistingProperty)


class UnitType(BaseModel):
    name: str = Field(description="e.g. '2BR / 2BA'")
    bedrooms: int = Field(ge=0, le=4, description="0 = studio")
    bathrooms: float = Field(ge=1, le=4)
    area_sqft: int = Field(ge=250, le=3500)
    count: int = Field(ge=1, le=300)


class Scheme(BaseModel):
    """One development option. The program comes from the Designer agent;
    sizes, layout, costs, returns and checks are computed by NestQuest."""
    name: str = Field(description="Evocative 2-3 word name, e.g. 'Linden Commons'.")
    tier: Literal["lean", "balanced", "max_yield"]
    tagline: str = Field(description="One short sentence on what makes this option different.")
    product: Product
    buildings: int = Field(ge=1, le=40)
    stories: int = Field(ge=1, le=MAX_DEV_STORIES)
    unit_types: list[UnitType] = Field(min_length=1, max_length=6)
    parking_spaces: int = Field(ge=0, le=1000)
    parking_type: Literal["surface", "structured"] = "surface"
    amenities: list[str] = Field(default_factory=list, description="Keys from the amenity catalog.")
    exterior: str = Field(description="One sentence on materials and look.")
    site_notes: str = Field(description="One sentence on how the site is organized.")


class SchemeSet(BaseModel):
    options: list[Scheme] = Field(min_length=3, max_length=3)


class DevRefinementReply(BaseModel):
    reply: str = Field(description="Short, friendly reply explaining what changed and why (2-4 sentences).")
    changes: list[str] = Field(description="Bullet list of concrete changes made.")
    scheme: Scheme
    declined: str = Field(default="", description="If part of the request could not or should not be done, say why.")


# ---------------------------------------------------------------- data

@lru_cache(maxsize=1)
def mf_model() -> dict:
    return json.loads((DATA_DIR / "cost_model_mf.json").read_text(encoding="utf-8"))


def amenity_catalog() -> dict[str, dict]:
    return mf_model()["features"]


def _v(entry):
    return entry["value"] if isinstance(entry, dict) and "value" in entry else entry


# ---------------------------------------------------------------- site rules

def dev_envelope(p: DevelopmentInput, product: str | None = None) -> dict:
    m = mf_model()
    d = _v(m["zoning_defaults"])
    z = p.zoning
    pick = lambda k: getattr(z, k) if getattr(z, k) is not None else d[k]  # noqa: E731
    front, side, rear = pick("front_setback_ft"), pick("side_setback_ft"), pick("rear_setback_ft")
    height, coverage = pick("max_height_ft"), pick("max_lot_coverage_pct")
    lot_area = p.lot_width_ft * p.lot_depth_ft
    acres = lot_area / 43_560
    prod = product or (p.product if p.product != "any" else None)
    density = z.max_units_per_acre
    density_src = "your entry"
    if density is None:
        density_src = "typical for the building type"
        density = m["products"][prod]["default_density"] if prod else max(x["default_density"] for x in m["products"].values())
    bw, bd = max(p.lot_width_ft - 2 * side, 0), max(p.lot_depth_ft - front - rear, 0)
    keep = p.existing.existing_sqft if p.owns_land and p.existing.structure == "keep" else 0
    if keep:
        bd = max(bd - math.sqrt(keep) - 10, 0)  # existing building assumed to stay at the back
    if height is None:
        max_stories = p.max_stories or MAX_DEV_STORIES
    else:
        max_stories = min(max(int((height - 6) // 10), 1), p.max_stories or MAX_DEV_STORIES)
    return {
        "lot_area_sqft": round(lot_area),
        "acres": round(acres, 2),
        "buildable_width_ft": round(bw, 1),
        "buildable_depth_ft": round(bd, 1),
        "setbacks_ft": {"front": front, "side": side, "rear": rear},
        "max_height_ft": height,
        "height_checked": height is not None,
        "max_stories": max_stories,
        "max_lot_coverage_pct": coverage,
        "max_building_footprint_sqft": round(max(lot_area * coverage / 100 - keep, 0)),
        "existing_kept_sqft": keep,
        "max_units_per_acre": density,
        "max_units": int(acres * density),
        "density_source": density_src,
    }


# ---------------------------------------------------------------- sizing + layout

def size_scheme(p: DevelopmentInput, s: Scheme) -> dict:
    m = mf_model()
    prod = m["products"][s.product]
    units = sum(u.count for u in s.unit_types)
    net = sum(u.count * u.area_sqft for u in s.unit_types)
    amen_area = sum(amenity_catalog()[a].get("area_sqft", 0) for a in s.amenities if a in amenity_catalog()
                    and amenity_catalog()[a]["type"] == "area")
    gross = net / prod["efficiency"] + amen_area
    per_bldg_gross = gross / s.buildings
    fp = per_bldg_gross / s.stories
    depth = min(prod["depth_ft"], max(math.sqrt(fp), 24))
    width = fp / depth
    return {
        "units": units,
        "net_sqft": round(net),
        "gross_sqft": round(gross),
        "avg_unit_sqft": round(net / units) if units else 0,
        "units_per_building": round(units / s.buildings, 1),
        "building_width_ft": round(width, 1),
        "building_depth_ft": round(depth, 1),
        "building_footprint_sqft": round(fp),
        "total_footprint_sqft": round(fp * s.buildings),
        "height_ft": s.stories * 10 + 6,
        "parking_area_sqft": round(s.parking_spaces * _v(m["parking"]["sqft_per_surface_space"]))
                             if s.parking_type == "surface" else 0,
    }


def layout_site(p: DevelopmentInput, s: Scheme, sz: dict, env: dict) -> dict:
    """Place buildings in rows from the street back, then surface parking behind them."""
    m = mf_model()
    gap, row_gap = m["building_gap_ft"], m["row_gap_ft"]
    sb = env["setbacks_ft"]
    bw, bd = env["buildable_width_ft"], env["buildable_depth_ft"]
    w, d = sz["building_width_ft"], sz["building_depth_ft"]
    per_row = max(int((bw + gap) // (w + gap)), 1) if w <= bw else 1
    rows = math.ceil(s.buildings / per_row)
    buildings = []
    street_y = p.lot_depth_ft - sb["front"]
    for i in range(s.buildings):
        r, c = divmod(i, per_row)
        in_row = min(per_row, s.buildings - r * per_row)
        row_w = in_row * w + (in_row - 1) * gap
        x0 = sb["side"] + max(bw - row_w, 0) / 2
        buildings.append({
            "x": round(x0 + c * (w + gap), 1), "y": round(street_y - d - r * (d + row_gap), 1),
            "w": round(w, 1), "h": round(d, 1), "stories": s.stories,
            "label": f"Bldg {chr(65 + i)}" if s.buildings <= 26 else f"Bldg {i + 1}",
            "sub": f"{sz['units_per_building']:g} units",
            "entries": min(int(round(sz["units_per_building"])), 8) if s.product in ("townhomes", "duplex") else 1,
        })
    used_depth = rows * d + (rows - 1) * row_gap
    parking = None
    park_depth = 0.0
    if sz["parking_area_sqft"] and bw > 0:
        park_depth = sz["parking_area_sqft"] / bw
        parking = {"x": sb["side"], "y": round(street_y - used_depth - row_gap / 2 - park_depth, 1),
                   "w": bw, "h": round(park_depth, 1), "spaces": s.parking_spaces}
    total_depth = used_depth + (row_gap / 2 + park_depth if parking else 0)
    return {"buildings": buildings, "parking": parking, "rows": rows, "per_row": per_row,
            "depth_needed_ft": round(total_depth, 1), "too_wide": w > bw}


# ---------------------------------------------------------------- cost + returns

def price_scheme(p: DevelopmentInput, s: Scheme, sz: dict) -> dict:
    m = mf_model()
    st = state_factors()[p.state_code.upper()]
    prod = m["products"][s.product]
    base_entry = m["hard_cost_per_sqft"][prod["base"]]
    base = _v(base_entry)
    finish = m["finish_multipliers"][p.finish_level]
    style = json.loads((DATA_DIR / "cost_model.json").read_text(encoding="utf-8"))["style_multipliers"][p.style]
    psf = base * st["factor"] * finish * style
    buildings_cost = psf * sz["gross_sqft"]
    gc = buildings_cost * _v(m["gc_overhead_pct_nahb"]) if prod["base"] == "nahb" else 0

    pk = m["parking"]
    per_space = _v(pk["surface_cost_per_space"] if s.parking_type == "surface" else pk["structured_cost_per_space"])
    parking = s.parking_spaces * per_space * st["factor"]

    amen = []
    for key in s.amenities:
        a = amenity_catalog().get(key)
        if not a:
            continue
        if a["type"] == "fixed":
            amt = a["value"] * st["factor"]
        elif a["type"] == "per_building":
            amt = a["value"] * s.buildings * st["factor"]
        elif a["type"] == "per_unit":
            amt = a["value"] * sz["units"] * st["factor"]
        elif a["type"] == "per_space":
            amt = math.ceil(s.parking_spaces * a["share"]) * a["value"] * st["factor"]
        elif a["type"] == "pct_of_hard":
            amt = buildings_cost * a["value"]
        else:  # area: already in gross sq ft, so its cost is inside buildings_cost
            amt = 0
        if amt:
            amen.append({"key": key, "label": a["label"], "cost": round(amt)})
    amen_total = sum(a["cost"] for a in amen)

    site_items = []
    ex = p.existing
    if p.owns_land:
        ep = json.loads((DATA_DIR / "cost_model.json").read_text(encoding="utf-8"))["existing_property"]
        if ex.structure == "teardown" and ex.existing_sqft:
            site_items.append({"label": f"Demolish existing {ex.existing_sqft:,} sq ft building",
                               "cost": round(ex.existing_sqft * ep["demolition_per_sqft"]["value"] * st["factor"])})
        if ep["slope_site_work_pct"]["value"][ex.slope]:
            site_items.append({"label": f"Extra site work for a {ex.slope} slope",
                               "cost": round(buildings_cost * ep["slope_site_work_pct"]["value"][ex.slope])})
        if ex.utilities == "well_septic":
            site_items.append({"label": "Private well and septic (per building)",
                               "cost": round(ep["well_septic"]["value"] * s.buildings * st["factor"])})
    site_total = sum(x["cost"] for x in site_items)

    hard = buildings_cost + gc + parking + amen_total + site_total
    soft = hard * _v(m["soft_cost_pct_of_hard"])
    contingency = (hard + soft) * _v(m["contingency_pct"])
    land = 0 if p.owns_land else p.land_cost
    total = hard + soft + contingency + land
    units = sz["units"] or 1
    return {
        "cost_per_sqft": round(psf),
        "buildings": round(buildings_cost),
        "gc_overhead": round(gc),
        "parking": round(parking),
        "parking_per_space": round(per_space * st["factor"]),
        "amenities": amen,
        "site_work": site_items,
        "hard_total": round(hard),
        "soft_costs": round(soft),
        "contingency": round(contingency),
        "land": round(land),
        "total": round(total),
        "per_unit": round(total / units),
        "factors": {"base_per_sqft": base, "base_source": prod["base"], "state": st["name"],
                    "state_factor": st["factor"], "finish": finish, "style": style},
    }


def returns(p: DevelopmentInput, sz: dict, cost: dict) -> dict | None:
    m = mf_model()
    units = sz["units"]
    if p.exit == "rent" and p.avg_rent:
        gpr = p.avg_rent * 12 * units
        egi = gpr * (1 - _v(m["rent"]["vacancy"]))
        opex = egi * _v(m["rent"]["opex_share"])
        noi = egi - opex
        return {"mode": "rent", "gross_rent": round(gpr), "effective_income": round(egi),
                "operating_costs": round(opex), "noi": round(noi),
                "yield_on_cost_pct": round(noi / cost["total"] * 100, 2) if cost["total"] else 0}
    if p.exit == "sell" and p.avg_sale_price:
        revenue = p.avg_sale_price * units
        profit = revenue - cost["total"]
        return {"mode": "sell", "revenue": round(revenue), "profit": round(profit),
                "margin_pct": round(profit / revenue * 100, 1) if revenue else 0}
    return None


# ---------------------------------------------------------------- checks

def check_scheme(p: DevelopmentInput, s: Scheme, env: dict, sz: dict, lay: dict, cost: dict, ret: dict | None) -> list[CheckItem]:
    out: list[CheckItem] = []
    add = lambda st, l, d: out.append(CheckItem(status=st, label=l, detail=d))  # noqa: E731
    m = mf_model()

    gap = cost["total"] - p.budget_total
    if gap <= 0:
        add("ok", "Within budget", f"${cost['total']:,.0f} total development cost vs ${p.budget_total:,.0f} budget.")
    elif gap <= 0.10 * p.budget_total:
        add("warn", "Slightly over budget", f"${cost['total']:,.0f}, ${gap:,.0f} over your ${p.budget_total:,.0f} budget.")
    else:
        add("fail", "Over budget", f"${cost['total']:,.0f}, ${gap:,.0f} over your ${p.budget_total:,.0f} budget.")

    if lay["too_wide"]:
        add("fail", "Buildings too wide for the site",
            f"Each building is about {sz['building_width_ft']:.0f} ft wide; the buildable width is {env['buildable_width_ft']:.0f} ft. Use more, smaller buildings.")
    elif lay["depth_needed_ft"] > env["buildable_depth_ft"] + 0.5:
        add("fail", "Does not fit the site",
            f"Buildings{' and parking' if lay['parking'] else ''} need about {lay['depth_needed_ft']:.0f} ft of depth; "
            f"the buildable depth is {env['buildable_depth_ft']:.0f} ft.")
    else:
        add("ok", "Fits the site", f"{s.buildings} building(s) in {lay['rows']} row(s)"
            f"{' plus surface parking' if lay['parking'] else ''} inside the buildable area.")
    if sz["total_footprint_sqft"] > env["max_building_footprint_sqft"]:
        add("fail", "Covers too much of the site",
            f"Building footprint {sz['total_footprint_sqft']:,} sq ft; limit {env['max_building_footprint_sqft']:,} sq ft.")

    if s.stories > env["max_stories"]:
        why = f"a {env['max_height_ft']:.0f} ft height limit" if env["height_checked"] else "your maximum"
        add("fail", "Too tall", f"{s.stories} stories; {why} allows {env['max_stories']}.")
    elif env["height_checked"]:
        add("ok", "Within the height limit", f"{s.stories} stories (about {sz['height_ft']} ft).")
    elif s.stories >= 4:
        add("warn", "Confirm the height limit", f"{s.stories} stories, about {sz['height_ft']} ft. Check the zoning height limit.")
    if s.stories >= 4 and "elevator" not in s.amenities:
        add("warn", "Elevator likely needed", f"Buildings of {s.stories} stories usually need an elevator for accessibility.")
    if s.stories >= 5 and s.product == "garden_apartments":
        add("warn", "Taller than a typical garden building",
            "5+ stories usually means a different construction type (podium or mid-rise), which can cost more than this estimate.")

    if sz["units"] > env["max_units"]:
        add("fail", "Exceeds allowed density",
            f"{sz['units']} units; {env['max_units_per_acre']:g} units/acre on {env['acres']} acres allows {env['max_units']}.")
    else:
        add("ok", "Within density", f"{sz['units']} units ({sz['units'] / max(env['acres'], 0.01):.1f}/acre; limit {env['max_units_per_acre']:g}).")

    want = math.ceil(sz["units"] * p.parking_per_unit)
    if s.parking_spaces < want:
        add("warn", "Less parking than requested", f"{s.parking_spaces} spaces vs {want} at {p.parking_per_unit:g} per unit.")
    else:
        add("ok", "Parking", f"{s.parking_spaces} {s.parking_type} spaces ({s.parking_spaces / max(sz['units'], 1):.2f} per unit).")

    lo, hi = m["products"][s.product]["units_per_building"]
    upb = sz["units_per_building"]
    if not lo <= upb <= hi:
        add("warn", "Unusual building size", f"{upb:g} units per building; {m['products'][s.product]['label'].lower()} usually have {lo}-{hi}.")

    mins = m["unit_comfort_min_sqft"]
    small = [f"{u.name} ({u.area_sqft} sq ft)" for u in s.unit_types if u.area_sqft < mins[str(min(u.bedrooms, 4))]]
    if small:
        add("warn", "Some units are smaller than typical", f"{', '.join(small)}.")
    if p.target_units and abs(sz["units"] / p.target_units - 1) > 0.2:
        add("warn", "Unit count differs from your target", f"{sz['units']} units vs {p.target_units} target.")
    beds_wanted = {"studio": 0, "1br": 1, "2br": 2, "3br": 3}
    have = {u.bedrooms for u in s.unit_types}
    missing = [k.upper() for k in p.unit_types if beds_wanted[k] not in have]
    if missing:
        add("warn", "Missing requested unit types", ", ".join(missing).replace("STUDIO", "Studio") + " not included.")
    for a in p.amenities:
        if a in amenity_catalog() and a not in s.amenities:
            add("warn", f"Missing: {amenity_catalog()[a]['label']}", "Requested amenity not in this plan.")

    if ret:
        if ret["mode"] == "rent":
            st = "ok" if ret["noi"] > 0 else "fail"
            add(st, "Rental income", f"Net operating income ${ret['noi']:,.0f}/yr; yield on cost {ret['yield_on_cost_pct']:.2f}%.")
        else:
            st = "ok" if ret["profit"] > 0 else "fail"
            add(st, "Sale profit" if ret["profit"] > 0 else "Sells at a loss",
                f"Revenue ${ret['revenue']:,.0f}, profit ${ret['profit']:,.0f} ({ret['margin_pct']:.1f}% margin).")
    return out


def evaluate_scheme(p: DevelopmentInput, s: Scheme) -> dict:
    """Size, lay out, price and check one scheme: the single source of truth for every number."""
    env = dev_envelope(p, s.product)
    sz = size_scheme(p, s)
    lay = layout_site(p, s, sz, env)
    cost = price_scheme(p, s, sz)
    ret = returns(p, sz, cost)
    checks = check_scheme(p, s, env, sz, lay, cost, ret)
    return {"envelope": env, "sizing": sz, "layout": lay, "cost": cost, "returns": ret,
            "checks": [c.model_dump() for c in checks]}


def dev_allowed_amounts(evals: list[dict], budget: float) -> set[float]:
    """Every dollar figure computed for these schemes, plus budget gaps and differences."""
    vals: set[float] = {budget}
    totals = []
    for ev in evals:
        c = ev["cost"]
        for k in ("cost_per_sqft", "buildings", "gc_overhead", "parking", "parking_per_space", "hard_total",
                  "soft_costs", "contingency", "land", "total", "per_unit"):
            vals.add(c[k])
        vals.update(a["cost"] for a in c["amenities"])
        vals.update(a["cost"] for a in c.get("site_work", []))
        if ev["returns"]:
            vals.update(v for k, v in ev["returns"].items() if isinstance(v, (int, float)) and not k.endswith("_pct"))
        vals.add(abs(c["total"] - budget))
        totals.append(c["total"])
    for a in totals:
        for b in totals:
            vals.add(abs(a - b))
    return {v for v in vals if v}


# ---------------------------------------------------------------- drawings

PRODUCT_COLORS = {"duplex": "#E9D8C4", "fourplex": "#E8DDB5", "townhomes": "#DCE5D0", "garden_apartments": "#D7E3E0"}


def site_plan_svg(p: DevelopmentInput, s: Scheme, lay: dict, env: dict, compact: bool = False) -> str:
    W, D = p.lot_width_ft, p.lot_depth_ft
    scale = min(560 / W, 420 / D) if not compact else min(300 / W, 170 / D)
    pad = 8
    sw, sd = W * scale + 2 * pad, D * scale + 2 * pad + 16
    sb = env["setbacks_ft"]
    t = lambda v: v * scale + pad  # noqa: E731
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {sw:.0f} {sd:.0f}" class="siteSvg" role="img" '
           f'aria-label="Site plan of {escape(s.name)}">',
           f'<rect x="{pad}" y="{pad}" width="{W * scale:.1f}" height="{D * scale:.1f}" fill="#E7ECDF" stroke="#7D8F69" stroke-width="2"/>',
           f'<rect x="{t(sb["side"]):.1f}" y="{t(sb["rear"]):.1f}" width="{env["buildable_width_ft"] * scale:.1f}" '
           f'height="{env["buildable_depth_ft"] * scale:.1f}" fill="none" stroke="#B08968" stroke-dasharray="5 3" stroke-width="1.5"/>']
    pk = lay["parking"]
    if pk:
        out.append(f'<rect x="{t(pk["x"]):.1f}" y="{t(pk["y"]):.1f}" width="{pk["w"] * scale:.1f}" height="{pk["h"] * scale:.1f}" '
                   f'fill="#8E8984" opacity=".55"/>')
        if not compact:
            out.append(f'<text x="{t(pk["x"] + pk["w"] / 2):.1f}" y="{t(pk["y"] + pk["h"] / 2) + 4:.1f}" font-size="11" '
                       f'text-anchor="middle" fill="#fff" font-weight="600">{pk["spaces"]} parking spaces</text>')
    color = PRODUCT_COLORS.get(s.product, "#E6E1DA")
    for b in lay["buildings"]:
        out.append(f'<rect x="{t(b["x"]):.1f}" y="{t(b["y"]):.1f}" width="{b["w"] * scale:.1f}" height="{b["h"] * scale:.1f}" '
                   f'fill="{color}" stroke="#5B4B3E" stroke-width="{1.2 if compact else 2}"/>')
        if not compact and b["w"] * scale > 40:
            out.append(f'<text x="{t(b["x"] + b["w"] / 2):.1f}" y="{t(b["y"] + b["h"] / 2):.1f}" font-size="10.5" '
                       f'text-anchor="middle" fill="#4A3F35" font-weight="600">{escape(b["label"])}</text>')
            out.append(f'<text x="{t(b["x"] + b["w"] / 2):.1f}" y="{t(b["y"] + b["h"] / 2) + 12:.1f}" font-size="9.5" '
                       f'text-anchor="middle" fill="#4A3F35" opacity=".75">{escape(b["sub"])}</text>')
    out.append(f'<text x="{pad + W * scale / 2:.1f}" y="{sd - 3:.0f}" font-size="{9 if compact else 10.5}" text-anchor="middle" fill="#7A6F63">street</text>')
    out.append("</svg>")
    return "".join(out)


def site_model_3d(p: DevelopmentInput, lay: dict, env: dict) -> dict:
    from nestquest.drawing import STYLE_LOOK
    look = STYLE_LOOK.get(p.style, STYLE_LOOK["modern"])
    return {
        "kind": "site",
        "style": p.style,
        "roof": look["roof"],
        "colors": {"wall": look["wall"], "trim": look["trim"], "accent": look["accent"]},
        "story_height": 10,
        "buildings": lay["buildings"],
        "parking": lay["parking"],
        "lot": {"w": p.lot_width_ft, "d": p.lot_depth_ft, "setbacks": env["setbacks_ft"],
                "existing": ({"x": round((p.lot_width_ft - math.sqrt(env["existing_kept_sqft"])) / 2, 1),
                              "y": env["setbacks_ft"]["rear"], "w": round(math.sqrt(env["existing_kept_sqft"]), 1),
                              "h": round(math.sqrt(env["existing_kept_sqft"]), 1)} if env["existing_kept_sqft"] else None)},
    }
