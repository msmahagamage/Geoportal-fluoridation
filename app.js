const DATA = {
  wells: "data/processed/groundwater_wells.geojson",
  counties: "data/processed/county_fluoride_2022.json",
  states: "data/processed/state_fluoride_2022.json",
  countyGeo: "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json",
  stateGeo: "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json"
};

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
  metricAverage: document.getElementById("metricAverage"),
  selectedDetails: document.getElementById("selectedDetails"),
  healthSummary: document.getElementById("healthSummary"),
  pwsSummary: document.getElementById("pwsSummary"),
  legend: document.getElementById("legend"),
  healthUpload: document.getElementById("healthUpload"),
  pwsUpload: document.getElementById("pwsUpload")
};

Promise.all([
  fetchJson(DATA.wells),
  fetchJson(DATA.counties),
  fetchJson(DATA.states),
  fetchJson(DATA.countyGeo),
  fetchJson(DATA.stateGeo)
]).then(([wells, counties, states, countyGeo, stateGeo]) => {
  state.wells = wells;
  counties.forEach((row) => state.countyFluoride.set(String(row.fips).padStart(5, "0"), row));
  states.forEach((row) => state.stateFluoride.set(row.state, row));
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

map.on("click", clearSelection);

[els.stateFilter, els.wellTypeFilter, els.fluorideRange, els.wellToggle].forEach((el) => {
  el.addEventListener("input", () => {
    els.fluorideRangeValue.textContent = Number(els.fluorideRange.value).toFixed(1);
    refreshWells();
    restyleBoundaries();
    updateMetrics();
  });
});

els.healthUpload.addEventListener("change", async (event) => {
  const rows = await readCsvFile(event.target.files[0]);
  state.healthAccess.clear();
  rows.forEach((row) => {
    const fips = clean(row.fips || row.FIPS || row.geoid || row.GEOID).padStart(5, "0");
    if (fips) state.healthAccess.set(fips, row);
  });
  els.healthSummary.innerHTML = `<strong>${state.healthAccess.size.toLocaleString()}</strong> county records merged by FIPS.`;
  restyleBoundaries();
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
  return fetch(url).then((res) => {
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
          "Healthy food access": valueOrBlank(health?.healthy_food_access),
          "Dental access": valueOrBlank(health?.dental_care_access),
          "Private dental providers": valueOrBlank(health?.private_dental_providers),
          "Public dental providers": valueOrBlank(health?.public_dental_providers)
        }));
      });
    }
  });
}

function addStateLayer(geojson) {
  state.stateLayer = L.geoJSON(geojson, {
    pane: "boundaryPane",
    style: stateStyle,
    onEachFeature: (feature, layer) => {
      layer.on("click", (event) => {
        if (state.identifyMode !== "boundaries") return;
        L.DomEvent.stop(event.originalEvent);
        const abbr = feature.properties.code || feature.properties.STATE || stateNameToAbbr(feature.properties.name);
        const row = state.stateFluoride.get(abbr);
        toggleSelection("state", abbr, layer, detailGrid({
          "State": `${feature.properties.name || abbr} (${abbr || "NA"})`,
          "Counties": valueOrBlank(row?.county_count),
          "Average fluoridated": percent(row?.avg_pctfluoride_2022)
        }));
      });
    }
  });
}

function addWellLayer(wells) {
  state.wellLayer = L.geoJSON(wells, {
    pane: "wellPane",
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      pane: "wellPane",
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
      layer.bindPopup(details);
      layer.on("click", (event) => {
        if (state.identifyMode !== "wells") return;
        L.DomEvent.stop(event.originalEvent);
        toggleSelection("well", p.usgs_id, layer, details);
      });
    }
  });
}

function switchBoundary(layerName) {
  if (state.selectedFeature && state.selectedFeature.type !== "well" && state.selectedFeature.type !== layerName) {
    clearSelection();
  }
  state.activeBoundary = layerName;
  if (state.countyLayer) map.removeLayer(state.countyLayer);
  if (state.stateLayer) map.removeLayer(state.stateLayer);
  if (layerName === "county") {
    state.countyLayer.addTo(map);
    els.viewTitle.textContent = "County Fluoridation";
  } else {
    state.stateLayer.addTo(map);
    els.viewTitle.textContent = "State Fluoridation";
  }
  bringWellsToFront();
  updateLegend();
}

function switchIdentifyMode(mode) {
  state.identifyMode = mode;
  clearSelection();
  refreshWells();
}

function resetHome() {
  document.querySelector("input[name='boundaryLayer'][value='state']").checked = true;
  document.querySelector("input[name='identifyMode'][value='boundaries']").checked = true;
  state.identifyMode = "boundaries";
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
  if (!state.wellLayer) return;
  if (map.hasLayer(state.wellLayer)) map.removeLayer(state.wellLayer);
  if (state.selectedFeature?.type === "well") clearSelection();
  if (!els.wellToggle.checked) return;
  const selectedState = els.stateFilter.value;
  const selectedType = els.wellTypeFilter.value;
  const minFluoride = Number(els.fluorideRange.value);
  const filtered = {
    type: "FeatureCollection",
    features: state.wells.features.filter((feature) => {
      const p = feature.properties;
      return (!selectedState || p.state === selectedState) &&
        (!selectedType || p.well_type === selectedType) &&
        (numeric(p.fluoride_mg_l) >= minFluoride);
    })
  };
  if (state.wellLayer) map.removeLayer(state.wellLayer);
  addWellLayer(filtered);
  state.wellLayer.addTo(map);
  bringWellsToFront();
}

function bringWellsToFront() {
  if (state.wellLayer && map.hasLayer(state.wellLayer)) {
    state.wellLayer.bringToFront();
  }
}

function restyleBoundaries() {
  if (state.countyLayer) state.countyLayer.setStyle(countyStyle);
  if (state.stateLayer) state.stateLayer.setStyle(stateStyle);
  applySelectedStyle();
}

function updateMetrics() {
  const selectedState = els.stateFilter.value;
  const counties = [...state.countyFluoride.values()].filter((row) => !selectedState || row.state === selectedState);
  const wells = els.wellToggle.checked && state.wellLayer ? state.wellLayer.getLayers().length : 0;
  els.metricCounties.textContent = counties.length.toLocaleString();
  els.metricWells.textContent = wells.toLocaleString();
  els.metricAverage.textContent = percent(average(counties.map((row) => row.pctfluoride_2022)));
}

function updateLegend() {
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
  `;
}

function countyStyle(feature) {
  const fips = String(feature.id || feature.properties.GEO_ID || "").slice(-5);
  const row = state.countyFluoride.get(fips);
  const selected = state.selectedFeature?.type === "county" && state.selectedFeature.id === fips;
  return selected ? selectedBoundaryStyle() : {
    color: "#ffffff",
    weight: 0.5,
    fillOpacity: 0.76,
    fillColor: choroplethColor(row?.pctfluoride_2022)
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
    fillColor: choroplethColor(row?.avg_pctfluoride_2022)
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
