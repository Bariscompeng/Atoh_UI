const SAVED_GPS_ROUTES_STORAGE_KEY = "gmp_saved_routes_v1";
const PENDING_GPS_ROUTE_STORAGE_KEY = "gmp_pending_route_open_v1";
const SAVED_GPS_ROUTES_EVENT = "gmp-saved-routes-changed";

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

function emitSavedRoutesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SAVED_GPS_ROUTES_EVENT));
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeWaypoint(rawWaypoint) {
  const lat = Number(rawWaypoint?.lat);
  const lng = Number(rawWaypoint?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const speed = Number(rawWaypoint?.speed);
  const waitSeconds = Number(rawWaypoint?.waitSeconds ?? rawWaypoint?.wait_seconds);

  return {
    lat,
    lng,
    speed: Number.isFinite(speed) && speed > 0 ? speed.toFixed(2) : "1.00",
    mode: rawWaypoint?.mode === "corner" ? "corner" : "pass",
    ...(Number.isFinite(waitSeconds) && waitSeconds > 0 ? { waitSeconds: Math.round(waitSeconds) } : {}),
    ...(Number.isFinite(Number(rawWaypoint?.altitude)) ? { altitude: Number(rawWaypoint.altitude) } : {})
  };
}

function haversineMeters(a, b) {
  const toRad = deg => deg * (Math.PI / 180);
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(value));
}

function routeBounds(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return null;

  const lats = waypoints.map(point => point.lat);
  const lngs = waypoints.map(point => point.lng);

  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs)
  };
}

function routeCenter(bounds) {
  if (!bounds) return null;
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2
  };
}

function routeDistanceMeters(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    total += haversineMeters(waypoints[index - 1], waypoints[index]);
  }
  return total;
}

export function createGpsRoutePreviewImage(waypoints, routeName = "") {
  const width = 320;
  const height = 180;
  const pad = 22;

  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    const emptySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1f2937"/>
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" rx="16" fill="url(#bg)"/>
        <text x="${width / 2}" y="${height / 2 - 8}" text-anchor="middle" fill="#e5e7eb" font-size="18" font-family="monospace" font-weight="700">GPS Rota</text>
        <text x="${width / 2}" y="${height / 2 + 18}" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="monospace">Henüz waypoint yok</text>
      </svg>
    `.replace(/\s+/g, " ").trim();
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(emptySvg)}`;
  }

  const bounds = routeBounds(waypoints);
  const lngSpan = Math.max(0.00001, bounds.maxLng - bounds.minLng);
  const latSpan = Math.max(0.00001, bounds.maxLat - bounds.minLat);
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;

  const project = point => {
    const x = pad + ((point.lng - bounds.minLng) / lngSpan) * usableWidth;
    const y = height - pad - ((point.lat - bounds.minLat) / latSpan) * usableHeight;
    return { x, y };
  };

  const projected = waypoints.map(project);
  const polyline = projected.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const title = escapeXml(routeName || "Kaydedilmiş Rota");

  const markers = projected.map((point, index) => `
    <g>
      <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="11" fill="#39ff14" stroke="#064a00" stroke-width="3"/>
      <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="13" fill="none" stroke="#000000" stroke-opacity=".36" stroke-width="1"/>
      <text x="${point.x.toFixed(1)}" y="${(point.y + 4).toFixed(1)}" text-anchor="middle" fill="#071707" font-size="10" font-family="monospace" font-weight="800">${index + 1}</text>
    </g>
  `).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#29451b"/>
          <stop offset="45%" stop-color="#4b6b2b"/>
          <stop offset="100%" stop-color="#6b4f2b"/>
        </linearGradient>
        <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" rx="16" fill="url(#bg)"/>
      <rect width="${width}" height="${height}" rx="16" fill="url(#grid)" opacity="0.5"/>
      <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="12" fill="rgba(15,23,42,0.16)" stroke="rgba(255,255,255,0.12)"/>
      <polyline points="${polyline}" fill="none" stroke="#f7ff00" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      ${markers}
      <rect x="14" y="14" width="${Math.min(240, 90 + title.length * 4)}" height="28" rx="8" fill="rgba(2,6,23,0.72)" stroke="rgba(255,255,255,0.18)"/>
      <text x="24" y="32" fill="#f8fafc" font-size="13" font-family="monospace" font-weight="700">${title}</text>
      <text x="${width - 16}" y="${height - 14}" text-anchor="end" fill="#dbeafe" font-size="11" font-family="monospace">${waypoints.length} WP</text>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function latLngToWorldPixel(lat, lng, zoom) {
  const safeLat = clamp(lat, -85.05112878, 85.05112878);
  const scale = 256 * (2 ** zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((safeLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function buildPreviewViewport(
  waypoints,
  width,
  height,
  zoom,
  {
    padRatio = 0.18,
    padXMin = 120,
    padYMin = 90
  } = {}
) {
  const worldPoints = waypoints.map(point => latLngToWorldPixel(point.lat, point.lng, zoom));
  let minX = Math.min(...worldPoints.map(point => point.x));
  let maxX = Math.max(...worldPoints.map(point => point.x));
  let minY = Math.min(...worldPoints.map(point => point.y));
  let maxY = Math.max(...worldPoints.map(point => point.y));

  const padX = Math.max(padXMin, (maxX - minX) * padRatio);
  const padY = Math.max(padYMin, (maxY - minY) * padRatio);

  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;

  let spanX = Math.max(1, maxX - minX);
  let spanY = Math.max(1, maxY - minY);
  const targetRatio = width / height;
  const currentRatio = spanX / spanY;

  if (currentRatio > targetRatio) {
    const desiredHeight = spanX / targetRatio;
    const extra = (desiredHeight - spanY) / 2;
    minY -= extra;
    maxY += extra;
  } else {
    const desiredWidth = spanY * targetRatio;
    const extra = (desiredWidth - spanX) / 2;
    minX -= extra;
    maxX += extra;
  }

  spanX = maxX - minX;
  spanY = maxY - minY;

  return {
    minX,
    minY,
    spanX,
    spanY,
    project(point) {
      const world = latLngToWorldPixel(point.lat, point.lng, zoom);
      return {
        x: ((world.x - minX) / spanX) * width,
        y: ((world.y - minY) / spanY) * height
      };
    }
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function loadTileWithFallback({ tileBases, tileExtensions, zoom, x, y }) {
  for (const base of tileBases) {
    for (const ext of tileExtensions) {
      const url = `${base}/${zoom}/${x}/${y}.${ext}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const image = await loadImage(url);
        return image;
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

export async function createGpsRouteTilePreviewImage({
  waypoints,
  routeName = "",
  width = 320,
  height = 180,
  zoom = 20,
  tileBases = [],
  tileExtensions = ["jpg", "jpeg", "png", "webp"],
  drawPath = true,
  drawMarkers = true,
  drawTitle = true,
  footerText = "",
  overlayShade = 0.18,
  viewportOptions = undefined
}) {
  if (typeof document === "undefined" || !Array.isArray(waypoints) || waypoints.length === 0) {
    return createGpsRoutePreviewImage(waypoints, routeName);
  }

  const viewport = buildPreviewViewport(waypoints, width, height, zoom, viewportOptions);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return createGpsRoutePreviewImage(waypoints, routeName);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);

  const tileMinX = Math.floor(viewport.minX / 256);
  const tileMaxX = Math.floor((viewport.minX + viewport.spanX) / 256);
  const tileMinY = Math.floor(viewport.minY / 256);
  const tileMaxY = Math.floor((viewport.minY + viewport.spanY) / 256);
  const maxTileIndex = 2 ** zoom;

  let drewAnyTile = false;

  for (let tileY = tileMinY; tileY <= tileMaxY; tileY += 1) {
    if (tileY < 0 || tileY >= maxTileIndex) continue;
    for (let tileX = tileMinX; tileX <= tileMaxX; tileX += 1) {
      const wrappedX = ((tileX % maxTileIndex) + maxTileIndex) % maxTileIndex;
      // eslint-disable-next-line no-await-in-loop
      const image = await loadTileWithFallback({
        tileBases,
        tileExtensions,
        zoom,
        x: wrappedX,
        y: tileY
      });
      if (!image) continue;

      const px = tileX * 256;
      const py = tileY * 256;
      const drawX = ((px - viewport.minX) / viewport.spanX) * width;
      const drawY = ((py - viewport.minY) / viewport.spanY) * height;
      const drawW = (256 / viewport.spanX) * width;
      const drawH = (256 / viewport.spanY) * height;
      ctx.drawImage(image, drawX, drawY, drawW, drawH);
      drewAnyTile = true;
    }
  }

  if (!drewAnyTile) {
    return createGpsRoutePreviewImage(waypoints, routeName);
  }

  if (overlayShade > 0) {
    ctx.fillStyle = `rgba(2, 6, 23, ${overlayShade})`;
    ctx.fillRect(0, 0, width, height);
  }

  const projected = waypoints.map(point => viewport.project(point));

  if (drawPath) {
    ctx.strokeStyle = "#f7ff00";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    projected.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  if (drawMarkers) {
    projected.forEach((point, index) => {
      ctx.beginPath();
      ctx.fillStyle = "#39ff14";
      ctx.strokeStyle = "#064a00";
      ctx.lineWidth = 3;
      ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "rgba(0,0,0,.36)";
      ctx.lineWidth = 1;
      ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#071707";
      ctx.font = "800 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), point.x, point.y + 0.5);
    });
  }

  if (drawTitle) {
    const title = routeName || "Kaydedilmiş Rota";
    ctx.fillStyle = "rgba(2,6,23,.72)";
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1;
    const titleWidth = Math.min(240, 90 + title.length * 4);
    ctx.beginPath();
    ctx.roundRect(14, 14, titleWidth, 28, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 13px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 24, 28);
  }

  if (footerText) {
    ctx.fillStyle = "#dbeafe";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(footerText, width - 16, height - 14);
  } else if (drawMarkers) {
    ctx.fillStyle = "#dbeafe";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${waypoints.length} WP`, width - 16, height - 14);
  }

  return canvas.toDataURL("image/png");
}

export async function createGpsLocationTilePreviewImage({
  lat,
  lng,
  label = "",
  width = 108,
  height = 124,
  zoom = 22,
  tileBases = [],
  tileExtensions = ["jpg", "jpeg", "png", "webp"]
}) {
  return createGpsRouteTilePreviewImage({
    waypoints: [{ lat, lng }],
    routeName: label,
    width,
    height,
    zoom,
    tileBases,
    tileExtensions,
    drawPath: false,
    drawMarkers: false,
    drawTitle: false,
    footerText: "",
    overlayShade: 0.04,
    viewportOptions: {
      padRatio: 0.04,
      padXMin: 52,
      padYMin: 68
    }
  });
}

function normalizeSavedRoute(rawRoute) {
  const waypoints = Array.isArray(rawRoute?.waypoints)
    ? rawRoute.waypoints.map(normalizeWaypoint).filter(Boolean)
    : [];
  const bounds = routeBounds(waypoints);
  const center = routeCenter(bounds);
  const distanceM = routeDistanceMeters(waypoints);
  const name = String(rawRoute?.name || "").trim();
  if (!name || waypoints.length === 0) return null;

  return {
    id: String(rawRoute?.id || `gps-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name,
    description: String(rawRoute?.description || "").trim(),
    createdAt: rawRoute?.createdAt || new Date().toISOString(),
    updatedAt: rawRoute?.updatedAt || rawRoute?.createdAt || new Date().toISOString(),
    waypoints,
    waypointCount: waypoints.length,
    distanceM,
    bounds,
    center,
    previewImage: rawRoute?.previewImage || createGpsRoutePreviewImage(waypoints, name)
  };
}

export function readSavedGpsMissionRoutes() {
  const rawRoutes = loadJson(SAVED_GPS_ROUTES_STORAGE_KEY, []);
  if (!Array.isArray(rawRoutes)) return [];

  return rawRoutes
    .map(normalizeSavedRoute)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function saveGpsMissionRoute({ name, description = "", waypoints, previewImage = "" }) {
  const now = new Date().toISOString();
  const route = normalizeSavedRoute({
    id: `gps-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    previewImage,
    createdAt: now,
    updatedAt: now,
    waypoints
  });
  if (!route) return null;

  const nextRoutes = [route, ...readSavedGpsMissionRoutes()];
  saveJson(SAVED_GPS_ROUTES_STORAGE_KEY, nextRoutes);
  emitSavedRoutesChanged();
  return route;
}

export function deleteSavedGpsMissionRoute(routeId) {
  const nextRoutes = readSavedGpsMissionRoutes().filter(route => route.id !== routeId);
  saveJson(SAVED_GPS_ROUTES_STORAGE_KEY, nextRoutes);
  emitSavedRoutesChanged();
}

export function getSavedGpsMissionRoute(routeId) {
  return readSavedGpsMissionRoutes().find(route => route.id === routeId) || null;
}

export function queueGpsMissionRouteOpen(routeId) {
  saveJson(PENDING_GPS_ROUTE_STORAGE_KEY, { kind: "saved", routeId, ts: Date.now() });
}

export function queueGpsMissionDraftRouteOpen(route) {
  saveJson(PENDING_GPS_ROUTE_STORAGE_KEY, { kind: "draft", route, ts: Date.now() });
}

export function consumeQueuedGpsMissionRouteOpen() {
  const payload = loadJson(PENDING_GPS_ROUTE_STORAGE_KEY, null);
  try {
    localStorage.removeItem(PENDING_GPS_ROUTE_STORAGE_KEY);
  } catch {
    // best-effort
  }
  if (!payload) return null;
  if (payload.kind === "saved" && payload.routeId) return { kind: "saved", routeId: payload.routeId };
  if (payload.kind === "draft" && payload.route) return { kind: "draft", route: normalizeSavedRoute(payload.route) };
  return null;
}

export function gpsMissionRoutesChangedEventName() {
  return SAVED_GPS_ROUTES_EVENT;
}
