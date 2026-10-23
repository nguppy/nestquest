// NestQuest front end: plain JavaScript, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const kfmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));

const STYLES = {
  modern: ["Modern", "Clean lines, big windows"],
  farmhouse: ["Farmhouse", "Gables, porch, board & batten"],
  craftsman: ["Craftsman", "Low roof, wood details"],
  colonial: ["Colonial", "Symmetric, classic"],
  ranch: ["Ranch", "Long, low, one level"],
  mediterranean: ["Mediterranean", "Stucco, tile roof"],
};
const STYLE_ICON = {
  modern: '<rect x="14" y="22" width="72" height="30" fill="#EDEAE4" stroke="#3E3A36" stroke-width="2"/><rect x="10" y="18" width="80" height="5" fill="#3E3A36"/><rect x="22" y="28" width="26" height="14" fill="#CFDCE0" stroke="#3E3A36"/><rect x="56" y="30" width="10" height="22" fill="#A7B5A0"/>',
  farmhouse: '<rect x="22" y="26" width="56" height="26" fill="#F7F4EE" stroke="#2F2D2B" stroke-width="2"/><polygon points="18,27 82,27 50,6" fill="#2F2D2B"/><rect x="28" y="33" width="9" height="11" fill="#CFDCE0"/><rect x="63" y="33" width="9" height="11" fill="#CFDCE0"/><rect x="45" y="38" width="10" height="14" fill="#8C9A7E"/>',
  craftsman: '<rect x="20" y="26" width="60" height="26" fill="#C9B79C" stroke="#5E4B3A" stroke-width="2"/><polygon points="14,27 86,27 50,12" fill="#5E4B3A"/><rect x="27" y="33" width="10" height="10" fill="#CFDCE0"/><rect x="63" y="33" width="10" height="10" fill="#CFDCE0"/><rect x="45" y="37" width="10" height="15" fill="#7C8B6A"/>',
  colonial: '<rect x="22" y="20" width="56" height="32" fill="#E8E1D3" stroke="#3F5566" stroke-width="2"/><polygon points="18,21 82,21 50,6" fill="#3F5566"/><rect x="28" y="25" width="8" height="9" fill="#CFDCE0"/><rect x="64" y="25" width="8" height="9" fill="#CFDCE0"/><rect x="28" y="39" width="8" height="9" fill="#CFDCE0"/><rect x="64" y="39" width="8" height="9" fill="#CFDCE0"/><rect x="45" y="38" width="10" height="14" fill="#3F5566"/>',
  ranch: '<rect x="8" y="32" width="84" height="20" fill="#D9CBB4" stroke="#6B5845" stroke-width="2"/><polygon points="4,33 96,33 82,22 18,22" fill="#6B5845"/><rect x="16" y="37" width="12" height="8" fill="#CFDCE0"/><rect x="72" y="37" width="12" height="8" fill="#CFDCE0"/><rect x="45" y="38" width="10" height="14" fill="#9AA88A"/>',
  mediterranean: '<rect x="20" y="24" width="60" height="28" fill="#F0E2C8" stroke="#9C5B3B" stroke-width="2"/><polygon points="14,25 86,25 72,13 28,13" fill="#C07A4F"/><path d="M28 44v-8a5 5 0 0 1 10 0v8z" fill="#CFDCE0"/><path d="M62 44v-8a5 5 0 0 1 10 0v8z" fill="#CFDCE0"/><path d="M45 52V40a5 5 0 0 1 10 0v12z" fill="#9C5B3B"/>',
};
const FINISH_HINT = {
  essential: "Builder-grade basics: laminate counters, vinyl plank, standard fixtures.",
  standard: "What most new homes have: quartz counters, mid-range cabinets and fixtures.",
  premium: "Upgraded: custom cabinets, hardwood, stone, designer fixtures.",
  luxury: "High-end throughout: bespoke millwork, premium appliances, imported finishes.",
};
const TIER_LABEL = { fits_easily: "Fits easily", best_match: "Best match", stretch: "Stretch" };
const AGENTS = [
  { key: "guard", ic: "🛡", name: "Safety guard", what: "Screens your notes for anything that isn't about your home" },
  { key: "intake", ic: "📝", name: "Intake agent", what: "Turns your answers into a clear project brief" },
  { key: "designer", ic: "✏️", name: "Designer agent", what: "Drafts three options and tests each one with NestQuest's calculators" },
  { key: "tools", ic: "📐", name: "Cost & code calculators", what: "Prices every option with your state's construction costs and checks your site" },
  { key: "advisor", ic: "💬", name: "Feasibility advisor", what: "Explains plainly what each option can and can't do" },
];
const PHASE_COLORS = ["#8C9A7E", "#B08968", "#C9B79C", "#7D8F69", "#D8C3A5", "#A3B18A", "#E3D5C1", "#C2B6A4"];

const state = { meta: null, runId: null, result: null, events: [], archive: [], refineEvents: [], usageRows: [], current: null, optIdx: 0, floor: "1", mode: "home", view3d: { mode: "exterior", floor: 1 } };

// ------------------------------------------------------------------ views
const FLOW = { form: "home-plan", options: "home-plan", refine: "home-plan", "dev-form": "develop", "dev-options": "develop", "dev-refine": "develop" };
function show(view) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + view).classList.remove("hidden");
  if (FLOW[view]) state.mode = FLOW[view] === "develop" ? "dev" : "home";
  const nav = view === "home" || view === "about" ? view : FLOW[view] || (state.mode === "dev" ? "develop" : "home-plan");
  $$(".mainnav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  $(".steps").classList.toggle("hidden", view === "home" || view === "about");
  if (view === "home") mountHero(); else unmountHero();
  if (view !== "refine" && view !== "dev-refine") disposeViewer();
  const step = { form: 1, working: 1, options: 2, refine: 3, "dev-form": 1, "dev-options": 2, "dev-refine": 3 }[view];
  $$(".step").forEach((s) => {
    const n = +s.dataset.step;
    s.classList.toggle("on", n === step);
    s.classList.toggle("done", n < step);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function route() {
  const h = location.hash || "#/";
  if (h.startsWith("#/develop")) show("dev-form");
  else if (h.startsWith("#/about")) show("about");
  else if (h.startsWith("#/home")) show("form");
  else show("home");
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

// ------------------------------------------------------------------ 3D
function when3dReady(fn) {
  if (window.NQ3D) return fn();
  window.addEventListener("nq3d-ready", fn, { once: true });
}
function mount3d(el, model, opts) {
  el.innerHTML = '<div class="loading3d">Loading 3D view…</div>';
  return new Promise((resolve) => {
    const timer = setTimeout(() => { if (!window.NQ3D) el.innerHTML = '<div class="loading3d">The 3D view needs an internet connection (it loads Three.js).</div>'; }, 8000);
    when3dReady(() => { clearTimeout(timer); resolve(window.NQ3D.mount(el, model, opts)); });
  });
}
async function mountHero() {
  if (state.hero || state.heroLoading) return;
  state.heroLoading = true;
  try {
    const model = state.sampleModel || (state.sampleModel = await (await fetch("/api/sample-model")).json());
    if (!$("#view-home").classList.contains("hidden")) state.hero = await mount3d($("#heroViewer"), model, { autoRotate: true });
  } finally { state.heroLoading = false; }
}
function unmountHero() { if (state.hero) { state.hero.dispose(); state.hero = null; } }
function disposeViewer() { if (state.viewer) { state.viewer.dispose(); state.viewer = null; } }

// ------------------------------------------------------------------ form
async function init() {
  state.meta = await (await fetch("/api/meta")).json();
  if (!state.meta.key_ok) $("#keyWarning").classList.remove("hidden");
  const F = $("#projectForm");
  const sel = $("select[name=state_code]", F);
  sel.innerHTML = '<option value="">Choose a state…</option>' +
    state.meta.states.map((s) => `<option value="${s.code}">${esc(s.name)}</option>`).join("");

  $(".styles", F).innerHTML = Object.entries(STYLES).map(([k, [n, d]]) =>
    `<button type="button" class="styleCard${k === "farmhouse" ? " on" : ""}" data-v="${k}"><svg viewBox="0 0 100 56">${STYLE_ICON[k]}<rect x="0" y="52" width="100" height="4" fill="#B9C4A8"/></svg>${n}<small>${d}</small></button>`).join("");
  $$(".styleCard", F).forEach((b) => b.onclick = () => { $$(".styleCard", F).forEach((x) => x.classList.remove("on")); b.classList.add("on"); });

  renderChipGroups($("#mustHaves"), state.meta.must_have_groups);
  renderInterior($("#interiorPrefs"));
  renderPropertyBlock(F);

  $$(".seg", F).filter((seg) => !seg.closest(".propertyBlock, #interiorPrefs")).forEach((seg) => $$("button", seg).forEach((b) => b.onclick = () => {
    $$("button", seg).forEach((x) => x.classList.remove("on")); b.classList.add("on");
    if (seg.dataset.name === "owns_land") toggleLand();
    if (seg.dataset.name === "finish_level") $("#finishHint").textContent = FINISH_HINT[b.dataset.v];
  }));
  $$(".stepper").forEach((st) => {
    const out = $("output", st), [minus, plus] = $$("button", st);
    const step = +st.dataset.step;
    minus.onclick = () => out.value = Math.max(+st.dataset.min, +out.value - step);
    plus.onclick = () => out.value = Math.min(+st.dataset.max, +out.value + step);
  });
  $$("input.money").forEach((i) => i.addEventListener("blur", () => { const n = parseMoney(i.value); if (n) i.value = n.toLocaleString("en-US"); }));
  ["lot_width_ft", "lot_depth_ft"].forEach((n) => F.elements[n].addEventListener("input", lotHint));
  $("#finishHint").textContent = FINISH_HINT.standard;
  lotHint();

  $("#projectForm").onsubmit = submitPlan;
  $("#exampleBtn").onclick = fillExample;
  $("#editBtn").onclick = () => go("#/home");
  $("#backBtn").onclick = () => show("options");
  $("#meter").onclick = openDrawer;
  $("#drawerClose").onclick = () => $("#drawer").classList.remove("open");
  $("#sourcesBtn").onclick = openSources;
  $$("[data-open-sources]").forEach((b) => b.onclick = openSources);
  $$("[data-close]").forEach((b) => b.onclick = () => b.closest(".modal").classList.add("hidden"));
  $("#chatForm").onsubmit = (e) => { e.preventDefault(); sendChat($("#chatInput").value); };
  window.addEventListener("hashchange", route);
  // in-page links (About us section nav) scroll instead of changing the route
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-scroll]");
    if (!a) return;
    e.preventDefault();
    const target = document.querySelector(a.getAttribute("href"));
    if (!target) return;
    const y = target.getBoundingClientRect().top + window.scrollY - 130;  // clear the sticky header + section nav
    const start = window.scrollY;
    window.scrollTo({ top: y, behavior: "smooth" });
    // Some browsers (or reduced-motion settings) ignore smooth scrolling: jump instead.
    setTimeout(() => { if (Math.abs(window.scrollY - start) < 2) window.scrollTo(0, y); }, 250);
  });
  if (window.initDev) window.initDev();
  route();
}

const parseMoney = (v) => +String(v).replace(/[^0-9.]/g, "") || 0;
const segVal = (name, form = "#projectForm") => $(`${form} .seg[data-name=${name}] .on`)?.dataset.v;

function toggleLand() {
  const owns = segVal("owns_land") === "true";
  togglePropertyBlock($("#projectForm"), owns);
  $("#landCostField").classList.toggle("hidden", owns);
  $("#landIncl").classList.toggle("hidden", owns);
}
function lotHint() {
  const F = $("#projectForm"), w = +F.elements.lot_width_ft.value, d = +F.elements.lot_depth_ft.value;
  if (w && d) $("#lotHint").textContent = `${(w * d).toLocaleString()} sq ft lot (${(w * d / 43560).toFixed(2)} acres). Width is the side facing the street.`;
}

function fillExample() {
  const F = $("#projectForm").elements;
  F.state_code.value = "VA";
  F.city.value = "Leesburg";
  F.lot_width_ft.value = 100;
  F.lot_depth_ft.value = 150;
  F.budget_total.value = "750,000";
  $(".stepper[data-name=bedrooms] output").value = 3;
  $(".stepper[data-name=bathrooms] output").value = 2.5;
  $$("#mustHaves .chip").forEach((c) => c.classList.toggle("on", ["home_office", "covered_porch", "primary_on_main", "solar_panels"].includes(c.dataset.v)));
  F.notes.value = "We have two kids and both of us work from home. We'd love a big kitchen that opens to the backyard.";
  lotHint();
}

function collect() {
  const f = $("#projectForm");
  const num = (n) => { const v = f.elements[n].value; return v === "" ? null : +v; };
  const zoning = {};
  ["front_setback_ft", "side_setback_ft", "rear_setback_ft", "max_height_ft", "max_lot_coverage_pct"].forEach((k) => {
    const v = num("z_" + k); if (v !== null) zoning[k] = v;
  });
  const owns = segVal("owns_land") === "true";
  return {
    state_code: f.elements.state_code.value,
    city: f.elements.city.value.trim(),
    lot_width_ft: num("lot_width_ft"), lot_depth_ft: num("lot_depth_ft"),
    owns_land: owns, land_cost: owns ? 0 : parseMoney(f.elements.land_cost.value),
    budget_total: parseMoney(f.elements.budget_total.value),
    bedrooms: +$(".stepper[data-name=bedrooms] output").value,
    bathrooms: +$(".stepper[data-name=bathrooms] output").value,
    stories: segVal("stories"),
    target_sqft: num("target_sqft"),
    style: $("#projectForm .styleCard.on").dataset.v,
    finish_level: segVal("finish_level"),
    construction: f.elements.construction.value,
    garage_cars: +segVal("garage_cars"),
    must_haves: $$("#mustHaves .chip.on").map((c) => c.dataset.v),
    notes: f.elements.notes.value.trim(),
    zoning,
    existing: owns ? collectProperty(f) : undefined,
    interior: collectInterior($("#interiorPrefs")),
  };
}

function formError(msg) { const e = $("#formErr"); e.textContent = msg; e.classList.toggle("hidden", !msg); }

async function submitPlan(e) {
  e.preventDefault();
  const p = collect();
  if (!p.state_code) return formError("Please choose the state you're building in.");
  if (!p.lot_width_ft || !p.lot_depth_ft || p.lot_width_ft <= 20 || p.lot_depth_ft <= 20) return formError("Please enter your lot's width and depth in feet (over 20 ft each).");
  if (p.budget_total < 50000) return formError("Please enter your total budget (at least $50,000).");
  if (!p.owns_land && p.land_cost >= p.budget_total) return formError("The land price uses up the whole budget. Check the numbers.");
  formError("");
  $("#planBtn").disabled = true;
  try {
    const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail?.[0]?.msg || j.detail || "Could not start planning.");
    state.geo = p.existing?.address ? $("#projectForm")._geo : null;
    startRun(j.run_id, p, "home");
  } catch (err) {
    formError(err.message);
  } finally {
    $("#planBtn").disabled = false;
  }
}

// ------------------------------------------------------------------ progress
function startRun(runId, project, mode) {
  state.archive.push(...state.events);
  state.runId = runId; state.project = project; state.events = []; state.mode = mode;
  show("working"); renderPipeline([]);
  poll();
}
async function poll() {
  const r = await fetch(`/api/runs/${state.runId}`);
  const j = await r.json();
  state.events = j.events;
  renderPipeline(j.events);
  updateMeter();
  if (j.status === "running") return setTimeout(poll, 700);
  if (j.status === "error") {
    if (state.mode === "dev") { show("dev-form"); window.devError(j.error); } else { show("form"); formError(j.error); }
    return;
  }
  state.result = j.result;
  state.chats = {};
  if (state.mode === "dev") { window.renderDevOptions(); show("dev-options"); }
  else { renderOptions(); show("options"); }
}

function renderPipeline(events) {
  const started = new Set(events.filter((e) => e.kind === "start" || e.kind === "tool" || e.kind === "guard").map((e) => e.agent));
  const done = new Set(events.filter((e) => e.kind === "done").map((e) => e.agent));
  if (started.has("intake")) done.add("guard");
  if (started.has("advisor")) done.add("tools");
  const usage = Object.fromEntries(events.filter((e) => e.kind === "done").map((e) => [e.agent, e.usage]));
  $("#pipeline").innerHTML = AGENTS.map((a) => {
    const cls = done.has(a.key) ? "done" : started.has(a.key) ? "active" : "";
    const u = usage[a.key];
    const tok = u ? `${kfmt(u.input_tokens + u.output_tokens)} tokens` : "";
    return `<li class="${cls}"><span class="ic">${done.has(a.key) ? "✓" : a.ic}</span><div><b>${a.name}</b><small>${a.what}</small></div><span class="tok">${tok}</span></li>`;
  }).join("");
  $("#livefeed").innerHTML = events.filter((e) => e.summary).slice(-6).reverse()
    .map((e) => `<li><b>${esc(e.tool || e.agent)}</b> · ${esc(e.summary)}</li>`).join("");
}

// ------------------------------------------------------------------ usage meter + drawer
function allEvents() { return [...state.archive, ...state.events, ...state.refineEvents]; }
function rowCost(u) {
  const p = state.meta.price_per_mtok;
  return ((u.input_tokens - u.cached_input_tokens) * p.input + u.cached_input_tokens * p.cached_input + u.output_tokens * p.output) / 1e6;
}
function updateMeter() {
  const done = allEvents().filter((e) => e.kind === "done");
  const tot = done.reduce((a, e) => ({ t: a.t + e.usage.input_tokens + e.usage.output_tokens, c: a.c + rowCost(e.usage) }), { t: 0, c: 0 });
  $("#meterTokens").textContent = `${tot.t.toLocaleString()} tokens`;
  $("#meterCost").textContent = "$" + tot.c.toFixed(4);
  $("#meter").classList.remove("pulse"); void $("#meter").offsetWidth; $("#meter").classList.add("pulse");
}
function openDrawer() {
  const done = allEvents().filter((e) => e.kind === "done");
  const rows = done.map((e, i) => ({ name: e.agent, ...e.usage, secs: e.seconds }));
  const sum = rows.reduce((a, r) => ({ requests: a.requests + r.requests, input_tokens: a.input_tokens + r.input_tokens, cached_input_tokens: a.cached_input_tokens + r.cached_input_tokens, output_tokens: a.output_tokens + r.output_tokens }), { requests: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 });
  $("#usageTable").innerHTML = `<p class="sub">Every agent runs on <b>${esc(state.meta.model)}</b> through Portkey. Prices: $${state.meta.price_per_mtok.input}/M input, $${state.meta.price_per_mtok.cached_input}/M cached, $${state.meta.price_per_mtok.output}/M output tokens.</p>
  <table class="usage"><tr><th>Agent call</th><th>Requests</th><th>Input</th><th>Cached</th><th>Output</th><th>Cost</th></tr>
  ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.requests}</td><td>${r.input_tokens.toLocaleString()}</td><td>${r.cached_input_tokens.toLocaleString()}</td><td>${r.output_tokens.toLocaleString()}</td><td>$${rowCost(r).toFixed(5)}</td></tr>`).join("")}
  <tr class="sum"><td>Total</td><td>${sum.requests}</td><td>${sum.input_tokens.toLocaleString()}</td><td>${sum.cached_input_tokens.toLocaleString()}</td><td>${sum.output_tokens.toLocaleString()}</td><td>$${rowCost(sum).toFixed(5)}</td></tr></table>`;
  const t0 = allEvents()[0]?.t || 0;
  $("#trace").innerHTML = allEvents().map((e) => {
    const what = e.kind === "start" ? "started" : e.kind === "done" ? `finished in ${e.seconds}s · ${e.usage.requests} request(s), ${(e.usage.input_tokens + e.usage.output_tokens).toLocaleString()} tokens`
      : e.kind === "tool" ? `called <code>${esc(e.tool)}</code>: ${esc(e.summary)}` : esc(e.summary || e.kind);
    return `<li class="k-${e.kind}"><span class="ag">${esc(e.agent)}</span> ${what}${e.t ? `<div class="meta">+${(e.t - t0).toFixed(1)}s</div>` : ""}</li>`;
  }).join("") || "<li>No runs yet.</li>";
  $("#drawer").classList.add("open");
}

// ------------------------------------------------------------------ options
function verdictOf(checks) {
  if (checks.some((c) => c.status === "fail")) return ["fail", "Not feasible as is"];
  if (checks.some((c) => c.status === "warn")) return ["warn", "Works with trade-offs"];
  return ["ok", "Can be built"];
}
function beds(d) { return d.rooms.filter((r) => r.kind === "bedroom" || r.kind === "primary_bedroom").length; }
function baths(d) { return d.rooms.filter((r) => r.kind === "bathroom").reduce((a, r) => a + (r.area_sqft < 40 ? 0.5 : 1), 0); }

function budgetBar(total, budget) {
  const max = Math.max(total, budget) * 1.08;
  const cls = total <= budget ? "" : total <= budget * 1.1 ? "warn" : "fail";
  const diff = total - budget;
  return `<div class="bar"><i class="${cls}" style="width:${(total / max) * 100}%"></i><span class="budgetMark" style="left:${(budget / max) * 100}%" title="Your budget"></span></div>
    <div class="barLbl"><span>${diff <= 0 ? money(-diff) + " under budget" : money(diff) + " over budget"}</span><span>Budget ${money(budget)}</span></div>`;
}

function listItems(advice, checks) {
  const li = (cls, mk, t) => `<div class="li"><span class="mk ${cls}">${mk}</span><span>${esc(t)}</span></div>`;
  return [...advice.can_do.map((t) => li("ok", "✓", t)), ...advice.trade_offs.map((t) => li("warn", "!", t)), ...advice.cannot_do.map((t) => li("fail", "✕", t))].join("");
}

function costTable(c) {
  const rows = [["House", c.house, `${money(c.cost_per_sqft)}/sq ft`], ["Garage", c.garage], ...c.features.map((f) => [f.label, f.cost]),
    ...(c.interior || []).map((f) => [f.label, f.cost, "interior selection"]), ...(c.site_work || []).map((f) => [f.label, f.cost, "your property"]),
    ["Builder overhead & profit", c.builder_overhead_profit, "NAHB average"], ["Contingency (10%)", c.contingency, "for surprises"]];
  if (c.land) rows.push(["Land", c.land]);
  const shareTotal = c.house_phases.reduce((a, p) => a + p.cost, 0) || 1;
  return `<table class="costTable">${rows.filter((r) => r[1]).map(([l, v, n]) => `<tr><td>${esc(l)}${n ? ` <span class="lbl2">${esc(n)}</span>` : ""}</td><td>${money(v)}</td></tr>`).join("")}
    <tr class="sum"><td>Estimated total</td><td>${money(c.total)}</td></tr></table>
    <div class="phaseBar">${c.house_phases.map((p, i) => `<span style="width:${(p.cost / shareTotal) * 100}%;background:${PHASE_COLORS[i]}" title="${esc(p.phase)}: ${money(p.cost)}"></span>`).join("")}</div>
    <div class="phaseLegend">${c.house_phases.map((p, i) => `<span><i style="background:${PHASE_COLORS[i]}"></i>${esc(p.phase)} ${money(p.cost)}</span>`).join("")}</div>
    <p class="hint">${esc(c.factors.state)} costs ${c.factors.state_factor >= 1 ? (Math.round((c.factors.state_factor - 1) * 100)) + "% above" : Math.round((1 - c.factors.state_factor) * 100) + "% below"} the national average of $${c.factors.national_base_per_sqft}/sq ft.</p>`;
}

function renderOptions() {
  const r = state.result, p = state.project;
  $("#briefSummary").textContent = r.brief.summary;
  const g = $("#guardNotice");
  g.classList.toggle("hidden", !r.guard_removed.length);
  g.innerHTML = `🛡 <b>Safety guard:</b> we ignored part of your notes because it looked like an instruction to the AI rather than a detail about your home: <i>“${esc(r.guard_removed.join(" "))}”</i>`;

  const env = r.envelope;
  const lw = p.lot_width_ft, ld = p.lot_depth_ft, sc = 200 / Math.max(lw, ld);
  const ex = p.existing;
  const propHtml = ex && (ex.address || ex.structure !== "vacant") ? `<div class="propMap">${state.geo ? mapIframe(state.geo.lat, state.geo.lon) : ""}
    <p>${ex.address ? `<b>${esc(ex.address)}</b><br>` : ""}${{ vacant: "Vacant land", teardown: `Existing ${ex.existing_sqft ? ex.existing_sqft.toLocaleString() + " sq ft " : ""}building to tear down`, keep: `Existing ${ex.existing_sqft ? ex.existing_sqft.toLocaleString() + " sq ft " : ""}building stays` }[ex.structure]} · ${ex.slope} slope · ${ex.utilities === "public" ? "public utilities" : "well & septic"}</p></div>` : "";
  $("#siteCard").innerHTML = `<h3>Your lot</h3>${propHtml}
    <svg class="lotSvg" viewBox="0 0 ${lw * sc + 20} ${ld * sc + 28}"><rect x="10" y="10" width="${lw * sc}" height="${ld * sc}" fill="#E7ECDF" stroke="#7D8F69" stroke-width="2"/>
    <rect x="${10 + env.setbacks_ft.side * sc}" y="${10 + env.setbacks_ft.rear * sc}" width="${env.buildable_width_ft * sc}" height="${env.buildable_depth_ft * sc}" fill="#FFFDF9" stroke="#B08968" stroke-dasharray="5 3" stroke-width="2"/>
    <text x="${10 + lw * sc / 2}" y="${10 + ld * sc / 2}" text-anchor="middle" font-size="12" fill="#5F7151">buildable area</text>
    <text x="${10 + lw * sc / 2}" y="${ld * sc + 22}" text-anchor="middle" font-size="11" fill="#7A6F63">street</text></svg>
    <p><b>${env.buildable_width_ft.toFixed(0)} × ${env.buildable_depth_ft.toFixed(0)} ft</b> buildable · up to <b>${env.max_stories}</b> stories · max footprint <b>${env.max_footprint_sqft.toLocaleString()} sq ft</b></p>
    <p class="hint">Rules: ${esc(env.rules_source)}.</p>`;

  $("#adviceCard").innerHTML = `<span class="rec">★ We recommend ${esc(r.advisor.recommended)}</span><p>${esc(r.advisor.overview)}</p>`;
  $("#notesCard").innerHTML = `<h3>Before you talk to a builder</h3>
    ${r.brief.concerns.length ? `<h4>Worth knowing early</h4><ul class="qs">${r.brief.concerns.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <h4>Confirm locally</h4><ul class="qs">${r.advisor.next_questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`;

  $("#options").innerHTML = r.options.map((o, i) => {
    const d = o.design, [vc, vt] = verdictOf(o.checks), rec = d.name === r.advisor.recommended;
    return `<article class="card opt-card${rec ? " recommended" : ""}">
      <div class="opt-top"><div class="tier"><span>${TIER_LABEL[d.tier]}</span>${rec ? '<span class="rec">★ Recommended</span>' : ""}</div>
        <h3>${esc(d.name)}</h3><p class="tagline">${esc(d.tagline)}</p></div>
      <div class="sketch">${o.elevation}</div>
      <div class="opt-body">
        <div class="price"><span class="total">${money(o.cost.total)}</span><span class="verdict ${vc}">${vt}</span></div>
        <div>${budgetBar(o.cost.total, p.budget_total)}</div>
        <div class="facts"><div><b>${o.sizing.finished_sqft.toLocaleString()}</b><span>sq ft</span></div><div><b>${beds(d)}</b><span>beds</span></div><div><b>${baths(d)}</b><span>baths</span></div><div><b>${d.stories}</b><span>${d.stories > 1 ? "stories" : "story"}</span></div></div>
        <p class="headline">${esc(o.advice.headline)}</p>
        <div class="lists">${listItems(o.advice, o.checks)}</div>
        <details class="more"><summary>Cost breakdown</summary>${costTable(o.cost)}</details>
        <details class="more"><summary>All checks</summary><div class="lists checks">${o.checks.map((c) => `<div class="li"><span class="mk ${c.status}">${{ ok: "✓", warn: "!", fail: "✕" }[c.status]}</span><span><b>${esc(c.label)}.</b> ${esc(c.detail)}</span></div>`).join("")}</div></details>
        <div class="opt-actions"><button class="btn primary" data-pick="${i}">Choose &amp; refine</button></div>
      </div></article>`;
  }).join("");
  $$("[data-pick]").forEach((b) => b.onclick = () => openRefine(+b.dataset.pick));
}

// ------------------------------------------------------------------ refine
function openRefine(i) {
  state.optIdx = i;
  state.chats[i] = state.chats[i] || { msgs: [], version: 1 };
  state.current = state.chats[i].current || state.result.options[i];
  state.view3d = { mode: "exterior", floor: 1 };
  renderDesign();
  renderMsgs();
  show("refine");
}

function renderDesign() {
  const o = state.current, d = o.design, p = state.project, [vc, vt] = verdictOf(o.checks);
  const chat = state.chats[state.optIdx];
  $("#refineTitle").textContent = d.name;
  $("#refineTag").textContent = d.tagline;
  const floors = Object.keys(o.plans);
  if (!floors.includes(state.floor)) state.floor = floors[0];
  const v = state.view3d;
  if (v.floor > floors.length) v.floor = 1;
  const tab = (m, f, label) => `<button data-v3="${m}" data-f="${f}" class="${v.mode === m && (m === "exterior" || v.floor === f) ? "on" : ""}">${label}</button>`;
  $("#designPane").innerHTML = `
    <div class="dpTop">
      <div>
        <div class="price"><span class="total">${money(o.cost.total)}</span><span class="verdict ${vc}">${vt}</span></div>
        <div style="margin:12px 0">${budgetBar(o.cost.total, p.budget_total)}</div>
      </div>
      <div>
        <div class="facts"><div><b>${o.sizing.finished_sqft.toLocaleString()}</b><span>sq ft</span></div><div><b>${beds(d)}</b><span>beds</span></div><div><b>${baths(d)}</b><span>baths</span></div><div><b>${d.stories}</b><span>stories</span></div></div>
        <div class="version" style="margin-top:10px">Version ${chat.version}${chat.version > 1 ? ' · <button class="link" id="undoBtn">Undo last change</button>' : ""}</div>
      </div>
    </div>
    <div class="viewTabs" style="margin-top:18px">${tab("exterior", 1, "3D exterior")}${floors.map((f) => tab("dollhouse", +f, `3D inside · floor ${f}`)).join("")}<span class="spacer"></span>${floors.map((f) => tab("plan", +f, `Plan · floor ${f}`)).join("")}</div>
    <div class="stage" id="stage"></div>
    <p class="hint">${v.mode === "plan" ? "Schematic floor plan." : "Drag to orbit, scroll to zoom, right-drag to pan. Schematic massing, not construction drawings."}</p>
    <p class="hint">${esc(d.exterior)} ${esc(d.interior)}</p>
    <div class="cols2">
      <div><h4>Cost breakdown</h4>${costTable(o.cost)}</div>
      <div><h4>Checks</h4><div class="lists">${o.checks.map((c) => `<div class="li"><span class="mk ${c.status}">${{ ok: "✓", warn: "!", fail: "✕" }[c.status]}</span><span><b>${esc(c.label)}.</b> ${esc(c.detail)}</span></div>`).join("")}</div>
      ${d.features.length ? `<h4>Features</h4><p>${d.features.map((f) => esc(state.meta.features[f] || f)).join(" · ")}</p>` : ""}</div>
    </div>`;
  $$("[data-v3]").forEach((b) => b.onclick = () => { state.view3d = { mode: b.dataset.v3, floor: +b.dataset.f }; renderDesign(); });
  renderStage(o);
  $("#undoBtn")?.addEventListener("click", undo);

  const ideas = ["Add a home office", "Bring it under budget", "Make the kitchen bigger", "Add a finished basement", "Make it one story", "Add a covered porch"];
  $("#suggest").innerHTML = ideas.map((t) => `<button type="button">${t}</button>`).join("");
  $$("#suggest button").forEach((b) => b.onclick = () => sendChat(b.textContent));
}

async function renderStage(o) {
  const v = state.view3d, stage = $("#stage");
  disposeViewer();
  if (v.mode === "plan") {
    stage.innerHTML = `<div class="planWrap" style="border:0;height:100%;display:grid;place-items:center">${o.plans[String(v.floor)]}</div>`;
    return;
  }
  const viewer = await mount3d(stage, o.model3d, {});
  if (stage.isConnected) { state.viewer = viewer; if (v.mode === "dollhouse") viewer.setMode("dollhouse", v.floor); }
  else viewer.dispose();
}

function renderMsgs() {
  const chat = state.chats[state.optIdx];
  const intro = `<div class="msg bot">Hi! This is <b>${esc(state.current.design.name)}</b>. Tell me what you'd like to change: rooms, sizes, features, stories. I'll update the plan and show how the cost moves.</div>`;
  $("#msgs").innerHTML = intro + chat.msgs.map((m) => {
    if (m.role === "user") return `<div class="msg user">${esc(m.text)}</div>`;
    if (m.typing) return `<div class="msg bot typing">Updating your design…</div>`;
    const delta = m.delta ? `<span class="delta ${m.delta > 0 ? "up" : "down"}">${m.delta > 0 ? "+" : "−"}${money(Math.abs(m.delta))} total</span>` : "";
    return `<div class="msg bot${m.blocked ? " blocked" : ""}">${esc(m.text)}${m.changes?.length ? `<ul>${m.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}${m.declined ? `<div class="declined">${esc(m.declined)}</div>` : ""}${delta}</div>`;
  }).join("");
  $("#msgs").scrollTop = 1e6;
}

async function sendChat(text) {
  text = text.trim();
  if (!text || state.busy) return;
  const chat = state.chats[state.optIdx];
  chat.msgs.push({ role: "user", text }, { role: "bot", typing: true });
  $("#chatInput").value = "";
  state.busy = true; $("#sendBtn").disabled = true;
  renderMsgs();
  try {
    const r = await fetch(`/api/runs/${state.runId}/refine`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ option_index: state.optIdx, message: text }) });
    const j = await r.json();
    chat.msgs.pop();
    if (!r.ok) { chat.msgs.push({ role: "bot", blocked: true, text: j.detail || "Something went wrong. Please try again." }); }
    else {
      state.refineEvents.push(...j.events);
      chat.msgs.push({ role: "bot", text: j.reply, changes: j.changes, declined: j.declined, delta: j.delta, blocked: j.blocked });
      if (!j.blocked) { chat.current = j.option; chat.version = j.version; state.current = j.option; renderDesign(); }
      updateMeter();
    }
  } catch (e) {
    chat.msgs.pop(); chat.msgs.push({ role: "bot", blocked: true, text: "Could not reach NestQuest. Is the app still running?" });
  }
  state.busy = false; $("#sendBtn").disabled = false;
  renderMsgs();
}

async function undo() {
  const r = await fetch(`/api/runs/${state.runId}/undo/${state.optIdx}`, { method: "POST" });
  if (!r.ok) return;
  const j = await r.json(), chat = state.chats[state.optIdx];
  chat.current = j.option; chat.version = j.version; state.current = j.option;
  chat.msgs.push({ role: "bot", text: "Undone. You're back to the previous version." });
  renderDesign(); renderMsgs();
}

// ------------------------------------------------------------------ sources
function openSources() {
  const m = state.meta, a = m.assumptions, s = m.state_factor_source || {};
  const item = (e, label) => `<li><b>${label}</b><span class="tag ${e.source.startsWith("sourced") ? "s" : "a"}">${e.source.startsWith("sourced") ? "Sourced" : "Assumption"}</span><br>${esc(e.cite)}</li>`;
  $("#sourcesBody").innerHTML = `<p class="sub">NestQuest's AI never makes up prices. Every dollar figure comes from this cost model, and the agents' answers are checked against it.</p>
    <ul class="srcList">
      ${item(a.national_cost_per_sqft, "National construction cost: $" + a.national_cost_per_sqft.value + " per sq ft")}
      ${item(a.construction_breakdown_shares, "Cost split by building phase")}
      <li><b>State cost factors</b><span class="tag s">Sourced</span><br>${esc(s.title || "DoD UFS 3-701-01 Area Cost Factors")}${s.edition ? ", " + esc(s.edition) : ""}. ${esc(s.how_derived || "")} These factors price military construction and are used here as an approximation of regional building costs.</li>
      ${item(a.builder_overhead_profit_pct, "Builder overhead & profit: " + Math.round(a.builder_overhead_profit_pct.value * 100) + "% of construction")}
      ${item(a.min_habitable_room_sqft, "Minimum room size: 70 sq ft")}
      ${item(a.garage_cost_ratio, "Garage cost")}
      ${item(a.contingency_pct, "10% contingency")}
      ${item(a.zoning_defaults, "Default zoning rules")}
      <li><b>Finish, construction method, style, stories and feature costs</b><span class="tag a">Assumption</span><br>NestQuest planning multipliers relative to NAHB's average home, adjusted by your state's factor.</li>
      <li><b>Interior selections</b><span class="tag a">Assumption</span><br>Flooring and ceiling height as a share of house cost; cabinets, counters and appliances as fixed allowances, relative to a standard package.</li>
      <li><b>Existing property work</b><span class="tag a">Assumption</span><br>Demolition $10/sq ft; extra site work of 3% (gentle) or 10% (steep slope) of house cost; $30,000 for a private well and septic. Address lookups use OpenStreetMap (Nominatim).</li>
    </ul>
    <h4>Multi-family developments</h4>
    <ul class="srcList">
      ${item(m.dev.hard_cost.rlb, "Garden apartments: $" + m.dev.hard_cost.rlb.value + " per gross sq ft")}
      ${item(m.dev.hard_cost.nahb, "Townhomes, duplexes, fourplexes: $" + m.dev.hard_cost.nahb.value + " per sq ft")}
      ${Object.entries(m.dev.assumptions).map(([k, e]) => item(e, { gc_overhead_pct_nahb: "Builder overhead (NAHB-based types)", soft_cost_pct_of_hard: "Soft costs: 20.5% of hard costs", contingency_pct: "10% contingency", efficiency_cite: "Net-to-gross efficiency", density_cite: "Default density limits", zoning_defaults: "Default zoning rules" }[k] || k)).join("")}
      ${item(m.dev.parking.surface_cost_per_space, "Surface parking: $" + m.dev.parking.surface_cost_per_space.value.toLocaleString() + " per space")}
      ${item(m.dev.parking.structured_cost_per_space, "Structured parking: $" + m.dev.parking.structured_cost_per_space.value.toLocaleString() + " per space")}
      ${item(m.dev.parking.sqft_per_surface_space, "Land per surface space: " + m.dev.parking.sqft_per_surface_space.value + " sq ft")}
      ${item(m.dev.rent.vacancy, "Vacancy: " + (m.dev.rent.vacancy.value * 100).toFixed(1) + "%")}
      ${item(m.dev.rent.opex_share, "Operating costs: " + Math.round(m.dev.rent.opex_share.value * 100) + "% of rent")}
      <li><b>Finish multipliers, amenity costs, building spacing</b><span class="tag a">Assumption</span><br>NestQuest planning assumptions, adjusted by your state's factor.</li>
    </ul>`;
  $("#sourcesModal").classList.remove("hidden");
}

// Start once every script (forms.js, dev.js) has loaded.
document.addEventListener("DOMContentLoaded", init);
