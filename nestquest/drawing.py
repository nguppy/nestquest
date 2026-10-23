"""SVG drawings: a floor plan per story and a front sketch of the house.

Drawn by code from the design's room list and computed footprint, so the
picture always matches the numbers.
"""

from __future__ import annotations

from html import escape

from nestquest.models import DesignOption

ROOM_COLORS = {
    "primary_bedroom": "#E9D8C4", "bedroom": "#F1E4D3", "bathroom": "#D7E3E0",
    "kitchen": "#E8DDB5", "living": "#DCE5D0", "family": "#DCE5D0", "dining": "#EFE6C9",
    "office": "#E3DCEB", "laundry": "#D9DEE6", "mudroom": "#E2DED6", "storage": "#E6E1DA",
    "hall": "#F3EEE7", "flex": "#E7E0D0",
}
INK = "#4A3F35"
WALL = "#5B4B3E"


# ---------------------------------------------------------------- squarified treemap

def _worst(row: list[float], w: float) -> float:
    s = sum(row)
    return max(max(w * w * r / (s * s), (s * s) / (w * w * r)) for r in row)


def _squarify(areas: list[float], x: float, y: float, w: float, h: float) -> list[tuple]:
    """Lay areas (already scaled to w*h) into the rectangle; returns (x, y, w, h) per area."""
    rects: list[tuple] = []
    items = list(areas)
    while items:
        short = min(w, h)
        row = [items.pop(0)]
        while items and _worst(row + [items[0]], short) <= _worst(row, short):
            row.append(items.pop(0))
        s = sum(row)
        if w >= h:  # column on the left
            cw = s / h
            cy = y
            for a in row:
                rects.append((x, cy, cw, a / cw))
                cy += a / cw
            x, w = x + cw, w - cw
        else:  # row on top
            rh = s / w
            cx = x
            for a in row:
                rects.append((cx, y, a / rh, rh))
                cx += a / rh
            y, h = y + rh, h - rh
    return rects


def floor_plan_svg(design: DesignOption, sizing: dict, floor: int) -> str:
    rooms = sorted((r for r in design.rooms if r.floor == floor), key=lambda r: -r.area_sqft)
    hw, hd = sizing["house_width_ft"], sizing["house_depth_ft"]
    gw = sizing["garage_width_ft"] if floor == 1 else 0
    front = sizing.get("garage_placement") == "front"
    pad = 6
    scale = min(8.0, 560 / max(hw + (0 if front else gw), 1), 520 / max(hd + (22 if front and gw else 0), 1))
    if front:
        W = max(hw, gw) * scale + 2 * pad
        H = (hd + (22 if gw else 0)) * scale + 2 * pad + 18
    else:
        W = (hw + gw) * scale + 2 * pad
        H = max(hd, 22 if gw else 0) * scale + 2 * pad + 18

    total = sum(r.area_sqft for r in rooms) or 1
    areas = [r.area_sqft / total * hw * hd for r in rooms]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" class="plan" role="img" '
             f'aria-label="Floor {floor} plan of {escape(design.name)}">']
    ox, oy = (pad, pad) if front else (pad + gw * scale, pad)
    for r, (x, y, w, h) in zip(rooms, _squarify(areas, 0, 0, hw, hd)):
        px, py, pw, ph = ox + x * scale, oy + y * scale, w * scale, h * scale
        parts.append(f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph:.1f}" '
                     f'fill="{ROOM_COLORS.get(r.kind, "#EEE")}" stroke="{WALL}" stroke-width="1.5"/>')
        if pw > 34 and ph > 22:
            fs = 11 if pw > 70 else 9
            parts.append(f'<text x="{px + pw / 2:.1f}" y="{py + ph / 2 - 2:.1f}" font-size="{fs}" '
                         f'text-anchor="middle" fill="{INK}" font-weight="600">{escape(r.name)}</text>')
            parts.append(f'<text x="{px + pw / 2:.1f}" y="{py + ph / 2 + fs:.1f}" font-size="{fs - 1}" '
                         f'text-anchor="middle" fill="{INK}" opacity=".75">{r.area_sqft} sq ft</text>')
    parts.append(f'<rect x="{ox:.1f}" y="{oy:.1f}" width="{hw * scale:.1f}" height="{hd * scale:.1f}" '
                 f'fill="none" stroke="{WALL}" stroke-width="4"/>')
    if gw:
        gh = 22 * scale
        gx, gy = (pad, pad + hd * scale) if front else (pad, pad)
        parts.append(f'<rect x="{gx}" y="{gy:.1f}" width="{gw * scale:.1f}" height="{gh:.1f}" fill="#E4E0D8" '
                     f'stroke="{WALL}" stroke-width="3" stroke-dasharray="6 3"/>')
        parts.append(f'<text x="{gx + gw * scale / 2:.1f}" y="{gy + gh / 2:.1f}" font-size="11" '
                     f'text-anchor="middle" fill="{INK}" font-weight="600">{design.garage_cars}-car garage</text>')
    parts.append(f'<text x="{pad}" y="{H - 5:.0f}" font-size="10" fill="{INK}" opacity=".7">'
                 f'Floor {floor} · house about {hw:.0f} × {hd:.0f} ft · street side at bottom · schematic, not to code</text>')
    parts.append("</svg>")
    return "".join(parts)


# ---------------------------------------------------------------- 3D model data

def model_3d(design: DesignOption, sizing: dict, style: str, lot: dict, interior: dict | None = None) -> dict:
    """Everything the browser's 3D viewer needs, in feet. Plan coordinates:
    x runs along the street, y runs from the back of the lot (0) toward the street.
    Room rectangles use the same layout as the 2D floor plans."""
    hw, hd = sizing["house_width_ft"], sizing["house_depth_ft"]
    gw = sizing["garage_width_ft"]
    front = sizing.get("garage_placement") == "front"
    hx = 0 if front else gw  # house's left edge
    floors = {}
    for f in sorted({r.floor for r in design.rooms}):
        rooms = sorted((r for r in design.rooms if r.floor == f), key=lambda r: -r.area_sqft)
        total = sum(r.area_sqft for r in rooms) or 1
        rects = _squarify([r.area_sqft / total * hw * hd for r in rooms], 0, 0, hw, hd)
        floors[str(f)] = [
            {"name": r.name, "kind": r.kind, "area": r.area_sqft, "color": ROOM_COLORS.get(r.kind, "#EEE"),
             "x": round(hx + x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)}
            for r, (x, y, w, h) in zip(rooms, rects)
        ]
    garage = None
    if gw:
        garage = {"x": 0, "y": hd if front else 0, "w": gw, "h": 22, "cars": design.garage_cars}
    look = STYLE_LOOK.get(style, STYLE_LOOK["farmhouse"])
    return {
        "kind": "house",
        "style": style,
        "roof": look["roof"],
        "colors": {"wall": look["wall"], "trim": look["trim"], "accent": look["accent"]},
        "stories": design.stories,
        "story_height": 10,
        "first_story_height": (interior or {}).get("ceiling_ft", 9) + 1,
        "interior": interior or {},
        "house": {"x": hx, "y": 0, "w": hw, "h": hd},
        "garage": garage,
        "floors": floors,
        "features": design.features,
        "lot": lot,
    }


# ---------------------------------------------------------------- front sketch

STYLE_LOOK = {
    "modern": {"roof": "flat", "wall": "#EDEAE4", "trim": "#3E3A36", "accent": "#A7B5A0"},
    "farmhouse": {"roof": "gable", "wall": "#F7F4EE", "trim": "#2F2D2B", "accent": "#8C9A7E"},
    "craftsman": {"roof": "low_gable", "wall": "#C9B79C", "trim": "#5E4B3A", "accent": "#7C8B6A"},
    "colonial": {"roof": "gable", "wall": "#E8E1D3", "trim": "#FFFFFF", "accent": "#3F5566"},
    "ranch": {"roof": "hip", "wall": "#D9CBB4", "trim": "#6B5845", "accent": "#9AA88A"},
    "mediterranean": {"roof": "hip", "wall": "#F0E2C8", "trim": "#9C5B3B", "accent": "#C07A4F"},
}


def elevation_svg(design: DesignOption, sizing: dict, style: str) -> str:
    look = STYLE_LOOK.get(style, STYLE_LOOK["farmhouse"])
    s = 6.0
    hw, gw = sizing["house_width_ft"], sizing["garage_width_ft"]
    wall_h = design.stories * 10 * s
    front = sizing.get("garage_placement") == "front"
    W = (max(hw, gw) if front else hw + gw) * s + 40
    roof_h = {"flat": 6, "gable": 0.42 * hw * s, "low_gable": 0.25 * hw * s, "hip": 0.22 * hw * s}[look["roof"]]
    H = wall_h + roof_h + 30
    g = H - 12  # ground line
    x0 = 20 if front else 20 + gw * s
    hx1 = x0 + hw * s
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" class="elev" role="img" '
         f'aria-label="Front sketch of {escape(design.name)}">']
    p.append(f'<rect x="0" y="{g:.0f}" width="{W:.0f}" height="12" fill="#B9C4A8"/>')
    # garage (beside the house; a front garage is drawn later, in front of the walls)
    if gw and not front:
        gh = 11 * s
        p.append(f'<rect x="20" y="{g - gh:.0f}" width="{gw * s:.0f}" height="{gh:.0f}" fill="{look["wall"]}" stroke="{look["trim"]}" stroke-width="2"/>')
        p.append(f'<rect x="{20 + gw * s * 0.1:.0f}" y="{g - gh * 0.75:.0f}" width="{gw * s * 0.8:.0f}" height="{gh * 0.75:.0f}" fill="#E3DED5" stroke="{look["trim"]}" stroke-width="1.5"/>')
        p.append(f'<polygon points="16,{g - gh:.0f} {24 + gw * s:.0f},{g - gh:.0f} {20 + gw * s:.0f},{g - gh - 18:.0f} 20,{g - gh - 18:.0f}" fill="{look["trim"]}"/>')
    # walls
    p.append(f'<rect x="{x0:.0f}" y="{g - wall_h:.0f}" width="{hw * s:.0f}" height="{wall_h:.0f}" fill="{look["wall"]}" stroke="{look["trim"]}" stroke-width="2"/>')
    # roof
    top = g - wall_h
    if look["roof"] == "flat":
        p.append(f'<rect x="{x0 - 6:.0f}" y="{top - 6:.0f}" width="{hw * s + 12:.0f}" height="6" fill="{look["trim"]}"/>')
    elif look["roof"] == "hip":
        p.append(f'<polygon points="{x0 - 8:.0f},{top:.0f} {hx1 + 8:.0f},{top:.0f} {hx1 - hw * s * 0.25:.0f},{top - roof_h:.0f} {x0 + hw * s * 0.25:.0f},{top - roof_h:.0f}" fill="{look["trim"]}"/>')
    else:
        p.append(f'<polygon points="{x0 - 8:.0f},{top:.0f} {hx1 + 8:.0f},{top:.0f} {(x0 + hx1) / 2:.0f},{top - roof_h:.0f}" fill="{look["trim"]}"/>')
    # windows per story + door
    for st in range(design.stories):
        wy = g - (st + 1) * 10 * s + 2.5 * s
        n = max(int(hw // 9), 2)
        for i in range(n):
            wx = x0 + (i + 0.5) * hw * s / n - 2 * s
            if st == 0 and i == n // 2:
                continue
            ww = 6 * s if style == "modern" else 4 * s
            p.append(f'<rect x="{wx:.0f}" y="{wy:.0f}" width="{ww:.0f}" height="{4.5 * s:.0f}" fill="#CFDCE0" stroke="{look["trim"]}" stroke-width="1.5"/>')
    if gw and front:
        gh = 11 * s
        p.append(f'<rect x="20" y="{g - gh:.0f}" width="{gw * s:.0f}" height="{gh:.0f}" fill="{look["wall"]}" stroke="{look["trim"]}" stroke-width="2"/>')
        p.append(f'<rect x="{20 + gw * s * 0.1:.0f}" y="{g - gh * 0.75:.0f}" width="{gw * s * 0.8:.0f}" height="{gh * 0.75:.0f}" fill="#E3DED5" stroke="{look["trim"]}" stroke-width="1.5"/>')
        p.append(f'<rect x="16" y="{g - gh - 5:.0f}" width="{gw * s + 8:.0f}" height="6" fill="{look["trim"]}"/>')
    dx = x0 + hw * s / 2 - 2 * s
    if gw and front and dx < 20 + gw * s:
        dx = 20 + gw * s + 4 if 20 + gw * s + 4 * s < x0 + hw * s else dx
    p.append(f'<rect x="{dx:.0f}" y="{g - 7.5 * s:.0f}" width="{4 * s:.0f}" height="{7.5 * s:.0f}" fill="{look["accent"]}" stroke="{look["trim"]}" stroke-width="1.5"/>')
    if "covered_porch" in design.features:
        p.append(f'<rect x="{x0 + hw * s * 0.2:.0f}" y="{g - 9 * s:.0f}" width="{hw * s * 0.6:.0f}" height="4" fill="{look["trim"]}"/>')
        for px in (0.22, 0.78):
            p.append(f'<rect x="{x0 + hw * s * px:.0f}" y="{g - 9 * s:.0f}" width="3" height="{9 * s:.0f}" fill="{look["trim"]}"/>')
    if "solar_panels" in design.features and look["roof"] != "flat":
        p.append(f'<polygon points="{x0 + hw * s * 0.6:.0f},{top - roof_h * 0.2:.0f} {x0 + hw * s * 0.85:.0f},{top - roof_h * 0.2:.0f} {x0 + hw * s * 0.72:.0f},{top - roof_h * 0.55:.0f} {x0 + hw * s * 0.6:.0f},{top - roof_h * 0.55:.0f}" fill="#33475B" opacity=".85"/>')
    p.append("</svg>")
    return "".join(p)
