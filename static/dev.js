// NestQuest developer (multi-family) pages. Uses helpers and `state` from app.js.
(function () {
  const PRODUCT_ICON = {
    any: '<rect x="8" y="26" width="22" height="26" fill="#EDE6DA" stroke="#5B4B3E" stroke-width="2"/><rect x="36" y="16" width="26" height="36" fill="#DCE5D0" stroke="#5B4B3E" stroke-width="2"/><rect x="68" y="30" width="24" height="22" fill="#E8DDB5" stroke="#5B4B3E" stroke-width="2"/><text x="50" y="12" font-size="10" text-anchor="middle" fill="#5B4B3E">?</text>',
    duplex: '<rect x="20" y="24" width="60" height="28" fill="#E9D8C4" stroke="#5B4B3E" stroke-width="2"/><polygon points="16,25 84,25 50,8" fill="#5B4B3E"/><line x1="50" y1="25" x2="50" y2="52" stroke="#5B4B3E" stroke-width="2"/><rect x="30" y="38" width="8" height="14" fill="#8C9A7E"/><rect x="62" y="38" width="8" height="14" fill="#8C9A7E"/>',
    fourplex: '<rect x="22" y="14" width="56" height="38" fill="#E8DDB5" stroke="#5B4B3E" stroke-width="2"/><rect x="18" y="10" width="64" height="5" fill="#5B4B3E"/><line x1="50" y1="14" x2="50" y2="52" stroke="#5B4B3E" stroke-width="1.5"/><line x1="22" y1="33" x2="78" y2="33" stroke="#5B4B3E" stroke-width="1.5"/><rect x="30" y="19" width="10" height="8" fill="#CFDCE0"/><rect x="60" y="19" width="10" height="8" fill="#CFDCE0"/><rect x="30" y="38" width="10" height="8" fill="#CFDCE0"/><rect x="60" y="38" width="10" height="8" fill="#CFDCE0"/>',
    townhomes: '<g fill="#DCE5D0" stroke="#5B4B3E" stroke-width="2"><rect x="8" y="22" width="21" height="30"/><rect x="29" y="22" width="21" height="30"/><rect x="50" y="22" width="21" height="30"/><rect x="71" y="22" width="21" height="30"/></g><g fill="#5B4B3E"><polygon points="8,23 29,23 18.5,12"/><polygon points="29,23 50,23 39.5,12"/><polygon points="50,23 71,23 60.5,12"/><polygon points="71,23 92,23 81.5,12"/></g>',
    garden_apartments: '<rect x="10" y="12" width="80" height="40" fill="#D7E3E0" stroke="#5B4B3E" stroke-width="2"/><rect x="6" y="8" width="88" height="5" fill="#5B4B3E"/><g fill="#CFDCE0" stroke="#5B4B3E" stroke-width=".8"><rect x="16" y="17" width="9" height="7"/><rect x="31" y="17" width="9" height="7"/><rect x="60" y="17" width="9" height="7"/><rect x="75" y="17" width="9" height="7"/><rect x="16" y="29" width="9" height="7"/><rect x="31" y="29" width="9" height="7"/><rect x="60" y="29" width="9" height="7"/><rect x="75" y="29" width="9" height="7"/><rect x="16" y="41" width="9" height="7"/><rect x="31" y="41" width="9" height="7"/><rect x="60" y="41" width="9" height="7"/><rect x="75" y="41" width="9" height="7"/></g><rect x="45" y="36" width="10" height="16" fill="#A7B5A0"/>',
  };
  const PRODUCT_SUB = { any: "Let NestQuest suggest", duplex: "2 units per building", fourplex: "3-4 units, stacked", townhomes: "Rows of 3-8 homes", garden_apartments: "2-4 story walk-ups" };
  const TIER = { lean: "Lean", balanced: "Balanced", max_yield: "Max yield" };
  const D = () => $("#devForm");
  const dseg = (name) => segVal(name, "#devForm");
  const dchat = () => state.devChats[state.devIdx];

  window.devError = function (msg) { const e = $("#devErr"); e.textContent = msg; e.classList.toggle("hidden", !msg); };

  window.initDev = function () {
    const F = D(), meta = state.meta;
    state.devChats = {};
    $("select[name=state_code]", F).innerHTML = '<option value="">Choose a state…</option>' +
      meta.states.map((s) => `<option value="${s.code}">${esc(s.name)}</option>`).join("");
    const products = { any: "Not sure yet", ...meta.dev.products };
    $(".typeCards", F).innerHTML = Object.entries(products).map(([k, n]) =>
      `<button type="button" class="styleCard${k === "townhomes" ? " on" : ""}" data-v="${k}"><svg viewBox="0 0 100 56">${PRODUCT_ICON[k]}<rect x="0" y="52" width="100" height="4" fill="#B9C4A8"/></svg>${esc(n)}<small>${PRODUCT_SUB[k]}</small></button>`).join("");
    $(".devStyles", F).innerHTML = Object.entries(STYLES).filter(([k]) => k !== "ranch").map(([k, [n, d]]) =>
      `<button type="button" class="styleCard${k === "modern" ? " on" : ""}" data-v="${k}"><svg viewBox="0 0 100 56">${STYLE_ICON[k]}<rect x="0" y="52" width="100" height="4" fill="#B9C4A8"/></svg>${n}<small>${d}</small></button>`).join("");
    for (const grp of $$(".styles", F)) $$(".styleCard", grp).forEach((b) => b.onclick = () => { $$(".styleCard", grp).forEach((x) => x.classList.remove("on")); b.classList.add("on"); });
    $("#devAmenities").innerHTML = Object.entries(meta.dev.amenities).map(([k, v]) => `<button type="button" class="chip" data-v="${k}">${esc(v)}</button>`).join("");
    $$(".chip", F).forEach((c) => c.onclick = () => c.classList.toggle("on"));
    renderPropertyBlock(F);
    $$(".seg", F).filter((seg) => !seg.closest(".propertyBlock")).forEach((seg) => $$("button", seg).forEach((b) => b.onclick = () => {
      $$("button", seg).forEach((x) => x.classList.remove("on")); b.classList.add("on");
      if (seg.dataset.name === "owns_land") { const own = b.dataset.v === "true"; $(".landCost", F).classList.toggle("hidden", own); $(".landIncl", F).classList.toggle("hidden", own); togglePropertyBlock(F, own); }
      if (seg.dataset.name === "exit") { const rent = b.dataset.v === "rent"; $(".exitRent", F).classList.toggle("hidden", !rent); $(".exitSell", F).classList.toggle("hidden", rent); }
    }));
    const hint = () => { const w = +F.elements.lot_width_ft.value, d = +F.elements.lot_depth_ft.value; if (w && d) $(".lotHint", F).textContent = `${(w * d).toLocaleString()} sq ft site (${(w * d / 43560).toFixed(2)} acres). Width is the side facing the street.`; };
    ["lot_width_ft", "lot_depth_ft"].forEach((n) => F.elements[n].addEventListener("input", hint));
    hint();
    $("#devExampleBtn").onclick = fillDevExample;
    F.onsubmit = submitDev;
    $("#devBackBtn").onclick = () => show("dev-options");
    $(".chatForm", $("#devChat")).onsubmit = (e) => { e.preventDefault(); sendDevChat($("input", e.target).value); };
  };

  function fillDevExample() {
    const F = D(), E = F.elements;
    E.state_code.value = "VA"; E.city.value = "Leesburg";
    E.lot_width_ft.value = 220; E.lot_depth_ft.value = 300;
    E.budget_total.value = "6,500,000"; E.target_units.value = 16;
    $$(".typeCards .styleCard", F).forEach((b) => b.classList.toggle("on", b.dataset.v === "townhomes"));
    $$("[data-name=unit_types] .chip", F).forEach((c) => c.classList.toggle("on", ["2br", "3br"].includes(c.dataset.v)));
    $$("#devAmenities .chip").forEach((c) => c.classList.toggle("on", ["ev_charging", "green_space", "playground"].includes(c.dataset.v)));
    E.avg_rent.value = "3,200";
    E.notes.value = "Family-oriented townhome community near downtown. We want energy-efficient homes and a shared green.";
    F.elements.lot_width_ft.dispatchEvent(new Event("input"));
  }

  function collectDev() {
    const F = D(), E = F.elements;
    const num = (n) => (E[n].value === "" ? null : +E[n].value);
    const zoning = {};
    ["front_setback_ft", "side_setback_ft", "rear_setback_ft", "max_height_ft", "max_lot_coverage_pct", "max_units_per_acre"].forEach((k) => { const v = num("z_" + k); if (v !== null) zoning[k] = v; });
    const owns = dseg("owns_land") === "true", exit = dseg("exit");
    return {
      state_code: E.state_code.value, city: E.city.value.trim(),
      lot_width_ft: num("lot_width_ft"), lot_depth_ft: num("lot_depth_ft"),
      owns_land: owns, land_cost: owns ? 0 : parseMoney(E.land_cost.value),
      budget_total: parseMoney(E.budget_total.value),
      product: $(".typeCards .styleCard.on", F).dataset.v,
      target_units: num("target_units"),
      max_stories: E.max_stories.value ? +E.max_stories.value : null,
      unit_types: $$("[data-name=unit_types] .chip.on", F).map((c) => c.dataset.v),
      parking_per_unit: num("parking_per_unit") ?? 1.5,
      finish_level: dseg("finish_level"),
      style: $(".devStyles .styleCard.on", F).dataset.v,
      exit,
      avg_rent: exit === "rent" ? parseMoney(E.avg_rent.value) || null : null,
      avg_sale_price: exit === "sell" ? parseMoney(E.avg_sale_price.value) || null : null,
      amenities: $$("#devAmenities .chip.on").map((c) => c.dataset.v),
      notes: E.notes.value.trim(),
      zoning,
      existing: owns ? collectProperty(F) : undefined,
    };
  }

  async function submitDev(e) {
    e.preventDefault();
    const p = collectDev();
    if (!p.state_code) return devError("Please choose the state the site is in.");
    if (!p.lot_width_ft || !p.lot_depth_ft || p.lot_width_ft < 40 || p.lot_depth_ft < 40) return devError("Please enter the site's width and depth in feet (at least 40 ft each).");
    if (p.budget_total < 100000) return devError("Please enter the total budget (at least $100,000).");
    if (!p.unit_types.length) return devError("Pick at least one unit type.");
    if (!p.owns_land && p.land_cost >= p.budget_total) return devError("The land price uses up the whole budget. Check the numbers.");
    devError("");
    $("#devPlanBtn").disabled = true;
    try {
      const r = await fetch("/api/dev/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail?.[0]?.msg || j.detail || "Could not start planning.");
      state.devChats = {};
      state.geo = p.existing?.address ? D()._geo : null;
      startRun(j.run_id, p, "dev");
    } catch (err) { devError(err.message); } finally { $("#devPlanBtn").disabled = false; }
  }

  // ---------------------------------------------------------------- results
  const unitsOf = (o) => o.sizing.units;
  function kpis(o) {
    const r = o.returns;
    const third = !r ? ["—", "add rent or price for returns"]
      : r.mode === "rent" ? [`${r.yield_on_cost_pct.toFixed(2)}%`, "yield on cost"] : [`${r.margin_pct.toFixed(1)}%`, "profit margin"];
    return `<div class="kpis"><div><b>${unitsOf(o)}</b><span>units</span></div><div><b>${money(o.cost.per_unit)}</b><span>cost per unit</span></div><div><b>${third[0]}</b><span>${third[1]}</span></div></div>`;
  }
  function mixLine(sc) { return sc.unit_types.map((u) => `${u.count}× ${esc(u.name)}`).join(" · "); }
  function devCostTable(c, ret) {
    const rows = [["Buildings", c.buildings, `${money(c.cost_per_sqft)}/sq ft`], ["Builder overhead", c.gc_overhead, "NAHB-based types"],
      ["Parking", c.parking, `${money(c.parking_per_space)}/space`], ...c.amenities.map((a) => [a.label, a.cost]),
      ...(c.site_work || []).map((s) => [s.label, s.cost, "your property"]),
      ["Soft costs", c.soft_costs, "design, permits, fees, financing"], ["Contingency (10%)", c.contingency], ["Land", c.land]];
    let html = `<table class="costTable">${rows.filter((r) => r[1]).map(([l, v, n]) => `<tr><td>${esc(l)}${n ? ` <span class="lbl2">${esc(n)}</span>` : ""}</td><td>${money(v)}</td></tr>`).join("")}
      <tr class="sum"><td>Total development cost</td><td>${money(c.total)}</td></tr></table>
      <p class="hint">${esc(c.factors.state)} factor ${c.factors.state_factor} × base $${c.factors.base_per_sqft}/sq ft (${c.factors.base_source === "rlb" ? "RLB 2026 multifamily" : "NAHB 2024"}).</p>`;
    if (ret) {
      html += ret.mode === "rent"
        ? `<table class="costTable"><tr><td>Gross rent / year</td><td>${money(ret.gross_rent)}</td></tr><tr><td>After 7.3% vacancy</td><td>${money(ret.effective_income)}</td></tr><tr><td>Operating costs (45%)</td><td>−${money(ret.operating_costs)}</td></tr><tr class="sum"><td>Net operating income</td><td>${money(ret.noi)}</td></tr><tr><td>Yield on cost</td><td>${ret.yield_on_cost_pct.toFixed(2)}%</td></tr></table>`
        : `<table class="costTable"><tr><td>Sales revenue</td><td>${money(ret.revenue)}</td></tr><tr class="sum"><td>Profit</td><td>${money(ret.profit)}</td></tr><tr><td>Margin</td><td>${ret.margin_pct.toFixed(1)}%</td></tr></table>`;
    }
    return html;
  }
  const checksHtml = (checks) => checks.map((c) => `<div class="li"><span class="mk ${c.status}">${{ ok: "✓", warn: "!", fail: "✕" }[c.status]}</span><span><b>${esc(c.label)}.</b> ${esc(c.detail)}</span></div>`).join("");

  window.renderDevOptions = function () {
    const r = state.result, p = state.project;
    $("#devBrief").textContent = r.brief.summary;
    const g = $("#devGuard");
    g.classList.toggle("hidden", !r.guard_removed.length);
    g.innerHTML = `🛡 <b>Safety guard:</b> we ignored part of your notes because it looked like an instruction to the AI: <i>“${esc(r.guard_removed.join(" "))}”</i>`;
    $("#devAdvice").innerHTML = `<span class="rec">★ We recommend ${esc(r.advisor.recommended)}</span><p>${esc(r.advisor.overview)}</p>`;
    const env = r.envelope;
    $("#devSite").innerHTML = `<h3>Your site</h3>${state.geo ? `<div class="propMap">${mapIframe(state.geo.lat, state.geo.lon)}</div>` : ""}${p.existing?.address ? `<p><b>${esc(p.existing.address)}</b></p>` : ""}<p><b>${env.acres} acres</b> · ${env.buildable_width_ft.toFixed(0)} × ${env.buildable_depth_ft.toFixed(0)} ft buildable</p>
      <p>Up to <b>${env.max_stories}</b> stories · <b>${env.max_units_per_acre}</b> units/acre (${esc(env.density_source)}) · ${env.max_lot_coverage_pct}% coverage</p>
      <p class="hint">Setbacks ${env.setbacks_ft.front}/${env.setbacks_ft.side}/${env.setbacks_ft.rear} ft (front/side/rear). Confirm with your jurisdiction.</p>`;
    $("#devNotes").innerHTML = `<h3>Before you go further</h3>
      ${r.brief.concerns.length ? `<h4>Worth knowing early</h4><ul class="qs">${r.brief.concerns.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <h4>Confirm locally</h4><ul class="qs">${r.advisor.next_questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`;
    $("#devOptions").innerHTML = r.options.map((o, i) => {
      const sc = o.scheme, [vc, vt] = verdictOf(o.checks), rec = sc.name === r.advisor.recommended;
      return `<article class="card opt-card${rec ? " recommended" : ""}">
        <div class="opt-top"><div class="tier"><span>${TIER[sc.tier]} · ${esc(state.meta.dev.products[sc.product])}</span>${rec ? '<span class="rec">★ Recommended</span>' : ""}</div>
          <h3>${esc(sc.name)}</h3><p class="tagline">${esc(sc.tagline)}</p></div>
        <div class="sketch" style="padding:10px 14px">${o.site_svg_small}</div>
        <div class="opt-body">
          <div class="price"><span class="total">${money(o.cost.total)}</span><span class="verdict ${vc}">${vt}</span></div>
          <div>${budgetBar(o.cost.total, p.budget_total)}</div>
          ${kpis(o)}
          <p class="hint" style="margin:0">${mixLine(sc)} · ${sc.buildings} bldg × ${sc.stories} stories · ${sc.parking_spaces} ${sc.parking_type} spaces</p>
          <p class="headline">${esc(o.advice.headline)}</p>
          <div class="lists">${listItems(o.advice, o.checks)}</div>
          <details class="more"><summary>Costs &amp; returns</summary>${devCostTable(o.cost, o.returns)}</details>
          <details class="more"><summary>All checks</summary><div class="lists checks">${checksHtml(o.checks)}</div></details>
          <div class="opt-actions"><button class="btn primary" data-devpick="${i}">Choose &amp; refine</button></div>
        </div></article>`;
    }).join("");
    $$("[data-devpick]").forEach((b) => b.onclick = () => openDevRefine(+b.dataset.devpick));
  };

  // ---------------------------------------------------------------- refine
  function openDevRefine(i) {
    state.devIdx = i;
    state.devChats[i] = state.devChats[i] || { msgs: [], version: 1 };
    state.devCurrent = state.devChats[i].current || state.result.options[i];
    state.devView = "3d";
    renderDevPane(); renderDevMsgs();
    show("dev-refine");
  }

  function renderDevPane() {
    const o = state.devCurrent, sc = o.scheme, p = state.project, [vc, vt] = verdictOf(o.checks), chat = dchat();
    $("#devRefineTitle").textContent = sc.name;
    $("#devRefineTag").textContent = `${state.meta.dev.products[sc.product]} · ${sc.tagline}`;
    $("#devPane").innerHTML = `
      <div class="dpTop">
        <div><div class="price"><span class="total">${money(o.cost.total)}</span><span class="verdict ${vc}">${vt}</span></div>
          <div style="margin:12px 0">${budgetBar(o.cost.total, p.budget_total)}</div></div>
        <div>${kpis(o)}<div class="version" style="margin-top:10px">Version ${chat.version}${chat.version > 1 ? ' · <button class="link" id="devUndo">Undo last change</button>' : ""}</div></div>
      </div>
      <div class="viewTabs" style="margin-top:18px"><button data-dv="3d" class="${state.devView === "3d" ? "on" : ""}">3D site</button><button data-dv="plan" class="${state.devView === "plan" ? "on" : ""}">Site plan</button></div>
      <div class="stage" id="devStage"></div>
      <p class="hint">${esc(sc.exterior)} ${esc(sc.site_notes)}</p>
      <div class="cols2">
        <div><h4>Unit mix</h4><table class="unitTable"><tr><th>Unit</th><th>Beds</th><th>Baths</th><th>Sq ft</th><th>Count</th></tr>
          ${sc.unit_types.map((u) => `<tr><td>${esc(u.name)}</td><td>${u.bedrooms || "Studio"}</td><td>${u.bathrooms}</td><td>${u.area_sqft.toLocaleString()}</td><td>${u.count}</td></tr>`).join("")}</table>
          <p class="hint">${sc.buildings} building(s) × ${sc.stories} stories · ${o.sizing.gross_sqft.toLocaleString()} gross sq ft · ${sc.parking_spaces} ${sc.parking_type} parking spaces${sc.amenities.length ? " · " + sc.amenities.map((a) => esc(state.meta.dev.amenities[a] || a)).join(", ") : ""}</p>
          <h4>Checks</h4><div class="lists">${checksHtml(o.checks)}</div></div>
        <div><h4>Costs &amp; returns</h4>${devCostTable(o.cost, o.returns)}</div>
      </div>`;
    $$("[data-dv]").forEach((b) => b.onclick = () => { state.devView = b.dataset.dv; renderDevPane(); });
    $("#devUndo")?.addEventListener("click", devUndo);
    const ideas = ["Add 4 more units", "Bring it under budget", "Swap some units to 3BR", "Add a playground", "Use structured parking", "Make it 2 stories"];
    $(".suggest", $("#devChat")).innerHTML = ideas.map((t) => `<button type="button">${t}</button>`).join("");
    $$(".suggest button", $("#devChat")).forEach((b) => b.onclick = () => sendDevChat(b.textContent));
    renderDevStage(o);
  }

  async function renderDevStage(o) {
    const stage = $("#devStage");
    disposeViewer();
    if (state.devView === "plan") { stage.innerHTML = `<div class="planWrap" style="border:0;height:100%;display:grid;place-items:center">${o.site_svg}</div>`; return; }
    const v = await mount3d(stage, o.model3d, {});
    if (stage.isConnected) state.viewer = v; else v.dispose();
  }

  function renderDevMsgs() {
    const chat = dchat(), box = $(".msgs", $("#devChat"));
    const intro = `<div class="msg bot">This is <b>${esc(state.devCurrent.scheme.name)}</b>. Tell me what to change: unit mix, number of units, stories, parking, amenities. I'll update the site plan and show how cost and returns move.</div>`;
    box.innerHTML = intro + chat.msgs.map((m) => {
      if (m.role === "user") return `<div class="msg user">${esc(m.text)}</div>`;
      if (m.typing) return `<div class="msg bot typing">Updating your plan…</div>`;
      const delta = m.delta ? `<span class="delta ${m.delta > 0 ? "up" : "down"}">${m.delta > 0 ? "+" : "−"}${money(Math.abs(m.delta))} total</span>` : "";
      return `<div class="msg bot${m.blocked ? " blocked" : ""}">${esc(m.text)}${m.changes?.length ? `<ul>${m.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}${m.declined ? `<div class="declined">${esc(m.declined)}</div>` : ""}${delta}</div>`;
    }).join("");
    box.scrollTop = 1e6;
  }

  async function sendDevChat(text) {
    text = (text || "").trim();
    if (!text || state.devBusy) return;
    const chat = dchat(), input = $(".chatForm input", $("#devChat")), btn = $(".chatForm button", $("#devChat"));
    chat.msgs.push({ role: "user", text }, { role: "bot", typing: true });
    input.value = ""; state.devBusy = true; btn.disabled = true;
    renderDevMsgs();
    try {
      const r = await fetch(`/api/runs/${state.runId}/refine`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ option_index: state.devIdx, message: text }) });
      const j = await r.json();
      chat.msgs.pop();
      if (!r.ok) chat.msgs.push({ role: "bot", blocked: true, text: j.detail || "Something went wrong. Please try again." });
      else {
        state.refineEvents.push(...j.events);
        chat.msgs.push({ role: "bot", text: j.reply, changes: j.changes, declined: j.declined, delta: j.delta, blocked: j.blocked });
        if (!j.blocked) { chat.current = j.option; chat.version = j.version; state.devCurrent = j.option; renderDevPane(); }
        updateMeter();
      }
    } catch (e) { chat.msgs.pop(); chat.msgs.push({ role: "bot", blocked: true, text: "Could not reach NestQuest. Is the app still running?" }); }
    state.devBusy = false; btn.disabled = false;
    renderDevMsgs();
  }

  async function devUndo() {
    const r = await fetch(`/api/runs/${state.runId}/undo/${state.devIdx}`, { method: "POST" });
    if (!r.ok) return;
    const j = await r.json(), chat = dchat();
    chat.current = j.option; chat.version = j.version; state.devCurrent = j.option;
    chat.msgs.push({ role: "bot", text: "Undone. You're back to the previous version." });
    renderDevPane(); renderDevMsgs();
  }
})();
