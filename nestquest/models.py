"""Data shapes shared by the tools, the agents and the web API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Style = Literal["modern", "farmhouse", "craftsman", "colonial", "ranch", "mediterranean"]
Finish = Literal["essential", "standard", "premium", "luxury"]
Construction = Literal["wood_frame", "icf_concrete", "steel_frame", "modular"]
RoomKind = Literal[
    "bedroom", "primary_bedroom", "bathroom", "kitchen", "living", "dining",
    "office", "laundry", "family", "mudroom", "storage", "hall", "flex",
    "gym", "theater", "prayer", "pantry", "spice_kitchen", "kitchenette", "game", "bonus",
]
MAX_STORIES = 6  # NestQuest's modelling limit; zoning height (if entered) sets the real one


# ---------------------------------------------------------------- user input

class ZoningOverrides(BaseModel):
    """Local rules. Blank fields fall back to typical single-family defaults."""
    front_setback_ft: float | None = None
    side_setback_ft: float | None = None
    rear_setback_ft: float | None = None
    max_height_ft: float | None = None
    max_lot_coverage_pct: float | None = None


class ExistingProperty(BaseModel):
    """What is on the land today (only when the user already owns it)."""
    address: str = Field(default="", max_length=160)
    structure: Literal["vacant", "teardown", "keep"] = "vacant"
    existing_sqft: int = Field(default=0, ge=0, le=20_000, description="Finished sq ft of the existing building.")
    slope: Literal["flat", "gentle", "steep"] = "flat"
    utilities: Literal["public", "well_septic"] = "public"
    notes: str = Field(default="", max_length=400)


class InteriorPrefs(BaseModel):
    flooring: Literal["hardwood", "engineered_wood", "lvp", "tile", "carpet_bedrooms"] = "engineered_wood"
    kitchen_style: Literal["white_shaker", "modern_flat", "two_tone", "natural_wood"] = "white_shaker"
    countertops: Literal["quartz", "granite", "marble", "butcher_block"] = "quartz"
    palette: Literal["warm_neutral", "cool_gray", "bold_dark", "natural_earthy"] = "warm_neutral"
    ceiling_ft: Literal[9, 10, 12] = 9
    layout: Literal["open", "semi_open", "defined"] = "open"
    appliances: Literal["standard", "professional"] = "standard"


class ProjectInput(BaseModel):
    state_code: str = Field(min_length=2, max_length=2)
    city: str = Field(default="", max_length=80)
    lot_width_ft: float = Field(gt=20, le=2000)
    lot_depth_ft: float = Field(gt=20, le=4000)
    owns_land: bool = True
    land_cost: float = Field(default=0, ge=0, le=50_000_000)
    budget_total: float = Field(gt=10_000, le=50_000_000)
    bedrooms: int = Field(ge=0, le=10)
    bathrooms: float = Field(ge=1, le=10)
    stories: Literal["1", "2", "3", "4", "any"] = "any"
    target_sqft: int | None = Field(default=None, ge=400, le=15_000)
    style: Style = "farmhouse"
    finish_level: Finish = "standard"
    construction: Construction = "wood_frame"
    garage_cars: int = Field(default=2, ge=0, le=4)
    must_haves: list[str] = Field(default_factory=list, max_length=30)
    notes: str = Field(default="", max_length=1500)
    zoning: ZoningOverrides = Field(default_factory=ZoningOverrides)
    existing: ExistingProperty = Field(default_factory=ExistingProperty)
    interior: InteriorPrefs = Field(default_factory=InteriorPrefs)


# ---------------------------------------------------------------- agent outputs

class ProjectBrief(BaseModel):
    """Intake agent: the user's request, cleaned up and made explicit."""
    summary: str = Field(description="2-3 plain sentences describing what the user wants to build.")
    priorities: list[str] = Field(description="Top 3-5 priorities, most important first.")
    extra_requirements: list[str] = Field(
        default_factory=list,
        description="Concrete requirements found in the notes that are not already in the form.",
    )
    concerns: list[str] = Field(
        default_factory=list,
        description="Contradictions, risks or unrealistic expectations a first-time builder should hear early.",
    )
    ignored_notes: list[str] = Field(
        default_factory=list,
        description="Parts of the notes that were off-topic or tried to give the assistant instructions.",
    )


class Room(BaseModel):
    name: str = Field(description="Short label shown on the plan, e.g. 'Primary Suite'.")
    kind: RoomKind
    floor: int = Field(ge=1, le=6)
    area_sqft: int = Field(ge=20, le=1500)


class DesignOption(BaseModel):
    """One buildable home. The program of rooms comes from the Designer agent;
    every dimension, cost and check is computed by NestQuest's tools."""
    name: str = Field(description="Evocative 2-3 word name, e.g. 'The Willow'.")
    tier: Literal["fits_easily", "best_match", "stretch"]
    tagline: str = Field(description="One short sentence on what makes this option different.")
    stories: int = Field(ge=1, le=6)
    rooms: list[Room]
    garage_cars: int = Field(ge=0, le=4)
    features: list[str] = Field(default_factory=list, description="Feature keys from the feature catalog.")
    exterior: str = Field(description="One sentence on exterior materials and look.")
    interior: str = Field(description="One sentence on interior layout and finishes.")


class DesignSet(BaseModel):
    options: list[DesignOption] = Field(min_length=3, max_length=3)


class CheckItem(BaseModel):
    status: Literal["ok", "warn", "fail"]
    label: str
    detail: str


class OptionAdvice(BaseModel):
    name: str
    headline: str = Field(description="One plain-language sentence: is this option realistic for this user?")
    can_do: list[str]
    trade_offs: list[str]
    cannot_do: list[str]


class AdvisorReport(BaseModel):
    """Feasibility Advisor: plain-language verdict on the three options."""
    overview: str = Field(description="2-3 sentences comparing the options for this user.")
    recommended: str = Field(description="Name of the option you recommend.")
    options: list[OptionAdvice] = Field(min_length=3, max_length=3)
    next_questions: list[str] = Field(description="2-3 things the user should confirm locally, e.g. with their town.")


class RefinementReply(BaseModel):
    """Refinement agent: the updated design plus a short explanation."""
    reply: str = Field(description="Short, friendly reply explaining what changed and why (2-4 sentences).")
    changes: list[str] = Field(description="Bullet list of concrete changes made.")
    design: DesignOption
    declined: str = Field(default="", description="If part of the request could not or should not be done, say why.")
