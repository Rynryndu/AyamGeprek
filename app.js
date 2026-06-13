/* Tour Map Studio — interactive walking-tour map builder
 * Pure vanilla JS + Leaflet. No build step, no API keys. */
(function () {
  "use strict";

  const STORAGE_KEY = "tour-map-studio:v1";

  // Default tour shown to first-time visitors: the "Like it Formosa"
  // Kaohsiung food tour through the historic Yancheng District.
  // NOTE: coordinates are approximate starting points — drag any marker to
  // the exact spot and re-export to refine them.
  const DEFAULT_TOUR = {
    title: "Kaohsiung Food Tour — Like it Formosa",
    description:
      "A 2.5-hour guided walking food tour through Kaohsiung's historic Yancheng District. Five tasting stops — from a 70-year milkfish eatery to a Michelin Bib Gourmand smoked duck and a beloved shaved-ice institution. Starts 10:30 AM at Yanchengpu MRT.",
    stops: [
      {
        name: "Yanchengpu MRT Station — Exit 1",
        description:
          "Meeting point (10 min). Check-in and introductions. \"Formosa\" is another name for Taiwan — Like it Formosa hopes visitors fall in love with Taiwan through its guided tours. Today: a walking journey tasting authentic Kaohsiung foods and the stories behind them.",
        imageUrl: "",
        lat: 22.6259,
        lng: 120.2866,
      },
      {
        name: "Yama Ichi (山壹旗魚食製所)",
        description:
          "Stop 1 · 30 min. A 70-year, family-run eatery in Yancheng First Public Market, specializing in milkfish snacks and tempura — a fish stall by morning, a fried-snack diner by afternoon. Deboning, pounding, seasoning and frying are all done by hand. Tasting: a tempura box with 3 kinds of fishcake (NT$88/box, NT$44 pp).",
        imageUrl: "",
        lat: 22.6242,
        lng: 120.285,
      },
      {
        name: "Duck Zhen (鴨肉珍)",
        description:
          "Stop 2 · 30 min. One of Kaohsiung's most iconic smoked-duck restaurants, running 60+ years and listed in the Michelin Guide (Bib Gourmand). Famous for tender, aromatic smoked duck with rice or vermicelli; humble, rustic and beloved — locals queue early. Tasting: a bowl of duck vermicelli (NT$60 pp).",
        imageUrl: "",
        lat: 22.623,
        lng: 120.2853,
      },
      {
        name: "Xiangming Tea Shop (香茗茶行)",
        description:
          "Stop 3 · 20 min. A historic tea house founded in 1946, set inside the Japanese-era \"Ginza Arcade\" with wooden window frames and old tea jars. It evolved from delivering loose tea by bicycle to modern ready-to-drink teas and soft serve. Tasting: choice of Oolong Milk Tea or Fresh Milk Tea (NT$70 pp).",
        imageUrl: "",
        lat: 22.6245,
        lng: 120.286,
      },
      {
        name: "DaGouDing Milkfish Rice-Noodle Soup (大溝頂虱目魚米粉湯)",
        description:
          "Stop 4 · 30 min. Hidden in a narrow alley of Yancheng First Public Market, this 60+ year spot is named for the \"covered ditch\" (DaGouDing). Milkfish — southern Taiwan's \"national fish\" — stars in its fish-belly soup with house-made fish paste and rice noodles. Tasting: fish-belly paste soup (one bowl per two) plus minced pork rice each (NT$83 pp).",
        imageUrl: "",
        lat: 22.6238,
        lng: 120.2849,
      },
      {
        name: "Po Po Ice (高雄婆婆冰)",
        description:
          "Stop 5 · 30 min. A 70+ year shaved-ice institution dating to the Japanese colonial era. Founded by Mrs. Cai Zhaogu — \"Po Po\" (grandmother) — who built the shop after being widowed at 36; her red kerchief became the brand's symbol. Tasting: choice of three shaved ices — signature plum, taro with red beans, or super-fruit combo with ice cream (NT$125 pp).",
        imageUrl: "",
        lat: 22.6283,
        lng: 120.2859,
      },
    ],
  };

  // ---- State ----------------------------------------------------------------
  /** @type {{title:string, description:string, stops:Stop[]}} */
  let tour = { title: "", description: "", stops: [] };
  let addMode = false;
  let editingId = null;
  let preview = { active: false, index: 0 };

  const markers = new Map(); // id -> Leaflet marker
  let routeLayer = null; // drawn polyline (street route or straight fallback)
  let routeLegs = null; // [{distance, duration, steps[], straight}] between consecutive stops
  let routeKey = ""; // signature of current stop geometry, to avoid refetching
  let routeReq = 0; // token to discard stale async routing responses
  let nextId = 1;

  // Public foot-routing endpoint (OSRM, hosted by FOSSGIS — no API key).
  const ROUTER_URL =
    "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";

  // ---- DOM ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    title: $("tour-title"),
    desc: $("tour-desc"),
    addBtn: $("add-mode-btn"),
    addHint: $("add-hint"),
    clearBtn: $("clear-btn"),
    list: $("stop-list"),
    empty: $("empty-state"),
    count: $("stop-count"),
    routeSummary: $("route-summary"),
    directionsBtn: $("directions-btn"),
    // directions modal
    dirOverlay: $("directions-overlay"),
    dirBody: $("dir-body"),
    dirClose: $("dir-close"),
    exportJson: $("export-json"),
    exportGpx: $("export-gpx"),
    importBtn: $("import-btn"),
    importInput: $("import-input"),
    shareBtn: $("share-btn"),
    playBtn: $("play-btn"),
    // editor
    overlay: $("editor-overlay"),
    eName: $("edit-name"),
    eDesc: $("edit-desc"),
    eImage: $("edit-image"),
    eLat: $("edit-lat"),
    eLng: $("edit-lng"),
    eDelete: $("edit-delete"),
    eCancel: $("edit-cancel"),
    eSave: $("edit-save"),
    // preview
    previewBar: $("preview-bar"),
    prevStop: $("prev-stop"),
    nextStop: $("next-stop"),
    exitPreview: $("exit-preview"),
    previewName: $("preview-name"),
    previewProgress: $("preview-progress"),
    toast: $("toast"),
  };

  // ---- Map ------------------------------------------------------------------
  const map = L.map("map", { zoomControl: true }).setView([22.625, 120.2858], 16);

  // Base maps. Default to a layer with English / romanized labels (Esri),
  // and offer standard OpenStreetMap (local-language labels) as an option.
  const baseLayers = {
    "English labels (Esri)": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution:
          "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, and other contributors",
      }
    ),
    "OpenStreetMap (local labels)": L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }
    ),
  };
  baseLayers["English labels (Esri)"].addTo(map);
  L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

  map.on("click", (e) => {
    if (!addMode) return;
    addStop(e.latlng.lat, e.latlng.lng);
  });

  // ---- Helpers --------------------------------------------------------------
  function uid() {
    return "s" + nextId++;
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.add("hidden"), 2200);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function makeIcon(number, active) {
    return L.divIcon({
      className: "",
      html: `<div class="tour-marker${active ? " active" : ""}"><span>${number}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30],
    });
  }

  function popupHtml(stop, index) {
    const img = stop.imageUrl
      ? `<img src="${escapeHtml(stop.imageUrl)}" alt="" onerror="this.style.display='none'">`
      : "";
    const desc = stop.description ? `<div>${escapeHtml(stop.description)}</div>` : "";
    return `<div class="popup-title">${index + 1}. ${escapeHtml(stop.name || "Untitled stop")}</div>${desc}${img}`;
  }

  // ---- Stops CRUD -----------------------------------------------------------
  function addStop(lat, lng) {
    const stop = {
      id: uid(),
      name: "Stop " + (tour.stops.length + 1),
      description: "",
      imageUrl: "",
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
    };
    tour.stops.push(stop);
    render();
    save();
    openEditor(stop.id);
  }

  function getStop(id) {
    return tour.stops.find((s) => s.id === id);
  }

  function moveStop(id, dir) {
    const i = tour.stops.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= tour.stops.length) return;
    [tour.stops[i], tour.stops[j]] = [tour.stops[j], tour.stops[i]];
    render();
    save();
  }

  function deleteStop(id) {
    tour.stops = tour.stops.filter((s) => s.id !== id);
    render();
    save();
  }

  function clearStops() {
    if (!tour.stops.length) return;
    if (!confirm("Remove all stops? This cannot be undone.")) return;
    tour.stops = [];
    render();
    save();
  }

  // ---- Rendering ------------------------------------------------------------
  function render() {
    renderMarkers();
    renderRoute();
    renderList();
    el.count.textContent = String(tour.stops.length);
    el.empty.classList.toggle("hidden", tour.stops.length > 0);
  }

  function renderMarkers() {
    // Drop markers no longer present
    for (const [id, m] of markers) {
      if (!getStop(id)) {
        map.removeLayer(m);
        markers.delete(id);
      }
    }
    tour.stops.forEach((stop, i) => {
      const active = preview.active && preview.index === i;
      let m = markers.get(stop.id);
      if (!m) {
        m = L.marker([stop.lat, stop.lng], { draggable: true });
        m.addTo(map);
        m.on("dragend", () => {
          const ll = m.getLatLng();
          stop.lat = +ll.lat.toFixed(6);
          stop.lng = +ll.lng.toFixed(6);
          renderRoute();
          renderList();
          save();
        });
        m.on("click", () => openEditor(stop.id));
        markers.set(stop.id, m);
      } else {
        m.setLatLng([stop.lat, stop.lng]);
      }
      m.setIcon(makeIcon(i + 1, active));
      m.bindPopup(popupHtml(stop, i));
    });
  }

  function stopsKey() {
    return tour.stops.map((s) => s.id + ":" + s.lat + "," + s.lng).join("|");
  }

  function renderRoute() {
    const key = stopsKey();
    // Geometry unchanged (e.g. re-render during preview) — keep current route.
    if (key === routeKey && routeLayer) return;
    routeKey = key;

    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    routeLegs = null;

    const pts = tour.stops.map((s) => [s.lat, s.lng]);
    if (pts.length < 2) {
      updateRouteSummary();
      return;
    }

    // Draw an immediate straight placeholder while the street route loads.
    routeLayer = L.polyline(pts, {
      color: "#94a3b8",
      weight: 3,
      opacity: 0.6,
      dashArray: "1 8",
      lineCap: "round",
    }).addTo(map);
    updateRouteSummary();

    const myReq = ++routeReq;
    fetchFootRoute(tour.stops).then((res) => {
      if (myReq !== routeReq) return; // a newer request superseded this one
      if (!res) {
        // Routing unavailable — keep the straight line, show estimates.
        routeLegs = straightLegs(tour.stops);
        updateRouteSummary();
        renderList();
        return;
      }
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = L.polyline(res.latlngs, {
        color: "#f97316",
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
      routeLegs = res.legs;
      updateRouteSummary();
      renderList();
    });
  }

  // Query the public OSRM foot router; resolves to {latlngs, legs} or null.
  function fetchFootRoute(stops) {
    const coords = stops.map((s) => s.lng + "," + s.lat).join(";");
    const url =
      ROUTER_URL + coords + "?overview=full&geometries=geojson&steps=true";
    return fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.code !== "Ok" || !data.routes || !data.routes[0]) {
          return null;
        }
        const route = data.routes[0];
        const latlngs = route.geometry.coordinates.map((c) => [c[1], c[0]]);
        const legs = (route.legs || []).map((leg) => ({
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps || [],
          straight: false,
        }));
        return { latlngs, legs };
      })
      .catch(() => null);
  }

  // Fallback: straight-line distance/time when routing can't be reached.
  function straightLegs(stops) {
    const legs = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const d = haversine(stops[i], stops[i + 1]);
      legs.push({ distance: d, duration: d / 1.35, steps: [], straight: true });
    }
    return legs;
  }

  function haversine(a, b) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function fmtDist(m) {
    if (!Number.isFinite(m)) return "";
    return m >= 1000 ? (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km" : Math.round(m) + " m";
  }

  function fmtDur(s) {
    if (!Number.isFinite(s)) return "";
    const min = Math.round(s / 60);
    return min < 1 ? "<1 min" : min + " min";
  }

  function routeTotals() {
    if (!routeLegs) return null;
    return routeLegs.reduce(
      (acc, l) => {
        acc.distance += l.distance || 0;
        acc.duration += l.duration || 0;
        acc.straight = acc.straight || l.straight;
        return acc;
      },
      { distance: 0, duration: 0, straight: false }
    );
  }

  function updateRouteSummary() {
    const n = tour.stops.length;
    const showDir = n >= 2;
    if (el.directionsBtn) el.directionsBtn.classList.toggle("hidden", !showDir);
    if (!el.routeSummary) return;

    if (n < 2) {
      el.routeSummary.classList.add("hidden");
      el.routeSummary.innerHTML = "";
      return;
    }
    el.routeSummary.classList.remove("hidden");
    if (!routeLegs) {
      el.routeSummary.innerHTML = '<span class="spin">↻</span> Calculating walking route…';
      return;
    }
    const t = routeTotals();
    const note = t.straight ? ' <span class="muted">(straight-line estimate)</span>' : "";
    el.routeSummary.innerHTML =
      "🚶 <strong>" + fmtDist(t.distance) + "</strong> · <strong>" +
      fmtDur(t.duration) + "</strong> total walking" + note;
  }

  function renderList() {
    el.list.innerHTML = "";
    tour.stops.forEach((stop, i) => {
      const li = document.createElement("li");
      li.className = "stop-item" + (preview.active && preview.index === i ? " active" : "");
      li.innerHTML = `
        <div class="stop-num">${i + 1}</div>
        <div class="stop-body" data-id="${stop.id}">
          <div class="stop-name">${escapeHtml(stop.name || "Untitled stop")}</div>
          <div class="stop-sub">${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</div>
        </div>
        <div class="stop-actions">
          <button class="icon-btn" data-act="up" ${i === 0 ? "disabled" : ""} title="Move up">▲</button>
          <button class="icon-btn" data-act="down" ${i === tour.stops.length - 1 ? "disabled" : ""} title="Move down">▼</button>
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="del" title="Delete">🗑</button>
        </div>`;

      li.querySelector(".stop-body").addEventListener("click", () => focusStop(stop.id));
      li.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const act = btn.dataset.act;
          if (act === "up") moveStop(stop.id, -1);
          else if (act === "down") moveStop(stop.id, 1);
          else if (act === "edit") openEditor(stop.id);
          else if (act === "del") deleteStop(stop.id);
        });
      });
      el.list.appendChild(li);

      // Walking connector to the next stop.
      if (i < tour.stops.length - 1) {
        const leg = routeLegs && routeLegs[i];
        const conn = document.createElement("li");
        conn.className = "leg-connector";
        if (leg) {
          conn.innerHTML =
            '<span class="leg-line"></span>' +
            '<button class="leg-info" data-leg="' + i + '" title="Show walking directions">' +
            "🚶 " + fmtDur(leg.duration) + " · " + fmtDist(leg.distance) +
            (leg.straight ? " · est." : "") +
            "</button>";
          conn.querySelector(".leg-info").addEventListener("click", () => openDirections(i));
        } else {
          conn.innerHTML = '<span class="leg-line"></span><span class="leg-info muted">🚶 …</span>';
        }
        el.list.appendChild(conn);
      }
    });
  }

  function focusStop(id) {
    const stop = getStop(id);
    if (!stop) return;
    map.panTo([stop.lat, stop.lng]);
    const m = markers.get(id);
    if (m) m.openPopup();
  }

  function fitToStops() {
    if (tour.stops.length === 0) return;
    if (tour.stops.length === 1) {
      map.setView([tour.stops[0].lat, tour.stops[0].lng], 15);
    } else {
      map.fitBounds(tour.stops.map((s) => [s.lat, s.lng]), { padding: [60, 60] });
    }
  }

  // ---- Add mode -------------------------------------------------------------
  function setAddMode(on) {
    addMode = on;
    el.addBtn.classList.toggle("active", on);
    el.addHint.classList.toggle("hidden", !on);
    el.addBtn.innerHTML = on
      ? '<span class="icon">✓</span> Click map to add'
      : '<span class="icon">＋</span> Add stop';
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }

  // ---- Editor modal ---------------------------------------------------------
  function openEditor(id) {
    const stop = getStop(id);
    if (!stop) return;
    editingId = id;
    el.eName.value = stop.name || "";
    el.eDesc.value = stop.description || "";
    el.eImage.value = stop.imageUrl || "";
    el.eLat.value = stop.lat;
    el.eLng.value = stop.lng;
    el.overlay.classList.remove("hidden");
    el.eName.focus();
    el.eName.select();
  }

  function closeEditor() {
    el.overlay.classList.add("hidden");
    editingId = null;
  }

  function saveEditor() {
    const stop = getStop(editingId);
    if (!stop) return closeEditor();
    stop.name = el.eName.value.trim();
    stop.description = el.eDesc.value.trim();
    stop.imageUrl = el.eImage.value.trim();
    const lat = parseFloat(el.eLat.value);
    const lng = parseFloat(el.eLng.value);
    if (Number.isFinite(lat)) stop.lat = lat;
    if (Number.isFinite(lng)) stop.lng = lng;
    closeEditor();
    render();
    save();
  }

  // ---- Walking directions ---------------------------------------------------
  function openDirections(scrollToLeg) {
    if (tour.stops.length < 2) return;
    el.dirBody.innerHTML = buildDirectionsHtml();
    el.dirOverlay.classList.remove("hidden");
    if (scrollToLeg != null) {
      const target = el.dirBody.querySelector('[data-leg-block="' + scrollToLeg + '"]');
      if (target) target.scrollIntoView({ block: "start" });
    } else {
      el.dirBody.scrollTop = 0;
    }
  }

  function closeDirections() {
    el.dirOverlay.classList.add("hidden");
  }

  function buildDirectionsHtml() {
    if (!routeLegs) return '<p class="muted">Calculating route…</p>';
    let html = "";
    for (let i = 0; i < tour.stops.length - 1; i++) {
      const from = tour.stops[i];
      const to = tour.stops[i + 1];
      const leg = routeLegs[i];
      const meta = leg
        ? fmtDist(leg.distance) + " · " + fmtDur(leg.duration) + (leg.straight ? " · estimate" : "")
        : "";
      html +=
        '<div class="dir-leg" data-leg-block="' + i + '">' +
        '<div class="dir-leg-head"><span class="dir-from">' + (i + 1) + "</span> " +
        escapeHtml(from.name || "Stop") + ' <span class="muted">→</span> <span class="dir-to">' +
        (i + 2) + "</span> " + escapeHtml(to.name || "Stop") +
        '<span class="dir-meta">' + meta + "</span></div>";

      if (leg && leg.steps && leg.steps.length) {
        html += '<ol class="dir-steps">';
        leg.steps.forEach((step) => {
          const d = step.distance ? ' <span class="muted">(' + fmtDist(step.distance) + ")</span>" : "";
          html += "<li>" + escapeHtml(stepText(step)) + d + "</li>";
        });
        html += "</ol>";
      } else if (leg && leg.straight) {
        html += '<p class="muted dir-note">Turn-by-turn unavailable (routing service unreachable) — showing direct distance.</p>';
      }
      html += "</div>";
    }
    return html;
  }

  // Turn an OSRM step into a short human instruction.
  function stepText(step) {
    const m = step.maneuver || {};
    const type = m.type || "";
    const mod = m.modifier ? " " + m.modifier : "";
    const onto = step.name ? " onto " + step.name : "";
    const on = step.name ? " on " + step.name : "";
    switch (type) {
      case "depart":
        return "Head" + (m.modifier ? " " + m.modifier : "") + on;
      case "turn":
      case "end of road":
        return "Turn" + mod + onto;
      case "new name":
        return "Continue" + onto;
      case "continue":
        return "Continue" + mod + on;
      case "merge":
        return "Merge" + mod + onto;
      case "fork":
        return "Keep" + mod + onto;
      case "roundabout":
      case "rotary":
        return "Take the roundabout" + onto;
      case "arrive":
        return "Arrive at the stop";
      default:
        return (type ? type.charAt(0).toUpperCase() + type.slice(1) : "Continue") + mod + onto;
    }
  }

  // ---- Preview mode ---------------------------------------------------------
  function startPreview() {
    if (tour.stops.length === 0) return toast("Add some stops first.");
    if (addMode) setAddMode(false);
    preview.active = true;
    preview.index = 0;
    el.previewBar.classList.remove("hidden");
    gotoPreview(0);
  }

  function gotoPreview(i) {
    preview.index = Math.max(0, Math.min(i, tour.stops.length - 1));
    const stop = tour.stops[preview.index];
    map.setView([stop.lat, stop.lng], Math.max(map.getZoom(), 16), { animate: true });
    el.previewName.textContent = (preview.index + 1) + ". " + (stop.name || "Untitled");
    el.previewProgress.textContent = (preview.index + 1) + " / " + tour.stops.length;
    el.prevStop.disabled = preview.index === 0;
    el.nextStop.disabled = preview.index === tour.stops.length - 1;
    render();
    const m = markers.get(stop.id);
    if (m) m.openPopup();
  }

  function exitPreview() {
    preview.active = false;
    el.previewBar.classList.add("hidden");
    render();
  }

  // ---- Persistence ----------------------------------------------------------
  function save() {
    tour.title = el.title.value;
    tour.description = el.desc.value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tour));
    } catch (e) {
      /* storage may be unavailable; ignore */
    }
  }

  function load() {
    // URL-shared tour takes priority
    const fromUrl = loadFromUrl();
    if (fromUrl) return setTour(fromUrl);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return setTour(JSON.parse(raw));
    } catch (e) {
      /* ignore */
    }
    // First-time visitor: show the built-in Kaohsiung food tour.
    setTour(DEFAULT_TOUR);
  }

  function setTour(data) {
    tour = normalizeTour(data);
    nextId = tour.stops.length + 1;
    el.title.value = tour.title || "";
    el.desc.value = tour.description || "";
    render();
    fitToStops();
  }

  function normalizeTour(data) {
    const t = { title: "", description: "", stops: [] };
    if (data && typeof data === "object") {
      t.title = typeof data.title === "string" ? data.title : "";
      t.description = typeof data.description === "string" ? data.description : "";
      if (Array.isArray(data.stops)) {
        t.stops = data.stops
          .map((s) => ({
            id: s.id || uid(),
            name: typeof s.name === "string" ? s.name : "",
            description: typeof s.description === "string" ? s.description : "",
            imageUrl: typeof s.imageUrl === "string" ? s.imageUrl : "",
            lat: parseFloat(s.lat),
            lng: parseFloat(s.lng),
          }))
          .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      }
    }
    return t;
  }

  // ---- Import / Export ------------------------------------------------------
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug(s) {
    return (s || "tour").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tour";
  }

  function exportJson() {
    save();
    download(slug(tour.title) + ".json", JSON.stringify(tour, null, 2), "application/json");
  }

  function exportGpx() {
    save();
    const esc = escapeHtml;
    const wpts = tour.stops
      .map(
        (s) =>
          `  <wpt lat="${s.lat}" lon="${s.lng}">\n    <name>${esc(s.name)}</name>` +
          (s.description ? `\n    <desc>${esc(s.description)}</desc>` : "") +
          `\n  </wpt>`
      )
      .join("\n");
    const rtepts = tour.stops
      .map((s) => `    <rtept lat="${s.lat}" lon="${s.lng}"><name>${esc(s.name)}</name></rtept>`)
      .join("\n");
    const gpx =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="Tour Map Studio" xmlns="http://www.topografix.com/GPX/1/1">\n` +
      `  <metadata><name>${esc(tour.title || "Tour")}</name>` +
      (tour.description ? `<desc>${esc(tour.description)}</desc>` : "") +
      `</metadata>\n${wpts}\n  <rte>\n    <name>${esc(tour.title || "Tour")}</name>\n${rtepts}\n  </rte>\n</gpx>`;
    download(slug(tour.title) + ".gpx", gpx, "application/gpx+xml");
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const name = file.name.toLowerCase();
        let data;
        if (name.endsWith(".gpx")) data = parseGpx(text);
        else if (name.endsWith(".csv")) data = parseCsv(text);
        else data = JSON.parse(text);
        setTour(data);
        save();
        toast(`Imported ${tour.stops.length} stop(s).`);
      } catch (err) {
        console.error(err);
        toast("Could not parse that file.");
      }
    };
    reader.readAsText(file);
  }

  function parseCsv(text) {
    const rows = csvRows(text);
    if (!rows.length) return { stops: [] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
    const ci = {
      name: idx(["name", "title", "stop"]),
      desc: idx(["description", "desc", "notes"]),
      lat: idx(["lat", "latitude", "y"]),
      lng: idx(["lng", "lon", "long", "longitude", "x"]),
      img: idx(["image", "imageurl", "image_url", "photo"]),
    };
    const stops = rows.slice(1).filter((r) => r.length).map((r) => ({
      name: ci.name >= 0 ? r[ci.name] : "",
      description: ci.desc >= 0 ? r[ci.desc] : "",
      imageUrl: ci.img >= 0 ? r[ci.img] : "",
      lat: parseFloat(r[ci.lat]),
      lng: parseFloat(r[ci.lng]),
    }));
    return { title: "", description: "", stops };
  }

  // Minimal RFC-4180-ish CSV parser (handles quotes and commas in quotes)
  function csvRows(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((f) => f !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
    return rows;
  }

  function parseGpx(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Bad GPX");
    const title = doc.querySelector("metadata > name")?.textContent || "";
    const desc = doc.querySelector("metadata > desc")?.textContent || "";
    // Prefer route points; fall back to waypoints or track points.
    let nodes = [...doc.querySelectorAll("rte > rtept")];
    if (!nodes.length) nodes = [...doc.querySelectorAll("wpt")];
    if (!nodes.length) nodes = [...doc.querySelectorAll("trkpt")];
    const stops = nodes.map((n, i) => ({
      name: n.querySelector("name")?.textContent || "Stop " + (i + 1),
      description: n.querySelector("desc")?.textContent || "",
      imageUrl: "",
      lat: parseFloat(n.getAttribute("lat")),
      lng: parseFloat(n.getAttribute("lng") || n.getAttribute("lon")),
    }));
    return { title, description: desc, stops };
  }

  // ---- Share link -----------------------------------------------------------
  function shareLink() {
    save();
    try {
      const json = JSON.stringify(tour);
      const encoded = btoa(unescape(encodeURIComponent(json)));
      const url = location.origin + location.pathname + "#tour=" + encoded;
      navigator.clipboard?.writeText(url).then(
        () => toast("Shareable link copied to clipboard."),
        () => prompt("Copy this link:", url)
      );
    } catch (e) {
      toast("Could not create link (tour too large).");
    }
  }

  function loadFromUrl() {
    const m = location.hash.match(/tour=([^&]+)/);
    if (!m) return null;
    try {
      const json = decodeURIComponent(escape(atob(m[1])));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  // ---- Events ---------------------------------------------------------------
  el.addBtn.addEventListener("click", () => setAddMode(!addMode));
  el.clearBtn.addEventListener("click", clearStops);
  el.title.addEventListener("input", save);
  el.desc.addEventListener("input", save);

  el.exportJson.addEventListener("click", exportJson);
  el.exportGpx.addEventListener("click", exportGpx);
  el.importBtn.addEventListener("click", () => el.importInput.click());
  el.importInput.addEventListener("change", (e) => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = "";
  });
  el.shareBtn.addEventListener("click", shareLink);

  el.eSave.addEventListener("click", saveEditor);
  el.eCancel.addEventListener("click", closeEditor);
  el.eDelete.addEventListener("click", () => {
    if (editingId) deleteStop(editingId);
    closeEditor();
  });
  el.overlay.addEventListener("click", (e) => {
    if (e.target === el.overlay) closeEditor();
  });

  el.playBtn.addEventListener("click", startPreview);
  el.prevStop.addEventListener("click", () => gotoPreview(preview.index - 1));
  el.nextStop.addEventListener("click", () => gotoPreview(preview.index + 1));
  el.exitPreview.addEventListener("click", exitPreview);

  el.directionsBtn.addEventListener("click", () => openDirections());
  el.dirClose.addEventListener("click", closeDirections);
  el.dirOverlay.addEventListener("click", (e) => {
    if (e.target === el.dirOverlay) closeDirections();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!el.overlay.classList.contains("hidden")) closeEditor();
      else if (!el.dirOverlay.classList.contains("hidden")) closeDirections();
      else if (preview.active) exitPreview();
      else if (addMode) setAddMode(false);
    }
    if (preview.active && el.overlay.classList.contains("hidden")) {
      if (e.key === "ArrowRight") gotoPreview(preview.index + 1);
      if (e.key === "ArrowLeft") gotoPreview(preview.index - 1);
    }
  });

  // ---- Init -----------------------------------------------------------------
  load();
})();
