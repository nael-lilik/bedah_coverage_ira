const map = L.map("map", { zoomControl: false }).setView([-2.5, 118], 5);
const selectedLocationLayer = L.layerGroup().addTo(map);
const btsLayer = L.layerGroup().addTo(map);
const resultsElement = document.getElementById("results");
const statusElement = document.getElementById("status");
const statusTextElement = document.getElementById("status-text");
const mapErrorElement = document.getElementById("map-error");
const seenListElement = document.getElementById("seen-list");
const seenCountElement = document.getElementById("seen-count");
const exportCsvButton = document.getElementById("export-csv");
const seenBtsDatabaseName = "coverage-bts-history";
const seenBtsStoreName = "seen-bts";
const legacyBtsStorageKey = "coverage-recent-bts-v1";
const coverageRadiusMeters = 1000;
const btsMarkers = new Map();
let seenBts = [];
let seenBtsDatabasePromise;
let latestRequestId = 0;

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

function setStatus(message, state = "") {
  statusElement.className = `status${state ? ` is-${state}` : ""}`;
  statusTextElement.textContent = message;
}

function showMapError(message) {
  mapErrorElement.textContent = message;
  mapErrorElement.hidden = false;
  window.setTimeout(() => {
    mapErrorElement.hidden = true;
  }, 5000);
}

function getCoverageResult(data) {
  if (!data || typeof data !== "object") return null;
  if (data.result && typeof data.result === "object") return data.result;
  if (data.data?.result && typeof data.data.result === "object") {
    return data.data.result;
  }
  return null;
}

function getBtsEntries(results) {
  const entries = new Map();

  for (const service of results) {
    const coverage = getCoverageResult(service.data);
    const btsList = Array.isArray(coverage?.bts_ids) ? coverage.bts_ids : [];

    for (const bts of btsList) {
      const latitude = bts.latitude;
      const longitude = bts.longitude;
      if (
        typeof latitude !== "number" ||
        typeof longitude !== "number" ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        continue;
      }

      const key =
        bts.id || `${bts.name || "BTS"}:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
      const existing = entries.get(key);
      if (existing) {
        existing.services.add(service.name);
      } else {
        entries.set(key, {
          ...bts,
          id: String(bts.id || key),
          name: String(bts.name || "BTS"),
          latitude,
          longitude,
          capacity: bts.capacity ?? "Tidak diketahui",
          services: new Set([service.name]),
        });
      }
    }
  }

  return [...entries.values()];
}

function addBtsMarkers(entries) {
  btsLayer.clearLayers();
  btsMarkers.clear();

  for (const bts of entries) {
    const name = String(bts.name || "BTS");
    const capacity = String(bts.capacity ?? "Tidak diketahui");
    L.circle([bts.latitude, bts.longitude], {
      radius: coverageRadiusMeters,
      color: "#087f72",
      weight: 1.5,
      fillColor: "#42b8a7",
      fillOpacity: 0.1,
    })
      .bindPopup(`<strong>${escapeHtml(name)}</strong><br>Radius coverage: 1 km`)
      .addTo(btsLayer);
    const marker = L.circleMarker([bts.latitude, bts.longitude], {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: "#087f72",
      fillOpacity: 1,
    }).addTo(btsLayer);
    const label = `${name} · Kapasitas ${capacity}`;

    marker.bindTooltip(escapeHtml(label), {
      permanent: true,
      direction: "top",
      offset: [0, -9],
      className: "bts-tooltip",
    });
    marker.bindPopup(
      `<strong>${escapeHtml(name)}</strong><br>Kapasitas: ${escapeHtml(String(capacity))}<br>Koordinat: ${bts.latitude.toFixed(5)}, ${bts.longitude.toFixed(5)}`
    );
    btsMarkers.set(bts.id, marker);
  }
}

function openSeenBtsDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("Browser ini tidak mendukung IndexedDB."));
  }
  if (seenBtsDatabasePromise) return seenBtsDatabasePromise;

  seenBtsDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(seenBtsDatabaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(seenBtsStoreName)) {
        database.createObjectStore(seenBtsStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error("Database BTS gagal dibuka."));
    request.onblocked = () => reject(new Error("Database BTS sedang diblokir tab lain."));
  });
  return seenBtsDatabasePromise;
}

function getAllSeenBts(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(seenBtsStoreName, "readonly");
    const request = transaction.objectStore(seenBtsStoreName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Riwayat BTS gagal dibaca."));
    transaction.onabort = () => reject(transaction.error || new Error("Pembacaan riwayat BTS dibatalkan."));
  });
}

function saveSeenBtsEntries(database, entries, seenAt) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(seenBtsStoreName, "readwrite");
    const store = transaction.objectStore(seenBtsStoreName);

    for (const entry of entries) {
      const request = store.get(entry.id);
      request.onsuccess = () => {
        const previous = request.result;
        store.put({
          ...previous,
          ...entry,
          firstSeen: previous?.firstSeen || entry.firstSeen || seenAt,
          lastSeen: entry.lastSeen || seenAt,
          services: [...new Set([...(previous?.services || []), ...(entry.services || [])])],
        });
      };
      request.onerror = () => transaction.abort();
    }

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Riwayat BTS gagal disimpan."));
    transaction.onabort = () => reject(transaction.error || new Error("Penyimpanan riwayat BTS dibatalkan."));
  });
}

function normalizeSeenBts(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Format riwayat BTS tidak valid.");
  }

  return entries
    .filter(
      (bts) =>
        bts &&
        typeof bts.latitude === "number" &&
        typeof bts.longitude === "number" &&
        Number.isFinite(bts.latitude) &&
        Number.isFinite(bts.longitude) &&
        bts.latitude >= -90 &&
        bts.latitude <= 90 &&
        bts.longitude >= -180 &&
        bts.longitude <= 180
    )
    .map((bts) => ({
      id: String(bts.id || `${bts.latitude},${bts.longitude}`),
      name: String(bts.name || "BTS"),
      latitude: bts.latitude,
      longitude: bts.longitude,
      capacity: String(bts.capacity ?? "Tidak diketahui"),
      services: Array.isArray(bts.services) ? bts.services.map(String) : [],
      firstSeen: String(bts.firstSeen || bts.lastSeen || ""),
      lastSeen: String(bts.lastSeen || bts.firstSeen || ""),
    }));
}

async function initializeSeenBts() {
  const database = await openSeenBtsDatabase();

  try {
    const storedLegacy = localStorage.getItem(legacyBtsStorageKey);
    if (storedLegacy) {
      const legacyEntries = normalizeSeenBts(JSON.parse(storedLegacy));
      await saveSeenBtsEntries(database, legacyEntries, new Date().toISOString());
      localStorage.removeItem(legacyBtsStorageKey);
    }
  } catch (error) {
    showMapError(`Migrasi riwayat BTS lama gagal: ${error.message}`);
  }

  seenBts = (await getAllSeenBts(database)).sort((left, right) =>
    String(right.lastSeen).localeCompare(String(left.lastSeen))
  );
  addBtsMarkers(seenBts);
  renderSeenBts();
}

function renderSeenBts() {
  seenCountElement.textContent = String(seenBts.length);
  exportCsvButton.disabled = seenBts.length === 0;
  seenListElement.replaceChildren();

  if (seenBts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "seen-empty";
    empty.textContent = "BTS yang pernah ditemukan akan tersimpan di sini.";
    seenListElement.append(empty);
    return;
  }

  for (const bts of seenBts) {
    const button = document.createElement("button");
    button.className = "seen-item";
    button.type = "button";
    button.title = "Fokus ke lokasi BTS pada peta";

    const details = document.createElement("span");
    details.className = "seen-item-details";
    const name = document.createElement("span");
    name.className = "seen-item-name";
    name.textContent = bts.name;
    const capacity = document.createElement("span");
    capacity.className = "seen-item-meta";
    capacity.textContent = `Kapasitas ${bts.capacity}`;
    details.append(name, capacity);
    if (bts.lastSeen && Number.isFinite(Date.parse(bts.lastSeen))) {
      const lastSeen = document.createElement("span");
      lastSeen.className = "seen-item-meta";
      lastSeen.textContent = `Terakhir terlihat ${new Date(bts.lastSeen).toLocaleString("id-ID")}`;
      details.append(lastSeen);
    }

    const coordinates = document.createElement("span");
    coordinates.className = "seen-item-coordinates";
    coordinates.textContent = `${bts.latitude.toFixed(4)}, ${bts.longitude.toFixed(4)}`;
    button.append(details, coordinates);
    button.addEventListener("click", () => {
      map.flyTo([bts.latitude, bts.longitude], Math.max(map.getZoom(), 13));
      btsMarkers.get(bts.id)?.openPopup();
    });
    seenListElement.append(button);
  }
}

async function rememberBtsEntries(entries) {
  const database = await openSeenBtsDatabase();
  await saveSeenBtsEntries(database, entries, new Date().toISOString());
  seenBts = (await getAllSeenBts(database)).sort((left, right) =>
    String(right.lastSeen).localeCompare(String(left.lastSeen))
  );
  addBtsMarkers(seenBts);
  renderSeenBts();
}

function csvCell(value, protectFormula = false) {
  let text = String(value ?? "");
  if (protectFormula && /^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function exportSeenBtsCsv() {
  const columns = [
    ["id", (bts) => bts.id, true],
    ["name", (bts) => bts.name, true],
    ["capacity", (bts) => bts.capacity, true],
    ["latitude", (bts) => bts.latitude, false],
    ["longitude", (bts) => bts.longitude, false],
    ["services", (bts) => (bts.services || []).join(", "), true],
    ["first_seen", (bts) => bts.firstSeen, true],
    ["last_seen", (bts) => bts.lastSeen, true],
  ];
  const rows = [
    columns.map(([header]) => csvCell(header)).join(","),
    ...seenBts.map((bts) =>
      columns.map(([, value], index) => csvCell(value(bts), columns[index][2])).join(",")
    ),
  ];
  const csv = `\uFEFF${rows.join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `bts-seen-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function appendResultCard(service) {
  const card = document.createElement("article");
  card.className = "result-card";

  const header = document.createElement("div");
  header.className = "result-header";
  const name = document.createElement("h2");
  name.className = "result-name";
  name.textContent = service.name;
  const badge = document.createElement("span");
  badge.className = "result-badge";

  const coverage = getCoverageResult(service.data);
  if (!service.success) {
    badge.classList.add("failed");
    badge.textContent = "Gagal";
  } else if (coverage?.inside_coverage === true) {
    badge.textContent = "Dalam coverage";
  } else if (coverage?.inside_coverage === false) {
    badge.classList.add("outside");
    badge.textContent = "Di luar coverage";
  } else {
    badge.textContent = "Respons diterima";
  }

  header.append(name, badge);
  card.append(header);

  const detail = document.createElement("p");
  detail.className = "result-detail";
  if (service.error) {
    detail.textContent = service.error;
  } else if (service.statusCode) {
    detail.textContent = `HTTP ${service.statusCode}`;
  } else {
    detail.textContent = "Tidak ada detail respons.";
  }
  card.append(detail);

  const btsCount = Array.isArray(coverage?.bts_ids)
    ? coverage.bts_ids.length
    : 0;
  if (btsCount > 0) {
    const count = document.createElement("p");
    count.className = "bts-count";
    count.textContent = `${btsCount} BTS ditampilkan pada peta`;
    card.append(count);
  }

  resultsElement.append(card);
}

async function checkCoverage(latitude, longitude, location, requestId) {
  resultsElement.replaceChildren();
  mapErrorElement.hidden = true;
  selectedLocationLayer.clearLayers();
  L.circle(location, {
    radius: coverageRadiusMeters,
    color: "#d18b26",
    weight: 1.5,
    fillColor: "#f1a43b",
    fillOpacity: 0.12,
  })
    .bindPopup("Radius dari lokasi yang dipilih: 1 km")
    .addTo(selectedLocationLayer);
  L.circleMarker(location, {
    radius: 8,
    color: "#ffffff",
    weight: 2,
    fillColor: "#f1a43b",
    fillOpacity: 1,
  })
    .bindPopup(`Lokasi dipilih<br>${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
    .addTo(selectedLocationLayer);

  setStatus("Menghubungi API coverage…", "loading");

  try {
    const response = await fetch("/api/coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude, longitude }),
    });
    const payload = await response.json();
    if (requestId !== latestRequestId) return;
    const results = Array.isArray(payload.results) ? payload.results : [];

    if (!response.ok && results.length === 0) {
      throw new Error(payload.error || "API coverage tidak dapat dihubungi.");
    }

    const btsEntries = getBtsEntries(results);
    if (btsEntries.length > 0) {
      await rememberBtsEntries(btsEntries);
    }
    if (requestId !== latestRequestId) return;
    results.forEach(appendResultCard);

    const failedCount = results.filter((service) => !service.success).length;
    if (results.length === 0) {
      setStatus("API tidak mengembalikan hasil", "error");
    } else if (failedCount === results.length) {
      setStatus("Semua layanan API gagal", "error");
    } else if (btsEntries.length > 0) {
      setStatus(`${btsEntries.length} lokasi BTS ditemukan`);
    } else {
      setStatus("Pengecekan selesai — tidak ada BTS pada respons");
    }
  } catch (error) {
    if (requestId !== latestRequestId) return;
    setStatus("Pengecekan gagal", "error");
    showMapError(error.message || "Terjadi kesalahan saat mengecek coverage.");
  }
}

map.on("click", (event) => {
  const latitude = Number(event.latlng.lat.toFixed(8));
  const longitude = Number(event.latlng.lng.toFixed(8));
  latestRequestId += 1;
  checkCoverage(latitude, longitude, event.latlng, latestRequestId);
});

exportCsvButton.addEventListener("click", exportSeenBtsCsv);
initializeSeenBts().catch((error) => {
  setStatus("Riwayat BTS gagal dimuat", "error");
  showMapError(`Riwayat BTS gagal dimuat: ${error.message}`);
});
