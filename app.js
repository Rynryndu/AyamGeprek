/* Tour Map Studio — interactive walking-tour map builder
 * Pure vanilla JS + Leaflet. No build step, no API keys. */
(function () {
  "use strict";

  const STORAGE_KEY = "tour-map-studio:v1";

  // ---- State ----------------------------------------------------------------
  /** @type {{title:string, description:string, stops:Stop[]}} */
  let tour = { title: "", description: "", stops: [] };
  let addMode = false;
  let editingId = null;
  let preview = { active: false, index: 0 };

  const markers = new Map(); // id -> Leaflet marker
  let routeLine = null;
  let nextId = 1;

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
  const map = L.map("map", { zoomControl: true }).setView([40.7589, -73.9851], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

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

  function renderRoute() {
    const pts = tour.stops.map((s) => [s.lat, s.lng]);
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    if (pts.length >= 2) {
      routeLine = L.polyline(pts, {
        color: "#3b82f6",
        weight: 4,
        opacity: 0.7,
        dashArray: "1 8",
        lineCap: "round",
      }).addTo(map);
    }
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
    setTour(tour);
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!el.overlay.classList.contains("hidden")) closeEditor();
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
