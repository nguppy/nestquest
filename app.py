"""NestQuest web app. Run:  python app.py   then open http://127.0.0.1:8000"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import uuid
import webbrowser

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from nestquest import tools
from nestquest.config import DATA_DIR, MODEL_NAME, PRICE_PER_MTOK, PROJECT_DIR, SESSION_TOKEN_CAP, MissingKeyError, require_api_key
from nestquest.drawing import model_3d
from nestquest.models import DesignOption, ProjectInput, Room
from nestquest.multifamily import DevelopmentInput, Scheme, amenity_catalog, mf_model
from nestquest.tools import GROUP_LABELS, INTERIOR_LABELS, must_have_groups

STATIC = PROJECT_DIR / "static"
app = FastAPI(title="NestQuest")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

RUNS: dict[str, dict] = {}  # in-memory: one entry per planning run (one browser session)


class RefineRequest(BaseModel):
    option_index: int = Field(ge=0, le=2)
    message: str = Field(min_length=1, max_length=600)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/meta")
def meta():
    cm = tools.cost_model()
    sources = json.loads((DATA_DIR / "cost_sources.json").read_text(encoding="utf-8"))
    try:
        require_api_key()
        key_ok = True
    except MissingKeyError:
        key_ok = False
    return {
        "model": MODEL_NAME,
        "price_per_mtok": PRICE_PER_MTOK,
        "key_ok": key_ok,
        "states": sorted(({"code": k, "name": v["name"], "factor": v["factor"]}
                          for k, v in tools.state_factors().items()), key=lambda s: s["name"]),
        "must_have_groups": {GROUP_LABELS[g]: items for g, items in must_have_groups().items()},
        "interior_labels": INTERIOR_LABELS,
        "features": {k: v["label"] for k, v in tools.feature_catalog().items()},
        "zoning_defaults": cm["zoning_defaults"]["value"],
        "assumptions": {k: v for k, v in cm.items() if isinstance(v, dict) and "cite" in v},
        "state_factor_source": sources.get("state_factor_source", {}),
        "dev": {
            "products": {k: v["label"] for k, v in mf_model()["products"].items()},
            "amenities": {k: v["label"] for k, v in amenity_catalog().items()},
            "assumptions": {k: v for k, v in mf_model().items() if isinstance(v, dict) and "cite" in v},
            "hard_cost": mf_model()["hard_cost_per_sqft"],
            "parking": mf_model()["parking"],
            "rent": mf_model()["rent"],
        },
    }


SAMPLE_PROJECT = ProjectInput(state_code="VA", lot_width_ft=100, lot_depth_ft=150, budget_total=750_000,
                              bedrooms=3, bathrooms=2.5, style="farmhouse")
SAMPLE_DESIGN = DesignOption(
    name="The Sample", tier="best_match", tagline="", stories=2, garage_cars=2,
    features=["covered_porch", "solar_panels"], exterior="", interior="",
    rooms=[Room(name=n, kind=k, floor=f, area_sqft=a) for n, k, f, a in [
        ("Living", "living", 1, 330), ("Kitchen", "kitchen", 1, 240), ("Dining", "dining", 1, 160),
        ("Office", "office", 1, 120), ("Primary Suite", "primary_bedroom", 1, 240), ("Primary Bath", "bathroom", 1, 110),
        ("Mudroom", "mudroom", 1, 60), ("Bedroom 2", "bedroom", 2, 150), ("Bedroom 3", "bedroom", 2, 140),
        ("Bath", "bathroom", 2, 60), ("Loft", "flex", 2, 180), ("Laundry", "laundry", 2, 50)]],
)


@app.get("/api/sample-model")
def sample_model():
    """3D model of a built-in sample home for the homepage (no AI call)."""
    ev = tools.evaluate(SAMPLE_PROJECT, SAMPLE_DESIGN)
    return model_3d(SAMPLE_DESIGN, ev["sizing"], SAMPLE_PROJECT.style, tools.lot_3d(SAMPLE_PROJECT, ev["sizing"]),
                    SAMPLE_PROJECT.interior.model_dump())


@app.get("/api/geocode")
async def geocode(q: str):
    """Find an address with OpenStreetMap's Nominatim service (US only) so we can map it and fill in the state."""
    import urllib.parse
    import urllib.request
    q = q.strip()[:160]
    if len(q) < 5:
        raise HTTPException(400, "Please enter a full street address.")
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "addressdetails": 1, "countrycodes": "us", "limit": 1})
    req = urllib.request.Request(url, headers={"User-Agent": "NestQuest-planning-tool/1.0 (student project)"})

    def fetch():
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read().decode("utf-8"))
    try:
        hits = await asyncio.to_thread(fetch)
    except Exception:
        raise HTTPException(503, "Couldn't reach the map service. You can still continue; just pick the state yourself.")
    if not hits:
        raise HTTPException(404, "We couldn't find that address. Check the spelling, or pick the state yourself.")
    h = hits[0]
    state_name = h.get("address", {}).get("state", "")
    code = next((k for k, v in tools.state_factors().items() if v["name"].lower() == state_name.lower()), None)
    return {"lat": float(h["lat"]), "lon": float(h["lon"]), "display_name": h.get("display_name", ""),
            "state_code": code, "city": h.get("address", {}).get("city") or h.get("address", {}).get("town")
            or h.get("address", {}).get("village") or ""}


async def _plan(run_id: str):
    run = RUNS[run_id]
    try:
        # Imported here so the page can still load (and explain) when the key is missing.
        from nestquest.pipeline import BudgetExceeded, plan_development, plan_project
    except MissingKeyError as e:
        run.update(status="error", error=str(e))
        return
    planner = plan_development if run["kind"] == "dev" else plan_project
    try:
        run["result"] = await planner(run["project"], run["events"])
        run["tokens_used"] = run["result"]["usage"]["total_tokens"]
        run["status"] = "done"
    except (MissingKeyError, BudgetExceeded) as e:
        run.update(status="error", error=str(e))
    except Exception as e:  # show a friendly message, keep details in the trace
        run["events"].append({"agent": "app", "kind": "error", "summary": f"{type(e).__name__}: {e}"[:400]})
        run.update(status="error", error="Something went wrong while planning. Please try again.")


def _start(project, kind: str) -> dict:
    if project.state_code.upper() not in tools.state_factors():
        raise HTTPException(400, "Please choose a US state.")
    run_id = uuid.uuid4().hex[:12]
    RUNS[run_id] = {"kind": kind, "project": project, "events": [], "status": "running", "result": None,
                    "error": None, "tokens_used": 0, "chat": {}}
    RUNS[run_id]["task"] = asyncio.create_task(_plan(run_id))  # keep a reference so it isn't garbage-collected
    return {"run_id": run_id}


@app.post("/api/plan")
async def start_plan(project: ProjectInput):
    return _start(project, "home")


@app.post("/api/dev/plan")
async def start_dev_plan(project: DevelopmentInput):
    return _start(project, "dev")


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found. It may have expired; please start again.")
    return {k: run[k] for k in ("kind", "status", "events", "result", "error", "tokens_used")}


@app.post("/api/runs/{run_id}/refine")
async def refine(run_id: str, req: RefineRequest):
    from nestquest.pipeline import BudgetExceeded, refine_design, refine_scheme
    run = RUNS.get(run_id)
    if not run or run["status"] != "done":
        raise HTTPException(404, "Plan not found. Please start again.")
    if run["tokens_used"] >= SESSION_TOKEN_CAP:
        raise HTTPException(429, "This session has used its token allowance. Start a new plan to keep going.")

    dev = run["kind"] == "dev"
    key = "scheme" if dev else "design"
    history = run["chat"].setdefault(req.option_index, [run["result"]["options"][req.option_index]])
    events: list[dict] = []
    try:
        if dev:
            current = Scheme.model_validate(history[-1]["scheme"])
            out = await refine_scheme(run["project"], current, run["result"]["brief"], req.message, events)
        else:
            current = DesignOption.model_validate(history[-1]["design"])
            out = await refine_design(run["project"], current, run["result"]["brief"], req.message, events)
    except BudgetExceeded as e:
        raise HTTPException(429, str(e))
    run["tokens_used"] += out["usage"]["total_tokens"]
    if not out["blocked"] and out["option"][key] != history[-1][key]:
        history.append(out["option"])  # only real edits create a new version
    out["events"] = events
    out["tokens_used"] = run["tokens_used"]
    out["version"] = len(history)
    return out


@app.post("/api/runs/{run_id}/undo/{option_index}")
def undo(run_id: str, option_index: int):
    run = RUNS.get(run_id)
    history = run and run["chat"].get(option_index)
    if not history:
        raise HTTPException(404, "Nothing to undo.")
    if len(history) > 1:
        history.pop()
    return {"option": history[-1], "version": len(history)}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    url = f"http://127.0.0.1:{port}"
    print(f"\n  NestQuest is running at {url}  (Ctrl+C to stop)\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
