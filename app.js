const DATA = {
  wells: "data/processed/groundwater_wells.geojson",
  counties: "data/processed/county_fluoride_2022.json",
  states: "data/processed/state_fluoride_2022.json",
  health: "data/processed/county_health_2025.json",
  countyGeo: "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json",
  stateGeo: "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json"
};

const DATA_VERSION = "20260608-well-aggregation-2";

const HOME_VIEW = {
  center: [39.5, -98.35],
  zoom: 4
};

const state = {
  countyFluoride: new Map(),
  stateFluoride: new Map(),
  healthAccess: new Map(),
  wells: null,
  countyLayer: null,
  stateLayer: null,
  wellLayer: null,
  wellSummaryLayer: null,
  stateBounds: new Map(),
  visibleWellCount: 0,
  currentWellDisplay: "summary",
  activeBoundary: "state",
  identifyMode: "boundaries",
  selectedFeature: null
};

const map = L.map("map", { preferCanvas: true }).setView([39.5, -98.35], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);
map.createPane("boundaryPane");
map.getPane("boundaryPane").style.zIndex = 410;
map.createPane("wellPane");
map.getPane("wellPane").style.zIndex = 430;
updateIdentifyInteractivity();
addHomeControl();

const els = {
  stateFilter: document.getElementById("stateFilter"),
  wellTypeFilter: document.getElementById("wellTypeFilter"),
  fluorideRange: document.getElementById("fluorideRange"),
  fluorideRangeValue: document.getElementById("fluorideRangeValue"),
  wellToggle: document.getElementById("wellToggle"),
  viewTitle: document.getElementById("viewTitle"),
  metricCounties: document.getElementById("metricCounties"),
  metricWells: document.getElementById("metricWells"),
  metricWellsLabel: document.getElementById("metricWellsLabel"),
  metricAverage: document.getElementById("metricAverage"),
  metricAverageLabel: document.getElementById("metricAverageLabel"),
  selectedDetails: document.getElementById("selectedDetails"),
  healthSummary: document.getElementById("healthSummary"),
  pwsSummary: document.getElementById("pwsSummary"),
  legend: document.getElementById("legend"),
  pwsUpload: document.getElementById("pwsUpload")
};

Promise.all([
  fetchJson(DATA.wells),
  fetchJson(DATA.counties),
  fetchJson(DATA.states),
  fetchJson(DATA.health),
  fetchJson(DATA.countyGeo),
  fetchJson(DATA.stateGeo)
]).then(([wells, counties, states, health, countyGeo, stateGeo]) => {
  state.wells = wells;
  counties.forEach((row) => state.countyFluoride.set(String(row.fips).padStart(5, "0"), row));
  states.forEach((row) => state.stateFluoride.set(row.state, row));
  health.forEach((row) => state.healthAccess.set(String(row.fips).padStart(5, "0"), row));
  buildFilters(counties, wells);
  addCountyLayer(countyGeo);
  addStateLayer(stateGeo);
  addWellLayer(wells);
  switchBoundary("state");
  refreshWells();
  updateMetrics();
}).catch((error) => {
  els.selectedDetails.textContent = `Could not load map data: ${error.message}`;
});

document.querySelectorAll("input[name='boundaryLayer']").forEach((input) => {
  input.addEventListener("change", () => switchBoundary(input.value));
});

document.querySelectorAll("input[name='identifyMode']").forEach((input) => {
  input.addEventListener("change", () => switchIdentifyMode(input.value));
});

document.querySelectorAll("input[name='wellDisplay']").forEach((input) => {
  input.addEventListener("change", () => {
    refreshWells();
    updateMetrics();
  });
});

map.on("click", clearSelection);

[els.wellTypeFilter, els.fluorideRange, els.wellToggle].forEach((el) => {
  el.addEventListener("input", () => {
    els.fluorideRangeValue.textContent = Number(els.fluorideRange.value).toFixed(1);
    refreshWells();
    restyleBoundaries();
    updateMetrics();
  });
});

els.stateFilter.addEventListener("input", () => {
  handleStateFilterChange();
  refreshWells();
  restyleBoundaries();
  updateMetrics();
});

els.pwsUpload.addEventListener("change", async (event) => {
  const rows = await readCsvFile(event.target.files[0]);
  const systems = new Set(rows.map((row) => clean(row.pws_id || row.PWSID || row.system_id || row.system_name)).filter(Boolean));
  const avg = average(rows.map((row) => numeric(row.fluoride_mg_l || row.fluoride || row.avg_fluoride)));
  els.pwsSummary.innerHTML = detailGrid({
    "Reports": rows.length.toLocaleString(),
    "Systems": systems.size.toLocaleString(),
    "Average fluoride": Number.isFinite(avg) ? `${avg.toFixed(2)} mg/L` : "Not available"
  });
});

function fetchJson(url) {
  const requestUrl = url.startsWith("data/") ? `${url}?v=${DATA_VERSION}` : url;
  return fetch(requestUrl, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.json();
  });
}

function buildFilters(counties, wells) {
  [...new Set(counties.map((row) => row.state).filter(Boolean))].sort().forEach((abbr) => {
    els.stateFilter.append(new Option(abbr, abbr));
  });
  const types = wells.features.map((feature) => feature.properties.well_type).filter(Boolean);
  [...new Set(types)].sort().forEach((type) => els.wellTypeFilter.append(new Option(type, type)));
}

function addCountyLayer(geojson) {
  state.countyLayer = L.geoJSON(geojson, {
    pane: "boundaryPane",
    bubblingMouseEvents: false,
    style: countyStyle,
    onEachFeature: (feature, layer) => {
      layer.on("click", (event) => {
        if (state.identifyMode !== "boundaries") return;
        L.DomEvent.stop(event.originalEvent);
        const fips = String(feature.id || feature.properties.GEO_ID || "").slice(-5);
        const row = state.countyFluoride.get(fips);
        const health = state.healthAccess.get(fips);
        toggleSelection("county", fips, layer, detailGrid({
          "County": row?.county || feature.properties.NAME || "Unknown",
          "FIPS": fips,
          "Fluoridated": percent(row?.pctfluoride_2022),
          "Limited healthy food access": healthPercent(health?.limited_healthy_food_pct),
          "Food environment index": healthNumber(health?.food_environment_index, 1, " / 10"),
          "Dentists per 100,000": healthNumber(health?.dentists_per_100k, 1),
          "Population per dentist": wholeNumber(health?.population_per_dentist)
        }));
        if (state.selectedFeature?.type === "county" && state.selectedFeature.id === fips) {
          showHealthDetails(health);
        }
      });
    }
  });
}

function addStateLayer(geojson) {
  state.stateLayer = L.geoJSON(geojson, {
    pane: "boundaryPane",
    bubblingMouseEvents: false,
    style: stateStyle,
    onEachFeature: (feature, layer) => {
      const abbr = feature.properties.code || feature.properties.STATE || stateNameToAbbr(feature.properties.name);
      if (abbr) state.stateBounds.set(abbr, layer.getBounds());
      layer.on("click", (event) => {
        if (state.identifyMode !== "boundaries") return;
        L.DomEvent.stop(event.originalEvent);
        const row = state.stateFluoride.get(abbr);
        toggleSelection("state", abbr, layer, detailGrid({
          "State": `${feature.properties.name || abbr} (${abbr || "NA"})`,
          "Counties": valueOrBlank(row?.county_count),
          "State fluoridation": statePercent(row?.pctfluoride_2022)
        }));
      });
    }
  });
}

function addWellLayer(wells) {
  state.wellLayer = L.geoJSON(wells, {
    pane: "wellPane",
    bubblingMouseEvents: false,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      pane: "wellPane",
      bubblingMouseEvents: false,
      ...wellBaseStyle(feature)
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const details = detailGrid({
        "USGS site": p.usgs_id,
        "State": p.state,
        "Aquifer": p.aquifer,
        "Well type": p.well_type,
        "Fluoride": `${p.fluoride_mg_l ?? "NA"} mg/L`,
        "Depth": p.depth_ft ? `${p.depth_ft} ft` : "NA",
        "Date": p.date || "NA"
      });
      layer.bindPopup(details, {
        autoPan: true,
        closeButton: true,
        closeOnClick: false,
        maxWidth: 320
      });
      layer.on("click", (event) => {
        if (state.identifyMode !== "wells") return;
        L.DomEvent.stop(event.originalEvent);
        toggleSelection("well", p.usgs_id, layer, details);
      });
    }
  });
}

function switchBoundary(layerName) {
  if (state.selectedFeature && state.selectedFeature.type !== "well") {
    clearSelection();
  }
  state.activeBoundary = layerName;
  if (state.countyLayer) map.removeLayer(state.countyLayer);
  if (state.stateLayer) map.removeLayer(state.stateLayer);
  if (layerName === "county" || layerName === "food" || layerName === "dental") {
    state.countyLayer.addTo(map);
    els.viewTitle.textContent = layerName === "food"
      ? "Limited Healthy Food Access"
      : layerName === "dental"
        ? "Dental Care Access"
        : "County Fluoridation";
  } else {
    state.stateLayer.addTo(map);
    els.viewTitle.textContent = "State Fluoridation";
  }
  restyleBoundaries();
  bringWellsToFront();
  updateLegend();
  updateMetrics();
}

function switchIdentifyMode(mode) {
  state.identifyMode = mode;
  clearSelection();
  updateIdentifyInteractivity();
  refreshWells();
}

function updateIdentifyInteractivity() {
  map.getPane("boundaryPane").style.pointerEvents = state.identifyMode === "boundaries" ? "auto" : "none";
  map.getPane("wellPane").style.pointerEvents = state.identifyMode === "wells" ? "auto" : "none";
}

function resetHome() {
  document.querySelector("input[name='boundaryLayer'][value='state']").checked = true;
  document.querySelector("input[name='identifyMode'][value='boundaries']").checked = true;
  document.querySelector("input[name='wellDisplay'][value='summary']").checked = true;
  state.identifyMode = "boundaries";
  updateIdentifyInteractivity();
  els.stateFilter.value = "";
  els.wellTypeFilter.value = "";
  els.fluorideRange.value = "0";
  els.fluorideRangeValue.textContent = "0.0";
  els.wellToggle.checked = true;
  map.closePopup();
  map.setView(HOME_VIEW.center, HOME_VIEW.zoom);
  clearSelection();
  switchBoundary("state");
  refreshWells();
  restyleBoundaries();
  updateMetrics();
}

function handleStateFilterChange() {
  const abbr = els.stateFilter.value;
  if (!abbr) {
    document.querySelector("input[name='wellDisplay'][value='summary']").checked = true;
    map.setView(HOME_VIEW.center, HOME_VIEW.zoom);
    return;
  }
  document.querySelector("input[name='wellDisplay'][value='individual']").checked = true;
  fitSelectedState();
}

function fitSelectedState() {
  const abbr = els.stateFilter.value;
  const bounds = state.stateBounds.get(abbr);
  if (bounds) {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 7 });
  }
}

function addHomeControl() {
  const HomeControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-home");
      const button = L.DomUtil.create("button", "", container);
      button.type = "button";
      button.title = "Home";
      button.setAttribute("aria-label", "Reset map to home view");
      button.textContent = "H";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, "click", (event) => {
        L.DomEvent.stop(event);
        resetHome();
      });
      return container;
    }
  });
  map.addControl(new HomeControl());
}

function refreshWells() {
  if (!state.wells) return;
  if (state.wellLayer && map.hasLayer(state.wellLayer)) map.removeLayer(state.wellLayer);
  if (state.wellSummaryLayer && map.hasLayer(state.wellSummaryLayer)) map.removeLayer(state.wellSummaryLayer);
  if (state.selectedFeature?.type === "well") clearSelection();
  state.visibleWellCount = 0;
  state.currentWellDisplay = "off";
  if (!els.wellToggle.checked) return;
  const selectedState = els.stateFilter.value;
  const selectedType = els.wellTypeFilter.value;
  const minFluoride = Number(els.fluorideRange.value);
  const filteredFeatures = state.wells.features.filter((feature) => {
    const p = feature.properties;
    return (!selectedState || p.state === selectedState) &&
      (!selectedType || p.well_type === selectedType) &&
      (numeric(p.fluoride_mg_l) >= minFluoride);
  });
  state.visibleWellCount = filteredFeatures.length;
  const display = currentWellDisplayMode();
  state.currentWellDisplay = display;
  if (display === "summary") {
    addWellSummaryLayer(filteredFeatures);
    state.wellSummaryLayer.addTo(map);
  } else {
    addWellLayer({ type: "FeatureCollection", features: filteredFeatures });
    state.wellLayer.addTo(map);
  }
  bringWellsToFront();
  updateLegend();
}

function bringWellsToFront() {
  if (state.wellLayer && map.hasLayer(state.wellLayer)) {
    state.wellLayer.bringToFront();
  }
  if (state.wellSummaryLayer && map.hasLayer(state.wellSummaryLayer)) {
    state.wellSummaryLayer.eachLayer((layer) => layer.bringToFront());
  }
}

function currentWellDisplayMode() {
  return document.querySelector("input[name='wellDisplay']:checked")?.value || "summary";
}

function addWellSummaryLayer(features) {
  const summaries = summarizeWellsByState(features);
  state.wellSummaryLayer = L.layerGroup(
    summaries.map((summary) => {
      const marker = L.circleMarker(summary.center, summaryStyle(summary));
      marker.bindPopup(detailGrid({
        "State": summary.state,
        "Groundwater wells": summary.count.toLocaleString(),
        "Average fluoride": `${summary.avgFluoride.toFixed(2)} mg/L`,
        "Below 0.7 mg/L": summary.low.toLocaleString(),
        "0.7-2.0 mg/L": summary.medium.toLocaleString(),
        "Above 2.0 mg/L": summary.high.toLocaleString()
      }), {
        autoPan: true,
        closeButton: true,
        closeOnClick: false,
        maxWidth: 320
      });
      marker.on("click", (event) => {
        if (state.identifyMode !== "wells") return;
        L.DomEvent.stop(event.originalEvent);
        els.stateFilter.value = summary.state;
        document.querySelector("input[name='wellDisplay'][value='individual']").checked = true;
        fitSelectedState();
        refreshWells();
        updateMetrics();
        els.selectedDetails.innerHTML = detailGrid({
          "State": summary.state,
          "Groundwater wells": summary.count.toLocaleString(),
          "Average fluoride": `${summary.avgFluoride.toFixed(2)} mg/L`,
          "Display": "State summary"
        });
      });
      return marker;
    })
  );
}

function summarizeWellsByState(features) {
  const groups = new Map();
  features.forEach((feature) => {
    const abbr = feature.properties.state || "Unknown";
    if (!groups.has(abbr)) {
      groups.set(abbr, { state: abbr, count: 0, fluoride: [], low: 0, medium: 0, high: 0, latSum: 0, lngSum: 0, points: [] });
    }
    const group = groups.get(abbr);
    const fluoride = numeric(feature.properties.fluoride_mg_l);
    const [lng, lat] = feature.geometry?.coordinates || [];
    group.count += 1;
    group.latSum += lat;
    group.lngSum += lng;
    group.points.push([lat, lng]);
    if (Number.isFinite(fluoride)) {
      group.fluoride.push(fluoride);
      if (fluoride > 2) group.high += 1;
      else if (fluoride >= 0.7) group.medium += 1;
      else group.low += 1;
    }
  });
  return [...groups.values()].map((group) => {
    const mean = [group.latSum / group.count, group.lngSum / group.count];
    return {
      ...group,
      center: representativePoint(group.points, mean),
      avgFluoride: average(group.fluoride)
    };
  }).filter((group) => Number.isFinite(group.center[0]) && Number.isFinite(group.center[1]) && Number.isFinite(group.avgFluoride));
}

function representativePoint(points, mean) {
  return points.reduce((best, point) => {
    const distance = squaredDistance(point, mean);
    return distance < best.distance ? { point, distance } : best;
  }, { point: mean, distance: Infinity }).point;
}

function squaredDistance(a, b) {
  return ((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2);
}

function restyleBoundaries() {
  if (state.countyLayer) state.countyLayer.setStyle(countyStyle);
  if (state.stateLayer) state.stateLayer.setStyle(stateStyle);
  applySelectedStyle();
}

function updateMetrics() {
  const selectedState = els.stateFilter.value;
  const counties = [...state.countyFluoride.values()].filter((row) => !selectedState || row.state === selectedState);
  const wells = els.wellToggle.checked ? state.visibleWellCount : 0;
  els.metricCounties.textContent = counties.length.toLocaleString();
  els.metricWells.textContent = wells.toLocaleString();
  els.metricWellsLabel.textContent = state.currentWellDisplay === "summary" ? "Wells summarized" : "Visible wells";
  if (state.activeBoundary === "food") {
    els.metricAverage.textContent = `${average([...state.healthAccess.values()].map((row) => row.limited_healthy_food_pct)).toFixed(1)}%`;
    els.metricAverageLabel.textContent = "Avg limited food access";
  } else if (state.activeBoundary === "dental") {
    els.metricAverage.textContent = average([...state.healthAccess.values()].map((row) => row.dentists_per_100k)).toFixed(1);
    els.metricAverageLabel.textContent = "Avg dentists per 100k";
  } else {
    if (state.activeBoundary === "state") {
      const selectedStateRow = selectedState ? state.stateFluoride.get(selectedState) : null;
      els.metricAverage.textContent = selectedStateRow
        ? statePercent(selectedStateRow.pctfluoride_2022)
        : [...state.stateFluoride.values()].filter((row) => Number.isFinite(numeric(row.pctfluoride_2022))).length.toLocaleString();
      els.metricAverageLabel.textContent = selectedStateRow ? "State fluoridation" : "States with fluoridation data";
    } else {
      els.metricAverage.textContent = percent(average(counties.map((row) => row.pctfluoride_2022)));
      els.metricAverageLabel.textContent = "Avg county fluoridation";
    }
  }
}

function updateLegend() {
  if (state.activeBoundary === "food") {
    els.legend.innerHTML = `
      <strong>Limited healthy food access</strong>
      ${legendRow("#1f7a7a", "0-5%")}
      ${legendRow("#8bc5a9", "5-10%")}
      ${legendRow("#e2b84b", "10-20%")}
      ${legendRow("#b4473a", "Above 20%")}
      ${legendRow("#c8ced1", "No data")}
    `;
    return;
  }
  if (state.activeBoundary === "dental") {
    els.legend.innerHTML = `
      <strong>Dentists per 100,000</strong>
      ${legendRow("#b4473a", "Below 30")}
      ${legendRow("#e2b84b", "30-50")}
      ${legendRow("#8bc5a9", "50-70")}
      ${legendRow("#1f7a7a", "70 or more")}
      ${legendRow("#c8ced1", "No data")}
    `;
    return;
  }
  els.legend.innerHTML = `
    <strong>Fluoridation level</strong>
    ${legendRow("#edf7f1", "0-25%")}
    ${legendRow("#bfe3cf", "25-50%")}
    ${legendRow("#74b7a1", "50-75%")}
    ${legendRow("#1f7a7a", "75-100%")}
    ${legendRow("#c8ced1", "No data")}
    <hr>
    ${legendRow("#3465a4", "Wells below 0.7 mg/L")}
    ${legendRow("#c78b1c", "Wells 0.7-2.0 mg/L")}
    ${legendRow("#b4473a", "Wells above 2.0 mg/L")}
    ${state.currentWellDisplay === "summary" ? `
      <hr>
      <div class="legendNote">State summary color = average well fluoride</div>
      <div class="legendNote">State summary size = number of wells</div>
    ` : ""}
  `;
}

function countyStyle(feature) {
  const fips = String(feature.id || feature.properties.GEO_ID || "").slice(-5);
  const row = state.countyFluoride.get(fips);
  const health = state.healthAccess.get(fips);
  const selected = state.selectedFeature?.type === "county" && state.selectedFeature.id === fips;
  return selected ? selectedBoundaryStyle() : {
    color: "#ffffff",
    weight: 0.5,
    fillOpacity: 0.76,
    fillColor: state.activeBoundary === "food"
      ? foodAccessColor(health?.limited_healthy_food_pct)
      : state.activeBoundary === "dental"
        ? dentalAccessColor(health?.dentists_per_100k)
        : choroplethColor(row?.pctfluoride_2022)
  };
}

function stateStyle(feature) {
  const abbr = feature.properties.code || stateNameToAbbr(feature.properties.name);
  const row = state.stateFluoride.get(abbr);
  const selected = state.selectedFeature?.type === "state" && state.selectedFeature.id === abbr;
  return selected ? selectedBoundaryStyle() : {
    color: "#ffffff",
    weight: 1,
    fillOpacity: 0.78,
    fillColor: choroplethColor(row?.pctfluoride_2022)
  };
}

function selectedBoundaryStyle() {
  return {
    color: "#101820",
    weight: 3,
    fillOpacity: 0.9,
    fillColor: "#ffd166"
  };
}

function selectedWellStyle(layer) {
  const value = layer.feature?.properties?.fluoride_mg_l;
  return {
    radius: radiusFor(value) + 4,
    fillColor: wellColor(value),
    fillOpacity: 0.95,
    color: "#101820",
    weight: 3
  };
}

function toggleSelection(type, id, layer, detailsHtml) {
  const selected = state.selectedFeature;
  if (selected?.type === type && selected.id === id) {
    clearSelection();
    return;
  }
  clearSelection();
  state.selectedFeature = { type, id, layer };
  els.selectedDetails.innerHTML = detailsHtml;
  applySelectedStyle();
  if (type === "well") layer.openPopup();
}

function clearSelection() {
  const selected = state.selectedFeature;
  state.selectedFeature = null;
  els.selectedDetails.textContent = selectedPrompt();
  els.healthSummary.textContent = "Select a county to view healthy-food and dental-care access.";
  map.closePopup();
  if (selected?.type === "well" && selected.layer) {
    selected.layer.setStyle(wellBaseStyle(selected.layer.feature));
  }
  restyleBoundaries();
}

function selectedPrompt() {
  return state.identifyMode === "wells"
    ? "Select a groundwater well on the map."
    : "Select a county or state boundary on the map.";
}

function applySelectedStyle() {
  const selected = state.selectedFeature;
  if (!selected?.layer) return;
  if (selected.type === "well") {
    selected.layer.setStyle(selectedWellStyle(selected.layer));
    selected.layer.bringToFront();
  } else {
    selected.layer.setStyle(selectedBoundaryStyle());
  }
  bringWellsToFront();
}

function choroplethColor(value) {
  const n = numeric(value);
  if (!Number.isFinite(n)) return "#c8ced1";
  if (n >= 0.75) return "#1f7a7a";
  if (n >= 0.5) return "#74b7a1";
  if (n >= 0.25) return "#bfe3cf";
  return "#edf7f1";
}

function foodAccessColor(value) {
  const n = numeric(value);
  if (!Number.isFinite(n)) return "#c8ced1";
  if (n > 20) return "#b4473a";
  if (n > 10) return "#e2b84b";
  if (n > 5) return "#8bc5a9";
  return "#1f7a7a";
}

function dentalAccessColor(value) {
  const n = numeric(value);
  if (!Number.isFinite(n)) return "#c8ced1";
  if (n >= 70) return "#1f7a7a";
  if (n >= 50) return "#8bc5a9";
  if (n >= 30) return "#e2b84b";
  return "#b4473a";
}

function showHealthDetails(health) {
  els.healthSummary.innerHTML = detailGrid({
    "Limited healthy food access": healthPercent(health?.limited_healthy_food_pct),
    "Food environment index": healthNumber(health?.food_environment_index, 1, " / 10"),
    "Dentists per 100,000": healthNumber(health?.dentists_per_100k, 1),
    "Population per dentist": wholeNumber(health?.population_per_dentist),
    "Release year": valueOrBlank(health?.year)
  });
}

function healthPercent(value) {
  const n = numeric(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "NA";
}

function healthNumber(value, decimals = 1, suffix = "") {
  const n = numeric(value);
  return Number.isFinite(n) ? `${n.toFixed(decimals)}${suffix}` : "NA";
}

function wholeNumber(value) {
  const n = numeric(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : "NA";
}

function wellBaseStyle(feature) {
  return {
    radius: radiusFor(feature.properties.fluoride_mg_l),
    fillColor: wellColor(feature.properties.fluoride_mg_l),
    fillOpacity: 0.7,
    color: "#263238",
    weight: 0.4,
    interactive: state.identifyMode === "wells"
  };
}

function wellColor(value) {
  const n = numeric(value);
  if (n > 2) return "#b4473a";
  if (n >= 0.7) return "#c78b1c";
  return "#3465a4";
}

function radiusFor(value) {
  const n = numeric(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(3, Math.min(9, 3 + n * 1.6));
}

function percent(value) {
  const n = numeric(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "NA";
}

function summaryStyle(summary) {
  return {
    pane: "wellPane",
    radius: Math.max(5, Math.min(20, 4 + Math.sqrt(summary.count) * 0.38)),
    fillColor: wellColor(summary.avgFluoride),
    fillOpacity: 0.72,
    color: "#101820",
    weight: 1.2,
    interactive: state.identifyMode === "wells"
  };
}

function statePercent(value) {
  const n = numeric(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "NA";
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(String(value).replace(/[<,]/g, "").trim());
}

function average(values) {
  const nums = values.map(numeric).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : NaN;
}

function clean(value) {
  return String(value ?? "").trim();
}

function valueOrBlank(value) {
  const text = clean(value);
  return text || "NA";
}

function detailGrid(items) {
  return `<div class="detailGrid">${Object.entries(items).map(([key, value]) =>
    `<span>${key}</span><strong>${valueOrBlank(value)}</strong>`
  ).join("")}</div>`;
}

function legendRow(color, label) {
  return `<div class="legendRow"><span class="swatch" style="background:${color}"></span>${label}</div>`;
}

function legendCircle(color, label) {
  return `<div class="legendRow"><span class="circleSwatch" style="background:${color}"></span>${label}</div>`;
}

async function readCsvFile(file) {
  if (!file) return [];
  const text = await file.text();
  return parseCsv(text);
}

function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  const headers = splitCsvLine(lines.shift()).map(clean);
  lines.forEach((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => row[header] = values[index] ?? "");
    rows.push(row);
  });
  return rows;
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map(clean);
}

function stateNameToAbbr(name) {
  const lookup = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
    Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
    Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
    Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
    Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
    Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
    "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC"
  };
  return lookup[name] || name;
}
