import React, { useEffect, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'Barlow Condensed',sans-serif";
const MIN_Z = 14;
const DL_MAX_Z = 20;
const DEFAULT_NATIVE_ZOOM = 18;
const OFFLINE_TILE_BASE = "/offline-tiles";
const OFFLINE_TILE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const SATELLITE_HEADING_OFFSET_KEY = "gmp_satellite_heading_offset_deg";
const GPS_DATUM = { lat: 39.8936297, lng: 32.7717651 };

function degToRad(deg) {
  return deg * Math.PI / 180;
}

function radToDeg(rad) {
  return rad * 180 / Math.PI;
}

function normalizeDeg(deg) {
  return normalizeSignedDeg(deg);
}

function normalizeSignedDeg(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function normalizeBearingDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

function normalizeRad(rad) {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

function compassBearingToRosYawRad(bearingDegValue) {
  return degToRad(normalizeDeg(90 - bearingDegValue));
}

function storageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

function getStoredSatelliteHeadingOffsetDeg() {
  const offset = parseFloat(storageGet(SATELLITE_HEADING_OFFSET_KEY));
  return Number.isFinite(offset) ? normalizeSignedDeg(offset) : 0;
}

function getSatelliteNativeZoom() {
  const env = import.meta.env || {};
  const raw = (
    storageGet("gmp_satellite_native_zoom") ||
    env.VITE_SATELLITE_NATIVE_ZOOM ||
    String(DEFAULT_NATIVE_ZOOM)
  ).trim();
  const zoom = parseInt(raw, 10);

  if (!Number.isFinite(zoom)) return DEFAULT_NATIVE_ZOOM;
  return Math.max(MIN_Z, Math.min(DL_MAX_Z, zoom));
}

function offlineTileUrl(coords, ext = OFFLINE_TILE_EXTENSIONS[0]) {
  return `${OFFLINE_TILE_BASE}/${coords.z}/${coords.x}/${coords.y}.${ext}`;
}

function tileAttribution() {
  return storageGet("gmp_satellite_attribution") || "Offline satellite imagery";
}

function offlineTileDataUrl(coords) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="#07111f"/>
      <path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#10243a" stroke-width="1"/>
      <path d="M24 182C60 142 86 158 118 120S180 80 232 112" fill="none" stroke="#173856" stroke-width="10" stroke-linecap="round" opacity=".65"/>
      <path d="M24 182C60 142 86 158 118 120S180 80 232 112" fill="none" stroke="#285a83" stroke-width="3" stroke-linecap="round" opacity=".8"/>
      <circle cx="128" cy="128" r="3" fill="#2f7fb4"/>
      <text x="128" y="112" fill="#41627f" font-family="monospace" font-size="11" font-weight="700" text-anchor="middle">UYDU TILE YOK</text>
      <text x="128" y="147" fill="#25425d" font-family="monospace" font-size="9" text-anchor="middle">z${coords.z} / ${coords.x} / ${coords.y}</text>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const CSS = `
  .gmp-scroll::-webkit-scrollbar{width:3px}
  .gmp-scroll::-webkit-scrollbar-track{background:transparent}
  .gmp-scroll::-webkit-scrollbar-thumb{background:#0a2040;border-radius:2px}

  .gmp-btn{transition:all 0.15s ease;outline:none;cursor:pointer;font-family:'JetBrains Mono',monospace}
  .gmp-btn:hover:not(:disabled){filter:brightness(1.3);transform:translateY(-1px)}
  .gmp-btn:active:not(:disabled){transform:translateY(0)}
  .gmp-btn:disabled{opacity:0.35;cursor:not-allowed}

  .gmp-wp-row{transition:background 0.08s}
  .gmp-wp-row:hover{background:rgba(0,212,255,0.04)!important}

  .gmp-input{
    background:#020810;
    border:1px solid #0f2236;
    border-radius:3px;
    color:#00d4ff;
    font-family:'JetBrains Mono',monospace;
    font-size:0.72rem;
    padding:0.3rem 0.5rem;
    outline:none;
    width:100%;
    box-sizing:border-box;
  }

  .gmp-input:focus{border-color:#00d4ff55}
  .gmp-table{
    width:100%;
    border-collapse:collapse;
    table-layout:fixed;
    font-family:'JetBrains Mono',monospace;
  }
  .gmp-table th{
    background:#25252a;
    border:1px solid #3b3b42;
    color:#d7d7d7;
    font-size:10px;
    font-weight:700;
    padding:4px 5px;
    text-align:left;
    white-space:nowrap;
  }
  .gmp-table td{
    background:#111116;
    border:1px solid #35353b;
    color:#e3e3e3;
    font-size:11px;
    padding:3px 5px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .gmp-table tbody tr:nth-child(even) td{background:#18181d}
  .gmp-table tbody tr:hover td{background:#232329}
  .gmp-table input,.gmp-table select{
    width:100%;
    box-sizing:border-box;
    background:#f4f4f4;
    border:1px solid #888;
    color:#111;
    font-family:'JetBrains Mono',monospace;
    font-size:11px;
    height:22px;
    padding:1px 3px;
  }
  .gmp-mp-btn{
    height:24px;
    border:1px solid #555;
    background:#e7e7e7;
    color:#111;
    font-family:'JetBrains Mono',monospace;
    font-size:11px;
    font-weight:700;
    cursor:pointer;
  }
  .gmp-mp-btn:disabled{opacity:.45;cursor:not-allowed}

  .leaflet-container{background:#0a0f1a}
  .leaflet-control-attribution{font-size:9px;opacity:0.35}
  .gmp-debug-tooltip{
    margin:0;
    padding:1px 4px;
    border:1px solid #0f2236;
    border-radius:3px;
    background:rgba(4,9,15,0.9);
    box-shadow:none;
    color:#c8dde8;
    font-family:'JetBrains Mono',monospace;
    font-size:9px;
    font-weight:700;
  }
  .gmp-debug-tooltip::before{display:none}
  .gmp-debug-tooltip-tf{
    color:#ffd6e4;
    border-color:#ff2d7555;
    background:rgba(8,10,16,0.78);
  }

  @keyframes gmpspin{to{transform:rotate(360deg)}}
  @keyframes gmpblink{0%,100%{opacity:1}50%{opacity:0.3}}
`;

// ── Offline static tile layer ─────────────────────────────────────────────
const OfflineTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement("img");
    img.setAttribute("role", "presentation");

    const fetchCoords = { z: coords.z, x: coords.x, y: coords.y };
    let settled = false;
    let extIndex = 0;
    const settle = () => { settled = true; };

    img.onload = () => { settle(); done(null, img); };
    img.onerror = () => {
      if (settled) return;
      extIndex += 1;

      if (extIndex < OFFLINE_TILE_EXTENSIONS.length) {
        img.src = offlineTileUrl(fetchCoords, OFFLINE_TILE_EXTENSIONS[extIndex]);
        return;
      }

      img.onerror = null;
      img.onload = () => { settle(); done(null, img); };
      img.src = offlineTileDataUrl(fetchCoords);
    };

    img.src = offlineTileUrl(fetchCoords);

    // Leaflet tile iptal edildiğinde settle bayrağını set et
    img._cancelLoad = settle;

    return img;
  },

  _abortLoading() {
    // Üst sınıfı çağır ve kendi iptal mekanizmamızı da tetikle
    L.TileLayer.prototype._abortLoading.call(this);
    for (const key in this._tiles) {
      const tile = this._tiles[key];
      if (tile.el && tile.el._cancelLoad) {
        tile.el._cancelLoad();
      }
    }
  }
});

// ── Map helpers ───────────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
      Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(2)} m`;
}

function bearingDeg(a, b) {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstNum(obj, keys) {
  for (const key of keys) {
    const n = toNum(obj?.[key]);
    if (n !== null) return n;
  }

  return null;
}

function pointIndex(p, fallback) {
  const n = firstNum(p, ["index", "wp_index", "waypoint_index", "id"]);
  return n !== null ? n : fallback + 1;
}

function offsetLatLng(anchor, eastM, northM) {
  const earthR = 6378137;
  const latRad = anchor.lat * Math.PI / 180;

  return {
    lat: anchor.lat + northM / earthR * 180 / Math.PI,
    lng: anchor.lng + eastM / (earthR * Math.cos(latRad)) * 180 / Math.PI
  };
}

function latLngDeltaMeters(a, b) {
  if (!a || !b) return null;

  const earthR = 6378137;
  const latRad = a.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;

  return {
    east: dLng * earthR * Math.cos(latRad),
    north: dLat * earthR
  };
}

function estimateMapXYFromRobotGps(targetLatLng, robotLatLon, robotPose, headingOffsetRad = 0) {
  const delta = latLngDeltaMeters(robotLatLon, targetLatLng);

  if (!delta || !robotPose) return null;

  const c = Math.cos(headingOffsetRad);
  const s = Math.sin(headingOffsetRad);
  const mapDx = c * delta.east + s * delta.north;
  const mapDy = -s * delta.east + c * delta.north;

  return {
    x: robotPose.x + mapDx,
    y: robotPose.y + mapDy
  };
}

function projectMapXYToLatLng(x, y, robotLatLon, robotPose, headingOffsetRad = 0) {
  if (!robotLatLon || !robotPose) return null;

  const dx = x - robotPose.x;
  const dy = y - robotPose.y;
  const c = Math.cos(headingOffsetRad);
  const s = Math.sin(headingOffsetRad);
  const east = c * dx - s * dy;
  const north = s * dx + c * dy;

  return offsetLatLng(robotLatLon, east, north);
}

function waypointIcon(index) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="11" fill="#39ff14" stroke="#064a00" stroke-width="3"/>
      <circle cx="14" cy="14" r="13" fill="none" stroke="#000000" stroke-opacity=".45" stroke-width="1"/>
      <text x="14" y="18" text-anchor="middle" font-family="monospace" font-size="11" font-weight="800" fill="#071707">${index}</text>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function makeWaypointLayer(wp, index) {
  return L.marker([wp.lat, wp.lng], {
    icon: waypointIcon(index + 1),
    riseOnHover: true,
    keyboard: false
  });
}

function makeDebugLayer(latlng, type = "fromll-source", label = "") {
  const colorByType = {
    "robot-gps": "#0ea5e9",
    "robot-tf": "#ff2d75",
    "fromll-source": "#39ff14",
    "fromll-xy": "#a78bfa",
    "vehicle-target": "#fbbf24",
    "nav2-goal": "#ef4444"
  };
  const color = colorByType[type] || "#00ff88";
  const isTarget = type === "vehicle-target" || type === "nav2-goal";
  const isTf = type === "robot-tf";
  const radius = isTarget ? 13 : isTf ? 6 : 9;
  const marker = L.circleMarker(latlng, {
    radius,
    color,
    weight: isTarget || isTf ? 2 : 1.5,
    fillColor: isTarget ? "transparent" : color,
    fillOpacity: isTarget ? 0 : isTf ? 0.18 : 0.9,
    opacity: isTf ? 0.8 : 1,
    dashArray: isTf ? "3 3" : null,
    bubblingMouseEvents: false
  });

  if (label) {
    marker.bindTooltip(label, {
      permanent: true,
      direction: isTf ? "right" : "bottom",
      offset: isTf ? [8, 0] : [0, 8],
      className: `gmp-debug-tooltip${isTf ? " gmp-debug-tooltip-tf" : ""}`,
      opacity: 1
    });
  }

  return marker;
}

function missionLevelFromText(text = "") {
  const s = text.toLowerCase();

  if (
    s.includes("succeeded") ||
    s.includes("success") ||
    s.includes("reached") ||
    s.includes("completed") ||
    s.includes("başar") ||
    s.includes("varıldı")
  ) {
    return "success";
  }

  if (
    s.includes("aborted") ||
    s.includes("abort") ||
    s.includes("fail") ||
    s.includes("error") ||
    s.includes("timeout") ||
    s.includes("unreachable") ||
    s.includes("varılamadı") ||
    s.includes("ulaşılamadı") ||
    s.includes("ulaşılamadı")
  ) {
    return "danger";
  }

  if (s.includes("cancel") || s.includes("iptal")) return "muted";

  if (
    s.includes("executing") ||
    s.includes("accepted") ||
    s.includes("navigat") ||
    s.includes("active") ||
    s.includes("gonderildi") ||
    s.includes("gönderildi") ||
    s.includes("eklendi")
  ) {
    return "active";
  }

  if (s.includes("warn") || s.includes("bekleniyor")) return "warn";

  return "info";
}

function missionNoticeColors(level) {
  if (level === "success") return { fg: "#072314", bg: "rgba(38,255,136,.92)", border: "rgba(190,255,218,.95)" };
  if (level === "danger") return { fg: "#fff1f1", bg: "rgba(185,28,28,.94)", border: "rgba(255,190,190,.85)" };
  if (level === "warn") return { fg: "#1f1600", bg: "rgba(251,191,36,.94)", border: "rgba(255,242,190,.85)" };
  if (level === "muted") return { fg: "#f8fafc", bg: "rgba(71,85,105,.94)", border: "rgba(203,213,225,.65)" };
  if (level === "active") return { fg: "#031d26", bg: "rgba(56,189,248,.94)", border: "rgba(186,230,253,.85)" };
  return { fg: "#f8fafc", bg: "rgba(15,23,42,.88)", border: "rgba(148,163,184,.65)" };
}

// ── TF helpers ────────────────────────────────────────────────────────────
function quatToYaw(q) {
  if (!q) return 0;

  const { x = 0, y = 0, z = 0, w = 1 } = q;

  return Math.atan2(
    2 * (w * z + x * y),
    1 - 2 * (y * y + z * z)
  );
}

function applyTF(msg, cache) {
  if (!msg?.transforms) return;

  for (const t of msg.transforms) {
    const parent = (t.header?.frame_id || "").replace(/^\//, "");
    const child = (t.child_frame_id || "").replace(/^\//, "");

    const tr = t.transform?.translation;
    const ro = t.transform?.rotation;

    if (!tr || !ro) continue;

    cache[child] = {
      parent,
      tx: tr.x,
      ty: tr.y,
      qx: ro.x,
      qy: ro.y,
      qz: ro.z,
      qw: ro.w
    };
  }
}

function solveTF(cache) {
  const target = cache["base_link"]
    ? "base_link"
    : cache["base_footprint"]
      ? "base_footprint"
      : null;

  if (!target) return null;

  const chain = [];
  let cur = target;
  const visited = new Set();

  while (cur && cur !== "map" && !visited.has(cur)) {
    visited.add(cur);

    const tf = cache[cur];
    if (!tf) break;

    chain.push({ ...tf });
    cur = tf.parent;
  }

  if (cur !== "map") return null;

  chain.reverse();

  let x = 0;
  let y = 0;
  let yaw = 0;

  for (const tf of chain) {
    const tyaw = quatToYaw({
      x: tf.qx,
      y: tf.qy,
      z: tf.qz,
      w: tf.qw
    });

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);

    x += c * tf.tx - s * tf.ty;
    y += s * tf.tx + c * tf.ty;
    yaw += tyaw;
  }

  return { x, y, yaw, childFrame: target };
}

function poseFromOdometry(msg) {
  const pose = msg?.pose?.pose || msg?.pose;
  const position = pose?.position || {};
  const orientation = pose?.orientation || {};
  const x = toNum(position.x);
  const y = toNum(position.y);
  const z = toNum(position.z);

  return {
    x,
    y,
    z,
    yaw: quatToYaw(orientation),
    frameId: msg?.header?.frame_id || "",
    childFrameId: msg?.child_frame_id || "",
    stamp: msg?.header?.stamp || null,
    ts: Date.now()
  };
}

function poseFromPoseStamped(msg) {
  const pose = msg?.pose || {};
  const position = pose?.position || {};
  const x = toNum(position.x);
  const y = toNum(position.y);
  const z = toNum(position.z);

  return {
    x,
    y,
    z,
    yaw: quatToYaw(pose.orientation),
    frameId: msg?.header?.frame_id || "",
    stamp: msg?.header?.stamp || null,
    ts: Date.now()
  };
}

function rosStampText(stamp, fallbackTs) {
  if (stamp && Number.isFinite(stamp.sec)) {
    const ms = stamp.sec * 1000 + Math.floor((stamp.nanosec || stamp.nsec || 0) / 1e6);
    return new Date(ms).toLocaleTimeString("tr-TR");
  }

  return fallbackTs ? new Date(fallbackTs).toLocaleTimeString("tr-TR") : "-";
}

function fmtNum(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function fmtDeg(value, digits = 1) {
  return Number.isFinite(value) ? `${normalizeDeg(value).toFixed(digits)}°` : "-";
}

function covarianceText(cov) {
  if (!Array.isArray(cov) || cov.length === 0) return "-";
  return cov.slice(0, 9).map(v => fmtNum(toNum(v), 3)).join(", ");
}

function readDebugPoint(p) {
  if (!p) return null;

  return {
    latitude: firstNum(p, ["latitude", "lat", "source_latitude", "source_lat"]),
    longitude: firstNum(p, ["longitude", "lon", "lng", "source_longitude", "source_lon"]),
    altitude: firstNum(p, ["altitude", "alt", "source_altitude"]),
    fromllFrame: p.fromll_frame || p.from_ll_frame || p.frame_id || p.frame || "",
    mapX: firstNum(p, ["fromll_x", "from_ll_x", "converted_x", "map_x", "x"]),
    mapY: firstNum(p, ["fromll_y", "from_ll_y", "converted_y", "map_y", "y"]),
    mapZ: firstNum(p, ["fromll_z", "from_ll_z", "converted_z", "map_z", "z"]),
    goalFrameId: p.goal_frame_id || p.goal_frame || p.frame_id || "",
    yaw: firstNum(p, ["yaw", "goal_yaw", "target_yaw"])
  };
}

const debugRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
  alignItems: "baseline",
  lineHeight: 1.35
};
const debugLabelStyle = { color: "#9ea0a8", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" };
const debugValueStyle = { color: "#e8e8e8", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" };

function DebugRow({ label, value, title }) {
  return (
    <div style={debugRowStyle} title={title || String(value ?? "")}>
      <span style={debugLabelStyle}>{label}</span>
      <span style={debugValueStyle}>{value ?? "-"}</span>
    </div>
  );
}

function DebugSection({ title, children, note }) {
  return (
    <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
      <div style={{ color: "#b9ff2f", fontWeight: 800, marginBottom: 4 }}>{title}</div>
      <div style={{ display: "grid", gap: 2 }}>{children}</div>
      {note ? <div style={{ color: "#9ea0a8", marginTop: 4, lineHeight: 1.35 }}>{note}</div> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
export default function GPSMissionPlannerPage() {
  const { ros, isConnected, status: globalStatus } = useROS();

  const [waypoints, setWaypoints] = useState([]);
  const [navStatus, setNavStatus] = useState("");
  const [centerOnRobot, setCenterOnRobot] = useState(false);
  const [rawGpsInfo, setRawGpsInfo] = useState(null);
  const [robotPoseInfo, setRobotPoseInfo] = useState(null);
  const [imuInfo, setImuInfo] = useState(null);
  const [gpsOdomInfo, setGpsOdomInfo] = useState(null);
  const [globalOdomInfo, setGlobalOdomInfo] = useState(null);
  const [nav2GoalInfo, setNav2GoalInfo] = useState(null);
  const [satelliteHeadingOffsetDeg, setSatelliteHeadingOffsetDeg] = useState(
    getStoredSatelliteHeadingOffsetDeg
  );
  const [compassBearingInput, setCompassBearingInput] = useState("");
  const [debugPoints, setDebugPoints] = useState([]);
  const [diagLogs, setDiagLogs] = useState([]);
  const [missionNotice, setMissionNotice] = useState(null);
  const [tableHeight, setTableHeight] = useState(300);

  const layoutRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);

  const wpMarkersRef = useRef([]);
  const waypointCountRef = useRef(0);
  const routePolylineRef = useRef(null);
  const tableResizeRef = useRef(false);

  const robotMarkerRef = useRef(null);
  const robotHeadingRef = useRef(null);
  const tfPoseMarkerRef = useRef(null);
  const nav2GoalMarkerRef = useRef(null);
  const robotLatLonRef = useRef(null);
  const robotYawRef = useRef(0);
  const robotDisplayYawRef = useRef(0);
  const robotPoseRef = useRef(null);
  const gpsOdomRef = useRef(null);
  const globalOdomRef = useRef(null);
  const nav2GoalRef = useRef(null);
  const imuYawRef = useRef(null);
  const imuInfoRef = useRef(null);
  const tfCacheRef = useRef({});
  const satelliteHeadingOffsetRef = useRef(satelliteHeadingOffsetDeg);

  const convertedMarkersRef = useRef([]);
  const lastFixLogRef = useRef(0);
  const lastTfLogRef = useRef(0);
  const lastImuLogRef = useRef(0);

  const wpPublisherRef = useRef(null);
  const statusSubRef = useRef(null);
  const robotSubRef = useRef(null);
  const imuSubRef = useRef(null);
  const tfSubRef = useRef(null);
  const tfStaticSubRef = useRef(null);
  const debugPointsSubRef = useRef(null);
  const gpsOdomSubRef = useRef(null);
  const globalOdomSubRef = useRef(null);
  const nav2GoalSubRef = useRef(null);

  const centerRef = useRef(false);

  const addLog = useCallback((level, text) => {
    setDiagLogs(prev => [
      {
        ts: Date.now(),
        level,
        text
      },
      ...prev
    ].slice(0, 12));
  }, []);

  const showMissionNotice = useCallback((text, level = missionLevelFromText(text)) => {
    if (!text) return;
    setMissionNotice({
      text,
      level,
      ts: Date.now()
    });
  }, []);

  useEffect(() => {
    centerRef.current = centerOnRobot;
  }, [centerOnRobot]);

  useEffect(() => {
    waypointCountRef.current = waypoints.length;
  }, [waypoints.length]);

  useEffect(() => {
    imuInfoRef.current = imuInfo;
  }, [imuInfo]);

  const ensureRouteLayer = useCallback(() => {
    const map = mapRef.current;

    if (!map) return null;
    if (routePolylineRef.current) return routePolylineRef.current;

    routePolylineRef.current = L.polyline([], {
      color: "#eaff00",
      weight: 4,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
      bubblingMouseEvents: false
    }).addTo(map);

    return routePolylineRef.current;
  }, []);

  const updateRouteOverlay = useCallback(() => {
    const route = ensureRouteLayer();

    if (!route) return;

    if (waypoints.length < 2) {
      route.setLatLngs([]);
      return;
    }

    route.setLatLngs(waypoints.map(wp => [wp.lat, wp.lng]));
  }, [ensureRouteLayer, waypoints]);

  useEffect(() => {
    const onMove = e => {
      if (!tableResizeRef.current || !layoutRef.current) return;

      const rect = layoutRef.current.getBoundingClientRect();
      const nextHeight = Math.round(rect.bottom - e.clientY);

      setTableHeight(Math.max(190, Math.min(480, nextHeight)));
    };

    const onUp = () => {
      tableResizeRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Leaflet harita ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const nativeZoom = getSatelliteNativeZoom();
    const map = L.map(mapDivRef.current, {
      center: [39.893549900875065, 32.771757831262036],
      zoom: nativeZoom,
      minZoom: 15,
      maxZoom: 20,
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: false,
      markerZoomAnimation: false
    });

    new OfflineTileLayer(null, {
      attribution: tileAttribution(),
      maxZoom: 21,
      maxNativeZoom: nativeZoom,
      minNativeZoom: nativeZoom,
      updateWhenIdle: false,
      keepBuffer: 4
    }).addTo(map);

    mapRef.current = map;

    map.on("click", e => {
      const text = `WP ${waypointCountRef.current + 1} eklendi: ${e.latlng.lat.toFixed(7)}, ${e.latlng.lng.toFixed(7)}`;

      addLog(
        "info",
        `WP eklendi lat=${e.latlng.lat.toFixed(7)} lon=${e.latlng.lng.toFixed(7)}`
      );
      showMissionNotice(text, "active");

      setWaypoints(prev => [
        ...prev,
        {
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          yaw: 0.0
        }
      ]);
    });

    return () => {
      routePolylineRef.current?.remove();
      routePolylineRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [addLog, showMissionNotice]);

  // ── Waypoint marker'ları ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    wpMarkersRef.current.forEach(m => m.remove());
    wpMarkersRef.current = [];

    waypoints.forEach((wp, i) => {
      const marker = makeWaypointLayer(wp, i).addTo(map);

      marker.bindPopup(`
        <b>WP ${i + 1}</b><br/>
        lat: ${wp.lat.toFixed(8)}<br/>
        lon: ${wp.lng.toFixed(8)}<br/>
        yaw: ${wp.yaw}
      `);

      wpMarkersRef.current.push(marker);
    });

    updateRouteOverlay();
  }, [waypoints, updateRouteOverlay]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => updateRouteOverlay();
    map.on("zoomend moveend resize viewreset", update);
    update();

    return () => {
      map.off("zoomend moveend resize viewreset", update);
    };
  }, [updateRouteOverlay]);

  const updateRobotMarker = useCallback((lat, lng, yaw = robotYawRef.current) => {
    const map = mapRef.current;

    if (!map) return;

    robotLatLonRef.current = { lat, lng };
    const offsetDeg = satelliteHeadingOffsetRef.current;
    const displayYaw = normalizeRad(yaw + degToRad(offsetDeg));
    const imu = imuInfoRef.current;
    robotDisplayYawRef.current = displayYaw;

    const headingEnd = offsetLatLng(
      { lat, lng },
      Math.cos(displayYaw) * 2.2,
      Math.sin(displayYaw) * 2.2
    );

    if (robotMarkerRef.current) {
      robotMarkerRef.current.setLatLng([lat, lng]);
    } else {
      robotMarkerRef.current = L.circleMarker([lat, lng], {
        radius: 10,
        color: "#ffffff",
        weight: 2,
        fillColor: "#0ea5e9",
        fillOpacity: 0.95,
        bubblingMouseEvents: false
      }).addTo(map);
    }

    if (robotHeadingRef.current) {
      robotHeadingRef.current.setLatLngs([[lat, lng], [headingEnd.lat, headingEnd.lng]]);
    } else {
      robotHeadingRef.current = L.polyline([[lat, lng], [headingEnd.lat, headingEnd.lng]], {
        color: "#ffffff",
        opacity: 0.95,
        weight: 3
      }).addTo(map);
    }

    robotMarkerRef.current.bindPopup(`
      <b>ROBOT</b><br/>
      lat: ${lat.toFixed(8)}<br/>
      lon: ${lng.toFixed(8)}<br/>
      map yaw: ${radToDeg(yaw).toFixed(1)}°<br/>
      satellite yaw: ${radToDeg(displayYaw).toFixed(1)}°<br/>
      offset: ${offsetDeg.toFixed(1)}°<br/>
      ${imu?.bearing !== undefined ? `IMU bearing: ${imu.bearing.toFixed(1)}°<br/>` : ""}
    `);

    if (centerRef.current) map.panTo([lat, lng]);
  }, []);

  const upsertProjectedMarker = useCallback((markerRef, xy, type, label, popupHtml) => {
    const map = mapRef.current;
    const ll = robotLatLonRef.current;
    const pose = robotPoseRef.current;

    if (!map || !xy || !ll || !pose || xy.x === null || xy.y === null) return;

    const latLng = projectMapXYToLatLng(
      xy.x,
      xy.y,
      ll,
      pose,
      degToRad(satelliteHeadingOffsetRef.current)
    );

    if (!latLng) return;

    if (markerRef.current) {
      markerRef.current.setLatLng([latLng.lat, latLng.lng]);
    } else {
      markerRef.current = makeDebugLayer([latLng.lat, latLng.lng], type, label).addTo(map);
    }

    markerRef.current.bindPopup(popupHtml(latLng));
  }, []);

  const updateTfPoseMarker = useCallback(() => {
    const pose = robotPoseRef.current;
    if (!pose) return;

    upsertProjectedMarker(
      tfPoseMarkerRef,
      { x: pose.x, y: pose.y },
      "robot-tf",
      "TF",
      () => `
        <b>TF MAP POSE</b><br/>
        frame: map -> ${pose.childFrame || "base_link"}<br/>
        x: ${pose.x.toFixed(3)} m<br/>
        y: ${pose.y.toFixed(3)} m<br/>
        yaw: ${radToDeg(pose.yaw).toFixed(1)} deg<br/>
        sadece debug projeksiyonu
      `
    );
  }, [upsertProjectedMarker]);

  const updateNav2GoalMarker = useCallback(() => {
    const goal = nav2GoalRef.current;
    if (!goal) return;

    upsertProjectedMarker(
      nav2GoalMarkerRef,
      { x: goal.x, y: goal.y },
      "nav2-goal",
      "NAV2",
      () => `
        <b>/gps_waypoint_nav/goal_pose</b><br/>
        frame: ${goal.frameId || "?"}<br/>
        x: ${fmtNum(goal.x)} m<br/>
        y: ${fmtNum(goal.y)} m<br/>
        yaw: ${radToDeg(goal.yaw).toFixed(1)} deg<br/>
        marker sadece UI debug projeksiyonu
      `
    );
  }, [upsertProjectedMarker]);

  useEffect(() => {
    satelliteHeadingOffsetRef.current = satelliteHeadingOffsetDeg;

    const ll = robotLatLonRef.current;
    if (ll) updateRobotMarker(ll.lat, ll.lng, robotYawRef.current);
    updateTfPoseMarker();
    updateNav2GoalMarker();
  }, [satelliteHeadingOffsetDeg, updateRobotMarker, updateTfPoseMarker, updateNav2GoalMarker]);

  // ── ROS topic'leri ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;

    try {
      statusSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/gps_waypoint_nav/status",
        messageType: "std_msgs/String",
        queue_length: 1,
        throttle_rate: 500
      });

      statusSubRef.current = sub;

      sub.subscribe(msg => {
        try {
          const p = JSON.parse(msg.data);
          const state = (p.state || "").toUpperCase();
          const detail = p.detail || "";
          const text = detail ? `${state} — ${detail}` : state;

          setNavStatus(text);
          addLog("status", detail ? `${state}: ${detail}` : state || "status alindi");
          showMissionNotice(text || "Görev status alındı");
        } catch {
          setNavStatus(msg.data || "");
          if (msg.data) {
            addLog("status", msg.data);
            showMissionNotice(msg.data);
          }
        }
      });
    } catch {
      // ROS status topic may not exist on every robot build.
    }

    try {
      robotSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/fix",
        messageType: "sensor_msgs/NavSatFix",
        queue_length: 1,
        throttle_rate: 1000
      });

      robotSubRef.current = sub;

      sub.subscribe(msg => {
        const { latitude: lat, longitude: lng } = msg;
        const rawInfo = {
          latitude: toNum(lat),
          longitude: toNum(lng),
          status: msg.status?.status ?? null,
          service: msg.status?.service ?? null,
          positionCovariance: msg.position_covariance || [],
          positionCovarianceType: msg.position_covariance_type ?? null,
          stamp: msg.header?.stamp || null,
          ts: Date.now()
        };

        setRawGpsInfo(rawInfo);

        if (isFinite(lat) && isFinite(lng)) {
          updateRobotMarker(lat, lng, robotYawRef.current);
          updateTfPoseMarker();
          updateNav2GoalMarker();

          if (Date.now() - lastFixLogRef.current > 5000) {
            lastFixLogRef.current = Date.now();
            addLog("fix", `GPS fix lat=${lat.toFixed(7)} lon=${lng.toFixed(7)}`);
          }
        }
      });
    } catch {
      // GPS fix topic may not exist on every robot build.
    }

    try {
      imuSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/imu/data",
        messageType: "sensor_msgs/Imu",
        queue_length: 1,
        throttle_rate: 500
      });

      imuSubRef.current = sub;

      sub.subscribe(msg => {
        const yaw = quatToYaw(msg.orientation);
        const yawDeg = radToDeg(yaw);
        const bearing = normalizeBearingDeg(90 - yawDeg);
        const frameId = msg.header?.frame_id || "";
        const ts = Date.now();
        const nextImuInfo = { yaw, bearing, ts, frameId };

        imuYawRef.current = yaw;
        imuInfoRef.current = nextImuInfo;
        setImuInfo(nextImuInfo);

        const ll = robotLatLonRef.current;
        if (ll) updateRobotMarker(ll.lat, ll.lng, robotYawRef.current);

        if (ts - lastImuLogRef.current > 5000) {
          lastImuLogRef.current = ts;
          addLog(
            "imu",
            `IMU ${frameId || "frame?"} yaw=${yawDeg.toFixed(1)}deg bearing=${bearing.toFixed(1)}deg`
          );
        }
      });
    } catch {
      // IMU topic is optional and only used for diagnostics/calibration.
    }

    try {
      tfSubRef.current?.unsubscribe();
      tfStaticSubRef.current?.unsubscribe();

      const handleTF = msg => {
        applyTF(msg, tfCacheRef.current);

        const pose = solveTF(tfCacheRef.current);

        if (!pose) return;

        robotYawRef.current = pose.yaw;
        robotPoseRef.current = pose;

        setRobotPoseInfo({
          x: pose.x,
          y: pose.y,
          yaw: pose.yaw,
          childFrame: pose.childFrame,
          ts: Date.now()
        });

        const ll = robotLatLonRef.current;

        if (ll) {
          updateRobotMarker(ll.lat, ll.lng, pose.yaw);
        }
        updateTfPoseMarker();
        updateNav2GoalMarker();

        if (Date.now() - lastTfLogRef.current > 5000) {
          lastTfLogRef.current = Date.now();
          addLog(
            "tf",
            `TF map->base x=${pose.x.toFixed(2)} y=${pose.y.toFixed(2)} yaw=${(pose.yaw * 180 / Math.PI).toFixed(1)}deg`
          );
        }
      };

      const tfSub = new ROSLIB.Topic({
        ros,
        name: "/tf",
        messageType: "tf2_msgs/msg/TFMessage",
        queue_length: 5,
        throttle_rate: 100
      });

      const tfStaticSub = new ROSLIB.Topic({
        ros,
        name: "/tf_static",
        messageType: "tf2_msgs/msg/TFMessage",
        queue_length: 5,
        throttle_rate: 1000
      });

      tfSubRef.current = tfSub;
      tfStaticSubRef.current = tfStaticSub;

      tfSub.subscribe(handleTF);
      tfStaticSub.subscribe(handleTF);
    } catch {
      // TF topics may not be available before localization starts.
    }

    try {
      gpsOdomSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/odometry/gps",
        messageType: "nav_msgs/msg/Odometry",
        queue_length: 1,
        throttle_rate: 250
      });

      gpsOdomSubRef.current = sub;

      sub.subscribe(msg => {
        const next = poseFromOdometry(msg);
        gpsOdomRef.current = next;
        setGpsOdomInfo(next);
      });
    } catch {
      // GPS odometry is optional on some setups.
    }

    try {
      globalOdomSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/odom/global",
        messageType: "nav_msgs/msg/Odometry",
        queue_length: 1,
        throttle_rate: 250
      });

      globalOdomSubRef.current = sub;

      sub.subscribe(msg => {
        const next = poseFromOdometry(msg);
        globalOdomRef.current = next;
        setGlobalOdomInfo(next);
      });
    } catch {
      // Global EKF odometry is optional on some setups.
    }

    try {
      nav2GoalSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/gps_waypoint_nav/goal_pose",
        messageType: "geometry_msgs/msg/PoseStamped",
        queue_length: 1,
        throttle_rate: 250
      });

      nav2GoalSubRef.current = sub;

      sub.subscribe(msg => {
        const next = poseFromPoseStamped(msg);
        nav2GoalRef.current = next;
        setNav2GoalInfo(next);
        updateNav2GoalMarker();
      });
    } catch {
      // Nav2 goal debug topic is optional.
    }

    try {
      debugPointsSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/gps_waypoint_nav/debug_points",
        messageType: "std_msgs/String",
        queue_length: 1,
        throttle_rate: 500
      });

      debugPointsSubRef.current = sub;

      sub.subscribe(msg => {
        const map = mapRef.current;

        if (!map) return;

        convertedMarkersRef.current.forEach(m => m.remove());
        convertedMarkersRef.current = [];

        let payload;

        try {
          payload = JSON.parse(msg.data);
        } catch {
          return;
        }

        const points = Array.isArray(payload.points)
          ? payload.points
          : Array.isArray(payload)
            ? payload
            : [];
        setDebugPoints(points);
        addLog("debug", `${points.length} fromLL debug noktasi alindi`);

        points.forEach((p, fallbackIndex) => {
          const headingOffsetRad = degToRad(satelliteHeadingOffsetRef.current);
          const idx = pointIndex(p, fallbackIndex);
          const lat = firstNum(p, ["latitude", "lat", "source_latitude", "source_lat"]);
          const lng = firstNum(p, ["longitude", "lon", "lng", "source_longitude", "source_lon"]);
          const mapX = firstNum(p, ["fromll_x", "from_ll_x", "converted_x", "map_x", "x"]);
          const mapY = firstNum(p, ["fromll_y", "from_ll_y", "converted_y", "map_y", "y"]);
          const goalX = firstNum(p, ["goal_x", "target_x", "nav_goal_x", "vehicle_goal_x", "sent_x"]);
          const goalY = firstNum(p, ["goal_y", "target_y", "nav_goal_y", "vehicle_goal_y", "sent_y"]);
          const yaw = firstNum(p, ["yaw", "goal_yaw", "target_yaw"]);
          const mapZ = firstNum(p, ["map_z", "z"]);
          const frame = p.frame_id || p.frame || "map";
          const expectedXY = lat !== null && lng !== null
              ? estimateMapXYFromRobotGps(
                  { lat, lng },
                  robotLatLonRef.current,
                  robotPoseRef.current,
                  headingOffsetRad
                )
            : null;
          const fromLLDelta = expectedXY && mapX !== null && mapY !== null
            ? Math.hypot(mapX - expectedXY.x, mapY - expectedXY.y)
            : null;

          if (lat !== null && lng !== null) {
            const marker = makeDebugLayer([lat, lng], "fromll-source", `LL WP${idx}`).addTo(map);

            marker.bindPopup(`
              <b>ORIJINAL WAYPOINT WP${idx}</b><br/>
              lat: ${lat.toFixed(8)}<br/>
              lon: ${lng.toFixed(8)}<br/>
              kaynak: UI lat/lon veya debug payload
            `);

            convertedMarkersRef.current.push(marker);
          }

          const fromLLLatLng = mapX !== null && mapY !== null
            ? projectMapXYToLatLng(
                mapX,
                mapY,
                robotLatLonRef.current,
                robotPoseRef.current,
                headingOffsetRad
              )
            : null;

          if (mapX !== null && mapY !== null && fromLLLatLng) {
            const marker = makeDebugLayer(
              [fromLLLatLng.lat, fromLLLatLng.lng],
              "fromll-xy",
              `FROMLL WP${idx}`
            ).addTo(map);

            marker.bindPopup(`
              <b>FROMLL XY WP${idx}</b><br/>
              haritadaki konum: robot GPS + TF referansiyla projelendi<br/>
              map_x: ${mapX.toFixed(3)} m<br/>
              map_y: ${mapY.toFixed(3)} m<br/>
              ${expectedXY ? `beklenen_x: ${expectedXY.x.toFixed(3)} m<br/>beklenen_y: ${expectedXY.y.toFixed(3)} m<br/>` : ""}
              ${fromLLDelta !== null ? `FROMLL farki: ${fromLLDelta.toFixed(2)} m<br/>` : ""}
              ${mapZ !== null ? `map_z: ${mapZ.toFixed(3)} m<br/>` : ""}
              frame: ${frame}<br/>
              lat*: ${fromLLLatLng.lat.toFixed(8)}<br/>
              lon*: ${fromLLLatLng.lng.toFixed(8)}<br/>
              ${yaw !== null ? `yaw: ${(yaw * 180 / Math.PI).toFixed(1)} deg` : ""}
            `);

            convertedMarkersRef.current.push(marker);
          } else if (mapX !== null && mapY !== null) {
            addLog("warn", `WP${idx} XY var ama haritaya projeksiyon icin GPS fix + TF bekleniyor`);
          }

          const vehicleX = goalX ?? mapX;
          const vehicleY = goalY ?? mapY;
          const vehicleLatLng = vehicleX !== null && vehicleY !== null
            ? projectMapXYToLatLng(
                vehicleX,
                vehicleY,
                robotLatLonRef.current,
                robotPoseRef.current,
                headingOffsetRad
              )
            : null;

          if (vehicleX !== null && vehicleY !== null && vehicleLatLng) {
            const marker = makeDebugLayer(
              [vehicleLatLng.lat, vehicleLatLng.lng],
              "vehicle-target",
              `NAV WP${idx}`
            ).addTo(map);

            marker.bindPopup(`
              <b>ARACIN GITMEK ISTEDIGI XY WP${idx}</b><br/>
              ${goalX === null || goalY === null ? "debug payload ayri hedef x/y vermedigi icin fromLL map_x/map_y kullanildi<br/>" : ""}
              target_x: ${vehicleX.toFixed(3)} m<br/>
              target_y: ${vehicleY.toFixed(3)} m<br/>
              ${expectedXY ? `GPS+TF beklenen_x: ${expectedXY.x.toFixed(3)} m<br/>GPS+TF beklenen_y: ${expectedXY.y.toFixed(3)} m<br/>` : ""}
              frame: ${frame}<br/>
              lat*: ${vehicleLatLng.lat.toFixed(8)}<br/>
              lon*: ${vehicleLatLng.lng.toFixed(8)}
            `);

            convertedMarkersRef.current.push(marker);
          }

          if (fromLLDelta !== null && fromLLDelta > 2) {
            addLog(
              "warn",
              `WP${idx} fromLL/TF farki ${fromLLDelta.toFixed(1)}m: navsat datum/yaw_offset kontrol et`
            );
          }
        });
      });
    } catch {
      // Debug topic is optional.
    }

    return () => {
      try { statusSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { robotSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { imuSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { tfSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { tfStaticSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { debugPointsSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { gpsOdomSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { globalOdomSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { nav2GoalSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
    };
  }, [ros, isConnected, updateRobotMarker, updateTfPoseMarker, updateNav2GoalMarker, addLog, showMissionNotice]);

  // ── Publisher ─────────────────────────────────────────────────────────
  const ensurePublisher = useCallback(() => {
    if (wpPublisherRef.current) return wpPublisherRef.current;
    if (!ros) return null;

    const pub = new ROSLIB.Topic({
      ros,
      name: "/ui/gps_waypoint",
      messageType: "std_msgs/String",
      queue_size: 1
    });

    pub.advertise();
    wpPublisherRef.current = pub;

    return pub;
  }, [ros]);

  const startMission = useCallback(() => {
    if (!ros || !isConnected || waypoints.length === 0) return;

    const pub = ensurePublisher();

    if (!pub) return;

    const buildWaypointPayload = wp => {
      return {
        latitude: wp.lat,
        longitude: wp.lng,
        altitude: 0.0,
        yaw: wp.yaw
      };
    };

    const payload = waypoints.length === 1
      ? JSON.stringify(buildWaypointPayload(waypoints[0]))
      : JSON.stringify({
          waypoints: waypoints.map(buildWaypointPayload)
        });

    pub.publish({ data: payload });
    addLog("info", `${waypoints.length} waypoint araca gonderildi`);
    showMissionNotice(`${waypoints.length} waypoint araca gönderildi`, "active");
  }, [ros, isConnected, waypoints, ensurePublisher, addLog, showMissionNotice]);

  const cancelMission = useCallback(() => {
    if (!ros || !isConnected) return;

    const pub = ensurePublisher();

    if (!pub) return;

    pub.publish({
      data: JSON.stringify({
        command: "cancel"
      })
    });
    addLog("warn", "Misyon iptal komutu gonderildi");
    showMissionNotice("Misyon iptal komutu gönderildi", "muted");
  }, [ros, isConnected, ensurePublisher, addLog, showMissionNotice]);

  const calibrateSatelliteHeading = useCallback(() => {
    if (!robotPoseInfo || !Number.isFinite(robotPoseInfo.yaw)) {
      addLog("warn", "Uydu yön kalibrasyonu için TF/map yaw bekleniyor");
      return;
    }

    const inputBearing = parseFloat(compassBearingInput);

    if (!Number.isFinite(inputBearing)) {
      addLog("warn", "Geçerli bir pusula bearing değeri gir");
      return;
    }

    const realRosYaw = compassBearingToRosYawRad(inputBearing);
    const offsetRad = normalizeRad(realRosYaw - robotPoseInfo.yaw);
    const offsetDeg = normalizeSignedDeg(radToDeg(offsetRad));

    setSatelliteHeadingOffsetDeg(offsetDeg);
    satelliteHeadingOffsetRef.current = offsetDeg;
    storageSet(SATELLITE_HEADING_OFFSET_KEY, String(offsetDeg));
    addLog("info", `Uydu yön offset ${offsetDeg.toFixed(1)}° olarak kaydedildi`);

    const ll = robotLatLonRef.current;
    if (ll) updateRobotMarker(ll.lat, ll.lng, robotYawRef.current);
  }, [robotPoseInfo, compassBearingInput, updateRobotMarker, addLog]);

  const resetSatelliteHeadingOffset = useCallback(() => {
    setSatelliteHeadingOffsetDeg(0);
    satelliteHeadingOffsetRef.current = 0;
    storageRemove(SATELLITE_HEADING_OFFSET_KEY);
    addLog("info", "Uydu yön offset sıfırlandı");

    const ll = robotLatLonRef.current;
    if (ll) updateRobotMarker(ll.lat, ll.lng, robotYawRef.current);
  }, [updateRobotMarker, addLog]);

  // ── Waypoint ops ──────────────────────────────────────────────────────
  const removeWaypoint = i => {
    setWaypoints(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateYaw = (i, v) => {
    setWaypoints(prev =>
      prev.map((wp, idx) =>
        idx === i ? { ...wp, yaw: parseFloat(v) || 0 } : wp
      )
    );
  };

  const moveWaypoint = (from, dir) => {
    setWaypoints(prev => {
      const to = from + dir;
      if (to < 0 || to >= prev.length) return prev;

      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const clearAll = () => {
    setWaypoints([]);
    setDebugPoints([]);
    addLog("info", "Waypoint ve debug markerlari temizlendi");
    showMissionNotice("Waypoint ve debug markerları temizlendi", "muted");

    wpMarkersRef.current.forEach(m => m.remove());
    wpMarkersRef.current = [];

    convertedMarkersRef.current.forEach(m => m.remove());
    convertedMarkersRef.current = [];
    tfPoseMarkerRef.current?.remove();
    tfPoseMarkerRef.current = null;
    nav2GoalMarkerRef.current?.remove();
    nav2GoalMarkerRef.current = null;

    routePolylineRef.current?.setLatLngs([]);
  };

  // ── Yardımcı ──────────────────────────────────────────────────────────
  const statusColor = () => {
    const s = navStatus.toLowerCase();

    if (s.includes("succeeded") || s.includes("success") || s.includes("reached")) {
      return "#00ff88";
    }

    if (s.includes("canceled") || s.includes("cancel")) {
      return "#94a3b8";
    }

    if (
      s.includes("aborted") ||
      s.includes("abort") ||
      s.includes("fail") ||
      s.includes("error")
    ) {
      return "#ef4444";
    }

    if (
      s.includes("executing") ||
      s.includes("accepted") ||
      s.includes("navigat")
    ) {
      return "#0ea5e9";
    }

    if (!navStatus) return "#1e3a52";

    return "#fbbf24";
  };

  const totalDist = waypoints.length >= 2
    ? waypoints
        .slice(0, -1)
        .reduce((sum, wp, i) => sum + haversine(wp, waypoints[i + 1]), 0)
    : null;
  const mapYawDeg = robotPoseInfo ? radToDeg(robotPoseInfo.yaw) : null;
  const displayYawDeg = robotPoseInfo
    ? radToDeg(normalizeRad(robotPoseInfo.yaw + degToRad(satelliteHeadingOffsetDeg)))
    : null;
  const debugDisplayYawCalibratedDeg = displayYawDeg !== null ? normalizeDeg(displayYawDeg) : null;
  const debugDisplayYawUncalibratedDeg = mapYawDeg !== null ? normalizeDeg(mapYawDeg) : null;
  const expectedRosYawDeg = Number.isFinite(parseFloat(compassBearingInput))
    ? normalizeDeg(90 - parseFloat(compassBearingInput))
    : null;
  const headingErrorDeg = expectedRosYawDeg !== null && mapYawDeg !== null
    ? normalizeDeg(expectedRosYawDeg - mapYawDeg)
    : null;
  const currentGpsLatLng = Number.isFinite(rawGpsInfo?.latitude) && Number.isFinite(rawGpsInfo?.longitude)
    ? { lat: rawGpsInfo.latitude, lng: rawGpsInfo.longitude }
    : null;
  const datumDistanceM = currentGpsLatLng ? haversine(currentGpsLatLng, GPS_DATUM) : null;
  const datumBearingDeg = currentGpsLatLng ? bearingDeg(currentGpsLatLng, GPS_DATUM) : null;
  const gpsTfDx = Number.isFinite(gpsOdomInfo?.x) && Number.isFinite(robotPoseInfo?.x)
    ? gpsOdomInfo.x - robotPoseInfo.x
    : null;
  const gpsTfDy = Number.isFinite(gpsOdomInfo?.y) && Number.isFinite(robotPoseInfo?.y)
    ? gpsOdomInfo.y - robotPoseInfo.y
    : null;
  const gpsTfDistance = gpsTfDx !== null && gpsTfDy !== null
    ? Math.hypot(gpsTfDx, gpsTfDy)
    : null;
  const lastDebugPoint = debugPoints.length ? readDebugPoint(debugPoints[debugPoints.length - 1]) : null;
  const missionColors = missionNoticeColors(missionNotice?.level);

  return (
    <>
      <style>{CSS}</style>

      <div
        ref={layoutRef}
        style={{
          height: "calc(100vh - 56px)",
          width: "100%",
          display: "grid",
          gridTemplateRows: `minmax(0, 1fr) ${tableHeight}px`,
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          overflow: "hidden",
          fontFamily: SANS,
          background: "#1b1b20",
          color: "#e6e6e6"
        }}
      >
        <div style={{ gridColumn: "1", gridRow: "1", position: "relative", minHeight: 0 }}>
          <div ref={mapDivRef} style={{ width: "100%", height: "100%" }} />

          <div
            style={{
              position: "absolute",
              top: 6,
              left: 8,
              zIndex: 1000,
              color: "#f1f1f1",
              fontFamily: MONO,
              fontSize: "11px",
              lineHeight: 1.35,
              textShadow: "0 1px 2px #000"
            }}
          >
            <div>Distance: {totalDist !== null ? fmtDist(totalDist) : "0 m"}</div>
            <div>WP Count: {waypoints.length}</div>
            <div>Map: Offline Satellite</div>
          </div>

          {missionNotice && (
            <div
              style={{
                position: "absolute",
                top: 8,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1100,
                maxWidth: "min(680px, calc(100% - 36px))",
                minHeight: 28,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                border: `1px solid ${missionColors.border}`,
                borderRadius: 4,
                background: missionColors.bg,
                color: missionColors.fg,
                boxShadow: "0 8px 24px rgba(0,0,0,.32)",
                fontFamily: MONO,
                fontSize: "11px",
                fontWeight: 800,
                lineHeight: 1.25,
                pointerEvents: "none",
                textAlign: "center"
              }}
            >
              <span style={{ opacity: 0.78, fontSize: "9px", letterSpacing: ".08em" }}>
                MISSION
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {missionNotice.text}
              </span>
            </div>
          )}

          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              zIndex: 900,
              pointerEvents: "none",
              color: "#ff3333",
              fontFamily: MONO,
              fontSize: 14,
              lineHeight: "12px",
              textAlign: "center",
              textShadow: "0 0 3px #000"
            }}
          >
            +
          </div>

          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 10,
              zIndex: 1000,
              padding: "3px 7px",
              background: "rgba(0,0,0,.62)",
              border: "1px solid rgba(255,255,255,.25)",
              color: "#dcdcdc",
              fontFamily: MONO,
              fontSize: "10px"
            }}
          >
            Haritaya tıkla: waypoint ekle · Sarı çizgi: rota · Yeşil pin: waypoint
          </div>
        </div>

        <aside
          style={{
            gridColumn: "2",
            gridRow: "1 / span 2",
            minHeight: 0,
            background: "#202026",
            borderLeft: "1px solid #070708",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <div
            style={{
              background: "#b9ff2f",
              color: "#111",
              fontWeight: 800,
              padding: "4px 8px",
              fontSize: "14px",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <span>Action</span>
            <span>&gt;&gt;</span>
          </div>

          <div className="gmp-scroll" style={{ padding: 8, display: "grid", gap: 8, fontFamily: MONO, fontSize: 11, overflow: "auto", minHeight: 0 }}>
            <label style={{ display: "grid", gap: 3 }}>
              <span>Map Provider</span>
              <select value="OfflineSatellite" disabled>
                <option>OfflineSatellite</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 3 }}>
              <span>Coord</span>
              <select value="GEO" disabled>
                <option>GEO</option>
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <input type="checkbox" disabled />
                Grid
              </label>
              <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <input type="checkbox" disabled />
                View KML
              </label>
            </div>

            <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
              <div style={{ color: "#9ea0a8", marginBottom: 3 }}>Status</div>
              <div style={{ color: isConnected ? "#39ff14" : "#ff6565", fontWeight: 800 }}>
                {globalStatus.toUpperCase()}
              </div>
              <div style={{ color: statusColor(), marginTop: 4 }}>{navStatus || "NAV -"}</div>
              <div style={{ color: "#9ea0a8", marginTop: 4 }}>
                Debug points: {debugPoints.length}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
              <div style={{ color: "#9ea0a8", marginBottom: 3 }}>Robot</div>
              {robotPoseInfo ? (
                <>
                  <div>x: {robotPoseInfo.x.toFixed(2)}</div>
                  <div>y: {robotPoseInfo.y.toFixed(2)}</div>
                  <div>yaw: {mapYawDeg.toFixed(1)} deg</div>
                </>
              ) : (
                <div style={{ color: "#777" }}>TF bekleniyor</div>
              )}
            </div>

            <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
              <div style={{ color: "#9ea0a8", marginBottom: 4 }}>Uydu Yön Kalibrasyonu</div>
              <div>Map yaw: {mapYawDeg !== null ? `${mapYawDeg.toFixed(1)}°` : "-"}</div>
              <div>Display yaw: {displayYawDeg !== null ? `${displayYawDeg.toFixed(1)}°` : "-"}</div>
              <div>IMU yaw: {imuInfo ? `${radToDeg(imuInfo.yaw).toFixed(1)}°` : "-"}</div>
              <div>IMU bearing: {imuInfo ? `${imuInfo.bearing.toFixed(1)}°` : "-"}</div>
              <div>Offset: {satelliteHeadingOffsetDeg >= 0 ? "+" : ""}{satelliteHeadingOffsetDeg.toFixed(1)}°</div>
              <div style={{ color: "#9ea0a8", marginTop: 4 }}>Pusula değeri Heading Debug alanından alınır.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 6, marginTop: 6 }}>
                <button className="gmp-mp-btn" onClick={calibrateSatelliteHeading}>
                  Pusulaya göre hizala
                </button>
                <button className="gmp-mp-btn" onClick={resetSatelliteHeadingOffset}>
                  Sıfırla
                </button>
              </div>
            </div>

            <DebugSection title="Raw GPS">
              <DebugRow label="/fix latitude" value={fmtNum(rawGpsInfo?.latitude, 8)} />
              <DebugRow label="/fix longitude" value={fmtNum(rawGpsInfo?.longitude, 8)} />
              <DebugRow label="/fix status" value={rawGpsInfo ? `${rawGpsInfo.status ?? "-"} / service ${rawGpsInfo.service ?? "-"}` : "-"} />
              <DebugRow
                label="position_covariance"
                value={covarianceText(rawGpsInfo?.positionCovariance)}
                title={covarianceText(rawGpsInfo?.positionCovariance)}
              />
              <DebugRow label="covariance_type" value={rawGpsInfo?.positionCovarianceType ?? "-"} />
              <DebugRow label="son mesaj" value={rosStampText(rawGpsInfo?.stamp, rawGpsInfo?.ts)} />
            </DebugSection>

            <DebugSection
              title="Datum"
              note="Datum reset noktası değildir; sadece GPS -> local XY dönüşüm referansıdır."
            >
              <DebugRow label="datum_lat" value={GPS_DATUM.lat.toFixed(7)} />
              <DebugRow label="datum_lon" value={GPS_DATUM.lng.toFixed(7)} />
              <DebugRow label="current_to_datum_distance_m" value={fmtNum(datumDistanceM, 3)} />
              <DebugRow label="current_to_datum_bearing_deg" value={datumBearingDeg !== null ? `${datumBearingDeg.toFixed(2)}°` : "-"} />
            </DebugSection>

            <DebugSection title="ROS TF Pose">
              <DebugRow label="TF map -> base x" value={fmtNum(robotPoseInfo?.x, 3)} />
              <DebugRow label="TF map -> base y" value={fmtNum(robotPoseInfo?.y, 3)} />
              <DebugRow label="TF map -> base yaw_deg" value={fmtDeg(mapYawDeg, 2)} />
              <DebugRow label="base frame" value={robotPoseInfo?.childFrame || "base_link/base_footprint bekleniyor"} />
            </DebugSection>

            <DebugSection title="GPS-Derived Odometry">
              <DebugRow label="/odometry/gps x" value={fmtNum(gpsOdomInfo?.x, 3)} />
              <DebugRow label="/odometry/gps y" value={fmtNum(gpsOdomInfo?.y, 3)} />
              <DebugRow label="frame_id" value={gpsOdomInfo?.frameId || "-"} />
              <DebugRow label="child_frame_id" value={gpsOdomInfo?.childFrameId || "-"} />
              <DebugRow label="son mesaj" value={rosStampText(gpsOdomInfo?.stamp, gpsOdomInfo?.ts)} />
            </DebugSection>

            <DebugSection title="Global EKF">
              <DebugRow label="/odom/global x" value={fmtNum(globalOdomInfo?.x, 3)} />
              <DebugRow label="/odom/global y" value={fmtNum(globalOdomInfo?.y, 3)} />
              <DebugRow label="/odom/global yaw_deg" value={globalOdomInfo ? fmtDeg(radToDeg(globalOdomInfo.yaw), 2) : "-"} />
              <DebugRow label="frame_id" value={globalOdomInfo?.frameId || "-"} />
              <DebugRow label="child_frame_id" value={globalOdomInfo?.childFrameId || "-"} />
              <DebugRow label="son mesaj" value={rosStampText(globalOdomInfo?.stamp, globalOdomInfo?.ts)} />
            </DebugSection>

            <DebugSection
              title="GPS vs TF Hata"
              note="Datum noktasında ve sabit robotta küçük olmalı; büyükse map->odom / navsat hizalaması sorunlu olabilir."
            >
              <DebugRow label="gps_vs_tf_dx" value={fmtNum(gpsTfDx, 3)} />
              <DebugRow label="gps_vs_tf_dy" value={fmtNum(gpsTfDy, 3)} />
              <DebugRow label="gps_vs_tf_distance_m" value={fmtNum(gpsTfDistance, 3)} />
            </DebugSection>

            <DebugSection title="Heading Debug">
              <DebugRow label="raw_tf_yaw_deg" value={fmtDeg(mapYawDeg, 2)} />
              <DebugRow label="ui_display_yaw_deg_uncalibrated" value={debugDisplayYawUncalibratedDeg !== null ? `${debugDisplayYawUncalibratedDeg.toFixed(2)}°` : "-"} />
              <DebugRow label="ui_display_yaw_deg_calibrated" value={debugDisplayYawCalibratedDeg !== null ? `${debugDisplayYawCalibratedDeg.toFixed(2)}°` : "-"} />
              <DebugRow label="satellite_heading_offset_deg" value={`${satelliteHeadingOffsetDeg.toFixed(2)}°`} />
              <label style={{ display: "grid", gap: 3, marginTop: 4 }}>
                <span style={{ color: "#9ea0a8" }}>phone_compass_bearing_deg</span>
                <input
                  className="gmp-input"
                  value={compassBearingInput}
                  onChange={e => setCompassBearingInput(e.target.value)}
                  placeholder="örn. 240"
                  inputMode="decimal"
                />
              </label>
              <DebugRow label="expected_ros_yaw_deg" value={expectedRosYawDeg !== null ? `${expectedRosYawDeg.toFixed(2)}°` : "-"} />
              <DebugRow label="heading_error_deg" value={headingErrorDeg !== null ? `${headingErrorDeg.toFixed(2)}°` : "-"} />
            </DebugSection>

            <DebugSection title="Waypoint Conversion Debug">
              <DebugRow label="latitude" value={fmtNum(lastDebugPoint?.latitude, 8)} />
              <DebugRow label="longitude" value={fmtNum(lastDebugPoint?.longitude, 8)} />
              <DebugRow label="altitude" value={fmtNum(lastDebugPoint?.altitude, 3)} />
              <DebugRow label="fromll_frame" value={lastDebugPoint?.fromllFrame || "-"} />
              <DebugRow label="map_x" value={fmtNum(lastDebugPoint?.mapX, 3)} />
              <DebugRow label="map_y" value={fmtNum(lastDebugPoint?.mapY, 3)} />
              <DebugRow label="map_z" value={fmtNum(lastDebugPoint?.mapZ, 3)} />
              <DebugRow label="goal_frame_id" value={lastDebugPoint?.goalFrameId || "-"} />
              <DebugRow label="yaw_deg" value={lastDebugPoint?.yaw !== null && lastDebugPoint?.yaw !== undefined ? fmtDeg(radToDeg(lastDebugPoint.yaw), 2) : "-"} />
            </DebugSection>

            <DebugSection title="Nav2 Goal Marker">
              <DebugRow label="goal_pose x" value={fmtNum(nav2GoalInfo?.x, 3)} />
              <DebugRow label="goal_pose y" value={fmtNum(nav2GoalInfo?.y, 3)} />
              <DebugRow label="goal_pose frame" value={nav2GoalInfo?.frameId || "-"} />
              <DebugRow label="goal_pose yaw_deg" value={nav2GoalInfo ? fmtDeg(radToDeg(nav2GoalInfo.yaw), 2) : "-"} />
              <DebugRow label="son mesaj" value={rosStampText(nav2GoalInfo?.stamp, nav2GoalInfo?.ts)} />
            </DebugSection>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={centerOnRobot}
                onChange={() => setCenterOnRobot(v => !v)}
              />
              Robotu takip et
            </label>

            <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
              <div style={{ color: "#9ea0a8", marginBottom: 3 }}>Messages</div>
              <div style={{ color: "#d7d7d7", lineHeight: 1.35 }}>
                {diagLogs[0]?.text || "Waypoint, GPS fix ve görev mesajları burada görünür."}
              </div>
            </div>

            <button
              className="gmp-mp-btn"
              onClick={startMission}
              disabled={!isConnected || waypoints.length === 0}
              style={{ background: "#b9ff2f" }}
            >
              MİSYON BAŞLAT
            </button>
            <button
              className="gmp-mp-btn"
              onClick={cancelMission}
              disabled={!isConnected}
              style={{ background: "#ff7070" }}
            >
              MİSYON İPTAL
            </button>
            <button className="gmp-mp-btn" onClick={clearAll} disabled={waypoints.length === 0}>
              TEMİZLE
            </button>
          </div>
        </aside>

        <section
          style={{
            gridColumn: "1",
            gridRow: "2",
            minHeight: 0,
            borderTop: "3px solid #b9ff2f",
            background: "#17171c",
            display: "flex",
            flexDirection: "column",
            position: "relative"
          }}
        >
          <div
            onMouseDown={() => {
              tableResizeRef.current = true;
              document.body.style.cursor = "row-resize";
              document.body.style.userSelect = "none";
            }}
            title="Tablo yüksekliğini ayarla"
            style={{
              position: "absolute",
              top: -7,
              left: 0,
              right: 0,
              height: 10,
              cursor: "row-resize",
              zIndex: 3
            }}
          />
          <div
            style={{
              height: 30,
              background: "#b9ff2f",
              color: "#1b1b1b",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px",
              fontWeight: 800,
              fontSize: "16px"
            }}
          >
            <span>Waypoints</span>
            <span style={{ fontFamily: MONO, fontSize: 11 }}>
              Total: {totalDist !== null ? fmtDist(totalDist) : "0 m"} · Count: {waypoints.length}
            </span>
          </div>

          <div
            style={{
              padding: "6px 8px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#202026",
              borderBottom: "1px solid #34343a",
              fontFamily: MONO,
              fontSize: 11
            }}
          >
            <span>WP Radius <b>40</b></span>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" disabled />
              Verify Height
            </label>
            <button className="gmp-mp-btn" onClick={clearAll} disabled={waypoints.length === 0}>
              Clear
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <table className="gmp-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th style={{ width: 116 }}>Command</th>
                  <th style={{ width: 62 }}>P1</th>
                  <th style={{ width: 62 }}>P2</th>
                  <th style={{ width: 62 }}>P3</th>
                  <th>Lat</th>
                  <th>Long</th>
                  <th style={{ width: 72 }}>Yaw</th>
                  <th style={{ width: 58 }}>Delete</th>
                  <th style={{ width: 70 }}>Up/Down</th>
                  <th style={{ width: 70 }}>Dist</th>
                  <th style={{ width: 56 }}>AZ</th>
                </tr>
              </thead>
              <tbody>
                {waypoints.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ color: "#8b8b92", height: 70, textAlign: "center" }}>
                      Haritaya tıklayarak rota waypointleri ekle.
                    </td>
                  </tr>
                ) : (
                  waypoints.map((wp, i) => {
                    const prev = i > 0 ? waypoints[i - 1] : null;
                    const dist = prev ? haversine(prev, wp) : 0;
                    const az = prev ? bearingDeg(prev, wp) : 0;

                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>
                          <select value="WAYPOINT" disabled>
                            <option>WAYPOINT</option>
                          </select>
                        </td>
                        <td>0</td>
                        <td>0</td>
                        <td>0</td>
                        <td title={String(wp.lat)}>{wp.lat.toFixed(7)}</td>
                        <td title={String(wp.lng)}>{wp.lng.toFixed(7)}</td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            value={wp.yaw}
                            onChange={e => updateYaw(i, e.target.value)}
                          />
                        </td>
                        <td>
                          <button className="gmp-mp-btn" onClick={() => removeWaypoint(i)}>X</button>
                        </td>
                        <td>
                          <button className="gmp-mp-btn" onClick={() => moveWaypoint(i, -1)} disabled={i === 0}>▲</button>
                          <button className="gmp-mp-btn" onClick={() => moveWaypoint(i, 1)} disabled={i === waypoints.length - 1}>▼</button>
                        </td>
                        <td>{dist.toFixed(1)}</td>
                        <td>{az.toFixed(0)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
 
