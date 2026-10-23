// Shared form pieces: the "your property" block (address + what's on the land),
// interior preference pickers, and grouped must-have chips. Uses helpers from app.js.
(function () {
  const INTERIOR = {
    flooring: { label: "Main floors", opts: { hardwood: ["Solid hardwood", "#9A6B43"], engineered_wood: ["Engineered wood", "#B58D64"], lvp: ["Luxury vinyl plank", "#C2B29C"], tile: ["Tile", "#D9D4CC"], carpet_bedrooms: ["Wood + carpeted bedrooms", "#CBBFAE"] } },
    kitchen_style: { label: "Kitchen cabinets", opts: { white_shaker: ["White shaker", "#F4F2ED"], modern_flat: ["Modern flat-panel", "#3E3A36"], two_tone: ["Two-tone", "linear-gradient(180deg,#F4F2ED 50%,#34495E 50%)"], natural_wood: ["Natural wood", "#A47E5C"] } },
    countertops: { label: "Countertops", opts: { quartz: ["Quartz", "#F1EFEA"], granite: ["Granite", "#6D6862"], marble: ["Marble", "linear-gradient(135deg,#F8F7F5 40%,#CFCAC4 45%,#F8F7F5 55%)"], butcher_block: ["Butcher block", "#C19A6B"] } },
    palette: { label: "Color palette", opts: { warm_neutral: ["Warm neutrals", "linear-gradient(90deg,#F4EDE3 50%,#C98B5E 50%)"], cool_gray: ["Cool grays", "linear-gradient(90deg,#E3E6E9 50%,#5F7A8C 50%)"], bold_dark: ["Bold & dark", "linear-gradient(90deg,#6A6F76 50%,#B5893C 50%)"], natural_earthy: ["Natural & earthy", "linear-gradient(90deg,#E6D9C2 50%,#8C9A7E 50%)"] } },
  };
  const SEGS = {
    ceiling_ft: { label: "Main-floor ceilings", opts: { 9: "9 ft", 10: "10 ft", 12: "12 ft" }, def: "9" },
    layout: { label: "Layout", opts: { open: "Open concept", semi_open: "Semi-open", defined: "Defined rooms" }, def: "open" },
    appliances: { label: "Appliances", opts: { standard: "Standard", professional: "Professional-grade" }, def: "standard" },
  };
  const DEF = { flooring: "engineered_wood", kitchen_style: "white_shaker", countertops: "quartz", palette: "warm_neutral" };

  // ---------------------------------------------------------------- property block
  window.renderPropertyBlock = function (form) {
    const el = $(".propertyBlock", form);
    el.innerHTML = `
      <div class="propBox">
        <h4 style="margin-top:0">Your property <span class="opt">optional</span></h4>
        <div class="addrRow">
          <input name="address" maxlength="160" placeholder="Street address, e.g. 1320 Elsinore Ave, McLean, VA" autocomplete="street-address">
          <button type="button" class="btn soft findBtn">Find on map</button>
        </div>
        <p class="hint addrMsg">We look the address up with OpenStreetMap to place it on a map and fill in the state.</p>
        <div class="mapBox hidden"></div>
        <div class="grid g3" style="margin-top:14px">
          <div class="field"><span class="lbl">What's on the land today?</span>
            <div class="seg" data-name="structure"><button type="button" data-v="vacant" class="on">Nothing (vacant)</button><button type="button" data-v="teardown">A building to tear down</button><button type="button" data-v="keep">A building that stays</button></div></div>
          <label class="exSqft hidden">Existing building size (sq ft)<input name="existing_sqft" type="number" min="100" max="20000" placeholder="e.g. 1,800"></label>
          <div class="field"><span class="lbl">Slope</span>
            <div class="seg" data-name="slope"><button type="button" data-v="flat" class="on">Flat</button><button type="button" data-v="gentle">Gentle</button><button type="button" data-v="steep">Steep</button></div></div>
          <div class="field"><span class="lbl">Utilities</span>
            <div class="seg" data-name="utilities"><button type="button" data-v="public" class="on">Public water &amp; sewer</button><button type="button" data-v="well_septic">Well &amp; septic</button></div></div>
          <label style="grid-column: span 2">About the existing property <span class="opt">optional</span><input name="existing_notes" maxlength="400" placeholder="e.g. Mature oaks in back we'd like to keep; existing driveway on the left"></label>
        </div>
      </div>`;
    $$(".seg", el).forEach((seg) => $$("button", seg).forEach((b) => b.onclick = () => {
      $$("button", seg).forEach((x) => x.classList.remove("on")); b.classList.add("on");
      if (seg.dataset.name === "structure") $(".exSqft", el).classList.toggle("hidden", b.dataset.v === "vacant");
    }));
    const find = async () => {
      const q = form.elements.address.value.trim(), msg = $(".addrMsg", el), map = $(".mapBox", el);
      if (q.length < 5) { msg.textContent = "Enter a street address first."; return; }
      msg.textContent = "Looking up the address…";
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail);
        form._geo = j;
        if (j.state_code) form.elements.state_code.value = j.state_code;
        if (j.city && !form.elements.city.value) form.elements.city.value = j.city;
        msg.textContent = `Found: ${j.display_name}`;
        map.innerHTML = mapIframe(j.lat, j.lon);
        map.classList.remove("hidden");
      } catch (e) { form._geo = null; msg.textContent = e.message || "Couldn't look up that address."; map.classList.add("hidden"); }
    };
    $(".findBtn", el).onclick = find;
    form.elements.address.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); find(); } });
  };

  window.mapIframe = function (lat, lon) {
    const d = 0.004;
    const bbox = [lon - d, lat - d * 0.7, lon + d, lat + d * 0.7].map((v) => v.toFixed(5)).join(",");
    return `<iframe title="Map of the property" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lon.toFixed(6)}"></iframe>`;
  };

  // Called when "Do you own the land?" changes
  window.togglePropertyBlock = function (form, owns) { $(".propertyBlock", form).classList.toggle("hidden", !owns); };

  window.collectProperty = function (form) {
    const el = $(".propertyBlock", form), v = (n) => $(`.seg[data-name=${n}] .on`, el)?.dataset.v;
    const structure = v("structure");
    return {
      address: form.elements.address.value.trim(),
      structure,
      existing_sqft: structure === "vacant" ? 0 : +form.elements.existing_sqft.value || 0,
      slope: v("slope"),
      utilities: v("utilities"),
      notes: form.elements.existing_notes.value.trim(),
    };
  };

  // ---------------------------------------------------------------- interior prefs
  window.renderInterior = function (el) {
    el.innerHTML = Object.entries(INTERIOR).map(([k, g]) => `
      <div class="field"><span class="lbl">${g.label}</span><div class="swatches" data-name="${k}">
        ${Object.entries(g.opts).map(([v, [n, c]]) => `<button type="button" class="swatch${v === DEF[k] ? " on" : ""}" data-v="${v}"><i style="background:${c}"></i>${n}</button>`).join("")}
      </div></div>`).join("") +
      `<div class="grid g3" style="margin-top:6px">${Object.entries(SEGS).map(([k, g]) => `
        <div class="field"><span class="lbl">${g.label}</span><div class="seg" data-name="${k}">
        ${Object.entries(g.opts).map(([v, n]) => `<button type="button" data-v="${v}" class="${v === g.def ? "on" : ""}">${n}</button>`).join("")}</div></div>`).join("")}</div>
      <p class="hint">These shape the cost estimate and the furnished 3D view of each floor.</p>`;
    $$(".swatches", el).forEach((grp) => $$(".swatch", grp).forEach((b) => b.onclick = () => { $$(".swatch", grp).forEach((x) => x.classList.remove("on")); b.classList.add("on"); }));
    $$(".seg", el).forEach((seg) => $$("button", seg).forEach((b) => b.onclick = () => { $$("button", seg).forEach((x) => x.classList.remove("on")); b.classList.add("on"); }));
  };
  window.collectInterior = function (el) {
    const out = {};
    for (const k of Object.keys(INTERIOR)) out[k] = $(`.swatches[data-name=${k}] .on`, el).dataset.v;
    for (const k of Object.keys(SEGS)) out[k] = $(`.seg[data-name=${k}] .on`, el).dataset.v;
    out.ceiling_ft = +out.ceiling_ft;
    return out;
  };

  // ---------------------------------------------------------------- grouped chips
  window.renderChipGroups = function (el, groups) {
    el.innerHTML = Object.entries(groups).map(([g, items]) => `
      <div class="chipGroup"><span class="lbl">${esc(g)}</span><div class="chips">
        ${Object.entries(items).map(([k, v]) => `<button type="button" class="chip" data-v="${k}">${esc(v)}</button>`).join("")}
      </div></div>`).join("");
    $$(".chip", el).forEach((c) => c.onclick = () => c.classList.toggle("on"));
  };
})();
