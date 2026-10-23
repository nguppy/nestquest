# NestQuest by EngeeHomes

**Plan a home or a development you can actually build.** NestQuest is a planning tool from EngeeHomes, a real estate developer based in Northern Virginia, focused on beautiful, sustainable communities, and expanding across the DMV and beyond. NestQuest itself works anywhere in the U.S.: costs are adjusted for all 50 states and D.C. It helps customers arrive with a realistic vision that EngeeHomes would be happy to build with them.

- **Homeowners:** enter a budget, a lot and the home you picture, and get three buildable home designs. Each comes with:
  - floor plans and a 3D model, including an "inside" view of each floor
  - a cost estimate based on your state's construction costs
  - a plain-language list of what works and what doesn't
- **Developers:** plan duplexes, fourplexes, townhomes or garden apartments, and get three site plans (lean, balanced, max yield). Each comes with:
  - unit mix, parking, density and height checks
  - total development cost and cost per unit
  - yield on cost or sale margin
  - a 3D model of the whole site
- **Your property:** if you already own the land, enter the address and NestQuest maps it (OpenStreetMap) and fills in the state. You can also say:
  - what's on the land today: vacant, a building to tear down, or a building that stays
  - the slope
  - whether it has public utilities or a well and septic

  Designs and costs account for all of it.
- **Interior preferences:** flooring, cabinets, countertops, color palette, ceiling height, open or defined layout, and appliances. They change the cost estimate and the furnished 3D "inside" view of each floor.
- **No story cap:** stories are only limited by a height limit you enter.
- **Features:** over 35 grouped options covering sustainability, outdoor living, lifestyle (including an in-law suite, spice kitchen and prayer room) and accessibility, plus over 20 amenities for developments.
- **About Us:** EngeeHomes' mission, vision, founder, process, projects (including the upcoming Manassas, VA multifamily development), design insights and contact details.
- **Refine by chatting** in either flow ("add a home office", "add 4 more 3BR units"). The plan, price, checks and 3D model update every time.
- **AI team:** four agents per flow (Intake, Designer, Advisor, Refinement) on `gpt-6-luna` via Portkey.
- **Numbers:** every dollar figure, dimension and pass/fail check comes from NestQuest's calculators, which use cited data (NAHB 2024, DoD 2026 area cost factors, IRC R304, RLB 2026, WGI 2026, NAA, Census). The AI is never allowed to make up a price.

## Run it locally (about 3 minutes)

You need **Python 3.12 or newer** and the course **Portkey API key**.

1. **Get the code**
   ```bash
   git clone https://github.com/nguppy/nestquest.git
   cd nestquest
   ```
2. **Create a virtual environment and install** (4 small packages)
   ```bash
   python -m venv .venv
   ```
   - Windows: `.venv\Scripts\activate`
   - macOS/Linux: `source .venv/bin/activate`
   ```bash
   pip install -r requirements.txt
   ```
3. **API key.** NestQuest reads `PORTKEY_API_KEY` from a `.env` file. It looks in this folder first, then in the folder above it. If your `.env` already sits one level up, skip this step. Otherwise:
   ```bash
   cp .env.example .env      # then paste your key into .env
   ```
4. **Start the app**
   ```bash
   python app.py
   ```
   Your browser opens at **http://127.0.0.1:8000**. If it doesn't, open that address yourself. Stop the app with `Ctrl+C`.

5. **Try it:** pick **Plan a home** or **Plan a development**, click **"Fill in an example…"**, then submit. Planning takes about a minute.

> The 3D views load Three.js from a CDN, so they need an internet connection. Everything else runs locally.
>
> If the page shows "API key not found", the `.env` file isn't in this folder or the folder above, or the key name isn't exactly `PORTKEY_API_KEY`.

**Optional: offline tests.** These cover the safety defenses and calculators and need no key:
```bash
python -m unittest -v
```

## How it works

```
Your form + notes
   │
   ▼
[Safety guard] ── removes injected instructions from your notes (plain Python)
   │
   ▼
[Intake agent] ── project brief: priorities, extra wishes, early warnings
   │
   ▼
[Designer agent] ⇄ tools: site_rules · feature_catalog · evaluate_design
   │                (drafts 3 homes, tests each one, fixes what fails)
   ▼
[Calculators] ── final size, cost, lot fit and code checks + floor plan & sketch drawings
   │
   ▼
[Feasibility Advisor] ── can do / trade-offs / can't do, in plain words
   │                    (answers with made-up dollar figures are rejected and retried)
   ▼
Three options  ──►  pick one  ──►  [Refinement agent] ⇄ same tools, one chat turn at a time
```

| Path | What it is |
|---|---|
| `app.py` | FastAPI web server and API routes |
| `nestquest/config.py` | The only model setup (`gpt-6-luna` via Portkey), `.env` loading, token caps and prices |
| `nestquest/agents.py` | The home agents and their tools |
| `nestquest/dev_agents.py` | The development agents and their tools |
| `nestquest/multifamily.py` | Development inputs, site layout, cost, returns, zoning checks and site drawings |
| `nestquest/pipeline.py` | How the agents hand work to each other |
| `nestquest/tools.py` | Site rules, sizing, cost and feasibility calculators |
| `nestquest/guard.py` | Prompt-injection filter and the invented-number check |
| `nestquest/drawing.py` | SVG floor plans, front sketches and 3D model data |
| `nestquest/prompts/` | Each agent's instructions |
| `data/` | Cost models and sources: `cost_model.json`, `cost_model_mf.json`, `cost_sources.json`, `multifamily_sources.json`, `state_cost_factors.csv` |
| `static/` | The web page (HTML/CSS/JS, no build step). The main files are:<br>• `viewer3d.js`: the Three.js 3D viewer, including furnished interiors<br>• `dev.js`: the developer pages<br>• `forms.js`: the property, interior and feature pickers<br>• `img/about/`: photos from EngeeHomes' materials |
| `tests/` | Offline tests |

## Safety and spending limits

- **Prompt injection:** notes and chat messages are screened before any agent sees them. Suspicious sentences are dropped from the notes, and suspicious chat messages are refused without calling the model. User text is passed to agents inside tags and labeled as data.
- **No invented numbers:** the Advisor's and Refiner's answers are scanned for dollar amounts. Any amount the calculators didn't produce sends the answer back to the agent for a retry.
- **Stays on topic:** the Refinement agent only edits the home design and declines anything else.
- **Spending caps:**
  - a planning run is capped at 16 model requests / 120k tokens
  - a chat turn is capped at 8 requests / 60k tokens
  - a session is capped at 400k tokens
- **Secrets:** the key is read only from `.env` and is never committed (see `.gitignore`).
- **Honesty:** the app labels everything a planning estimate, not a quote. It lists which inputs are sourced and which are assumptions (see **Sources & assumptions** in the app footer).

## Data sources

- **National cost:** NAHB, *Cost of Constructing a Home – 2024* (Jan 2025): $162 per finished sq ft, phase breakdown, and builder overhead and profit shares.
- **State costs:** U.S. DoD, *UFS 3-701-01 Facilities Pricing Guide* (June 2026), Table 4-1 Area Cost Factors, as the median factor per state. These price military construction, so NestQuest uses them only as an approximation of regional costs.
- **Room minimum:** International Residential Code R304: habitable rooms at least 70 sq ft.
- **Multi-family hard costs:**
  - Garden apartments: Rider Levett Bucknall Q2 2026 "Multi-Family" cost per sq ft. NestQuest uses the mean of the low end across 18 US cities ($250).
  - Townhomes, duplexes and fourplexes: NAHB's $162 per sq ft.
- **Multi-family soft costs:** Minnesota Housing (2018): 17% of total development cost.
- **Parking:**
  - Structured: WGI 2026, $33,300 per space.
  - Surface: midpoint of a sourced $5,000–$20,000 range (Ventura County 2022, VTPI 2021).
  - Land per surface space: VTPI, 300 sq ft.
- **Rental math:**
  - Vacancy: Census Housing Vacancy Survey Q2 2026 (7.3%).
  - Operating costs: National Apartment Association, 45% of rent.
- **Density defaults:** JHP Architecture rules of thumb (2024).
- **Assumptions:** these are NestQuest planning assumptions, and the app shows them as such:
  - zoning defaults
  - multipliers for finish level, construction method, style and stories
  - feature and amenity costs
  - building spacing
