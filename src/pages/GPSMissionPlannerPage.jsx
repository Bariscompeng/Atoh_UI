
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  buildCoverageNavPoints,
  COVERAGE_STYLE_OPTIONS,
  latLngToLocalMeters,
  localMetersToLatLng,
} from "../features/gpsMission/coverage/coveragePlanner";
import NoGoMissionSection from "../features/gpsMission/noGo/NoGoMissionSection";
import OffsetTrackingMissionSection from "../features/gpsMission/offset/OffsetTrackingMissionSection";
import CoverageMissionSection from "../features/gpsMission/coverage/CoverageMissionSection";
import GPSMissionPlannerFrameDebugPanel from "../features/gpsMission/debug/GPSMissionPlannerFrameDebugPanel";
import GPSMissionPlannerDebugPanel from "../features/gpsMission/debug/GPSMissionPlannerDebugPanel";
import SavedGpsRouteCard from "../features/gpsMission/routes/SavedGpsRouteCard";
import useCoverageMapLayers from "../features/gpsMission/coverage/useCoverageMapLayers";
import useNoGoMapLayers from "../features/gpsMission/noGo/useNoGoMapLayers";
import useOffsetLineOverlays from "../features/gpsMission/offset/useOffsetLineOverlays";
import { publishCoveragePolygon, callCoverageStart, callCoverageCancel } from "../features/gpsMission/coverage/coverageRosService";
import { publishNoGoPayload } from "../features/gpsMission/noGo/noGoRosService";
import { publishOffsetTrackingRequest, callOffsetTrackingCancel } from "../features/gpsMission/offset/offsetRosService";
import {
  consumeQueuedGpsMissionRouteOpen,
  createGpsRoutePreviewImage,
  createGpsRouteTilePreviewImage,
  deleteSavedGpsMissionRoute,
  getSavedGpsMissionRoute,
  gpsMissionRoutesChangedEventName,
  readSavedGpsMissionRoutes,
  saveGpsMissionRoute
} from "../utils/gpsMissionRoutes";

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'Barlow Condensed',sans-serif";
const MIN_Z = 14;
const DL_MAX_Z = 22;
const DEFAULT_NATIVE_ZOOM = 20;
const DEFAULT_WAYPOINT_SPEED_MULTIPLIER = 1.0;
const MAX_WAYPOINT_SPEED_MULTIPLIER = 3.0;
const OFFLINE_TILE_BASE = "/offline-tiles";
const ORTHO_TILE_BASE = "/gps_ortho_tiles";
const ORTHO_BOUNDS = [
  [39.794308, 32.528756],
  [39.798233, 32.534089]
];
const ORTHO_START_ZOOM_BOOST = 5;
const DEFAULT_MAP_CENTER = [39.7962150, 32.5312773];
const OFFLINE_TILE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const UI_STATE_TOPIC = "/ui/gps_mission_planner/state";
const WAYPOINTS_STORAGE_KEY = "gmp_waypoints_state";
const GPS_COVERAGE_STORAGE_KEY = "gmp_coverage_state";
const GPS_NO_GO_STORAGE_KEY = "gmp_no_go_zones_state";
const GPS_BASE_LAYER_STORAGE_KEY = "gmp_active_base_layer";
const GPS_NO_GO_TOPIC = "/ui/no_go_zones";
const NO_GO_DEBUG_TOPIC = "/no_go_zones/debug";
const GPS_COVERAGE_POLYGON_TOPIC = "/gps_coverage/field_polygon";
const GPS_COVERAGE_STATUS_TOPIC = "/gps_coverage/status";
const GPS_COVERAGE_DEBUG_POINTS_TOPIC = "/gps_coverage/debug_points";
const GPS_COVERAGE_PATH_TOPIC = "/gps_coverage/path";
const GPS_COVERAGE_START_SERVICE = "/gps_coverage/start";
const GPS_COVERAGE_CANCEL_SERVICE = "/gps_coverage/cancel";
const GPS_OFFSET_LINE_STORAGE_KEY = "gmp_offset_line_state";
const GPS_OFFSET_LINE_REQUEST_TOPIC = "/gps_offset_line/request";
const GPS_OFFSET_LINE_STATUS_TOPIC = "/gps_offset_line/status";
const GPS_OFFSET_LINE_DEBUG_POINTS_TOPIC = "/gps_offset_line/debug_points";
const GPS_OFFSET_LINE_PATH_TOPIC = "/gps_offset_line/path";
const GPS_OFFSET_LINE_START_SERVICE = "/gps_offset_line/start";
const GPS_OFFSET_LINE_CANCEL_SERVICE = "/gps_offset_line/cancel";
const OFFSET_LINE_TRAIL_MIN_STEP_M = 0.2;
const GPS_FRAME_DEBUG_TOPIC = "/gps_frame_debug";
const ROS_HEADING_OFFSET_NODE = "/imu_odom_republisher";
const ROS_HEADING_OFFSET_PARAM = "imu_yaw_offset_deg";
// const GPS_DATUM = { lat: 39.8936491, lng: 32.7717700 }; // Ofis
const GPS_DATUM = { lat: 39.7962150, lng: 32.5312773 }; // Saha bahçe

// Sabit saha noktaları — datum/şarj/eve dön referans noktaları (ortofoto üzerinde marker olarak gösterilir).
//   datum  : GPS_DATUM = Saha bahçe (dual_ekf_navsat_params_gps_tf_test.yaml -> datum ile birebir).
//   charge : GoCharge hedefi.
//   home   : GoHome hedefi.
const FIELD_POINTS = [
  { id: "datum",  label: "Datum",   lat: GPS_DATUM.lat, lng: GPS_DATUM.lng, glyph: "◎", color: "#a855f7", source: "GPS_DATUM · Saha bahçe" },
  { id: "charge", label: "Şarj",    lat: 39.7962284, lng: 32.5313263, yaw: -214.8, glyph: "⚡", color: "#22c55e", source: "Task Manager · GoCharge" },
  { id: "home",   label: "Eve Dön", lat: 39.7961831, lng: 32.5312344, yaw: -16.3,  glyph: "⌂", color: "#f59e0b", source: "Task Manager · GoHome" },
  { id: "bed-1",  label: "Y1",      lat: 39.7961957, lng: 32.5312284, glyph: "1", color: "#06b6d4", source: "Task Manager · Yatak-1" },
  { id: "bed-2",  label: "Y2",      lat: 39.7962241, lng: 32.5312753, glyph: "2", color: "#06b6d4", source: "Task Manager · Yatak-2" },
  { id: "bed-3",  label: "Y3",      lat: 39.7962403, lng: 32.5312984, glyph: "3", color: "#06b6d4", source: "Task Manager · Yatak-3" },
  { id: "bed-4",  label: "Y4",      lat: 39.7962575, lng: 32.5313236, glyph: "4", color: "#06b6d4", source: "Task Manager · Yatak-4" },
  { id: "bed-5",  label: "Y5",      lat: 39.7962722, lng: 32.5313474, glyph: "5", color: "#06b6d4", source: "Task Manager · Yatak-5" },
  { id: "bed-6",  label: "Y6",      lat: 39.7962872, lng: 32.5313725, glyph: "6", color: "#06b6d4", source: "Task Manager · Yatak-6" },
  { id: "bed-7",  label: "Y7",      lat: 39.7963031, lng: 32.5313953, glyph: "7", color: "#06b6d4", source: "Task Manager · Yatak-7" },
];
const MIN_NO_GO_AREA_M2 = 0.5;
const NAVSAT_MAGNETIC_DECLINATION_RAD = 0.068;
const NAVSAT_YAW_OFFSET_RAD = 0.0;
const NAVSAT_MAP_TO_ENU_OFFSET_RAD = 0.0;
const NAVSAT_MAP_TO_ENU_OFFSET_DEG = NAVSAT_MAP_TO_ENU_OFFSET_RAD * 180 / Math.PI;

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

function displayAngleDegToCompassBearing(displayAngleDeg) {
  return normalizeBearingDeg(90 - displayAngleDeg);
}

function normalizeRad(rad) {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

function latLngFromPayload(payload) {
  const lat = toNum(payload?.latitude ?? payload?.lat);
  const lng = toNum(payload?.longitude ?? payload?.lon ?? payload?.lng);

  return lat !== null && lng !== null ? { lat, lng } : null;
}

function formatSignedDeg(deg, digits = 1) {
  return Number.isFinite(deg) ? `${deg >= 0 ? "+" : ""}${deg.toFixed(digits)}°` : "-";
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
    // Local storage is best-effort; live state still works.
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local storage is best-effort; live state still works.
  }
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

  .gmp-map-actions{
    position:absolute;
    right:12px;
    bottom:8px;
    z-index:1100;
    display:flex;
    gap:6px;
    align-items:center;
    flex-wrap:wrap;
    justify-content:flex-end;
    max-width:calc(100% - 24px);
  }
  .gmp-derived-toggles{
    position:absolute;
    right:12px;
    bottom:122px;
    z-index:1100;
    display:flex;
    align-items:center;
    gap:6px;
  }
  .gmp-derived-toggle{
    min-height:24px;
    display:flex;
    align-items:center;
    gap:7px;
    padding:4px 8px;
    border:1px solid rgba(255,255,255,.24);
    border-radius:4px;
    background:rgba(0,0,0,.64);
    color:#f8fafc;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    font-weight:800;
    cursor:pointer;
    user-select:none;
    box-shadow:0 8px 24px rgba(0,0,0,.28);
  }
  .gmp-derived-toggle input{
    width:13px;
    height:13px;
    margin:0;
    accent-color:#b9ff2f;
    cursor:pointer;
  }
  .gmp-map-actions .gmp-mp-btn{
    min-width:96px;
    height:28px;
    padding:0 10px;
    text-transform:uppercase;
  }
  .gmp-robot-marker{
    width:30px;
    height:30px;
    position:relative;
  }
  .gmp-robot-marker__body{
    width:30px;
    height:30px;
    transform:rotate(var(--gmp-robot-rotation, 0deg));
    transform-origin:50% 50%;
    filter:drop-shadow(0 2px 5px rgba(0,0,0,.55));
  }
  .gmp-robot-marker__body svg{display:block}
  .gmp-map-messages{
    position:absolute;
    right:12px;
    bottom:44px;
    z-index:1100;
    width:310px;
    max-width:calc(100% - 24px);
    padding:6px 8px;
    border:1px solid rgba(255,255,255,.25);
    background:rgba(9,10,14,.78);
    color:#d7d7d7;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    line-height:1.35;
    box-sizing:border-box;
  }
  .gmp-heading-calibration{
    position:absolute;
    left:10px;
    bottom:36px;
    z-index:1100;
    width:min(520px, calc(100% - 390px));
    min-width:360px;
    padding:7px;
    border:1px solid rgba(255,255,255,.25);
    background:rgba(9,10,14,.78);
    color:#e6e6e6;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    line-height:1.35;
    box-sizing:border-box;
  }
  .gmp-heading-grid{
    display:grid;
    grid-template-columns:repeat(5, minmax(0, 1fr));
    gap:6px;
    margin-top:5px;
  }
  .gmp-heading-controls{
    display:grid;
    grid-template-columns:minmax(0, 1fr) 96px 72px;
    gap:6px;
    margin-top:6px;
  }
  .gmp-heading-controls input{
    min-width:0;
    height:24px;
    box-sizing:border-box;
    border:1px solid rgba(255,255,255,.25);
    background:rgba(0,0,0,.45);
    color:#f8fafc;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    padding:2px 5px;
  }
  .gmp-heading-controls button{
    height:24px;
    border:1px solid rgba(255,255,255,.25);
    background:#e7e7e7;
    color:#111;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    font-weight:800;
    cursor:pointer;
  }
  .gmp-heading-controls button:disabled{opacity:.45;cursor:not-allowed}
  .gmp-heading-note{
    margin-top:5px;
    color:#aeb4bd;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    line-height:1.35;
  }
  .gmp-heading-toggle{
    display:flex;
    align-items:center;
    gap:6px;
    margin-top:6px;
    color:#d7d7d7;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    font-weight:700;
    user-select:none;
  }
  .gmp-heading-toggle input{
    width:13px;
    height:13px;
    margin:0;
    accent-color:#b9ff2f;
  }
  .gmp-frame-debug-panel{
    position:absolute;
    top:165px;
    left:10px;
    z-index:1000;
    width:min(300px,calc(100% - 24px));
    padding:7px 8px;
    background:rgba(4,9,15,.78);
    border:1px solid rgba(148,163,184,.36);
    color:#e7e7e7;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    line-height:1.35;
    box-shadow:0 8px 22px rgba(0,0,0,.3);
    pointer-events:auto;
    box-sizing:border-box;
  }
  .gmp-frame-debug-panel__title{
    color:#9ea0a8;
    font-weight:900;
    margin-bottom:4px;
  }
  .gmp-frame-debug-panel__grid{
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    gap:2px 8px;
  }
  .gmp-frame-debug-panel__grid span:nth-child(odd){color:#aeb6c2}
  .gmp-frame-debug-panel__grid span:nth-child(even){color:#f8fafc;font-weight:800}
  .gmp-frame-debug-panel__row-toggle{
    display:flex;
    align-items:center;
    gap:4px;
    min-width:0;
    color:inherit;
    font:inherit;
    user-select:none;
    cursor:pointer;
  }
  .gmp-frame-debug-panel__row-toggle input{
    width:11px;
    height:11px;
    margin:0;
    accent-color:#b9ff2f;
  }
  .gmp-action-resizer{
    position:absolute;
    top:0;
    bottom:0;
    left:-5px;
    width:10px;
    cursor:col-resize;
    z-index:5;
  }
  .gmp-action-resizer::after{
    content:"";
    position:absolute;
    top:0;
    bottom:0;
    left:4px;
    width:1px;
    background:#34343a;
  }
  .gmp-action-resizer:hover::after{background:#b9ff2f}

  .leaflet-container{background:#0a0f1a}
  .leaflet-control-attribution{font-size:9px;opacity:0.35}
  .gmp-layer-control.leaflet-control-layers,
  .gmp-tile-refresh-control{
    border:1px solid #223044;
    border-radius:4px;
    background:rgba(3,8,15,0.88);
    box-shadow:0 8px 24px rgba(0,0,0,0.35);
    color:#d9e6ef;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    font-weight:800;
  }
  .gmp-layer-control .leaflet-control-layers-list{
    margin:0;
    padding:6px 8px;
  }
  .gmp-layer-control label{
    display:block;
    margin:2px 0;
    white-space:nowrap;
  }
  .gmp-layer-control input{accent-color:#b9ff2f}
  .gmp-tile-refresh-control{
    display:flex;
    gap:0;
    overflow:hidden;
    margin-top:-34px !important;
    margin-left:126px !important;
  }
  .gmp-tile-refresh-control button{
    display:block;
    border:0;
    background:transparent;
    color:#b9ff2f;
    padding:6px 8px;
    font:inherit;
    cursor:pointer;
  }
  .gmp-tile-refresh-control button + button{border-left:1px solid #223044}
  .gmp-tile-refresh-control button:hover{background:rgba(185,255,47,0.08)}
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
  .gmp-coverage-modal-backdrop{
    position:absolute;
    inset:0;
    z-index:1600;
    display:flex;
    justify-content:flex-start;
    align-items:stretch;
    pointer-events:none;
  }
  .gmp-coverage-modal{
    width:min(430px,calc(100% - 22px));
    margin:10px;
    background:rgba(16,16,20,.96);
    border:1px solid #3b3b42;
    border-radius:6px;
    box-shadow:0 18px 48px rgba(0,0,0,.55);
    color:#e7e7e7;
    font-family:'JetBrains Mono',monospace;
    pointer-events:auto;
    display:flex;
    flex-direction:column;
    min-height:0;
    max-height:calc(100% - 20px);
  }
  .gmp-coverage-modal button,
  .gmp-coverage-modal input,
  .gmp-coverage-modal select{font-family:'JetBrains Mono',monospace}
  .gmp-coverage-head{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    padding:10px 12px;
    border-bottom:1px solid #303039;
  }
  .gmp-coverage-body{
    padding:10px 12px;
    overflow:auto;
    display:grid;
    gap:10px;
  }
  .gmp-coverage-section{
    border:1px solid #2f2f36;
    background:#111116;
    border-radius:5px;
    padding:9px;
    display:grid;
    gap:8px;
  }
  .gmp-coverage-label{
    color:#9ea0a8;
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
  }
  .gmp-coverage-row{
    display:flex;
    gap:6px;
    align-items:center;
  }
  .gmp-coverage-grid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:8px;
  }
  .gmp-coverage-field{
    width:100%;
    box-sizing:border-box;
    height:28px;
    border:1px solid #46464f;
    background:#07070b;
    color:#f1f5f9;
    border-radius:4px;
    padding:0 7px;
    font-size:11px;
  }
  .gmp-coverage-btn{
    min-height:28px;
    border:1px solid #555;
    background:#202027;
    color:#e7e7e7;
    border-radius:4px;
    padding:0 9px;
    font-size:11px;
    font-weight:800;
    cursor:pointer;
  }
  .gmp-coverage-btn:disabled{opacity:.42;cursor:not-allowed}
  .gmp-coverage-point{
    display:grid;
    grid-template-columns:26px minmax(0,1fr) 26px;
    align-items:center;
    gap:6px;
    color:#d7d7d7;
    font-size:10px;
  }
  .gmp-coverage-point.is-selected{background:#1e293b;border-radius:4px}
  .gmp-coverage-pill{
    border:1px solid #41414a;
    background:#09090d;
    border-radius:4px;
    padding:5px 7px;
    color:#cbd5e1;
    font-size:10px;
    line-height:1.35;
  }
  .gmp-coverage-vertex-icon{
    width:24px;
    height:24px;
    border-radius:50%;
    border:2px solid #fff;
    background:#f97316;
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    font:900 11px 'JetBrains Mono',monospace;
    line-height:1;
    box-shadow:0 2px 8px rgba(0,0,0,.45);
  }
  .gmp-coverage-vertex-icon.is-start{background:#22c55e;color:#07240f}
  .gmp-no-go-modal{
    width:min(460px, calc(100vw - 24px));
    max-height:calc(100vh - 96px);
    overflow:auto;
    background:#12070a;
    border:1px solid #ef4444;
    box-shadow:0 18px 70px rgba(0,0,0,.62),0 0 0 1px rgba(239,68,68,.22);
  }
  .gmp-no-go-modal .gmp-coverage-head{border-bottom-color:#7f1d1d}
  .gmp-no-go-modal .gmp-coverage-section{border-color:#7f1d1d;background:#16090d}
  .gmp-no-go-modal .gmp-coverage-label{color:#fca5a5}
  .gmp-no-go-modal .gmp-coverage-pill{border-color:#7f1d1d;background:#0b0406;color:#fecaca}
  .gmp-no-go-zone-row{
    width:100%;
    display:grid;
    grid-template-columns:16px minmax(0,1fr) auto;
    align-items:center;
    gap:7px;
    border:0;
    border-bottom:1px solid #3f1218;
    background:transparent;
    color:#fecaca;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;
    padding:7px 2px;
    text-align:left;
    cursor:pointer;
  }
  .gmp-no-go-zone-row.is-selected{background:#2b1015}
  .gmp-no-go-vertex-icon{
    width:14px;
    height:14px;
    border-radius:50%;
    border:2px solid #fecaca;
    background:#dc2626;
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    font:900 8px 'JetBrains Mono',monospace;
    box-shadow:0 2px 8px rgba(0,0,0,.45);
  }
  .gmp-no-go-vertex-icon.is-selected{
    background:#7f1d1d;
    border-color:#ffffff;
    box-shadow:0 0 0 2px rgba(127,29,29,.55),0 2px 8px rgba(0,0,0,.45);
  }
  .gmp-coverage-intermediate-icon{
    min-width:20px;
    height:16px;
    padding:0 3px;
    border-radius:8px;
    border:2px solid #93c5fd;
    background:#1d4ed8;
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    font:800 8px 'JetBrains Mono',monospace;
    white-space:nowrap;
    box-shadow:0 2px 6px rgba(0,0,0,.4);
  }
  .gmp-coverage-intermediate-icon.has-wait{background:#b45309;border-color:#fcd34d}
  .gmp-coverage-intermediate-icon.is-selected{outline:2px solid #fff;outline-offset:1px}
  .gmp-no-go-edge-icon{
    width:14px;
    height:14px;
    border-radius:3px;
    border:1px solid #fecaca;
    background:#f87171;
    box-shadow:0 2px 7px rgba(0,0,0,.35);
  }
  .gmp-waypoint-edge-icon{
    width:14px;
    height:14px;
    border-radius:3px;
    border:1px solid #d9f99d;
    background:#65a30d;
    box-shadow:0 2px 7px rgba(0,0,0,.35);
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

function nowIso() {
  return new Date().toISOString();
}

function noGoZoneId() {
  return `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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

function signedLocalArea(points) {
  if (points.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }

  return sum / 2;
}

function segmentOrientation(a, b, c) {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function localPointOnSegment(a, b, c) {
  return (
    b.x <= Math.max(a.x, c.x) + 1e-9 &&
    b.x >= Math.min(a.x, c.x) - 1e-9 &&
    b.y <= Math.max(a.y, c.y) + 1e-9 &&
    b.y >= Math.min(a.y, c.y) - 1e-9
  );
}

function localSegmentsIntersect(p1, q1, p2, q2) {
  const o1 = segmentOrientation(p1, q1, p2);
  const o2 = segmentOrientation(p1, q1, q2);
  const o3 = segmentOrientation(p2, q2, p1);
  const o4 = segmentOrientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && localPointOnSegment(p1, p2, q1)) return true;
  if (o2 === 0 && localPointOnSegment(p1, q2, q1)) return true;
  if (o3 === 0 && localPointOnSegment(p2, p1, q2)) return true;
  if (o4 === 0 && localPointOnSegment(p2, q1, q2)) return true;
  return false;
}

function localPolygonSelfIntersects(points) {
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];

    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || Math.abs(i - j) === points.length - 1) continue;

      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (localSegmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

function localPointInsidePolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (localPointOnSegment(a, point, b)) return true;

    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;

    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }

  return inside;
}

function closestLocalPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return { x: a.x, y: a.y };

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return {
    x: a.x + dx * t,
    y: a.y + dy * t
  };
}

function constrainLatLngToPolygon(latLng, polygonLatLngs, anchor) {
  if (!latLng || !anchor || !Array.isArray(polygonLatLngs) || polygonLatLngs.length < 3) {
    return { latLng, constrained: false };
  }

  const localPoint = latLngToLocalMeters(latLng, anchor);
  const localPolygon = polygonLatLngs.map(point => latLngToLocalMeters(point, anchor)).filter(Boolean);
  if (!localPoint || localPolygon.length < 3 || localPointInsidePolygon(localPoint, localPolygon)) {
    return { latLng, constrained: false };
  }

  let best = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < localPolygon.length; i += 1) {
    const a = localPolygon[i];
    const b = localPolygon[(i + 1) % localPolygon.length];
    const candidate = closestLocalPointOnSegment(localPoint, a, b);
    const dx = candidate.x - localPoint.x;
    const dy = candidate.y - localPoint.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      best = candidate;
      bestDistSq = distSq;
    }
  }

  const constrainedLatLng = best ? localMetersToLatLng(best, anchor) : null;
  return {
    latLng: constrainedLatLng || latLng,
    constrained: Boolean(constrainedLatLng)
  };
}

function normalizeGpsPoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.lon ?? point?.longitude);
  const altitude = Number(point?.altitude ?? point?.alt);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    ...(Number.isFinite(altitude) ? { altitude } : {})
  };
}

function cleanGpsPolygonPoints(points) {
  const clean = [];

  for (const rawPoint of points || []) {
    const point = normalizeGpsPoint(rawPoint);
    if (!point) continue;

    if (!clean.some(existing => haversine(existing, point) < 0.05)) {
      clean.push(point);
    }
  }

  return clean;
}

function validateGpsPolygon(points) {
  const clean = cleanGpsPolygonPoints(points);
  const warnings = [];

  if (clean.length < 3) {
    return { ok: false, points: clean, warnings: ["Polygon en az 3 farklı noktadan oluşmalı."] };
  }

  if (clean.length !== (points || []).length) {
    warnings.push("Aynı koordinat tekrarları temizlendi.");
  }

  const anchor = clean[0] || GPS_DATUM;
  const localPoints = clean.map(point => latLngToLocalMeters(point, anchor)).filter(Boolean);

  if (localPoints.length < 3) {
    return { ok: false, points: clean, warnings: ["GPS noktaları lokal koordinata çevrilemedi."] };
  }

  if (localPolygonSelfIntersects(localPoints)) {
    return { ok: false, points: clean, warnings: ["Kesişen/self-intersecting poligonlara izin verilmez."] };
  }

  const area = Math.abs(signedLocalArea(localPoints));
  if (area < MIN_NO_GO_AREA_M2) {
    warnings.push(`Alan çok küçük (${area.toFixed(2)} m²). Kaydetmeden önce kontrol edin.`);
  }

  return { ok: true, points: clean, warnings, area };
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

function isInBounds(lat, lng, bounds) {
  const [[south, west], [north, east]] = bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function setOrthoStartView(map) {
  if (!map) return;

  map.fitBounds(ORTHO_BOUNDS);
  map.setZoom(Math.min(map.getZoom() + ORTHO_START_ZOOM_BOOST, map.getMaxZoom()));
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

function waypointIcon(index, state = "pending") {
  const reached = state === "reached";
  const fill = reached ? "#38bdf8" : "#39ff14";
  const stroke = reached ? "#075985" : "#064a00";
  const textFill = reached ? "#ffffff" : "#071707";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="11" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
      <circle cx="14" cy="14" r="13" fill="none" stroke="#000000" stroke-opacity=".45" stroke-width="1"/>
      <text x="14" y="18" text-anchor="middle" font-family="monospace" font-size="11" font-weight="800" fill="${textFill}">${index}</text>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function coverageVertexIcon(index, isStart = false) {
  const fill = isStart ? "#22c55e" : "#f97316";
  const stroke = isStart ? "#14532d" : "#9a3412";
  const textFill = isStart ? "#06220d" : "#ffffff";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="11" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
      <circle cx="14" cy="14" r="13" fill="none" stroke="#000000" stroke-opacity=".45" stroke-width="1"/>
      <text x="14" y="18" text-anchor="middle" font-family="monospace" font-size="11" font-weight="800" fill="${textFill}">${index}</text>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function noGoVertexIcon(index, isSelected = false) {
  return L.divIcon({
    className: "",
    html: `<div class="gmp-no-go-vertex-icon ${isSelected ? "is-selected" : ""}">${index}</div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function coverageIntermediateIcon(label, { hasWait = false, isSelected = false } = {}) {
  const classes = ["gmp-coverage-intermediate-icon"];
  if (hasWait) classes.push("has-wait");
  if (isSelected) classes.push("is-selected");
  return L.divIcon({
    className: "",
    html: `<div class="${classes.join(" ")}">${label}</div>`,
    iconSize: [26, 16],
    iconAnchor: [13, 8]
  });
}

function noGoEdgeIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="gmp-no-go-edge-icon"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function waypointEdgeIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="gmp-waypoint-edge-icon"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function robotVehicleIcon(displayYaw = 0) {
  const rotationDeg = -radToDeg(displayYaw);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="11.5" fill="#0ea5e9" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M24 15L12 8.2V12H6V18H12V21.8L24 15Z" fill="#ffffff"/>
      <circle cx="15" cy="15" r="14" fill="none" stroke="#000000" stroke-opacity=".38" stroke-width="1"/>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return L.divIcon({
    className: "",
    html: `
      <div class="gmp-robot-marker" style="--gmp-robot-rotation:${rotationDeg}deg">
        <div class="gmp-robot-marker__body">${svg}</div>
      </div>
    `.replace(/\s+/g, " ").trim(),
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15]
  });
}

function fieldPointIcon(glyph, color, label) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:64px;height:34px;pointer-events:none;">
        <div style="position:absolute;left:50%;top:9px;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#0b1220;">${glyph}</div>
        <div style="position:absolute;left:50%;top:22px;transform:translateX(-50%);padding:0 5px;border-radius:3px;background:rgba(2,6,23,.85);color:#fff;font-size:9px;font-weight:800;white-space:nowrap;border:1px solid ${color};">${label}</div>
      </div>
    `.replace(/\s+/g, " ").trim(),
    iconSize: [64, 34],
    iconAnchor: [32, 9],
    popupAnchor: [0, -9]
  });
}

function debugArrowHeadIcon(color, bearingDegValue, label = "") {
  const safeBearing = Number.isFinite(bearingDegValue) ? bearingDegValue : 0;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M11 2L18 18L11 14.5L4 18L11 2Z" fill="${color}" stroke="#020617" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return L.divIcon({
    className: "",
    html: `
      <div title="${label}" style="width:22px;height:22px;transform:rotate(${safeBearing}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))">
        ${svg}
      </div>
    `.replace(/\s+/g, " ").trim(),
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function makeWaypointLayer(wp, index, state = "pending") {
  return L.marker([wp.lat, wp.lng], {
    icon: waypointIcon(index + 1, state),
    draggable: true,
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
    s.includes("varıldı") ||
    s.includes("ulaşıldı") ||
    s.includes("tamamlandı")
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

function missionMetersText(value) {
  const n = toNum(value);
  if (n === null) return null;
  return n >= 10 ? `${n.toFixed(1)} m` : `${n.toFixed(2)} m`;
}

function translateMissionText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "";

  const lower = text.toLowerCase();
  const exactMap = new Map([
    ["complete", "Görev tamamlandı."],
    ["completed", "Görev tamamlandı."],
    ["mission complete", "Görev tamamlandı."],
    ["all navigation segments completed", "Tüm navigasyon segmentleri tamamlandı."],
    ["paused", "Görev duraklatıldı."],
    ["resume", "Görev devam ediyor."],
    ["resumed", "Görev devam ediyor."],
    ["stopped", "Görev durduruldu."],
    ["cancelled", "Görev iptal edildi."],
    ["canceled", "Görev iptal edildi."],
    ["waiting", "Görev bekliyor."],
    ["feedback", "Görev durumu güncellendi."]
  ]);

  if (exactMap.has(lower)) return exactMap.get(lower);

  return text
    .replace(/all navigation segments completed/gi, "tüm navigasyon segmentleri tamamlandı")
    .replace(/mission complete/gi, "görev tamamlandı")
    .replace(/\bwaypoint list(?: is)? ready\b/gi, "waypoint listesi hazır")
    .replace(/\bconnected\b/gi, "bağlandı")
    .replace(/\bdisconnected\b/gi, "bağlantı kesildi")
    .replace(/\bpaused\b/gi, "duraklatıldı")
    .replace(/\bresume(?:d)?\b/gi, "devam ediyor")
    .replace(/\bstopped\b/gi, "durduruldu")
    .replace(/\bcancel(?:led|ed)?\b/gi, "iptal edildi")
    .replace(/\bwaiting\b/gi, "bekliyor")
    .replace(/\bnavigating\b/gi, "waypointe gidiliyor")
    .replace(/\breached\b/gi, "ulaşıldı")
    .replace(/\barrived\b/gi, "ulaşıldı")
    .replace(/\bcompleted\b/gi, "tamamlandı")
    .replace(/\bcomplete\b/gi, "tamamlandı");
}

function missionResultMessage(code, detail = "") {
  const translatedDetail = translateMissionText(detail);
  const suffix = translatedDetail ? ` (${translatedDetail})` : "";

  if (code === 1) return { text: `Görev kabul edildi. Araç birazdan harekete geçecek.${suffix}`, level: "active" };
  if (code === 2) return { text: `Araç waypointe gidiyor.${suffix}`, level: "active" };
  if (code === 3) return { text: `Görev iptal ediliyor.${suffix}`, level: "muted" };
  if (code === 4) return { text: `Waypoint'e ulaşıldı. Görev tamamlandı.${suffix}`, level: "success" };
  if (code === 5) return { text: `Görev iptal edildi.${suffix}`, level: "muted" };
  if (code === 6) return { text: `Araç waypointe gidemedi. Görev başarısız oldu.${suffix}`, level: "danger" };
  if (code === 7) return { text: `Görev durumu bilinmiyor.${suffix}`, level: "warn" };
  if (code === 8) return { text: `Görev beklemede.${suffix}`, level: "info" };

  return null;
}

function readableMissionStatusFromPayload(payload) {
  const state = String(payload?.state || payload?.status_text || payload?.event || "").trim();
  const stateLc = state.toLowerCase();
  const detail = String(payload?.detail || payload?.message || payload?.error_msg || payload?.error || "").trim();
  const translatedState = translateMissionText(state);
  const translatedDetail = translateMissionText(detail);
  const distance = missionMetersText(
    payload?.distance_remaining ?? payload?.remaining_distance ?? payload?.distance
  );
  const recoveries = toNum(payload?.recoveries ?? payload?.number_of_recoveries);
  const wpIndex = toNum(payload?.waypoint_index ?? payload?.wp_index ?? payload?.current_waypoint);
  const wpTotal = toNum(payload?.waypoint_count ?? payload?.wp_count ?? payload?.total_waypoints);
  const wpText = wpIndex !== null
    ? `WP ${wpIndex}${wpTotal !== null ? `/${wpTotal}` : ""}`
    : "Waypoint";
  const code = firstNum(payload, ["result", "status", "status_code", "goal_status", "code"]);
  const resultMessage = code !== null ? missionResultMessage(code, detail) : null;

  if (
    distance ||
    stateLc.includes("feedback") ||
    stateLc.includes("executing") ||
    stateLc.includes("active") ||
    stateLc.includes("navigat")
  ) {
    const pieces = [`${wpText}'e gidiliyor`];
    if (distance) pieces.push(`kalan mesafe ${distance}`);
    if (recoveries !== null && recoveries > 0) pieces.push(`kurtarma denemesi ${recoveries}`);

    return { text: pieces.join(" - "), level: "active" };
  }

  if (
    stateLc.includes("succeeded") ||
    stateLc.includes("success") ||
    stateLc.includes("complete") ||
    stateLc.includes("completed") ||
    stateLc.includes("reached") ||
    stateLc.includes("arrived") ||
    stateLc.includes("done") ||
    stateLc.includes("tamam") ||
    stateLc.includes("ulaş")
  ) {
    return { text: `${wpText}'e ulaşıldı. Görev tamamlandı.`, level: "success" };
  }

  if (
    stateLc.includes("aborted") ||
    stateLc.includes("failed") ||
    stateLc.includes("fail") ||
    stateLc.includes("error") ||
    stateLc.includes("timeout") ||
    stateLc.includes("unreachable") ||
    stateLc.includes("başarısız") ||
    stateLc.includes("ulaşılamadı")
  ) {
    return {
      text: `Araç ${wpText.toLowerCase()}'e gidemedi. Görev başarısız oldu.${detail ? ` (${detail})` : ""}`,
      level: "danger"
    };
  }

  if (stateLc.includes("cancel") || stateLc.includes("iptal")) {
    return { text: `Görev iptal edildi.${detail ? ` (${detail})` : ""}`, level: "muted" };
  }

  if (resultMessage) return resultMessage;

  if (state || detail) {
    return {
      text: translatedDetail
        ? `${translatedState || "Görev durumu"}: ${translatedDetail}`
        : translatedState || state,
      level: missionLevelFromText(`${translatedState || state} ${translatedDetail || detail}`)
    };
  }

  return null;
}

function readableMissionStatusFromText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const resultMatch = text.match(/\b(?:result|status|code|goal_status)\s*[:=]\s*(-?\d+)\b/i);
  const resultCode = resultMatch ? Number(resultMatch[1]) : null;
  const distanceMatch = text.match(/\bdistance_remaining\s*[:=]\s*(-?\d+(?:\.\d+)?)\b/i);
  const recoveriesMatch = text.match(/\brecoveries\s*[:=]\s*(-?\d+(?:\.\d+)?)\b/i);

  if (distanceMatch) {
    const pieces = ["Waypoint'e gidiliyor", `kalan mesafe ${missionMetersText(distanceMatch[1])}`];
    const recoveries = toNum(recoveriesMatch?.[1]);
    if (recoveries !== null && recoveries > 0) pieces.push(`kurtarma denemesi ${recoveries}`);
    return { text: pieces.join(" - "), level: "active" };
  }

  if (resultCode !== null) {
    const cleanedDetail = text
      .replace(resultMatch[0], "")
      .replace(/^[\s:;,\-—]+|[\s:;,\-—]+$/g, "");
    const resultMessage = missionResultMessage(resultCode, cleanedDetail);
    if (resultMessage) return resultMessage;
  }

  return readableMissionStatusFromPayload({ state: translateMissionText(text) });
}

function waypointReachedNoticeText(waypointNumber) {
  return `${waypointNumber} numaralı waypoint alındı.`;
}

function normalizeWaypointNumber(value) {
  const n = toNum(value);
  if (n === null) return null;
  return Math.max(1, Math.trunc(n));
}

function shiftReachedIndexesForInsert(prev, insertIndex) {
  const next = new Set();
  prev.forEach(index => {
    next.add(index >= insertIndex ? index + 1 : index);
  });
  return next;
}

function shiftReachedIndexesForRemove(prev, removeIndex) {
  const next = new Set();
  prev.forEach(index => {
    if (index === removeIndex) return;
    next.add(index > removeIndex ? index - 1 : index);
  });
  return next;
}

function shiftReachedIndexesForMove(prev, from, to) {
  const next = new Set();
  prev.forEach(index => {
    if (index === from) {
      next.add(to);
      return;
    }
    if (from < to && index > from && index <= to) {
      next.add(index - 1);
      return;
    }
    if (from > to && index >= to && index < from) {
      next.add(index + 1);
      return;
    }
    next.add(index);
  });
  return next;
}

function parseWaitingDwellInfo(text) {
  const str = String(text || "");
  const dwellMatch = str.match(/dwell\s*=\s*([\d.]+)/i);
  if (!dwellMatch) return null;

  const seconds = Number(dwellMatch[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const wpMatch = str.match(/\bwp\s*=\s*(\d+)/i);
  return {
    seconds,
    waypointIndex: wpMatch ? Math.max(0, Number(wpMatch[1]) - 1) : null
  };
}

function reachedWaypointNumberFromPayload(payload) {
  if (!payload) return null;

  const state = String(payload?.state || payload?.status_text || payload?.event || "").toLowerCase();
  const detail = String(payload?.detail || payload?.message || "").toLowerCase();
  const code = firstNum(payload, ["result", "status", "status_code", "goal_status", "code"]);
  const isReached =
    code === 4 ||
    state.includes("complete") ||
    state.includes("reached") ||
    state.includes("arrived") ||
    state.includes("completed") ||
    state.includes("done") ||
    state.includes("ulaş") ||
    detail.includes("reached") ||
    detail.includes("arrived") ||
    detail.includes("ulaş");

  if (!isReached) return undefined;

  return normalizeWaypointNumber(
    payload?.waypoint_index ??
    payload?.wp_index ??
    payload?.current_waypoint ??
    payload?.waypoint ??
    payload?.wp
  );
}

function reachedWaypointNumberFromText(rawText) {
  const text = String(rawText || "");
  const lower = text.toLowerCase();
  const resultMatch = text.match(/\b(?:result|status|code|goal_status)\s*[:=]\s*(-?\d+)\b/i);
  const resultCode = resultMatch ? Number(resultMatch[1]) : null;
  const isReached =
    resultCode === 4 ||
    lower.includes("complete") ||
    lower.includes("reached") ||
    lower.includes("arrived") ||
    lower.includes("completed") ||
    lower.includes("done") ||
    lower.includes("ulaş");

  if (!isReached) return undefined;

  const wpMatch =
    text.match(/\b(?:wp|waypoint)\s*#?\s*(\d+)\b/i) ||
    text.match(/\b(\d+)\s*\.?\s*waypoint\b/i);

  return normalizeWaypointNumber(wpMatch?.[1]);
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

function waypointModeValue(value) {
  return String(value || "pass").toLowerCase() === "corner" ? "corner" : "pass";
}

function waypointModeLabel(value) {
  return waypointModeValue(value).toUpperCase();
}

function waypointSpeedValue(value) {
  const n = toNum(value);
  return n !== null && n > 0
    ? Math.min(MAX_WAYPOINT_SPEED_MULTIPLIER, n)
    : DEFAULT_WAYPOINT_SPEED_MULTIPLIER;
}

function waypointSpeedText(value) {
  return waypointSpeedValue(value).toFixed(2);
}

function waypointSpeedStoredText(wp) {
  const value = wp?.speed_multiplier ?? wp?.speedMultiplier ?? wp?.speed;
  return value === "" || value === null || value === undefined
    ? waypointSpeedText(DEFAULT_WAYPOINT_SPEED_MULTIPLIER)
    : String(value);
}

function waypointWaitSecondsValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.max(1, Math.round(n))) : undefined;
}

function normalizeStoredWaypoints(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(wp => ({
      lat: toNum(wp?.lat),
      lng: toNum(wp?.lng),
      altitude: firstNum(wp, ["altitude", "alt"]),
      speed: waypointSpeedStoredText(wp),
      mode: waypointModeValue(wp?.mode),
      waitSeconds: waypointWaitSecondsValue(wp?.waitSeconds ?? wp?.wait_seconds)
    }))
    .filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lng));
}

function readStoredWaypointState() {
  const raw = storageGet(WAYPOINTS_STORAGE_KEY);
  if (!raw) return { waypoints: [], reachedIndexes: new Set() };

  try {
    const payload = JSON.parse(raw);
    const waypoints = normalizeStoredWaypoints(payload?.waypoints);
    const reachedIndexes = new Set(
      Array.isArray(payload?.reachedWaypointIndexes)
        ? payload.reachedWaypointIndexes
            .map(index => Math.trunc(Number(index)))
            .filter(index => index >= 0 && index < waypoints.length)
        : []
    );

    return { waypoints, reachedIndexes };
  } catch {
    return { waypoints: [], reachedIndexes: new Set() };
  }
}

function normalizeCoveragePoints(points) {
  if (!Array.isArray(points)) return [];

  return points
    .map(point => {
      const lat = firstNum(point, ["lat", "latitude"]);
      const lng = firstNum(point, ["lng", "lon", "longitude"]);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    })
    .filter(Boolean);
}

const COVERAGE_NODE_LABEL_RE = /^T\d+(\.\d+)?$/;
const COVERAGE_MANUAL_NODE_LABEL_RE = /^T\d+\.\d+$/;

function normalizeCoverageWaitPoints(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const result = {};

  for (const [label, value] of Object.entries(source)) {
    if (typeof label !== "string" || !COVERAGE_NODE_LABEL_RE.test(label)) continue;
    const seconds = Number(value?.seconds ?? value?.wait_seconds ?? value);
    if (Number.isFinite(seconds) && seconds > 0) {
      result[label] = { seconds: Math.min(3600, Math.max(1, Math.round(seconds))) };
    }
  }

  return result;
}

function clampPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeCoverageNodeOverrides(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const result = {};

  for (const [label, value] of Object.entries(source)) {
    if (typeof label !== "string" || !COVERAGE_NODE_LABEL_RE.test(label)) continue;
    const lat = Number(value?.lat);
    const lng = Number(value?.lng ?? value?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      result[label] = { lat, lng };
    }
  }

  return result;
}

function normalizeCoverageRemovedNodeLabels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(label => typeof label === "string" && COVERAGE_NODE_LABEL_RE.test(label));
}

function normalizeCoverageManualNodes(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const entry of raw) {
    const label = entry?.label;
    if (typeof label !== "string" || !COVERAGE_MANUAL_NODE_LABEL_RE.test(label)) continue;
    const afterLabel = entry?.afterLabel === null || entry?.afterLabel === undefined
      ? null
      : String(entry.afterLabel);
    if (afterLabel !== null && !COVERAGE_NODE_LABEL_RE.test(afterLabel)) continue;
    result.push({ label, afterLabel });
  }
  return result;
}

function normalizeCoverageState(payload) {
  const state = payload || {};
  const points = normalizeCoveragePoints(state.points || state.polygon);
  const allowedStyles = COVERAGE_STYLE_OPTIONS.map(option => option.value);
  const style = typeof state.style === "string" && allowedStyles.includes(state.style)
    ? state.style
    : "zigzag";
  const startCorner = Math.trunc(Number(state.startCorner ?? state.start_corner));

  return {
    open: Boolean(state.open),
    drawingEnabled: Boolean(state.drawingEnabled ?? state.drawing_enabled),
    points,
    style,
    lineSpacing: clampPositiveNumber(state.lineSpacing ?? state.line_spacing, 0.4),
    pointDensity: clampPositiveNumber(state.pointDensity ?? state.point_density, 0.5),
    navPoseSpacing: Math.max(1.2, clampPositiveNumber(state.navPoseSpacing ?? state.nav_pose_spacing, 1.5)),
    sweepAngleDeg: Number.isFinite(Number(state.sweepAngleDeg ?? state.sweep_angle_deg))
      ? Number(state.sweepAngleDeg ?? state.sweep_angle_deg)
      : 0,
    diagonalAngleDeg: Number.isFinite(Number(state.diagonalAngleDeg ?? state.diagonal_angle_deg))
      ? Number(state.diagonalAngleDeg ?? state.diagonal_angle_deg)
      : 45,
    headingDeg: Number.isFinite(Number(state.headingDeg ?? state.heading_deg))
      ? Number(state.headingDeg ?? state.heading_deg)
      : 0,
    curveStrength: clampPositiveNumber(state.curveStrength ?? state.curve_strength, 0.8),
    circleDirection: state.circleDirection === "ccw" || state.circle_direction === "ccw" ? "ccw" : "cw",
    spiralDirection: state.spiralDirection === "inward" || state.spiral_direction === "inward" ? "inward" : "outward",
    spiralRotation: state.spiralRotation === "ccw" || state.spiral_rotation === "ccw" ? "ccw" : "cw",
    startRadius: Number.isFinite(Number(state.startRadius ?? state.start_radius))
      ? Math.max(0, Number(state.startRadius ?? state.start_radius))
      : 0,
    headlandPasses: Math.max(1, Math.trunc(Number(state.headlandPasses ?? state.headland_passes) || 1)),
    boundaryDirection: state.boundaryDirection === "ccw" || state.boundary_direction === "ccw" ? "ccw" : "cw",
    startCorner: Number.isFinite(startCorner) && startCorner >= 0 && startCorner <= 3 ? startCorner : 0,
    waitPoints: normalizeCoverageWaitPoints(state.waitPoints ?? state.wait_points),
    nodeOverrides: normalizeCoverageNodeOverrides(state.nodeOverrides ?? state.node_overrides),
    removedNodeLabels: normalizeCoverageRemovedNodeLabels(state.removedNodeLabels ?? state.removed_node_labels),
    manualNodes: normalizeCoverageManualNodes(state.manualNodes ?? state.manual_nodes),
    autoStart: Boolean(state.autoStart ?? state.auto_start),
    topic: typeof state.topic === "string" && state.topic.trim()
      ? state.topic
      : GPS_COVERAGE_POLYGON_TOPIC,
  };
}

function readStoredCoverageState() {
  const raw = storageGet(GPS_COVERAGE_STORAGE_KEY);
  if (!raw) return normalizeCoverageState(null);

  try {
    return normalizeCoverageState(JSON.parse(raw));
  } catch {
    return normalizeCoverageState(null);
  }
}

function normalizeNoGoZone(rawZone, index = 0) {
  const points = cleanGpsPolygonPoints(rawZone?.coordinates || rawZone?.points || rawZone?.polygon || []);
  const now = nowIso();
  const rawGroupId = Number(rawZone?.groupId ?? rawZone?.group_id);
  const groupId = Number.isFinite(rawGroupId) && rawGroupId > 0 ? Math.trunc(rawGroupId) : index + 1;
  const rawBufferMeters = Number(
    rawZone?.bufferMeters
    ?? rawZone?.buffer_m
    ?? rawZone?.keepout_buffer_m
    ?? rawZone?.metadata?.buffer_m
    ?? rawZone?.metadata?.keepout_buffer_m
  );
  const bufferMeters = Number.isFinite(rawBufferMeters) && rawBufferMeters >= 0 ? rawBufferMeters : 0;

  return {
    id: String(rawZone?.id || `zone-${String(index + 1).padStart(3, "0")}`),
    name: String(rawZone?.name || `Yasak bölge ${index + 1}`),
    groupId,
    enabled: rawZone?.enabled !== false,
    type: rawZone?.type || "hard",
    bufferMeters,
    coordinates: points.map(point => ({
      latitude: point.lat,
      longitude: point.lng,
      ...(Number.isFinite(point.altitude) ? { altitude: point.altitude } : {})
    })),
    metadata: {
      ...(rawZone?.metadata || {}),
      created_at: rawZone?.metadata?.created_at || now,
      updated_at: rawZone?.metadata?.updated_at || now,
      buffer_m: bufferMeters,
      keepout_buffer_m: bufferMeters
    }
  };
}

function normalizeNoGoState(rawState) {
  const zones = Array.isArray(rawState)
    ? rawState
    : Array.isArray(rawState?.no_go_zones)
      ? rawState.no_go_zones
      : Array.isArray(rawState?.zones)
        ? rawState.zones
        : [];
  const draftPoints = cleanGpsPolygonPoints(rawState?.draftPoints || rawState?.draft_points || []);
  const selectedZoneId = typeof rawState?.selectedZoneId === "string"
    ? rawState.selectedZoneId
    : typeof rawState?.selected_zone_id === "string"
      ? rawState.selected_zone_id
      : null;
  const draftGroupIdRaw = Number(rawState?.draftGroupId ?? rawState?.draft_group_id);
  const maxGroupId = zones.reduce((max, zone, index) => {
    const next = normalizeNoGoZone(zone, index).groupId;
    return Math.max(max, next);
  }, 0);

  return {
    zones: zones.map(normalizeNoGoZone).filter(zone => zone.coordinates.length >= 3),
    draftPoints,
    selectedZoneId,
    masterEnabled: rawState?.masterEnabled !== false && rawState?.master_enabled !== false,
    draftGroupId: Number.isFinite(draftGroupIdRaw) && draftGroupIdRaw > 0 ? Math.trunc(draftGroupIdRaw) : maxGroupId + 1,
  };
}

function readStoredNoGoState() {
  const raw = storageGet(GPS_NO_GO_STORAGE_KEY);
  if (!raw) return normalizeNoGoState(null);

  try {
    return normalizeNoGoState(JSON.parse(raw));
  } catch {
    return normalizeNoGoState(null);
  }
}

function normalizeOffsetLineState(rawState) {
  const state = rawState || {};
  const start = normalizeGpsPoint(state.start);
  const end = normalizeGpsPoint(state.end);
  const side = state.side === "right" ? "right" : "left";
  const distanceCmRaw = Number(state.distanceCm ?? state.distance_cm);

  return {
    panelOpen: Boolean(state.panelOpen ?? state.panel_open),
    drawingEnabled: Boolean(state.drawingEnabled ?? state.drawing_enabled),
    start,
    end,
    distanceCm: Number.isFinite(distanceCmRaw) && distanceCmRaw > 0 ? distanceCmRaw : 20,
    side,
  };
}

function mapOffsetLineRunState(rawState) {
  switch (rawState) {
    case "sent":
    case "accepted":
    case "feedback":
      return "RUNNING";
    case "received":
    case "planned":
      return "PLANNED";
    case "complete":
      return "DONE";
    case "canceled":
    case "cancel":
    case "stopped":
    case "rejected":
      return "STOPPED";
    case "error":
      return "ERROR";
    default:
      return "IDLE";
  }
}

function readStoredOffsetLineState() {
  const raw = storageGet(GPS_OFFSET_LINE_STORAGE_KEY);
  if (!raw) return normalizeOffsetLineState(null);

  try {
    return normalizeOffsetLineState(JSON.parse(raw));
  } catch {
    return normalizeOffsetLineState(null);
  }
}

function carrierSolutionText(carrSoln) {
  if (!Number.isFinite(carrSoln)) return "none";
  if (carrSoln === 0) return "none";
  if (carrSoln === 1) return "float";
  if (carrSoln === 2) return "fixed";
  return "none";
}

function parseUbloxNavPvt(msg) {
  const flags = toNum(msg?.flags);
  const carrSolnRaw = firstNum(msg, ["carr_soln", "carrSoln", "carrier_solution", "carrierSolution"]);
  const carrSoln = carrSolnRaw !== null
    ? carrSolnRaw
    : flags !== null
      ? (flags >> 6) & 0x03
      : null;

  return {
    rtkStatus: carrierSolutionText(carrSoln),
    flags,
    stamp: msg?.header?.stamp || null,
    ts: Date.now()
  };
}

function parseRtkStatusFromText(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return null;

  const mentionsRtk = /\b(rtk|carrier|carr[_\s-]?soln|carrsoln|fix[_\s-]?(?:quality|type))\b/.test(value);
  if (!mentionsRtk) return null;

  const fixQualityMatch = value.match(/\bfix[_\s-]?quality\s*[:=]\s*([0-9]+)\b/);
  if (fixQualityMatch) {
    const quality = Number(fixQualityMatch[1]);
    if (quality === 4) return "fixed";
    if (quality === 5) return "float";
    return "none";
  }

  const numericMatch = value.match(/\b(?:carr[_\s-]?soln|carrsoln|carrier(?:\s+solution)?|rtk)\s*[:=]\s*([0-2])\b/);
  if (numericMatch) return carrierSolutionText(Number(numericMatch[1]));

  if (/\b(no(?:ne)?|invalid|single|standalone|not\s+fixed|no\s+rtk|no\s+fix)\b/.test(value)) return "none";
  if (/\b(float|floating|rtkfloat|rtk_float|dgps)\b/.test(value)) return "float";
  if (/\b(fixed|fix|rtkfix|rtk_fixed|rtk\s+fixed)\b/.test(value)) return "fixed";

  return null;
}

function horizontalStdFromCovariance(cov) {
  if (!Array.isArray(cov) || cov.length < 5) return null;

  const xVar = toNum(cov[0]);
  const yVar = toNum(cov[4]);

  if (xVar === null || yVar === null || xVar < 0 || yVar < 0) return null;

  return Math.sqrt(Math.max(xVar, yVar));
}

function ageSec(info) {
  if (!info?.ts) return null;
  return Math.max(0, (Date.now() - info.ts) / 1000);
}

function checkColors(level) {
  if (level === "ok") return { fg: "#39ff14", bg: "rgba(57,255,20,.07)", border: "rgba(57,255,20,.35)" };
  if (level === "warn") return { fg: "#fbbf24", bg: "rgba(251,191,36,.08)", border: "rgba(251,191,36,.35)" };
  if (level === "danger") return { fg: "#ff7070", bg: "rgba(239,68,68,.09)", border: "rgba(239,68,68,.42)" };
  return { fg: "#94a3b8", bg: "rgba(148,163,184,.07)", border: "rgba(148,163,184,.28)" };
}

function buildMissionReadiness({
  isConnected,
  waypoints,
  currentGpsLatLng,
  rawGpsInfo,
  robotPoseInfo,
  gpsTfDistance,
  datumDistanceM,
  debugPoints,
  lastDebugPoint,
  nav2GoalInfo
}) {
  const checks = [];
  const blockers = [];
  const add = (id, level, label, detail, block = false) => {
    checks.push({ id, level, label, detail, block });
    if (block) blockers.push(label);
  };

  add(
    "ros",
    isConnected ? "ok" : "danger",
    "ROS bağlantısı",
    isConnected ? "Bağlandı" : "ROS bridge bağlantısı yok",
    !isConnected
  );

  add(
    "waypoints",
    waypoints.length > 0 ? "ok" : "danger",
    "Waypoint listesi",
    waypoints.length > 0 ? `${waypoints.length} waypoint hazır` : "En az bir waypoint ekle",
    waypoints.length === 0
  );

  const gpsAge = ageSec(rawGpsInfo);
  const gpsStd = horizontalStdFromCovariance(rawGpsInfo?.positionCovariance);
  const hasFix = Boolean(
    currentGpsLatLng &&
    rawGpsInfo &&
    Number.isFinite(rawGpsInfo.status) &&
    rawGpsInfo.status >= 0
  );

  if (!hasFix) {
    add("gps", "danger", "GPS fix", "Geçerli /fix yok. Enlem/boylam dönüşümüne güvenilemez.", true);
  } else if (gpsAge !== null && gpsAge > 3) {
    add("gps", "warn", "GPS fix", `/fix mesajı eski: ${gpsAge.toFixed(1)} sn önce`);
  } else if (gpsStd !== null && gpsStd > 2.0) {
    add("gps", "warn", "GPS covariance", `Yatay standart sapma yüksek: ${gpsStd.toFixed(2)} m`);
  } else {
    add(
      "gps",
      "ok",
      "GPS fix",
      `Geçerli fix${gpsStd !== null ? `, yatay std ${gpsStd.toFixed(2)} m` : ""}`
    );
  }

  add(
    "tf",
    robotPoseInfo ? "ok" : "danger",
    "TF map -> base",
    robotPoseInfo
      ? `x=${robotPoseInfo.x.toFixed(2)} y=${robotPoseInfo.y.toFixed(2)}`
      : "map -> base_link/base_footprint bekleniyor",
    !robotPoseInfo
  );

  if (Number.isFinite(datumDistanceM)) {
    add(
      "datum",
      datumDistanceM > 2000 ? "warn" : "ok",
      "Datum mesafesi",
      `Tanımlı datumdan ${datumDistanceM.toFixed(1)} m uzakta`
    );
  } else {
    add("datum", "info", "Datum mesafesi", "GPS fix bekleniyor");
  }

  if (Number.isFinite(gpsTfDistance)) {
    add(
      "gps_tf",
      gpsTfDistance > 5 ? "danger" : gpsTfDistance > 2 ? "warn" : "ok",
      "GPS ve TF hizası",
      `${gpsTfDistance.toFixed(2)} m fark${gpsTfDistance > 5 ? " - map->odom/navsat hizalamasını kontrol et" : ""}`
    );
  } else {
    add("gps_tf", "info", "GPS ve TF hizası", "/odometry/gps ve TF pozu bekleniyor");
  }

  if (!debugPoints.length) {
    add("fromll", "info", "Waypoint dönüşümü", "Henüz /fromLL debug noktası yok. Bir kez başlat veya dönüşümü doğrula.");
  } else if (
    !lastDebugPoint ||
    !Number.isFinite(lastDebugPoint.mapX) ||
    !Number.isFinite(lastDebugPoint.mapY)
  ) {
    add("fromll", "warn", "Waypoint dönüşümü", "Son debug noktasında map_x/map_y yok");
  } else {
    add(
      "fromll",
      "ok",
      "Waypoint dönüşümü",
      `Son hedef ${lastDebugPoint.goalFrameId || "map"} x=${lastDebugPoint.mapX.toFixed(2)} y=${lastDebugPoint.mapY.toFixed(2)}`
    );
  }

  if (nav2GoalInfo?.frameId) {
    add(
      "nav2_goal",
      nav2GoalInfo.frameId.replace(/^\//, "") === "map" ? "ok" : "warn",
      "Nav2 hedef frame",
      `${nav2GoalInfo.frameId} x=${fmtNum(nav2GoalInfo.x, 2)} y=${fmtNum(nav2GoalInfo.y, 2)}`
    );
  } else {
    add("nav2_goal", "info", "Nav2 hedef frame", "Henüz hedef yayınlanmadı");
  }

  return {
    checks,
    blockers,
    canStart: blockers.length === 0,
    worstLevel: checks.some(c => c.level === "danger")
      ? "danger"
      : checks.some(c => c.level === "warn")
        ? "warn"
        : "ok"
  };
}

function readDebugPoint(p) {
  if (!p) return null;

  return {
    index: firstNum(p, ["index", "wp_index", "waypoint_index", "id"]),
    latitude: firstNum(p, ["latitude", "lat", "source_latitude", "source_lat"]),
    longitude: firstNum(p, ["longitude", "lon", "lng", "source_longitude", "source_lon"]),
    altitude: firstNum(p, ["altitude", "alt", "source_altitude"]),
    fromllFrame: p.fromll_frame || p.from_ll_frame || p.frame_id || p.frame || "",
    mapX: firstNum(p, ["fromll_x", "from_ll_x", "converted_x", "map_x", "x"]),
    mapY: firstNum(p, ["fromll_y", "from_ll_y", "converted_y", "map_y", "y"]),
    mapZ: firstNum(p, ["fromll_z", "from_ll_z", "converted_z", "map_z", "z"]),
    goalX: firstNum(p, ["goal_x", "target_x", "nav_goal_x", "vehicle_goal_x", "sent_x"]),
    goalY: firstNum(p, ["goal_y", "target_y", "nav_goal_y", "vehicle_goal_y", "sent_y"]),
    goalFrameId: p.goal_frame_id || p.goal_frame || p.frame_id || "",
    yaw: firstNum(p, ["yaw", "goal_yaw", "target_yaw"]),
    mode: p.mode || p.nav_mode || p.waypoint_mode || "",
    yawSource: p.yaw_source || p.yawSource || p.heading_source || ""
  };
}

function debugPointVehicleTarget(point) {
  if (!point) return null;
  const x = point.goalX ?? point.mapX;
  const y = point.goalY ?? point.mapY;
  if (x === null || y === null) return null;
  return { x, y };
}

// ─────────────────────────────────────────────────────────────────────────
export default function GPSMissionPlannerPage() {
  const { ros, isConnected, status: globalStatus } = useROS();
  const storedWaypointStateRef = useRef(readStoredWaypointState());
  const storedCoverageStateRef = useRef(readStoredCoverageState());
  const storedNoGoStateRef = useRef(readStoredNoGoState());
  const storedOffsetLineStateRef = useRef(readStoredOffsetLineState());

  const [waypoints, setWaypoints] = useState(() => storedWaypointStateRef.current.waypoints);
  const waypointsRef = useRef(waypoints);
  const [savedRoutes, setSavedRoutes] = useState(() => readSavedGpsMissionRoutes());
  const [saveRouteDialogOpen, setSaveRouteDialogOpen] = useState(false);
  const [loadRouteDialogOpen, setLoadRouteDialogOpen] = useState(false);
  const [routeDraftName, setRouteDraftName] = useState("");
  const [routeDraftDescription, setRouteDraftDescription] = useState("");
  const [routePreviewImage, setRoutePreviewImage] = useState("");
  const [routePreviewBusy, setRoutePreviewBusy] = useState(false);
  const [routeSaveBusy, setRouteSaveBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [reachedWaypointIndexes, setReachedWaypointIndexes] = useState(
    () => new Set(storedWaypointStateRef.current.reachedIndexes)
  );
  const [activeWaitIndex, setActiveWaitIndex] = useState(null);
  const activeWaitIndexRef = useRef(null);
  const [activeWaitRemaining, setActiveWaitRemaining] = useState(0);
  const activeWaitEndRef = useRef(null);
  const activeWaitDurationRef = useRef(0);
  const [navStatus, setNavStatus] = useState("");
  const [centerOnRobot, setCenterOnRobot] = useState(false);
  const [rawGpsInfo, setRawGpsInfo] = useState(null);
  const [robotPoseInfo, setRobotPoseInfo] = useState(null);
  const [imuInfo, setImuInfo] = useState(null);
  const [gpsOdomInfo, setGpsOdomInfo] = useState(null);
  const [globalOdomInfo, setGlobalOdomInfo] = useState(null);
  const [nav2GoalInfo, setNav2GoalInfo] = useState(null);
  const [rtkInfo, setRtkInfo] = useState(null);
  const [debugPoints, setDebugPoints] = useState([]);
  const [diagLogs, setDiagLogs] = useState([]);
  const [missionNotice, setMissionNotice] = useState(null);
  const [missionStopped, setMissionStopped] = useState(false);
  const [waypointEditLocked, setWaypointEditLocked] = useState(false);
  const [showDerivedGoalMarkers, setShowDerivedGoalMarkers] = useState(false);
  const [showGlobalPlan, setShowGlobalPlan] = useState(true);
  const [showLocalPlan, setShowLocalPlan] = useState(false);
  const [globalPlanInfo, setGlobalPlanInfo] = useState(null);
  const [localPlanInfo, setLocalPlanInfo] = useState(null);
  const [coveragePlannerOpen, setCoveragePlannerOpen] = useState(() => storedCoverageStateRef.current.open);
  const [coverageDrawingEnabled, setCoverageDrawingEnabled] = useState(() => storedCoverageStateRef.current.drawingEnabled);
  const [coveragePoints, setCoveragePoints] = useState(() => storedCoverageStateRef.current.points);
  const [coverageStyle, setCoverageStyle] = useState(() => storedCoverageStateRef.current.style);
  const [coverageLineSpacing, setCoverageLineSpacing] = useState(() => storedCoverageStateRef.current.lineSpacing);
  const [coveragePointDensity, setCoveragePointDensity] = useState(() => storedCoverageStateRef.current.pointDensity);
  const [coverageNavPoseSpacing, setCoverageNavPoseSpacing] = useState(() => storedCoverageStateRef.current.navPoseSpacing);
  const [coverageSweepAngle, setCoverageSweepAngle] = useState(() => storedCoverageStateRef.current.sweepAngleDeg);
  const [coverageDiagonalAngle, setCoverageDiagonalAngle] = useState(() => storedCoverageStateRef.current.diagonalAngleDeg);
  const [coverageHeadingDeg, setCoverageHeadingDeg] = useState(() => storedCoverageStateRef.current.headingDeg);
  const [coverageCurveStrength, setCoverageCurveStrength] = useState(() => storedCoverageStateRef.current.curveStrength);
  const [coverageCircleDirection, setCoverageCircleDirection] = useState(() => storedCoverageStateRef.current.circleDirection);
  const [coverageSpiralDirection, setCoverageSpiralDirection] = useState(() => storedCoverageStateRef.current.spiralDirection);
  const [coverageSpiralRotation, setCoverageSpiralRotation] = useState(() => storedCoverageStateRef.current.spiralRotation);
  const [coverageStartRadius, setCoverageStartRadius] = useState(() => storedCoverageStateRef.current.startRadius);
  const [coverageHeadlandPasses, setCoverageHeadlandPasses] = useState(() => storedCoverageStateRef.current.headlandPasses);
  const [coverageBoundaryDirection, setCoverageBoundaryDirection] = useState(() => storedCoverageStateRef.current.boundaryDirection);
  const [coverageStartCorner, setCoverageStartCorner] = useState(() => storedCoverageStateRef.current.startCorner);
  const [coverageWaitPoints, setCoverageWaitPoints] = useState(() => storedCoverageStateRef.current.waitPoints);
  const [coverageNodeOverrides, setCoverageNodeOverrides] = useState(() => storedCoverageStateRef.current.nodeOverrides);
  const [coverageRemovedNodeLabels, setCoverageRemovedNodeLabels] = useState(() => storedCoverageStateRef.current.removedNodeLabels);
  const [coverageManualNodes, setCoverageManualNodes] = useState(() => storedCoverageStateRef.current.manualNodes);
  const [selectedCoverageNodeLabel, setSelectedCoverageNodeLabel] = useState(null);
  const [coverageAutoStart, setCoverageAutoStart] = useState(() => storedCoverageStateRef.current.autoStart);
  const [coveragePlannerTopic, setCoveragePlannerTopic] = useState(() => storedCoverageStateRef.current.topic);
  const [coveragePublishStatus, setCoveragePublishStatus] = useState("");
  const [coveragePublishError, setCoveragePublishError] = useState("");
  const [coveragePublishing, setCoveragePublishing] = useState(false);
  const [coverageStartStatus, setCoverageStartStatus] = useState("");
  const [coverageStartError, setCoverageStartError] = useState("");
  const [coverageCancelStatus, setCoverageCancelStatus] = useState("");
  const [coverageCancelError, setCoverageCancelError] = useState("");
  const [coverageCancelling, setCoverageCancelling] = useState(false);
  const [noGoPanelOpen, setNoGoPanelOpen] = useState(false);
  const [noGoDrawingEnabled, setNoGoDrawingEnabled] = useState(false);
  const [noGoZones, setNoGoZones] = useState(() => storedNoGoStateRef.current.zones);
  const [draftNoGoPoints, setDraftNoGoPoints] = useState(() => storedNoGoStateRef.current.draftPoints);
  const [selectedNoGoZoneId, setSelectedNoGoZoneId] = useState(() => storedNoGoStateRef.current.selectedZoneId);
  const [selectedNoGoVertexIndex, setSelectedNoGoVertexIndex] = useState(null);
  const [pendingNoGoZone, setPendingNoGoZone] = useState(null);
  const [pendingNoGoName, setPendingNoGoName] = useState("");
  const [draftNoGoGroupId, setDraftNoGoGroupId] = useState(() => storedNoGoStateRef.current.draftGroupId);
  const [noGoMasterEnabled, setNoGoMasterEnabled] = useState(() => storedNoGoStateRef.current.masterEnabled);
  const [noGoEdgeAck, setNoGoEdgeAck] = useState(false);
  const [noGoPublishStatus, setNoGoPublishStatus] = useState("");
  const [noGoPublishError, setNoGoPublishError] = useState("");
  const [noGoPublishing, setNoGoPublishing] = useState(false);
  const [showNoGoKeepoutBuffer, setShowNoGoKeepoutBuffer] = useState(true);
  const [noGoDebugZones, setNoGoDebugZones] = useState([]);
  const [gpsCoverageStatusInfo, setGpsCoverageStatusInfo] = useState(null);
  const [gpsCoverageDebugInfo, setGpsCoverageDebugInfo] = useState(null);
  const [gpsCoveragePathInfo, setGpsCoveragePathInfo] = useState(null);
  const [gpsCoveragePathPoints, setGpsCoveragePathPoints] = useState([]);
  const [offsetLinePanelOpen, setOffsetLinePanelOpen] = useState(() => storedOffsetLineStateRef.current.panelOpen);
  const [offsetLineDrawingEnabled, setOffsetLineDrawingEnabled] = useState(() => storedOffsetLineStateRef.current.drawingEnabled);
  const [offsetLineStart, setOffsetLineStart] = useState(() => storedOffsetLineStateRef.current.start);
  const [offsetLineEnd, setOffsetLineEnd] = useState(() => storedOffsetLineStateRef.current.end);
  const [offsetLineDistanceCm, setOffsetLineDistanceCm] = useState(() => storedOffsetLineStateRef.current.distanceCm);
  const [offsetLineSide, setOffsetLineSide] = useState(() => storedOffsetLineStateRef.current.side);
  const [offsetLineRunState, setOffsetLineRunState] = useState("IDLE");
  const [offsetLineStatusInfo, setOffsetLineStatusInfo] = useState(null);
  const [offsetLineDebugInfo, setOffsetLineDebugInfo] = useState(null);
  const [offsetLinePathPointCount, setOffsetLinePathPointCount] = useState(0);
  const [offsetLineError, setOffsetLineError] = useState("");
  const [gpsFrameDebugInfo, setGpsFrameDebugInfo] = useState(null);
  const [fromLLWarning, setFromLLWarning] = useState(null);
  const [tableHeight, setTableHeight] = useState(300);
  const [actionPanelWidth, setActionPanelWidth] = useState(360);
  const [activeBaseLayer, setActiveBaseLayer] = useState("satellite");
  const [orthoTilesLoaded, setOrthoTilesLoaded] = useState(false);
  const [compassHeadingInput, setCompassHeadingInput] = useState("");
  const [lastCompassHeadingDeg, setLastCompassHeadingDeg] = useState(null);
  const [showBaseLinkXAxisArrow, setShowBaseLinkXAxisArrow] = useState(true);
  const [showUiHeadingArrow, setShowUiHeadingArrow] = useState(true);
  const [showRosMapXAxisArrow, setShowRosMapXAxisArrow] = useState(true);
  const [showRosMapYAxisArrow, setShowRosMapYAxisArrow] = useState(true);

  const setNoGoPanelOpenExclusive = useCallback(nextValue => {
    const resolved = typeof nextValue === "function" ? nextValue(noGoPanelOpen) : nextValue;
    const nextOpen = Boolean(resolved);
    if (nextOpen) {
      setOffsetLinePanelOpen(false);
      setCoveragePlannerOpen(false);
    }
    setNoGoPanelOpen(nextOpen);
  }, [coveragePlannerOpen, noGoPanelOpen, offsetLinePanelOpen]);

  const setOffsetLinePanelOpenExclusive = useCallback(nextValue => {
    const resolved = typeof nextValue === "function" ? nextValue(offsetLinePanelOpen) : nextValue;
    const nextOpen = Boolean(resolved);
    if (nextOpen) {
      setNoGoPanelOpen(false);
      setCoveragePlannerOpen(false);
    }
    setOffsetLinePanelOpen(nextOpen);
  }, [coveragePlannerOpen, noGoPanelOpen, offsetLinePanelOpen]);

  const setCoveragePlannerOpenExclusive = useCallback(nextValue => {
    const resolved = typeof nextValue === "function" ? nextValue(coveragePlannerOpen) : nextValue;
    const nextOpen = Boolean(resolved);
    if (nextOpen) {
      setNoGoPanelOpen(false);
      setOffsetLinePanelOpen(false);
    }
    setCoveragePlannerOpen(nextOpen);
  }, [coveragePlannerOpen, noGoPanelOpen, offsetLinePanelOpen]);

  const layoutRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const activeBaseLayerRef = useRef("satellite");

  const wpMarkersRef = useRef([]);
  const waypointEdgeMarkersRef = useRef([]);
  const reachedWaypointIndexesRef = useRef(new Set(storedWaypointStateRef.current.reachedIndexes));
  const waypointCountRef = useRef(0);
  const routePolylineRef = useRef(null);
  const pendingRouteFitBoundsRef = useRef(null);
  const globalPlanPolylineRef = useRef(null);
  const localPlanPolylineRef = useRef(null);
  const tableResizeRef = useRef(false);
  const actionPanelResizeRef = useRef(false);
  const clientIdRef = useRef(`gmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const uiStatePublisherRef = useRef(null);
  const uiStateSubRef = useRef(null);
  const applyingRemoteStateRef = useRef(false);

  const robotMarkerRef = useRef(null);
  const fieldPointMarkersRef = useRef([]);
  const robotHeadingRef = useRef(null);
  const tfPoseMarkerRef = useRef(null);
  const nav2GoalMarkerRef = useRef(null);
  const rosHeadingLineRef = useRef(null);
  const rosHeadingArrowRef = useRef(null);
  const uiHeadingLineRef = useRef(null);
  const uiHeadingArrowRef = useRef(null);
  const rosMapXAxisLineRef = useRef(null);
  const rosMapXAxisArrowRef = useRef(null);
  const rosMapYAxisLineRef = useRef(null);
  const rosMapYAxisArrowRef = useRef(null);
  const showBaseLinkXAxisArrowRef = useRef(true);
  const showUiHeadingArrowRef = useRef(true);
  const showRosMapXAxisArrowRef = useRef(true);
  const showRosMapYAxisArrowRef = useRef(true);
  const robotLatLonRef = useRef(null);
  const robotYawRef = useRef(0);
  const robotMarkerHeadingOffsetRadRef = useRef(0);
  const projectionHeadingOffsetRadRef = useRef(NAVSAT_MAP_TO_ENU_OFFSET_RAD);
  const robotPoseRef = useRef(null);
  const gpsOdomRef = useRef(null);
  const globalOdomRef = useRef(null);
  const nav2GoalRef = useRef(null);
  const debugPointsRef = useRef([]);
  const gpsFrameDebugRef = useRef(null);
  const imuYawRef = useRef(null);
  const imuInfoRef = useRef(null);
  const tfCacheRef = useRef({});
  const waypointEditLockedRef = useRef(false);
  const showDerivedGoalMarkersRef = useRef(false);
  const showGlobalPlanRef = useRef(true);
  const showLocalPlanRef = useRef(false);
  const globalPlanRef = useRef([]);
  const localPlanRef = useRef([]);
  const coverageDrawingEnabledRef = useRef(false);
  const coveragePointMarkersRef = useRef([]);
  const coveragePolygonRef = useRef(null);
  const coverageSweepLineRef = useRef(null);
  const coverageGeneratedMarkersRef = useRef([]);
  const suppressMapClickUntilRef = useRef(0);
  const noGoDrawingEnabledRef = useRef(false);
  const noGoZonesRef = useRef([]);
  const draftNoGoPointsRef = useRef([]);
  const selectedNoGoZoneIdRef = useRef(null);
  const noGoLayerRefs = useRef({ polygons: {}, keepouts: [], vertices: [], edges: [], draft: null, draftVertices: [] });

  const offsetLineDrawingEnabledRef = useRef(false);
  const offsetLineStartRef = useRef(null);
  const offsetLineEndRef = useRef(null);
  const offsetLineSideRef = useRef("left");
  const offsetLineRunStateRef = useRef("IDLE");
  const offsetLinePathRef = useRef([]);
  const offsetLineTrailRef = useRef([]);
  const showOffsetLineRef = useRef(true);
  const offsetReferencePolylineRef = useRef(null);
  const offsetLinePolylineRef = useRef(null);
  const offsetTrailPolylineRef = useRef(null);
  const offsetLineMarkersRef = useRef([]);

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
  const noGoDebugSubRef = useRef(null);
  const gpsOdomSubRef = useRef(null);
  const globalOdomSubRef = useRef(null);
  const nav2GoalSubRef = useRef(null);
  const globalPlanSubRef = useRef(null);
  const localPlanSubRef = useRef(null);
  const rtkSubRef = useRef(null);
  const rtkStatusSubRef = useRef(null);
  const rtkRosoutSubRef = useRef(null);
  const gpsCoverageStatusSubRef = useRef(null);
  const gpsCoverageDebugSubRef = useRef(null);
  const gpsCoveragePathSubRef = useRef(null);
  const gpsFrameDebugSubRef = useRef(null);
  const offsetLineStatusSubRef = useRef(null);
  const offsetLineDebugSubRef = useRef(null);
  const offsetLinePathSubRef = useRef(null);
  const offsetLineRequestPubRef = useRef(null);

  const centerRef = useRef(false);

  const suppressMapClicksFor = useCallback((ms = 250) => {
    suppressMapClickUntilRef.current = Date.now() + ms;
  }, []);

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

  const ensureUiStatePublisher = useCallback(() => {
    if (uiStatePublisherRef.current) return uiStatePublisherRef.current;
    if (!ros || !isConnected) return null;

    const pub = new ROSLIB.Topic({
      ros,
      name: UI_STATE_TOPIC,
      messageType: "std_msgs/msg/String",
      queue_size: 1
    });

    pub.advertise();
    uiStatePublisherRef.current = pub;

    return pub;
  }, [ros, isConnected]);

  const publishUiState = useCallback((partialState) => {
    if (applyingRemoteStateRef.current) return;

    const pub = ensureUiStatePublisher();
    if (!pub) return;

    pub.publish({
      data: JSON.stringify({
        source: clientIdRef.current,
        ts: Date.now(),
        ...partialState
      })
    });
  }, [ensureUiStatePublisher]);

  const currentCoverageState = useMemo(() => ({
    open: coveragePlannerOpen,
    drawingEnabled: coverageDrawingEnabled,
    points: coveragePoints,
    style: coverageStyle,
    lineSpacing: coverageLineSpacing,
    pointDensity: coveragePointDensity,
    navPoseSpacing: coverageNavPoseSpacing,
    sweepAngleDeg: coverageSweepAngle,
    diagonalAngleDeg: coverageDiagonalAngle,
    headingDeg: coverageHeadingDeg,
    curveStrength: coverageCurveStrength,
    circleDirection: coverageCircleDirection,
    spiralDirection: coverageSpiralDirection,
    spiralRotation: coverageSpiralRotation,
    startRadius: coverageStartRadius,
    headlandPasses: coverageHeadlandPasses,
    boundaryDirection: coverageBoundaryDirection,
    startCorner: coverageStartCorner,
    waitPoints: coverageWaitPoints,
    nodeOverrides: coverageNodeOverrides,
    removedNodeLabels: coverageRemovedNodeLabels,
    manualNodes: coverageManualNodes,
    autoStart: coverageAutoStart,
    topic: coveragePlannerTopic,
  }), [
    coveragePlannerOpen,
    coverageDrawingEnabled,
    coveragePoints,
    coverageStyle,
    coverageLineSpacing,
    coveragePointDensity,
    coverageNavPoseSpacing,
    coverageSweepAngle,
    coverageDiagonalAngle,
    coverageHeadingDeg,
    coverageCurveStrength,
    coverageCircleDirection,
    coverageSpiralDirection,
    coverageSpiralRotation,
    coverageStartRadius,
    coverageHeadlandPasses,
    coverageBoundaryDirection,
    coverageStartCorner,
    coverageWaitPoints,
    coverageNodeOverrides,
    coverageRemovedNodeLabels,
    coverageManualNodes,
    coverageAutoStart,
    coveragePlannerTopic,
  ]);

  useEffect(() => {
    storageSet(GPS_COVERAGE_STORAGE_KEY, JSON.stringify(currentCoverageState));
    publishUiState({ coverage: currentCoverageState });
  }, [currentCoverageState, publishUiState]);

  useEffect(() => {
    noGoDrawingEnabledRef.current = noGoDrawingEnabled;
  }, [noGoDrawingEnabled]);

  useEffect(() => {
    noGoZonesRef.current = noGoZones;
  }, [noGoZones]);

  useEffect(() => {
    draftNoGoPointsRef.current = draftNoGoPoints;
  }, [draftNoGoPoints]);

  useEffect(() => {
    selectedNoGoZoneIdRef.current = selectedNoGoZoneId;
  }, [selectedNoGoZoneId]);

  useEffect(() => {
    storageSet(GPS_NO_GO_STORAGE_KEY, JSON.stringify({
      zones: noGoZones,
      draftPoints: draftNoGoPoints,
      selectedZoneId: selectedNoGoZoneId,
      masterEnabled: noGoMasterEnabled,
      draftGroupId: draftNoGoGroupId,
    }));
  }, [draftNoGoGroupId, draftNoGoPoints, noGoMasterEnabled, noGoZones, selectedNoGoZoneId]);

  useEffect(() => {
    offsetLineDrawingEnabledRef.current = offsetLineDrawingEnabled;
  }, [offsetLineDrawingEnabled]);

  useEffect(() => {
    offsetLineStartRef.current = offsetLineStart;
  }, [offsetLineStart]);

  useEffect(() => {
    offsetLineEndRef.current = offsetLineEnd;
  }, [offsetLineEnd]);

  useEffect(() => {
    offsetLineSideRef.current = offsetLineSide;
  }, [offsetLineSide]);

  useEffect(() => {
    offsetLineRunStateRef.current = offsetLineRunState;
  }, [offsetLineRunState]);

  useEffect(() => {
    storageSet(GPS_OFFSET_LINE_STORAGE_KEY, JSON.stringify({
      panelOpen: offsetLinePanelOpen,
      drawingEnabled: offsetLineDrawingEnabled,
      start: offsetLineStart,
      end: offsetLineEnd,
      distanceCm: offsetLineDistanceCm,
      side: offsetLineSide,
    }));
  }, [offsetLinePanelOpen, offsetLineDrawingEnabled, offsetLineStart, offsetLineEnd, offsetLineDistanceCm, offsetLineSide]);

  useEffect(() => {
    const validReachedIndexes = [...reachedWaypointIndexes]
      .filter(index => Number.isInteger(index) && index >= 0 && index < waypoints.length);

    storageSet(WAYPOINTS_STORAGE_KEY, JSON.stringify({
      waypoints: waypoints.map(wp => ({
        lat: wp.lat,
        lng: wp.lng,
        ...(Number.isFinite(wp.altitude) ? { altitude: wp.altitude } : {}),
        speed: waypointSpeedText(wp.speed),
        mode: waypointModeValue(wp.mode),
        ...(waypointWaitSecondsValue(wp.waitSeconds) ? { waitSeconds: waypointWaitSecondsValue(wp.waitSeconds) } : {})
      })),
      reachedWaypointIndexes: validReachedIndexes
    }));
  }, [waypoints, reachedWaypointIndexes]);

  useEffect(() => {
    centerRef.current = centerOnRobot;
  }, [centerOnRobot]);

  useEffect(() => {
    if (!ros || !isConnected) return;

    try {
      uiStateSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: UI_STATE_TOPIC,
        messageType: "std_msgs/msg/String",
        queue_length: 1,
        throttle_rate: 50
      });

      uiStateSubRef.current = sub;

      sub.subscribe(msg => {
        let payload;

        try {
          payload = JSON.parse(msg.data);
        } catch {
          return;
        }

        if (!payload || payload.source === clientIdRef.current) return;

        applyingRemoteStateRef.current = true;

        try {
	          if (Array.isArray(payload.waypoints)) {
	            setWaypoints(normalizeStoredWaypoints(payload.waypoints));
	          }

	          if (payload.coverage) {
	            const nextCoverage = normalizeCoverageState(payload.coverage);
	            setCoveragePlannerOpen(nextCoverage.open);
	            setCoverageDrawingEnabled(nextCoverage.drawingEnabled);
	            setCoveragePoints(nextCoverage.points);
	            setCoverageStyle(nextCoverage.style);
	            setCoverageLineSpacing(nextCoverage.lineSpacing);
	            setCoveragePointDensity(nextCoverage.pointDensity);
	            setCoverageNavPoseSpacing(nextCoverage.navPoseSpacing);
	            setCoverageSweepAngle(nextCoverage.sweepAngleDeg);
	            setCoverageDiagonalAngle(nextCoverage.diagonalAngleDeg);
	            setCoverageHeadingDeg(nextCoverage.headingDeg);
	            setCoverageCurveStrength(nextCoverage.curveStrength);
	            setCoverageCircleDirection(nextCoverage.circleDirection);
	            setCoverageSpiralDirection(nextCoverage.spiralDirection);
	            setCoverageSpiralRotation(nextCoverage.spiralRotation);
	            setCoverageStartRadius(nextCoverage.startRadius);
	            setCoverageHeadlandPasses(nextCoverage.headlandPasses);
	            setCoverageBoundaryDirection(nextCoverage.boundaryDirection);
	            setCoverageStartCorner(nextCoverage.startCorner);
	            setCoverageWaitPoints(nextCoverage.waitPoints);
	            setCoverageNodeOverrides(nextCoverage.nodeOverrides);
	            setCoverageRemovedNodeLabels(nextCoverage.removedNodeLabels);
	            setCoverageManualNodes(nextCoverage.manualNodes);
	            setCoverageAutoStart(nextCoverage.autoStart);
	            setCoveragePlannerTopic(nextCoverage.topic);
	          }

	          if (payload.clearDebug) {
            showDerivedGoalMarkersRef.current = false;
            setShowDerivedGoalMarkers(false);
            setDebugPoints([]);
            debugPointsRef.current = [];
            convertedMarkersRef.current.forEach(m => m.remove());
            convertedMarkersRef.current = [];
            tfPoseMarkerRef.current?.remove();
            tfPoseMarkerRef.current = null;
            waypointsRef.current = [];
            nav2GoalRef.current = null;
            setNav2GoalInfo(null);
            nav2GoalMarkerRef.current?.remove();
            nav2GoalMarkerRef.current = null;
            routePolylineRef.current?.setLatLngs([]);
            globalPlanRef.current = [];
            localPlanRef.current = [];
            setGlobalPlanInfo(null);
            setLocalPlanInfo(null);
            globalPlanPolylineRef.current?.setLatLngs([]);
            localPlanPolylineRef.current?.setLatLngs([]);
          }

          if (typeof payload.centerOnRobot === "boolean") {
            setCenterOnRobot(payload.centerOnRobot);
          }

          if (typeof payload.missionStopped === "boolean") {
            setMissionStopped(payload.missionStopped);
          }

          if (payload.notice?.text) {
            showMissionNotice(payload.notice.text, payload.notice.level);
          }

          if (payload.log?.text) {
            addLog(payload.log.level || "sync", payload.log.text);
          }
        } finally {
          window.setTimeout(() => {
            applyingRemoteStateRef.current = false;
          }, 0);
        }
      });
    } catch {
      // UI state sync is optional; the page still works without this topic.
    }

    return () => {
      try { uiStateSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      uiStateSubRef.current = null;
    };
  }, [ros, isConnected, addLog, showMissionNotice]);

  useEffect(() => {
    waypointCountRef.current = waypoints.length;
    setReachedWaypointIndexes(prev => {
      const next = new Set([...prev].filter(index => index < waypoints.length));
      reachedWaypointIndexesRef.current = next;
      return next;
    });
  }, [waypoints.length]);

  useEffect(() => {
    reachedWaypointIndexesRef.current = reachedWaypointIndexes;
  }, [reachedWaypointIndexes]);

  useEffect(() => {
    waypointsRef.current = waypoints;
  }, [waypoints]);

  useEffect(() => {
    waypointEditLockedRef.current = waypointEditLocked;
  }, [waypointEditLocked]);

  useEffect(() => {
    debugPointsRef.current = debugPoints;
  }, [debugPoints]);

  const clearWaitCountdown = useCallback(() => {
    activeWaitEndRef.current = null;
    activeWaitDurationRef.current = 0;
    activeWaitIndexRef.current = null;
    setActiveWaitIndex(null);
    setActiveWaitRemaining(0);
  }, []);

  const startWaitCountdown = useCallback((index, seconds) => {
    activeWaitEndRef.current = Date.now() + seconds * 1000;
    activeWaitDurationRef.current = seconds;
    activeWaitIndexRef.current = index;
    setActiveWaitIndex(index);
    setActiveWaitRemaining(seconds);
  }, []);

  useEffect(() => {
    if (activeWaitIndex === null) return undefined;

    const id = setInterval(() => {
      const endAt = activeWaitEndRef.current;
      if (!endAt) return;

      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setActiveWaitRemaining(remaining);
      if (remaining <= 0) clearWaitCountdown();
    }, 250);

    return () => clearInterval(id);
  }, [activeWaitIndex, clearWaitCountdown]);

  const markWaypointReached = useCallback((waypointNumber) => {
    const count = waypointCountRef.current;
    if (count <= 0) return null;

    let index = waypointNumber !== null && waypointNumber !== undefined
      ? normalizeWaypointNumber(waypointNumber) - 1
      : null;

    if (index === null || index < 0 || index >= count) {
      index = [...Array(count).keys()].find(i => !reachedWaypointIndexesRef.current.has(i));
    }

    if (index === undefined || index === null || index < 0 || index >= count) return null;

    setReachedWaypointIndexes(prev => {
      if (prev.has(index)) return prev;

      const next = new Set(prev);
      next.add(index);
      reachedWaypointIndexesRef.current = next;
      return next;
    });

    return index + 1;
  }, []);

  useEffect(() => {
    imuInfoRef.current = imuInfo;
  }, [imuInfo]);

  useEffect(() => {
    coverageDrawingEnabledRef.current = coverageDrawingEnabled;
  }, [coverageDrawingEnabled]);


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

  const fitMapToWaypoints = useCallback(points => {
    const map = mapRef.current;
    if (!map || !Array.isArray(points) || points.length === 0) return;

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 19));
      return;
    }

    const bounds = L.latLngBounds(points.map(point => [point.lat, point.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 20 });
    }
  }, []);

  const applySavedRouteToPlanner = useCallback((route, sourceLabel = "kayit") => {
    const nextWaypoints = normalizeStoredWaypoints(route?.waypoints);
    if (nextWaypoints.length === 0) {
      showMissionNotice("Seçilen kayıtlı rota boş veya geçersiz", "warn");
      return false;
    }

    pendingRouteFitBoundsRef.current = nextWaypoints;
    reachedWaypointIndexesRef.current = new Set();
    setReachedWaypointIndexes(new Set());
    setMissionStopped(false);
    setWaypointEditLocked(false);
    clearWaitCountdown();
    setWaypoints(nextWaypoints);

    const noticeText = `Kayıtlı rota açıldı: ${route.name}`;
    const logText = `${sourceLabel} üzerinden rota açıldı: ${route.name} (${nextWaypoints.length} waypoint)`;
    addLog("info", logText);
    showMissionNotice(noticeText, "active");
    publishUiState({
      waypoints: nextWaypoints,
      missionStopped: false,
      notice: { text: noticeText, level: "active" },
      log: { level: "info", text: logText }
    });
    return true;
  }, [addLog, clearWaitCountdown, publishUiState, showMissionNotice]);

  const openSaveRouteDialog = useCallback(() => {
    if (waypoints.length === 0) {
      showMissionNotice("Kaydetmek için önce waypoint rotası oluştur", "warn");
      return;
    }
    setRouteDraftName("");
    setRouteDraftDescription("");
    setRoutePreviewImage("");
    setSaveRouteDialogOpen(true);
  }, [showMissionNotice, waypoints.length]);

  const captureCurrentWaypointViewportPreview = useCallback(async (routeName = "") => {
    const map = mapRef.current;
    const container = map?.getContainer?.();
    if (!map || !container || waypoints.length === 0) return "";

    const containerWidth = container.clientWidth || 0;
    const containerHeight = container.clientHeight || 0;
    if (containerWidth <= 0 || containerHeight <= 0) return "";

    const targetWidth = 320;
    const targetHeight = 180;
    const targetRatio = targetWidth / targetHeight;
    const containerPoints = waypoints.map(point => map.latLngToContainerPoint([point.lat, point.lng]));
    const markerPad = 26;
    let minX = Math.min(...containerPoints.map(point => point.x)) - markerPad;
    let maxX = Math.max(...containerPoints.map(point => point.x)) + markerPad;
    let minY = Math.min(...containerPoints.map(point => point.y)) - markerPad;
    let maxY = Math.max(...containerPoints.map(point => point.y)) + markerPad;

    minX = Math.max(0, minX);
    minY = Math.max(0, minY);
    maxX = Math.min(containerWidth, maxX);
    maxY = Math.min(containerHeight, maxY);

    let cropWidth = Math.max(80, maxX - minX);
    let cropHeight = Math.max(80, maxY - minY);
    const currentRatio = cropWidth / cropHeight;

    if (currentRatio > targetRatio) {
      const desiredHeight = cropWidth / targetRatio;
      const extra = (desiredHeight - cropHeight) / 2;
      minY = Math.max(0, minY - extra);
      maxY = Math.min(containerHeight, maxY + extra);
    } else {
      const desiredWidth = cropHeight * targetRatio;
      const extra = (desiredWidth - cropWidth) / 2;
      minX = Math.max(0, minX - extra);
      maxX = Math.min(containerWidth, maxX + extra);
    }

    cropWidth = Math.max(80, maxX - minX);
    cropHeight = Math.max(80, maxY - minY);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const containerRect = container.getBoundingClientRect();

    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    const scaleX = targetWidth / cropWidth;
    const scaleY = targetHeight / cropHeight;
    const drawDomImage = (image, x, y, width, height) => {
      try {
        if (!image || width <= 0 || height <= 0) return;
        ctx.drawImage(image, x, y, width, height);
      } catch {
        // best-effort preview drawing
      }
    };

    const toCropRect = rect => ({
      x: (rect.left - minX) * scaleX,
      y: (rect.top - minY) * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY
    });

    const tileImages = [...container.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")];
    tileImages.forEach(image => {
      if (!image.complete || image.naturalWidth <= 0) return;
      const imageRect = image.getBoundingClientRect();
      const rect = {
        left: imageRect.left - containerRect.left,
        top: imageRect.top - containerRect.top,
        width: imageRect.width,
        height: imageRect.height
      };
      const drawRect = toCropRect(rect);
      drawDomImage(image, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    });

    ctx.strokeStyle = "#f7ff00";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    containerPoints.forEach((point, index) => {
      const x = (point.x - minX) * scaleX;
      const y = (point.y - minY) * scaleY;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const markerImages = [...container.querySelectorAll(".leaflet-marker-pane img.leaflet-marker-icon")];
    markerImages.forEach(image => {
      if (!image.complete || image.naturalWidth <= 0) return;
      const imageRect = image.getBoundingClientRect();
      const rect = {
        left: imageRect.left - containerRect.left,
        top: imageRect.top - containerRect.top,
        width: imageRect.width,
        height: imageRect.height
      };
      const drawRect = toCropRect(rect);
      drawDomImage(image, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    });

    ctx.fillStyle = "rgba(2,6,23,.72)";
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1;
    const previewTitle = routeName.trim() || "Rota Önizleme";
    const titleWidth = Math.min(240, 90 + previewTitle.length * 4);
    ctx.beginPath();
    ctx.roundRect(14, 14, titleWidth, 28, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 13px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(previewTitle, 24, 28);

    return canvas.toDataURL("image/png");
  }, [waypoints]);

  const buildRoutePreviewImage = useCallback(async (routeName = "") => {
    const previewName = routeName.trim() || "Rota Önizleme";
    try {
      const currentViewImage = await captureCurrentWaypointViewportPreview(previewName);
      if (currentViewImage) return currentViewImage;
    } catch {
      // fallback below
    }

    try {
      return await createGpsRouteTilePreviewImage({
        waypoints,
        routeName: previewName,
        tileBases: [ORTHO_TILE_BASE, OFFLINE_TILE_BASE],
        tileExtensions: OFFLINE_TILE_EXTENSIONS,
        zoom: 20
      });
    } catch {
      return createGpsRoutePreviewImage(waypoints, previewName);
    }
  }, [captureCurrentWaypointViewportPreview, waypoints]);

  const handleSaveCurrentRoute = useCallback(async () => {
    const name = routeDraftName.trim();
    if (!name) {
      showMissionNotice("Rota adı zorunlu", "warn");
      return;
    }

    setRouteSaveBusy(true);
    const previewImage = routePreviewImage || await buildRoutePreviewImage(name);

    const savedRoute = saveGpsMissionRoute({
      name,
      description: routeDraftDescription.trim(),
      waypoints,
      previewImage
    });

    if (!savedRoute) {
      setRouteSaveBusy(false);
      showMissionNotice("Rota kaydedilemedi", "danger");
      return;
    }

    setSavedRoutes(readSavedGpsMissionRoutes());
    setSaveRouteDialogOpen(false);
    setRouteDraftName("");
    setRouteDraftDescription("");
    setRoutePreviewImage("");
    setRouteSaveBusy(false);
    addLog("info", `GPS rota kaydedildi: ${savedRoute.name}`);
    showMissionNotice(`Rota kaydedildi: ${savedRoute.name}`, "success");
  }, [addLog, buildRoutePreviewImage, routeDraftDescription, routeDraftName, routePreviewImage, showMissionNotice, waypoints]);

  const handleLoadSavedRoute = useCallback(route => {
    if (applySavedRouteToPlanner(route, "kayitli rota")) {
      setLoadRouteDialogOpen(false);
    }
  }, [applySavedRouteToPlanner]);

  const handleDeleteSavedRoute = useCallback(route => {
    if (!route?.id) return;
    deleteSavedGpsMissionRoute(route.id);
    setSavedRoutes(readSavedGpsMissionRoutes());
    addLog("info", `Kayıtlı rota silindi: ${route.name}`);
    showMissionNotice(`Kayıtlı rota silindi: ${route.name}`, "muted");
  }, [addLog, showMissionNotice]);

  const replaceRouteWithSingleWaypoint = useCallback(point => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;

    const nextWaypoint = {
      lat: point.lat,
      lng: point.lng,
      speed: waypointSpeedText(DEFAULT_WAYPOINT_SPEED_MULTIPLIER),
      mode: "pass"
    };
    const noticeText = `Eski rota silindi. Yeni rota WP 1 ile başlatıldı`;
    const logText = `Tamamlanan rota silindi, yeni WP 1 eklendi lat=${point.lat.toFixed(7)} lon=${point.lng.toFixed(7)}`;

    setMissionStopped(false);
    setWaypointEditLocked(false);
    clearWaitCountdown();
    reachedWaypointIndexesRef.current = new Set();
    setReachedWaypointIndexes(new Set());
    globalPlanRef.current = [];
    localPlanRef.current = [];
    setGlobalPlanInfo(null);
    setLocalPlanInfo(null);
    globalPlanPolylineRef.current?.setLatLngs([]);
    localPlanPolylineRef.current?.setLatLngs([]);

    setWaypoints([nextWaypoint]);
    publishUiState({
      waypoints: [nextWaypoint],
      missionStopped: false,
      notice: { text: noticeText, level: "active" },
      log: { level: "info", text: logText }
    });
    addLog("info", logText);
    showMissionNotice(noticeText, "active");
  }, [addLog, clearWaitCountdown, publishUiState, showMissionNotice]);

  const openConfirmDialog = useCallback(({
    title = "Onay Gerekli",
    message = "",
    confirmLabel = "Onayla",
    cancelLabel = "Vazgeç",
    accent = "#ef4444",
    onConfirm = null,
    onCancel = null
  }) => {
    setConfirmDialog({
      title,
      message,
      confirmLabel,
      cancelLabel,
      accent,
      onConfirm,
      onCancel
    });
  }, []);

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog(prev => {
      if (prev?.onCancel) prev.onCancel();
      return null;
    });
  }, []);

  const submitConfirmDialog = useCallback(() => {
    if (!confirmDialog?.onConfirm) {
      setConfirmDialog(null);
      return;
    }
    const action = confirmDialog.onConfirm;
    setConfirmDialog(null);
    action();
  }, [confirmDialog]);

  useEffect(() => {
    if (!saveRouteDialogOpen || waypoints.length === 0) {
      setRoutePreviewBusy(false);
      return undefined;
    }

    let cancelled = false;
    setRoutePreviewBusy(true);

    buildRoutePreviewImage(routeDraftName).then(image => {
      if (cancelled) return;
      setRoutePreviewImage(image);
      setRoutePreviewBusy(false);
    });

    return () => {
      cancelled = true;
    };
  }, [buildRoutePreviewImage, routeDraftName, saveRouteDialogOpen, waypoints.length]);

  useEffect(() => {
    const syncSavedRoutes = () => setSavedRoutes(readSavedGpsMissionRoutes());
    syncSavedRoutes();
    window.addEventListener(gpsMissionRoutesChangedEventName(), syncSavedRoutes);
    return () => window.removeEventListener(gpsMissionRoutesChangedEventName(), syncSavedRoutes);
  }, []);

  useEffect(() => {
    const queuedRoute = consumeQueuedGpsMissionRouteOpen();
    if (!queuedRoute) return;
    if (queuedRoute.kind === "saved") {
      const route = getSavedGpsMissionRoute(queuedRoute.routeId);
      if (!route) return;
      applySavedRouteToPlanner(route, "Task Manager");
      return;
    }
    if (queuedRoute.kind === "draft" && queuedRoute.route) {
      applySavedRouteToPlanner(queuedRoute.route, "Task Manager sıra");
    }
  }, [applySavedRouteToPlanner]);

  useEffect(() => {
    if (!pendingRouteFitBoundsRef.current || waypoints.length === 0) return;
    const routePoints = pendingRouteFitBoundsRef.current;
    pendingRouteFitBoundsRef.current = null;
    window.requestAnimationFrame(() => fitMapToWaypoints(routePoints));
  }, [fitMapToWaypoints, waypoints]);

  const insertWaypointAt = useCallback((insertIndex, point) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    if (waypointEditLockedRef.current) {
      showMissionNotice("Action Start sonrası waypoint düzenleme kilitli", "warn");
      return;
    }

    suppressMapClicksFor();

    const insertedWaypoint = {
      lat: point.lat,
      lng: point.lng,
      speed: waypointSpeedText(DEFAULT_WAYPOINT_SPEED_MULTIPLIER),
      mode: "pass"
    };
    const noticeText = `${insertIndex + 1} numaralı waypoint araya eklendi`;
    const logText = `WP ${insertIndex + 1} araya eklendi lat=${point.lat.toFixed(7)} lon=${point.lng.toFixed(7)}`;

    setWaypoints(prev => {
      const safeIndex = Math.max(0, Math.min(insertIndex, prev.length));
      const nextWaypoints = [...prev];
      nextWaypoints.splice(safeIndex, 0, insertedWaypoint);

      setReachedWaypointIndexes(prevReached => {
        const nextReached = shiftReachedIndexesForInsert(prevReached, safeIndex);
        reachedWaypointIndexesRef.current = nextReached;
        return nextReached;
      });

      publishUiState({
        waypoints: nextWaypoints,
        notice: { text: noticeText, level: "active" },
        log: { level: "info", text: logText }
      });

      return nextWaypoints;
    });

    addLog("info", logText);
    showMissionNotice(noticeText, "active");
  }, [addLog, publishUiState, showMissionNotice, suppressMapClicksFor]);

  const updateWaypointPosition = useCallback((waypointIndex, point) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    if (waypointEditLockedRef.current) {
      showMissionNotice("Action Start sonrası waypoint taşıma kilitli", "warn");
      return;
    }

    suppressMapClicksFor();

    const noticeText = `WP ${waypointIndex + 1} taşındı`;
    const logText = `WP ${waypointIndex + 1} taşındı lat=${point.lat.toFixed(7)} lon=${point.lng.toFixed(7)}`;

    setWaypoints(prev => {
      if (waypointIndex < 0 || waypointIndex >= prev.length) return prev;

      const nextWaypoints = prev.map((wp, index) => (
        index === waypointIndex
          ? { ...wp, lat: point.lat, lng: point.lng }
          : wp
      ));

      publishUiState({
        waypoints: nextWaypoints,
        notice: { text: noticeText, level: "active" },
        log: { level: "info", text: logText }
      });

      return nextWaypoints;
    });

    addLog("info", logText);
    showMissionNotice(noticeText, "active");
  }, [addLog, publishUiState, showMissionNotice, suppressMapClicksFor]);

  useEffect(() => {
    const onMove = e => {
      if (!layoutRef.current) return;

      const rect = layoutRef.current.getBoundingClientRect();

      if (tableResizeRef.current) {
        const nextHeight = Math.round(rect.bottom - e.clientY);
        setTableHeight(Math.max(190, Math.min(480, nextHeight)));
      }

      if (actionPanelResizeRef.current) {
        const maxWidth = Math.max(320, rect.width - 520);
        const nextWidth = Math.round(rect.right - e.clientX);

        setActionPanelWidth(Math.max(300, Math.min(maxWidth, nextWidth)));
      }
    };

    const onUp = () => {
      tableResizeRef.current = false;
      actionPanelResizeRef.current = false;
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

  useEffect(() => {
    window.requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
    });
  }, [actionPanelWidth, tableHeight]);

  // ── Leaflet harita ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const nativeZoom = getSatelliteNativeZoom();
    const map = L.map(mapDivRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: nativeZoom,
      minZoom: 15,
      maxZoom: 24,
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: false,
      markerZoomAnimation: false
    });

    const initialBaseLayer = storageGet(GPS_BASE_LAYER_STORAGE_KEY) === "orthophoto" ? "orthophoto" : "satellite";
    const satelliteLayer = new OfflineTileLayer(null, {
      attribution: tileAttribution(),
      maxZoom: 24,
      maxNativeZoom: nativeZoom,
      minNativeZoom: nativeZoom,
      updateWhenIdle: false,
      keepBuffer: 4
    });

    const orthoLayer = L.tileLayer(`${ORTHO_TILE_BASE}/{z}/{x}/{y}.png`, {
      minZoom: 16,
      maxZoom: 24,
      maxNativeZoom: 22,
      tms: true,
      attribution: "Local Ortho",
      keepBuffer: 4
    });

    orthoLayer.on("tileload", () => {
      setOrthoTilesLoaded(true);
    });
    orthoLayer.on("tileerror", () => {
      setOrthoTilesLoaded(false);
    });

    const refreshTiles = (nextLayer = activeBaseLayerRef.current) => {
      map.invalidateSize();

      if (nextLayer === "orthophoto") {
        setOrthoTilesLoaded(false);
        orthoLayer.setUrl(`${ORTHO_TILE_BASE}/{z}/{x}/{y}.png?refresh=${Date.now()}`);
        orthoLayer.redraw();
        setOrthoStartView(map);
      } else {
        const robotLatLon = robotLatLonRef.current;
        map.setView(
          robotLatLon ? [robotLatLon.lat, robotLatLon.lng] : DEFAULT_MAP_CENTER,
          Math.max(map.getZoom(), nativeZoom)
        );
        satelliteLayer.redraw();
      }

      window.setTimeout(() => {
        map.invalidateSize();
        if (nextLayer === "orthophoto") orthoLayer.redraw();
        else satelliteLayer.redraw();
      }, 80);
    };

    const layerControl = L.control.layers(
      {
        "Uydu": satelliteLayer,
        "Ortofoto": orthoLayer
      },
      null,
      {
        position: "topleft",
        collapsed: false
      }
    ).addTo(map);
    layerControl.getContainer()?.classList.add("gmp-layer-control");

    const refreshControl = L.control({ position: "topleft" });
    refreshControl.onAdd = () => {
      const container = L.DomUtil.create("div", "gmp-tile-refresh-control leaflet-bar");
      const refreshButton = L.DomUtil.create("button", "", container);
      refreshButton.type = "button";
      refreshButton.textContent = "Tile Yenile";
      refreshButton.title = "Aktif harita tile katmanını yeniden yükle";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(refreshButton, "click", () => {
        refreshTiles();
      });
      return container;
    };
    refreshControl.addTo(map);

    if (initialBaseLayer === "orthophoto") {
      orthoLayer.addTo(map);
      setOrthoStartView(map);
      setOrthoTilesLoaded(false);
    } else {
      satelliteLayer.addTo(map);
      setOrthoTilesLoaded(false);
    }

    activeBaseLayerRef.current = initialBaseLayer;
    setActiveBaseLayer(initialBaseLayer);

    mapRef.current = map;

    // Sabit saha noktaları: datum, şarj ve eve dön marker'ları (ROS2 paramlarından).
    fieldPointMarkersRef.current.forEach(m => m.remove());
    fieldPointMarkersRef.current = FIELD_POINTS.map(fp => {
      // interactive:false -> marker tıklamayı yutmaz, altına waypoint eklenebilir.
      const marker = L.marker([fp.lat, fp.lng], {
        icon: fieldPointIcon(fp.glyph, fp.color, fp.label),
        keyboard: false,
        interactive: false,
        zIndexOffset: 700
      }).addTo(map);
      return marker;
    });

    const noGoLayers = noGoLayerRefs.current;

    map.on("baselayerchange", e => {
      const nextLayer = e.layer === orthoLayer ? "orthophoto" : "satellite";
      activeBaseLayerRef.current = nextLayer;
      setActiveBaseLayer(nextLayer);
      storageSet(GPS_BASE_LAYER_STORAGE_KEY, nextLayer);
      if (nextLayer === "orthophoto") {
        setOrthoTilesLoaded(false);
        setOrthoStartView(map);
      }
      window.setTimeout(() => refreshTiles(nextLayer), 0);
    });

    map.on("click", e => {
      if (Date.now() < suppressMapClickUntilRef.current) return;

      if (offsetLineDrawingEnabledRef.current) {
        const point = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (!offsetLineStartRef.current) {
          setOffsetLineStart(point);
          setOffsetLineError("");
          showMissionNotice("Offset referans çizgisi: 1. nokta eklendi", "active");
        } else {
          setOffsetLineEnd(point);
          setOffsetLineError("");
          showMissionNotice("Offset referans çizgisi: 2. nokta eklendi", "active");
        }
        return;
      }

      if (noGoDrawingEnabledRef.current) {
        const point = { lat: e.latlng.lat, lng: e.latlng.lng };
        setDraftNoGoPoints(prev => [...prev, point]);
        setNoGoPublishError("");
        setNoGoPublishStatus(`Yasak bölge noktası eklendi: ${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`);
        showMissionNotice("Yasak bölge noktası eklendi", "active");
        return;
      }

      if (coverageDrawingEnabledRef.current) {
        const point = { lat: e.latlng.lat, lng: e.latlng.lng };
        setCoveragePoints(prev => [...prev, point]);
        setCoveragePublishError("");
        setCoveragePublishStatus(`Polygon noktası eklendi: ${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`);
        showMissionNotice("Coverage polygon noktası eklendi", "active");
        return;
      }

      if (waypointEditLockedRef.current) {
        showMissionNotice("Action Start sonrası waypoint ekleme kilitli", "warn");
        return;
      }

      if (
        waypointCountRef.current > 0 &&
        reachedWaypointIndexesRef.current.size >= waypointCountRef.current
      ) {
        const point = { lat: e.latlng.lat, lng: e.latlng.lng };
        openConfirmDialog({
          title: "Mevcut Rotayı Değiştir",
          message: "Mevcut rota silinsin mi?",
          confirmLabel: "Evet, Sil",
          cancelLabel: "Hayır",
          accent: "#b9ff2f",
          onConfirm: () => replaceRouteWithSingleWaypoint(point),
        });
        return;
      }

      const text = `WP ${waypointCountRef.current + 1} eklendi: ${e.latlng.lat.toFixed(7)}, ${e.latlng.lng.toFixed(7)}`;
      const logText = `WP eklendi lat=${e.latlng.lat.toFixed(7)} lon=${e.latlng.lng.toFixed(7)}`;

      addLog(
        "info",
        logText
      );
      showMissionNotice(text, "active");

      setWaypoints(prev => {
        const nextWaypoints = [
          ...prev,
          {
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            speed: waypointSpeedText(DEFAULT_WAYPOINT_SPEED_MULTIPLIER),
            mode: "pass"
          }
        ];

        publishUiState({
          waypoints: nextWaypoints,
          notice: { text, level: "active" },
          log: { level: "info", text: logText }
        });

        return nextWaypoints;
      });
    });

    return () => {
      routePolylineRef.current?.remove();
      routePolylineRef.current = null;
      globalPlanPolylineRef.current?.remove();
      globalPlanPolylineRef.current = null;
      localPlanPolylineRef.current?.remove();
      localPlanPolylineRef.current = null;
      coveragePolygonRef.current?.remove();
      coveragePolygonRef.current = null;
      coverageSweepLineRef.current?.remove();
      coverageSweepLineRef.current = null;
      coverageGeneratedMarkersRef.current.forEach(marker => marker.remove());
      coverageGeneratedMarkersRef.current = [];
      [
        [rosHeadingLineRef, rosHeadingArrowRef],
        [uiHeadingLineRef, uiHeadingArrowRef],
        [rosMapXAxisLineRef, rosMapXAxisArrowRef],
        [rosMapYAxisLineRef, rosMapYAxisArrowRef]
      ].forEach(([lineRef, arrowRef]) => {
        lineRef.current?.remove();
        arrowRef.current?.remove();
        lineRef.current = null;
        arrowRef.current = null;
      });
      coveragePointMarkersRef.current.forEach(marker => marker.remove());
      coveragePointMarkersRef.current = [];
      Object.values(noGoLayers.polygons).forEach(layer => layer.remove());
      noGoLayers.polygons = {};
      noGoLayers.vertices.forEach(marker => marker.remove());
      noGoLayers.vertices = [];
      noGoLayers.edges.forEach(marker => marker.remove());
      noGoLayers.edges = [];
      noGoLayers.draft?.remove();
      noGoLayers.draft = null;
      offsetReferencePolylineRef.current?.remove();
      offsetReferencePolylineRef.current = null;
      offsetLinePolylineRef.current?.remove();
      offsetLinePolylineRef.current = null;
      offsetTrailPolylineRef.current?.remove();
      offsetTrailPolylineRef.current = null;
      offsetLineMarkersRef.current.forEach(marker => marker.remove());
      offsetLineMarkersRef.current = [];
      waypointEdgeMarkersRef.current.forEach(marker => marker.remove());
      waypointEdgeMarkersRef.current = [];
      fieldPointMarkersRef.current.forEach(marker => marker.remove());
      fieldPointMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [addLog, openConfirmDialog, publishUiState, replaceRouteWithSingleWaypoint, showMissionNotice]);
  // ── Waypoint marker'ları ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    wpMarkersRef.current.forEach(m => m.remove());
    wpMarkersRef.current = [];

    waypoints.forEach((wp, i) => {
      const marker = makeWaypointLayer(
        wp,
        i,
        reachedWaypointIndexes.has(i) ? "reached" : "pending"
      ).addTo(map);

      if (waypointEditLocked) marker.dragging?.disable();
      else marker.dragging?.enable();

      marker.bindPopup(`
        <b>WP ${i + 1}</b><br/>
        durum: ${reachedWaypointIndexes.has(i) ? "alındı" : "bekliyor"}<br/>
        lat: ${wp.lat.toFixed(8)}<br/>
        lon: ${wp.lng.toFixed(8)}<br/>
        mode: ${waypointModeLabel(wp.mode)}
      `);

      marker.on("dragstart", () => {
        suppressMapClicksFor();
      });
      marker.on("dragend", e => {
        const latlng = e.target.getLatLng();
        updateWaypointPosition(i, { lat: latlng.lat, lng: latlng.lng });
      });

      wpMarkersRef.current.push(marker);
    });

    updateRouteOverlay();
  }, [waypoints, reachedWaypointIndexes, suppressMapClicksFor, updateRouteOverlay, updateWaypointPosition, waypointEditLocked]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    waypointEdgeMarkersRef.current.forEach(marker => marker.remove());
    waypointEdgeMarkersRef.current = [];

    if (waypoints.length < 2) return;

    for (let index = 0; index < waypoints.length - 1; index += 1) {
      const start = waypoints[index];
      const end = waypoints[index + 1];
      const mid = {
        lat: (start.lat + end.lat) / 2,
        lng: (start.lng + end.lng) / 2
      };

      const edgeMarker = L.marker([mid.lat, mid.lng], {
        icon: waypointEdgeIcon(),
        keyboard: false,
        bubblingMouseEvents: false,
        riseOnHover: true
      }).addTo(map);

      edgeMarker.on("click", e => {
        L.DomEvent.stopPropagation(e);
        insertWaypointAt(index + 1, mid);
      });

      waypointEdgeMarkersRef.current.push(edgeMarker);
    }
  }, [insertWaypointAt, waypoints]);

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

  const removeArrowOverlay = useCallback((lineRef, arrowRef) => {
    lineRef.current?.remove();
    arrowRef.current?.remove();
    lineRef.current = null;
    arrowRef.current = null;
  }, []);

  const upsertArrowOverlay = useCallback((lineRef, arrowRef, start, end, color, label, options = {}) => {
    const map = mapRef.current;

    if (!map || !start || !end) {
      removeArrowOverlay(lineRef, arrowRef);
      return null;
    }

    const latLngs = [[start.lat, start.lng], [end.lat, end.lng]];
    const bearing = bearingDeg(start, end);

    if (lineRef.current) {
      lineRef.current.setLatLngs(latLngs);
      lineRef.current.setStyle({
        color,
        weight: options.weight ?? 4,
        opacity: options.opacity ?? 0.95,
        dashArray: options.dashArray ?? null
      });
    } else {
      lineRef.current = L.polyline(latLngs, {
        color,
        weight: options.weight ?? 4,
        opacity: options.opacity ?? 0.95,
        dashArray: options.dashArray ?? null,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
        bubblingMouseEvents: false
      }).addTo(map);
    }

    if (arrowRef.current) {
      arrowRef.current.setLatLng([end.lat, end.lng]);
      arrowRef.current.setIcon(debugArrowHeadIcon(color, bearing, label));
    } else {
      arrowRef.current = L.marker([end.lat, end.lng], {
        icon: debugArrowHeadIcon(color, bearing, label),
        keyboard: false,
        interactive: false,
        zIndexOffset: options.zIndexOffset ?? 950
      }).addTo(map);
    }

    return bearing;
  }, [removeArrowOverlay]);

  const updateRosFrameDebugOverlay = useCallback(() => {
    const start =
      latLngFromPayload(gpsFrameDebugRef.current?.base_gps) ||
      robotLatLonRef.current;
    const pose = robotPoseRef.current;
    const backend = gpsFrameDebugRef.current;
    const yawRad = pose?.yaw;

    if (!start || !Number.isFinite(yawRad)) {
      removeArrowOverlay(rosHeadingLineRef, rosHeadingArrowRef);
      removeArrowOverlay(uiHeadingLineRef, uiHeadingArrowRef);
      removeArrowOverlay(rosMapXAxisLineRef, rosMapXAxisArrowRef);
      removeArrowOverlay(rosMapYAxisLineRef, rosMapYAxisArrowRef);
      return;
    }

    const baseLinkScreenYaw = normalizeRad(yawRad);
    const uiHeadingYaw = normalizeRad(yawRad);
    const headingLenM = 2.8;
    const rosHeadingEnd = offsetLatLng(
      start,
      Math.cos(baseLinkScreenYaw) * headingLenM,
      Math.sin(baseLinkScreenYaw) * headingLenM
    );
    const uiHeadingEnd = offsetLatLng(
      start,
      Math.cos(uiHeadingYaw) * headingLenM,
      Math.sin(uiHeadingYaw) * headingLenM
    );

    if (showBaseLinkXAxisArrowRef.current) {
      upsertArrowOverlay(
        rosHeadingLineRef,
        rosHeadingArrowRef,
        start,
        rosHeadingEnd,
        "#2563eb",
        "base_link +X",
        { weight: 4, zIndexOffset: 980 }
      );
    } else {
      removeArrowOverlay(rosHeadingLineRef, rosHeadingArrowRef);
    }
    if (showUiHeadingArrowRef.current) {
      upsertArrowOverlay(
        uiHeadingLineRef,
        uiHeadingArrowRef,
        start,
        uiHeadingEnd,
        "#fbbf24",
        "UI/compass heading",
        { weight: 4, dashArray: "5 5", zIndexOffset: 990 }
      );
    } else {
      removeArrowOverlay(uiHeadingLineRef, uiHeadingArrowRef);
    }

    const axisMarkers = backend?.axis_markers || {};
    const backendPlusX = latLngFromPayload(axisMarkers.map_plus_x);
    const backendPlusY = latLngFromPayload(axisMarkers.map_plus_y);
    const plusX = backendPlusX || (
      pose
        ? projectMapXYToLatLng(pose.x + 1.0, pose.y, start, pose, NAVSAT_MAP_TO_ENU_OFFSET_RAD)
        : null
    );
    const plusY = backendPlusY || (
      pose
        ? projectMapXYToLatLng(pose.x, pose.y + 1.0, start, pose, NAVSAT_MAP_TO_ENU_OFFSET_RAD)
        : null
    );

    if (showRosMapXAxisArrowRef.current) {
      upsertArrowOverlay(
        rosMapXAxisLineRef,
        rosMapXAxisArrowRef,
        start,
        plusX,
        "#ef4444",
        "ROS +X",
        { weight: 5, zIndexOffset: 970 }
      );
    } else {
      removeArrowOverlay(rosMapXAxisLineRef, rosMapXAxisArrowRef);
    }
    if (showRosMapYAxisArrowRef.current) {
      upsertArrowOverlay(
        rosMapYAxisLineRef,
        rosMapYAxisArrowRef,
        start,
        plusY,
        "#22c55e",
        "ROS +Y",
        { weight: 5, zIndexOffset: 970 }
      );
    } else {
      removeArrowOverlay(rosMapYAxisLineRef, rosMapYAxisArrowRef);
    }
  }, [removeArrowOverlay, upsertArrowOverlay]);

  useEffect(() => {
    showBaseLinkXAxisArrowRef.current = showBaseLinkXAxisArrow;
    showUiHeadingArrowRef.current = showUiHeadingArrow;
    showRosMapXAxisArrowRef.current = showRosMapXAxisArrow;
    showRosMapYAxisArrowRef.current = showRosMapYAxisArrow;
    updateRosFrameDebugOverlay();
  }, [
    showBaseLinkXAxisArrow,
    showUiHeadingArrow,
    showRosMapXAxisArrow,
    showRosMapYAxisArrow,
    updateRosFrameDebugOverlay
  ]);

  const updateRobotMarker = useCallback((lat, lng, yaw = robotYawRef.current) => {
    const map = mapRef.current;

    if (!map) return;

    robotLatLonRef.current = { lat, lng };

    if (offsetLineRunStateRef.current === "RUNNING") {
      const trail = offsetLineTrailRef.current;
      const last = trail[trail.length - 1];
      const movedM = last ? haversine(last, { lat, lng }) : Infinity;
      if (movedM >= OFFSET_LINE_TRAIL_MIN_STEP_M) {
        trail.push({ lat, lng });
        if (offsetTrailPolylineRef.current) {
          offsetTrailPolylineRef.current.setLatLngs(
            trail.length >= 2 ? trail.map(p => [p.lat, p.lng]) : []
          );
        }
      }
    }

    const markerHeadingOffsetRad = robotMarkerHeadingOffsetRadRef.current;
    const displayYaw = normalizeRad(yaw + markerHeadingOffsetRad);
    const markerHeadingOffsetDeg = radToDeg(markerHeadingOffsetRad);
    const imu = imuInfoRef.current;

    const headingEnd = offsetLatLng(
      { lat, lng },
      Math.cos(displayYaw) * 2.2,
      Math.sin(displayYaw) * 2.2
    );

    if (robotMarkerRef.current) {
      robotMarkerRef.current.setLatLng([lat, lng]);
      robotMarkerRef.current.setIcon(robotVehicleIcon(displayYaw));
    } else {
      robotMarkerRef.current = L.marker([lat, lng], {
        icon: robotVehicleIcon(displayYaw),
        keyboard: false,
        zIndexOffset: 900
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
      marker yaw: ${radToDeg(displayYaw).toFixed(1)}°<br/>
      marker heading source: TF yaw + compass calibration<br/>
      marker offset: ${markerHeadingOffsetDeg.toFixed(1)}°<br/>
      ${imu?.bearing !== undefined ? `IMU bearing: ${imu.bearing.toFixed(1)}°<br/>` : ""}
    `);

    if (centerRef.current) {
      const shouldPanToRobot =
        activeBaseLayerRef.current !== "orthophoto" ||
        isInBounds(lat, lng, ORTHO_BOUNDS);

      if (shouldPanToRobot) map.panTo([lat, lng]);
    }
    updateRosFrameDebugOverlay();
  }, [updateRosFrameDebugOverlay]);

  const upsertProjectedMarker = useCallback((markerRef, xy, type, label, popupHtml, visible = true) => {
    const map = mapRef.current;
    const ll = robotLatLonRef.current;
    const pose = robotPoseRef.current;

    if (!map || !xy || !ll || !pose || xy.x === null || xy.y === null) return;

    const latLng = projectMapXYToLatLng(
      xy.x,
      xy.y,
      ll,
      pose,
      projectionHeadingOffsetRadRef.current
    );

    if (!latLng) return;

    if (markerRef.current) {
      markerRef.current.setLatLng([latLng.lat, latLng.lng]);
    } else {
      markerRef.current = makeDebugLayer([latLng.lat, latLng.lng], type, label);
    }

    markerRef.current.bindPopup(popupHtml(latLng));

    if (visible) {
      if (!map.hasLayer(markerRef.current)) markerRef.current.addTo(map);
    } else if (map.hasLayer(markerRef.current)) {
      markerRef.current.remove();
    }
  }, []);

  const upsertLatLngMarker = useCallback((markerRef, latLng, type, label, popupHtml, visible = true) => {
    const map = mapRef.current;

    if (!map || !latLng || !Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng)) return;

    if (markerRef.current) {
      markerRef.current.setLatLng([latLng.lat, latLng.lng]);
    } else {
      markerRef.current = makeDebugLayer([latLng.lat, latLng.lng], type, label);
    }

    markerRef.current.bindPopup(popupHtml(latLng));

    if (visible) {
      if (!map.hasLayer(markerRef.current)) markerRef.current.addTo(map);
    } else if (map.hasLayer(markerRef.current)) {
      markerRef.current.remove();
    }
  }, []);

  const findGoalSourceLatLng = useCallback(goal => {
    if (!goal) return null;

    let bestMatch = null;

    for (const rawPoint of debugPointsRef.current) {
      const point = readDebugPoint(rawPoint);
      if (!point || point.latitude === null || point.longitude === null) continue;

      const vehicleTarget = debugPointVehicleTarget(point);
      if (!vehicleTarget) continue;

      const distance = Math.hypot(vehicleTarget.x - goal.x, vehicleTarget.y - goal.y);

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = {
          distance,
          point
        };
      }
    }

    if (!bestMatch || bestMatch.distance > 1.0) return null;

    return {
      lat: bestMatch.point.latitude,
      lng: bestMatch.point.longitude,
      point: bestMatch.point,
      distance: bestMatch.distance
    };
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

    const sourceLatLng = findGoalSourceLatLng(goal);

    if (sourceLatLng) {
      upsertLatLngMarker(
        nav2GoalMarkerRef,
        { lat: sourceLatLng.lat, lng: sourceLatLng.lng },
        "nav2-goal",
        "NAV2",
        () => `
          <b>/gps_waypoint_nav/goal_pose</b><br/>
          frame: ${goal.frameId || "?"}<br/>
          x: ${fmtNum(goal.x)} m<br/>
          y: ${fmtNum(goal.y)} m<br/>
          yaw: ${radToDeg(goal.yaw).toFixed(1)} deg<br/>
          kaynak waypoint lat: ${sourceLatLng.lat.toFixed(8)}<br/>
          kaynak waypoint lon: ${sourceLatLng.lng.toFixed(8)}<br/>
          debug eşleşme farkı: ${sourceLatLng.distance.toFixed(3)} m
        `,
        showDerivedGoalMarkersRef.current
      );
      return;
    }

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
        marker fallback UI debug projeksiyonu
      `,
      showDerivedGoalMarkersRef.current
    );
  }, [findGoalSourceLatLng, upsertLatLngMarker, upsertProjectedMarker]);

  const ensurePlanPolyline = useCallback((polylineRef, options) => {
    const map = mapRef.current;

    if (!map) return null;
    if (polylineRef.current) return polylineRef.current;

    polylineRef.current = L.polyline([], {
      interactive: false,
      bubblingMouseEvents: false,
      ...options
    }).addTo(map);

    return polylineRef.current;
  }, []);

  const updatePlanPolyline = useCallback((polylineRef, pathRef, visibleRef, options) => {
    const map = mapRef.current;
    const ll = robotLatLonRef.current;
    const pose = robotPoseRef.current;

    if (!map) return;

    const line = ensurePlanPolyline(polylineRef, options);
    if (!line) return;

    if (!visibleRef.current || !ll || !pose || pathRef.current.length < 2) {
      line.setLatLngs([]);
      return;
    }

    const latLngs = pathRef.current
      .map(point => projectMapXYToLatLng(
        point.x,
        point.y,
        ll,
        pose,
        projectionHeadingOffsetRadRef.current
      ))
      .filter(Boolean)
      .map(point => [point.lat, point.lng]);

    line.setLatLngs(latLngs.length >= 2 ? latLngs : []);
  }, [ensurePlanPolyline]);

  const updateNav2PlanOverlays = useCallback(() => {
    updatePlanPolyline(
      globalPlanPolylineRef,
      globalPlanRef,
      showGlobalPlanRef,
      {
        color: "#00d4ff",
        weight: 4,
        opacity: 0.92,
        dashArray: "8 7",
        lineCap: "round",
        lineJoin: "round"
      }
    );

    updatePlanPolyline(
      localPlanPolylineRef,
      localPlanRef,
      showLocalPlanRef,
      {
        color: "#10b981",
        weight: 5,
        opacity: 0.96,
        lineCap: "round",
        lineJoin: "round"
      }
    );
  }, [updatePlanPolyline]);

  const {
    updateOffsetLinePathOverlay,
    updateOffsetLineOverlays,
  } = useOffsetLineOverlays({
    mapRef,
    offsetLineStart,
    offsetLineEnd,
    offsetLineSide,
    offsetLineStartRef,
    offsetLineEndRef,
    offsetLineSideRef,
    offsetLineMarkersRef,
    offsetReferencePolylineRef,
    offsetLinePolylineRef,
    offsetLinePathRef,
    showOffsetLineRef,
    offsetTrailPolylineRef,
    offsetLineTrailRef,
    updatePlanPolyline,
    latLngDeltaMeters,
    offsetLatLng,
    MONO,
  });

  useEffect(() => {
    robotMarkerHeadingOffsetRadRef.current = 0;
    projectionHeadingOffsetRadRef.current = NAVSAT_MAP_TO_ENU_OFFSET_RAD;

    const ll = robotLatLonRef.current;
    if (ll) updateRobotMarker(ll.lat, ll.lng, robotYawRef.current);
    updateTfPoseMarker();
    updateNav2GoalMarker();
    updateNav2PlanOverlays();
    updateOffsetLineOverlays();
    updateRosFrameDebugOverlay();
  }, [
    updateRobotMarker,
    updateTfPoseMarker,
    updateNav2GoalMarker,
    updateNav2PlanOverlays,
    updateOffsetLineOverlays,
    updateRosFrameDebugOverlay
  ]);

  useEffect(() => {
    showDerivedGoalMarkersRef.current = showDerivedGoalMarkers;

    const map = mapRef.current;
    if (!map) return;

    convertedMarkersRef.current.forEach(marker => {
      if (showDerivedGoalMarkers) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else if (map.hasLayer(marker)) {
        marker.remove();
      }
    });

    if (nav2GoalMarkerRef.current) {
      if (showDerivedGoalMarkers) {
        updateNav2GoalMarker();
      } else if (map.hasLayer(nav2GoalMarkerRef.current)) {
        nav2GoalMarkerRef.current.remove();
      }
    }
  }, [showDerivedGoalMarkers, updateNav2GoalMarker]);

  useEffect(() => {
    showGlobalPlanRef.current = showGlobalPlan;
    updateNav2PlanOverlays();
  }, [showGlobalPlan, updateNav2PlanOverlays]);

  useEffect(() => {
    showLocalPlanRef.current = showLocalPlan;
    updateNav2PlanOverlays();
  }, [showLocalPlan, updateNav2PlanOverlays]);

  // ── ROS topic'leri ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;

    try {
      statusSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/gps_waypoint_nav/status",
        messageType: "std_msgs/msg/String",
        queue_length: 1,
        throttle_rate: 500
      });

      statusSubRef.current = sub;

      sub.subscribe(msg => {
        try {
          const p = JSON.parse(msg.data);
          const stateLc = String(p.state || "").toLowerCase();
          const reachedWpNumber = reachedWaypointNumberFromPayload(p);
          const reachedWp = reachedWpNumber !== undefined
            ? markWaypointReached(reachedWpNumber)
            : null;
          const state = (p.state || "").toUpperCase();
          const detail = p.detail || "";
          const readable = readableMissionStatusFromPayload(p);
          const text = reachedWp !== null
            ? waypointReachedNoticeText(reachedWp)
            : readable?.text || translateMissionText(detail ? `${state} - ${detail}` : state);
          const level = reachedWp !== null
            ? "success"
            : readable?.level || missionLevelFromText(text);

          if (stateLc === "paused" || stateLc === "pause") {
            setMissionStopped(true);
          } else if (
            stateLc === "resume" ||
            stateLc === "sent" ||
            stateLc === "feedback" ||
            stateLc === "result" ||
            stateLc === "complete" ||
            stateLc === "cancel" ||
            stateLc === "stopped" ||
            stateLc === "error"
          ) {
            setMissionStopped(false);
          }

          if ([
            "complete",
            "cancel",
            "canceled",
            "cancelled",
            "stopped",
            "error",
            "aborted",
            "abort",
            "success",
            "succeeded",
            "result"
          ].includes(stateLc)) {
            setWaypointEditLocked(false);
          }

          if (stateLc === "waiting") {
            const waitInfo = parseWaitingDwellInfo(detail);
            const waitIndex = waitInfo?.waypointIndex ?? activeWaitIndexRef.current;
            if (waitInfo && waitIndex !== null && activeWaitIndexRef.current !== waitIndex) {
              startWaitCountdown(waitIndex, waitInfo.seconds);
            }
          } else if (activeWaitIndexRef.current !== null) {
            clearWaitCountdown();
          }

          setNavStatus(text);
          addLog("status", text || "Görev durumu alındı");
          showMissionNotice(text || "Görev durumu alındı", level);
        } catch {
          const reachedWpNumber = reachedWaypointNumberFromText(msg.data);
          const reachedWp = reachedWpNumber !== undefined
            ? markWaypointReached(reachedWpNumber)
            : null;
          const rawTextLc = String(msg.data || "").toLowerCase();
          const readable = readableMissionStatusFromText(msg.data);
          const text = reachedWp !== null
            ? waypointReachedNoticeText(reachedWp)
            : readable?.text || translateMissionText(msg.data) || "";
          const level = reachedWp !== null
            ? "success"
            : readable?.level || missionLevelFromText(text);

          if (rawTextLc.includes("paused") || rawTextLc.includes("waiting for resume")) {
            setMissionStopped(true);
          } else if (
            rawTextLc.includes("resume") ||
            rawTextLc.includes("cancel") ||
            rawTextLc.includes("complete") ||
            rawTextLc.includes("success") ||
            rawTextLc.includes("stopped") ||
            rawTextLc.includes("error")
          ) {
            setMissionStopped(false);
          }

          if (
            rawTextLc.includes("cancel") ||
            rawTextLc.includes("complete") ||
            rawTextLc.includes("success") ||
            rawTextLc.includes("succeeded") ||
            rawTextLc.includes("stopped") ||
            rawTextLc.includes("error") ||
            rawTextLc.includes("abort")
          ) {
            setWaypointEditLocked(false);
          }

          if (rawTextLc.includes("waiting") && rawTextLc.includes("dwell")) {
            const waitInfo = parseWaitingDwellInfo(msg.data);
            const waitIndex = waitInfo?.waypointIndex ?? activeWaitIndexRef.current;
            if (waitInfo && waitIndex !== null && activeWaitIndexRef.current !== waitIndex) {
              startWaitCountdown(waitIndex, waitInfo.seconds);
            }
          } else if (activeWaitIndexRef.current !== null) {
            clearWaitCountdown();
          }

          setNavStatus(text);
          if (msg.data) {
            addLog("status", text);
            showMissionNotice(text, level);
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

	        if (Number.isFinite(rawInfo.latitude) && Number.isFinite(rawInfo.longitude)) {
	          updateRobotMarker(
	            rawInfo.latitude,
	            rawInfo.longitude,
	            robotYawRef.current
          );
	          updateTfPoseMarker();
	          updateNav2GoalMarker();
	          updateNav2PlanOverlays();
	          updateRosFrameDebugOverlay();

          if (Date.now() - lastFixLogRef.current > 5000) {
            lastFixLogRef.current = Date.now();
            addLog("fix", `GPS fix lat=${rawInfo.latitude.toFixed(7)} lon=${rawInfo.longitude.toFixed(7)}`);
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
	        updateNav2PlanOverlays();
	        updateRosFrameDebugOverlay();

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
	      gpsFrameDebugSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_FRAME_DEBUG_TOPIC,
	        messageType: "std_msgs/msg/String",
	        queue_length: 1,
	        throttle_rate: 250
	      });

	      gpsFrameDebugSubRef.current = sub;
	      sub.subscribe(msg => {
	        let payload = null;

	        try {
	          payload = JSON.parse(String(msg?.data || ""));
	        } catch {
	          payload = null;
	        }

	        if (!payload || typeof payload !== "object") return;

	        const next = {
	          ...payload,
	          topic: GPS_FRAME_DEBUG_TOPIC,
	          ts: Date.now()
	        };

	        gpsFrameDebugRef.current = next;
	        setGpsFrameDebugInfo(next);
	        updateRosFrameDebugOverlay();
	      });
	    } catch {
	      // Optional backend frame debug topic; UI falls back to /tf + /fix.
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
      globalPlanSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/plan",
        messageType: "nav_msgs/msg/Path",
        queue_length: 1,
        throttle_rate: 500
      });

      globalPlanSubRef.current = sub;

      sub.subscribe(msg => {
        const points = Array.isArray(msg?.poses)
          ? msg.poses
              .map(ps => ({
                x: toNum(ps?.pose?.position?.x),
                y: toNum(ps?.pose?.position?.y)
              }))
              .filter(point => point.x !== null && point.y !== null)
          : [];

        globalPlanRef.current = points;
        setGlobalPlanInfo({
          count: points.length,
          frameId: msg?.header?.frame_id || "",
          stamp: msg?.header?.stamp || null,
          ts: Date.now()
        });
        updateNav2PlanOverlays();
      });
    } catch {
      // Nav2 global plan topic is optional.
    }

    try {
      localPlanSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/local_plan",
        messageType: "nav_msgs/msg/Path",
        queue_length: 1,
        throttle_rate: 150
      });

      localPlanSubRef.current = sub;

      sub.subscribe(msg => {
        const points = Array.isArray(msg?.poses)
          ? msg.poses
              .map(ps => ({
                x: toNum(ps?.pose?.position?.x),
                y: toNum(ps?.pose?.position?.y)
              }))
              .filter(point => point.x !== null && point.y !== null)
          : [];

        localPlanRef.current = points;
        setLocalPlanInfo({
          count: points.length,
          frameId: msg?.header?.frame_id || "",
          stamp: msg?.header?.stamp || null,
          ts: Date.now()
        });
        updateNav2PlanOverlays();
      });
    } catch {
      // Nav2 local plan topic is optional.
    }

    try {
      rtkSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/ublox/navpvt",
        messageType: "ublox_msgs/NavPVT",
        queue_length: 1,
        throttle_rate: 500
      });

      rtkSubRef.current = sub;
      sub.subscribe(msg => {
        setRtkInfo({
          ...parseUbloxNavPvt(msg),
          source: "/ublox/navpvt"
        });
      });
    } catch {
      // u-blox NAV-PVT is optional; /fix still drives robot position.
    }

    try {
      rtkStatusSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/rtk_status",
        messageType: "std_msgs/msg/String",
        queue_length: 1,
        throttle_rate: 500
      });

      rtkStatusSubRef.current = sub;
      sub.subscribe(msg => {
        const text = String(msg?.data || "");
        const rtkStatus = parseRtkStatusFromText(text);
        if (!rtkStatus) return;

        setRtkInfo({
          rtkStatus,
          source: "/rtk_status",
          detail: text,
          ts: Date.now()
        });
      });
    } catch {
      // Rover GPS RTK status topic is optional on older robot builds.
    }

    try {
      rtkRosoutSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/rosout",
        messageType: "rcl_interfaces/msg/Log",
        queue_length: 10,
        throttle_rate: 200
      });

      rtkRosoutSubRef.current = sub;
      sub.subscribe(msg => {
        const text = String(msg?.msg || "");
        const rtkStatus = parseRtkStatusFromText(text);
        if (!rtkStatus) return;

        setRtkInfo({
          rtkStatus,
          source: msg?.name ? `/rosout:${msg.name}` : "/rosout",
          stamp: msg?.stamp || null,
          ts: Date.now()
        });
      });
    } catch {
      // ROS logs are optional; direct GPS topics still drive the page when present.
    }

	    try {
	      gpsCoverageStatusSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_COVERAGE_STATUS_TOPIC,
	        messageType: "std_msgs/String",
	        queue_length: 1,
	        throttle_rate: 500
	      });

	      gpsCoverageStatusSubRef.current = sub;
	      sub.subscribe(msg => {
	        const text = String(msg?.data || "");
	        setGpsCoverageStatusInfo({
	          text,
	          topic: GPS_COVERAGE_STATUS_TOPIC,
	          ts: Date.now()
	        });
	      });
	    } catch {
	      // GPS coverage status is optional until the coverage stack is running.
	    }

	    try {
	      gpsCoverageDebugSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_COVERAGE_DEBUG_POINTS_TOPIC,
	        messageType: "std_msgs/String",
	        queue_length: 1,
	        throttle_rate: 500
	      });

	      gpsCoverageDebugSubRef.current = sub;
	      sub.subscribe(msg => {
	        let count = 0;
	        let text = String(msg?.data || "");
	        try {
	          const payload = JSON.parse(text);
	          const points = Array.isArray(payload?.points)
	            ? payload.points
	            : Array.isArray(payload)
	              ? payload
	              : [];
	          count = points.length;
	        } catch {
	          // Keep raw text visible if the debug topic is not JSON.
	        }

	        setGpsCoverageDebugInfo({
	          count,
	          text,
	          topic: GPS_COVERAGE_DEBUG_POINTS_TOPIC,
	          ts: Date.now()
	        });
	      });
	    } catch {
	      // GPS coverage debug points are optional.
	    }

	    try {
	      gpsCoveragePathSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_COVERAGE_PATH_TOPIC,
	        messageType: "nav_msgs/msg/Path",
	        queue_length: 1,
	        throttle_rate: 500
	      });

	      gpsCoveragePathSubRef.current = sub;
	      sub.subscribe(msg => {
          const points = Array.isArray(msg?.poses)
            ? msg.poses
                .map(ps => ({
                  x: toNum(ps?.pose?.position?.x),
                  y: toNum(ps?.pose?.position?.y)
                }))
                .filter(point => point.x !== null && point.y !== null)
            : [];

          setGpsCoveragePathPoints(points);
	        setGpsCoveragePathInfo({
	          count: points.length,
	          frameId: msg?.header?.frame_id || "",
	          stamp: msg?.header?.stamp || null,
	          topic: GPS_COVERAGE_PATH_TOPIC,
	          ts: Date.now()
	        });
	      });
	    } catch {
	      // GPS coverage path is optional until a polygon has been planned.
	    }

	    try {
	      offsetLineStatusSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_OFFSET_LINE_STATUS_TOPIC,
	        messageType: "std_msgs/String",
	        queue_length: 1,
	        throttle_rate: 300
	      });

	      offsetLineStatusSubRef.current = sub;
	      sub.subscribe(msg => {
	        const text = String(msg?.data || "");
	        let state = "error";
	        let detail = text;
	        try {
	          const payload = JSON.parse(text);
	          state = String(payload?.state || "error");
	          detail = String(payload?.detail || "");
	        } catch {
	          // Keep raw text if status payload is not JSON.
	        }

	        setOffsetLineStatusInfo({ state, detail, ts: Date.now() });
	        const runState = mapOffsetLineRunState(state);
	        setOffsetLineRunState(runState);
	        if (runState === "ERROR") {
	          setOffsetLineError(detail || "Offset takip hatası");
	          showMissionNotice(`Offset takip hatası: ${detail}`, "danger");
	        } else if (runState === "RUNNING" && offsetLineRunStateRef.current !== "RUNNING") {
	          showMissionNotice("Offset takibi başladı", "active");
	        } else if (runState === "DONE") {
	          showMissionNotice("Offset takibi tamamlandı", "active");
	        } else if (runState === "STOPPED") {
	          showMissionNotice("Offset takibi durduruldu", "warn");
	        }
	      });
	    } catch {
	      // Offset line status is optional until the node is running.
	    }

	    try {
	      offsetLineDebugSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_OFFSET_LINE_DEBUG_POINTS_TOPIC,
	        messageType: "std_msgs/String",
	        queue_length: 1,
	        throttle_rate: 500
	      });

	      offsetLineDebugSubRef.current = sub;
	      sub.subscribe(msg => {
	        setOffsetLineDebugInfo({
	          text: String(msg?.data || ""),
	          ts: Date.now()
	        });
	      });
	    } catch {
	      // Offset line debug points are optional.
	    }

	    try {
	      offsetLinePathSubRef.current?.unsubscribe();

	      const sub = new ROSLIB.Topic({
	        ros,
	        name: GPS_OFFSET_LINE_PATH_TOPIC,
	        messageType: "nav_msgs/msg/Path",
	        queue_length: 1,
	        throttle_rate: 300
	      });

	      offsetLinePathSubRef.current = sub;
	      sub.subscribe(msg => {
	        const points = Array.isArray(msg?.poses)
	          ? msg.poses
	              .map(ps => ({
	                x: toNum(ps?.pose?.position?.x),
	                y: toNum(ps?.pose?.position?.y)
	              }))
	              .filter(point => point.x !== null && point.y !== null)
	          : [];

	        offsetLinePathRef.current = points;
	        setOffsetLinePathPointCount(points.length);
	        updateOffsetLinePathOverlay();
	      });
	    } catch {
	      // Offset line path is optional until a line has been planned.
	    }

	    try {
	      debugPointsSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: "/gps_waypoint_nav/debug_points",
        messageType: "std_msgs/msg/String",
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
          debugPointsRef.current = points;
	        setDebugPoints(points);
	        if (!points.length) setFromLLWarning(null);
	        addLog("debug", `${points.length} fromLL debug noktasi alindi`);
	        let maxFromLLDelta = null;

        points.forEach((p, fallbackIndex) => {
          const headingOffsetRad = projectionHeadingOffsetRadRef.current;
          const point = readDebugPoint(p);
          const idx = point?.index ?? pointIndex(p, fallbackIndex);
          const lat = point?.latitude ?? null;
          const lng = point?.longitude ?? null;
          const mapX = point?.mapX ?? null;
          const mapY = point?.mapY ?? null;
          const goalX = point?.goalX ?? null;
          const goalY = point?.goalY ?? null;
          const yaw = point?.yaw ?? null;
          const mode = point?.mode || "";
          const yawSource = point?.yawSource || "";
          const mapZ = point?.mapZ ?? null;
          const frame = point?.goalFrameId || point?.fromllFrame || "map";
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
            const marker = makeDebugLayer([lat, lng], "fromll-source", `LL WP${idx}`);

            marker.bindPopup(`
              <b>ORIJINAL WAYPOINT WP${idx}</b><br/>
              lat: ${lat.toFixed(8)}<br/>
              lon: ${lng.toFixed(8)}<br/>
              ${mode ? `mode: ${String(mode).toUpperCase()}<br/>` : ""}
              ${yawSource ? `yaw_source: ${yawSource}<br/>` : ""}
              kaynak: UI lat/lon veya debug payload
            `);

            if (showDerivedGoalMarkersRef.current) marker.addTo(map);
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
            );

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
              ${mode ? `mode: ${String(mode).toUpperCase()}<br/>` : ""}
              ${yawSource ? `yaw_source: ${yawSource}<br/>` : ""}
              ${yaw !== null ? `yaw: ${(yaw * 180 / Math.PI).toFixed(1)} deg` : ""}
            `);

            if (showDerivedGoalMarkersRef.current) marker.addTo(map);
            convertedMarkersRef.current.push(marker);
          } else if (mapX !== null && mapY !== null) {
            addLog("warn", `WP${idx} XY var ama haritaya projeksiyon icin GPS fix + TF bekleniyor`);
          }

          const vehicleTarget = debugPointVehicleTarget(point);
          const vehicleX = vehicleTarget?.x ?? null;
          const vehicleY = vehicleTarget?.y ?? null;
          const projectedVehicleLatLng = vehicleX !== null && vehicleY !== null
            ? projectMapXYToLatLng(
                vehicleX,
                vehicleY,
                robotLatLonRef.current,
                robotPoseRef.current,
                headingOffsetRad
              )
            : null;

          const vehicleLatLng = lat !== null && lng !== null
            ? { lat, lng }
            : projectedVehicleLatLng;

          if (vehicleX !== null && vehicleY !== null && vehicleLatLng) {
            const marker = makeDebugLayer(
              [vehicleLatLng.lat, vehicleLatLng.lng],
              "vehicle-target",
              `NAV WP${idx}`
            );

            marker.bindPopup(`
              <b>ARACIN GITMEK ISTEDIGI XY WP${idx}</b><br/>
              ${goalX === null || goalY === null ? "debug payload ayri hedef x/y vermedigi icin fromLL map_x/map_y kullanildi<br/>" : ""}
              target_x: ${vehicleX.toFixed(3)} m<br/>
              target_y: ${vehicleY.toFixed(3)} m<br/>
              ${expectedXY ? `GPS+TF beklenen_x: ${expectedXY.x.toFixed(3)} m<br/>GPS+TF beklenen_y: ${expectedXY.y.toFixed(3)} m<br/>` : ""}
              frame: ${frame}<br/>
              ${lat !== null && lng !== null ? `kaynak waypoint lat: ${lat.toFixed(8)}<br/>kaynak waypoint lon: ${lng.toFixed(8)}<br/>` : ""}
              lat*: ${vehicleLatLng.lat.toFixed(8)}<br/>
              lon*: ${vehicleLatLng.lng.toFixed(8)}<br/>
              ${mode ? `mode: ${String(mode).toUpperCase()}<br/>` : ""}
              ${yawSource ? `yaw_source: ${yawSource}` : ""}
            `);

            if (showDerivedGoalMarkersRef.current) marker.addTo(map);
            convertedMarkersRef.current.push(marker);
          }

	          if (fromLLDelta !== null && fromLLDelta > 2) {
	            maxFromLLDelta = Math.max(maxFromLLDelta ?? 0, fromLLDelta);
	            addLog(
	              "warn",
	              `WP${idx} fromLL/TF farki ${fromLLDelta.toFixed(1)}m: navsat datum/yaw_offset kontrol et`
	            );
	          }
	        });
	        setFromLLWarning(
	          maxFromLLDelta !== null
	            ? `fromLL/debug farkı ${maxFromLLDelta.toFixed(1)} m: datum, yaw_offset veya frame modu yanlış olabilir.`
	            : null
	        );
          updateNav2GoalMarker();
	      });
    } catch {
      // Debug topic is optional.
    }

    try {
      noGoDebugSubRef.current?.unsubscribe();

      const sub = new ROSLIB.Topic({
        ros,
        name: NO_GO_DEBUG_TOPIC,
        messageType: "std_msgs/msg/String",
        queue_length: 1,
        throttle_rate: 500
      });

      noGoDebugSubRef.current = sub;
      sub.subscribe(msg => {
        try {
          const payload = JSON.parse(msg?.data || "{}");
          const zones = Array.isArray(payload?.zones) ? payload.zones : [];
          setNoGoDebugZones(zones);
        } catch (e) {
          addLog("warn", `${NO_GO_DEBUG_TOPIC} JSON parse hatasi: ${e?.message || String(e)}`);
        }
      });
    } catch {
      // No-go debug topic is optional.
    }

    return () => {
      try { statusSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { robotSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { imuSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { tfSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { tfStaticSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { debugPointsSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { noGoDebugSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { gpsOdomSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { globalOdomSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { nav2GoalSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { globalPlanSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
      try { localPlanSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { rtkSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { rtkStatusSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { rtkRosoutSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { gpsCoverageStatusSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { gpsCoverageDebugSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { gpsCoveragePathSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { gpsFrameDebugSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { offsetLineStatusSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { offsetLineDebugSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	      try { offsetLinePathSubRef.current?.unsubscribe(); } catch { /* ignore unsubscribe errors */ }
	    };
	  }, [ros, isConnected, updateRobotMarker, updateTfPoseMarker, updateNav2GoalMarker, updateNav2PlanOverlays, updateOffsetLinePathOverlay, updateRosFrameDebugOverlay, addLog, showMissionNotice, markWaypointReached, startWaitCountdown, clearWaitCountdown]);

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

    const gps = rawGpsInfo;
    const hasValidFix =
      Number.isFinite(gps?.latitude) &&
      Number.isFinite(gps?.longitude) &&
      Number.isFinite(gps?.status) &&
      gps.status >= 0;

    if (!hasValidFix) {
      addLog("warn", "Action Start engellendi: geçerli GPS fix yok");
      showMissionNotice("ACTION START engellendi: geçerli GPS fix yok", "danger");
      publishUiState({
        notice: { text: "ACTION START engellendi: geçerli GPS fix yok", level: "danger" },
        log: { level: "warn", text: "Action Start engellendi: geçerli GPS fix yok" }
      });
      return;
    }

    if (!robotPoseInfo) {
      addLog("warn", "Action Start engellendi: TF map->base bekleniyor");
      showMissionNotice("ACTION START engellendi: TF map->base bekleniyor", "danger");
      publishUiState({
        notice: { text: "ACTION START engellendi: TF map->base bekleniyor", level: "danger" },
        log: { level: "warn", text: "Action Start engellendi: TF map->base bekleniyor" }
      });
      return;
    }

    const pub = ensurePublisher();

    if (!pub) return;

    const buildWaypointPayload = (wp, index = 0) => {
      const payload = {
        latitude: wp.lat,
        longitude: wp.lng
      };

      if (Number.isFinite(wp.altitude)) {
        payload.altitude = wp.altitude;
      }

      if (waypointWaitSecondsValue(wp.waitSeconds)) {
        payload.wait_seconds = waypointWaitSecondsValue(wp.waitSeconds);
      }

      if (index < waypoints.length - 1) {
        const speedMultiplier = waypointSpeedValue(wp.speed);
        payload.speed_multiplier = speedMultiplier;
        payload.speed = speedMultiplier;
      }

      return payload;
    };

    const payload = waypoints.length === 1
      ? JSON.stringify(buildWaypointPayload(waypoints[0], 0))
      : JSON.stringify({
          waypoints: waypoints.map(buildWaypointPayload)
        });

    reachedWaypointIndexesRef.current = new Set();
    setReachedWaypointIndexes(new Set());
    setMissionStopped(false);
    setWaypointEditLocked(true);
    clearWaitCountdown();
    pub.publish({ data: payload });
    addLog("info", `${waypoints.length} waypoint araca gonderildi`);
    showMissionNotice(`Action Start: ${waypoints.length} waypoint araca gönderildi`, "active");
    publishUiState({
      waypoints,
      missionStopped: false,
      notice: { text: `Action Start: ${waypoints.length} waypoint araca gönderildi`, level: "active" },
      log: { level: "info", text: `${waypoints.length} waypoint araca gonderildi` }
    });
  }, [ros, isConnected, waypoints, rawGpsInfo, robotPoseInfo, ensurePublisher, addLog, showMissionNotice, publishUiState, clearWaitCountdown]);

  const toggleMissionStop = useCallback(() => {
    if (!ros || !isConnected) return;

    const pub = ensurePublisher();

    if (!pub) return;

    const nextStopped = !missionStopped;
    const command = nextStopped ? "stop" : "resume";
    const noticeText = nextStopped
      ? "STOP komutu gönderildi: görev duraklatılıyor"
      : "RESUME komutu gönderildi: görev devam ediyor";

    pub.publish({
      data: JSON.stringify({
        command
      })
    });
    setMissionStopped(nextStopped);
    addLog(nextStopped ? "warn" : "info", `${command.toUpperCase()} komutu gonderildi`);
    showMissionNotice(noticeText, nextStopped ? "warn" : "active");
    publishUiState({
      missionStopped: nextStopped,
      notice: { text: noticeText, level: nextStopped ? "warn" : "active" },
      log: { level: nextStopped ? "warn" : "info", text: `${command.toUpperCase()} komutu gonderildi` }
    });
  }, [ros, isConnected, ensurePublisher, missionStopped, addLog, showMissionNotice, publishUiState]);

  const cancelMission = useCallback(() => {
    if (!ros || !isConnected) return;

    const pub = ensurePublisher();

    if (!pub) return;

    pub.publish({
      data: JSON.stringify({
        command: "cancel"
      })
    });
    setMissionStopped(false);
    setWaypointEditLocked(false);
    clearWaitCountdown();
    globalPlanRef.current = [];
    localPlanRef.current = [];
    setGlobalPlanInfo(null);
    setLocalPlanInfo(null);
    updateNav2PlanOverlays();
    addLog("warn", "Action Cancel komutu gonderildi");
    showMissionNotice("Action Cancel komutu gönderildi", "muted");
    publishUiState({
      missionStopped: false,
      notice: { text: "Action Cancel komutu gönderildi", level: "muted" },
      log: { level: "warn", text: "Action Cancel komutu gonderildi" }
    });

    // Güvenlik: ACTION CANCEL aktif bir offset takibini de durdursun, aksi halde
    // iki ayrı Nav2 hedefi (mission + offset line) aynı anda çakışabilir.
    if (["RUNNING", "PLANNED"].includes(offsetLineRunStateRef.current)) {
      try {
        new ROSLIB.Service({
          ros,
          name: GPS_OFFSET_LINE_CANCEL_SERVICE,
          serviceType: "std_srvs/srv/Trigger"
        }).callService({}, () => {}, () => {});
      } catch {
        // best-effort
      }
    }
  }, [ros, isConnected, ensurePublisher, updateNav2PlanOverlays, addLog, showMissionNotice, publishUiState, clearWaitCountdown]);

  // ── Waypoint ops ──────────────────────────────────────────────────────
  const removeWaypoint = i => {
    if (waypointEditLocked) {
      showMissionNotice("Action Start sonrası waypoint silme kilitli", "warn");
      return;
    }
    setWaypoints(prev => {
      const nextWaypoints = prev.filter((_, idx) => idx !== i);
      const logText = `WP ${i + 1} silindi`;

      setReachedWaypointIndexes(prevReached => {
        const nextReached = shiftReachedIndexesForRemove(prevReached, i);
        reachedWaypointIndexesRef.current = nextReached;
        return nextReached;
      });

      publishUiState({
        waypoints: nextWaypoints,
        notice: { text: logText, level: "muted" },
        log: { level: "info", text: logText }
      });

      return nextWaypoints;
    });
  };

  const updateSpeed = (i, v) => {
    if (waypointEditLocked) {
      showMissionNotice("Action Start sonrası waypoint düzenleme kilitli", "warn");
      return;
    }
    setWaypoints(prev => {
      const speedMultiplier = waypointSpeedValue(v);
      const nextValue = speedMultiplier.toFixed(2);
      const nextWaypoints = prev.map((wp, idx) =>
        idx === i ? { ...wp, speed: nextValue } : wp
      );

      publishUiState({
        waypoints: nextWaypoints,
        log: { level: "info", text: `WP ${i + 1} hız çarpanı ${speedMultiplier.toFixed(2)} olarak ayarlandı` }
      });

      return nextWaypoints;
    });
  };

  const resetHeadingCorrection = useCallback(() => {
    setCompassHeadingInput("");
    setLastCompassHeadingDeg(null);
    const text = "Pusula girişi sıfırlandı";
    addLog("imu", text);
    showMissionNotice(text, "active");
  }, [addLog, showMissionNotice]);

  const sendRosCompassHeading = useCallback((measuredCompassHeading) => {
    if (!ros || !isConnected) {
      const text = "ROS bağlı değil: pusula değeri ROS'a gönderilemedi";
      addLog("warn", text);
      showMissionNotice(text, "warn");
      return;
    }

    const service = new ROSLIB.Service({
      ros,
      name: `${ROS_HEADING_OFFSET_NODE}/set_parameters`,
      serviceType: "rcl_interfaces/srv/SetParameters"
    });

    service.callService(
      {
        parameters: [
          {
            name: ROS_HEADING_OFFSET_PARAM,
            value: {
              type: 3,
              double_value: measuredCompassHeading
            }
          }
        ]
      },
      result => {
        const paramResult = result?.results?.[0];

        if (paramResult && paramResult.successful === false) {
          const text = `ROS pusula değeri uygulanamadı: ${paramResult.reason || "parametre reddedildi"}`;
          addLog("warn", text);
          showMissionNotice(text, "danger");
          return;
        }

        const text = `ROS pusula değeri gönderildi: ${measuredCompassHeading.toFixed(1)}°`;
        addLog("imu", `${text} (${ROS_HEADING_OFFSET_NODE}.${ROS_HEADING_OFFSET_PARAM})`);
        showMissionNotice(text, "active");
      },
      error => {
        const reason = typeof error === "string" ? error : error?.message || "servis çağrısı başarısız";
        const text = `ROS pusula değeri uygulanamadı: ${reason}`;
        addLog("warn", text);
        showMissionNotice(text, "danger");
      }
    );
  }, [addLog, isConnected, ros, showMissionNotice]);

  const calibrateHeadingFromInput = useCallback(() => {
    const value = Number(compassHeadingInput);

    if (!Number.isFinite(value)) {
      const text = "Aracın önünün baktığı pusula değerini derece olarak gir";
      addLog("warn", text);
      showMissionNotice(text, "warn");
      return;
    }

    const measuredCompassHeading = normalizeBearingDeg(value);
    setLastCompassHeadingDeg(measuredCompassHeading);
    sendRosCompassHeading(measuredCompassHeading);
  }, [
    addLog,
    compassHeadingInput,
    sendRosCompassHeading,
    showMissionNotice
  ]);

  const updateWaitSeconds = (i, v) => {
    if (waypointEditLocked) {
      showMissionNotice("Action Start sonrası waypoint düzenleme kilitli", "warn");
      return;
    }
    setWaypoints(prev => {
      const nextWaitSeconds = waypointWaitSecondsValue(v);
      const nextWaypoints = prev.map((wp, idx) =>
        idx === i ? { ...wp, waitSeconds: nextWaitSeconds } : wp
      );
      const logText = nextWaitSeconds
        ? `WP ${i + 1} hassas işlem: ${nextWaitSeconds}s bekleme`
        : `WP ${i + 1} hassas işlem kaldırıldı`;

      publishUiState({
        waypoints: nextWaypoints,
        log: { level: "info", text: logText }
      });

      return nextWaypoints;
    });
  };

  const updateMode = (i, v) => {
    if (waypointEditLocked) {
      showMissionNotice("Action Start sonrası waypoint düzenleme kilitli", "warn");
      return;
    }
    setWaypoints(prev => {
      const nextMode = waypointModeValue(v);
      const nextWaypoints = prev.map((wp, idx) =>
        idx === i ? { ...wp, mode: nextMode } : wp
      );

      publishUiState({
        waypoints: nextWaypoints,
        log: { level: "info", text: `WP ${i + 1} mode ${waypointModeLabel(nextMode)} olarak ayarlandı` }
      });

      return nextWaypoints;
    });
  };

  const moveWaypoint = (from, dir) => {
    if (waypointEditLocked) {
      showMissionNotice("Action Start sonrası waypoint sıra değişikliği kilitli", "warn");
      return;
    }
    setWaypoints(prev => {
      const to = from + dir;
      if (to < 0 || to >= prev.length) return prev;

      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];

      setReachedWaypointIndexes(prevReached => {
        const nextReached = shiftReachedIndexesForMove(prevReached, from, to);
        reachedWaypointIndexesRef.current = nextReached;
        return nextReached;
      });

      publishUiState({
        waypoints: next,
        log: { level: "info", text: `WP ${from + 1} sıra değiştirildi` }
      });
      return next;
    });
  };

  const clearAll = () => {
    storageRemove(WAYPOINTS_STORAGE_KEY);
    showDerivedGoalMarkersRef.current = false;
    setShowDerivedGoalMarkers(false);
    setWaypointEditLocked(false);
    waypointsRef.current = [];
    setWaypoints([]);
    reachedWaypointIndexesRef.current = new Set();
    setReachedWaypointIndexes(new Set());
    setMissionStopped(false);
    clearWaitCountdown();
    setDebugPoints([]);
    debugPointsRef.current = [];
    addLog("info", "Waypoint ve debug markerlari temizlendi");
    showMissionNotice("Waypoint ve debug markerları temizlendi", "muted");
    publishUiState({
      waypoints: [],
      missionStopped: false,
      clearDebug: true,
      notice: { text: "Waypoint ve debug markerları temizlendi", level: "muted" },
      log: { level: "info", text: "Waypoint ve debug markerları temizlendi" }
    });

    wpMarkersRef.current.forEach(m => m.remove());
    wpMarkersRef.current = [];

    convertedMarkersRef.current.forEach(m => m.remove());
    convertedMarkersRef.current = [];
    tfPoseMarkerRef.current?.remove();
    tfPoseMarkerRef.current = null;
    nav2GoalRef.current = null;
    setNav2GoalInfo(null);
    nav2GoalMarkerRef.current?.remove();
    nav2GoalMarkerRef.current = null;

    routePolylineRef.current?.setLatLngs([]);
    globalPlanRef.current = [];
    localPlanRef.current = [];
    setGlobalPlanInfo(null);
    setLocalPlanInfo(null);
    globalPlanPolylineRef.current?.setLatLngs([]);
    localPlanPolylineRef.current?.setLatLngs([]);
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
  const projectionHeadingOffsetDeg = radToDeg(projectionHeadingOffsetRadRef.current);
  const displayYawDeg = robotPoseInfo
    ? radToDeg(normalizeRad(robotPoseInfo.yaw))
    : null;
  const displayCompassBearingDeg = displayYawDeg !== null
    ? displayAngleDegToCompassBearing(displayYawDeg)
    : null;
  const debugDisplayYawDeg = displayYawDeg !== null ? normalizeDeg(displayYawDeg) : null;
  const currentGpsLatLng = useMemo(() => (
    Number.isFinite(rawGpsInfo?.latitude) && Number.isFinite(rawGpsInfo?.longitude)
      ? { lat: rawGpsInfo.latitude, lng: rawGpsInfo.longitude }
      : null
  ), [rawGpsInfo?.latitude, rawGpsInfo?.longitude]);
  const coverageAnchor = useMemo(
    () => coveragePoints[0] || currentGpsLatLng || GPS_DATUM,
    [coveragePoints, currentGpsLatLng]
  );
  const coverageLocalPoints = useMemo(
    () => coveragePoints.map(point => latLngToLocalMeters(point, coverageAnchor)).filter(Boolean),
    [coveragePoints, coverageAnchor]
  );
  const coverageSweepOptions = useMemo(() => ({
    style: coverageStyle,
    lineSpacing: coverageLineSpacing,
    pointDensity: coveragePointDensity,
    navPoseSpacing: coverageNavPoseSpacing,
    sweepAngleDeg: coverageSweepAngle,
    diagonalAngleDeg: coverageDiagonalAngle,
    headingDeg: coverageHeadingDeg,
    curveStrength: coverageCurveStrength,
    circleDirection: coverageCircleDirection,
    spiralDirection: coverageSpiralDirection,
    spiralRotation: coverageSpiralRotation,
    startRadius: coverageStartRadius,
    headlandPasses: coverageHeadlandPasses,
    boundaryDirection: coverageBoundaryDirection,
    startCorner: coverageStartCorner,
  }), [
    coverageStyle,
    coverageLineSpacing,
    coveragePointDensity,
    coverageNavPoseSpacing,
    coverageSweepAngle,
    coverageDiagonalAngle,
    coverageHeadingDeg,
    coverageCurveStrength,
    coverageCircleDirection,
    coverageSpiralDirection,
    coverageSpiralRotation,
    coverageStartRadius,
    coverageHeadlandPasses,
    coverageBoundaryDirection,
    coverageStartCorner,
  ]);
  const coverageLocalNodes = useMemo(
    () => buildCoverageNavPoints(coverageLocalPoints, coverageSweepOptions),
    [coverageLocalPoints, coverageSweepOptions]
  );
  const coverageAutoRouteNodes = useMemo(
    () => coverageLocalNodes
      .map(node => {
        const latLng = localMetersToLatLng(node, coverageAnchor);
        if (!latLng) return null;
        const constrained = constrainLatLngToPolygon(latLng, coveragePoints, coverageAnchor).latLng || latLng;
        return { ...node, lat: constrained.lat, lng: constrained.lng };
      })
      .filter(Boolean),
    [coverageLocalNodes, coverageAnchor, coveragePoints]
  );
  const coverageRouteNodes = coverageAutoRouteNodes;
  const coverageFrameBaseGps = useMemo(
    () => latLngFromPayload(gpsFrameDebugInfo?.base_gps) || currentGpsLatLng || null,
    [gpsFrameDebugInfo, currentGpsLatLng]
  );
  const coverageFramePose = useMemo(() => {
    const baseMap = gpsFrameDebugInfo?.base_map || {};
    const baseX = toNum(baseMap.x);
    const baseY = toNum(baseMap.y);

    if (baseX === null || baseY === null || !robotPoseInfo) return robotPoseInfo || null;

    return {
      x: baseX,
      y: baseY,
      yaw: robotPoseInfo.yaw
    };
  }, [gpsFrameDebugInfo, robotPoseInfo]);
  const coverageActualPathNodes = useMemo(() => {
    if (coveragePoints.length < 3) return [];
    if (!coverageFrameBaseGps || !coverageFramePose || gpsCoveragePathPoints.length === 0) return [];

    return gpsCoveragePathPoints
      .map((point, index) => {
        const latLng = projectMapXYToLatLng(
          point.x,
          point.y,
          coverageFrameBaseGps,
          coverageFramePose,
          NAVSAT_MAP_TO_ENU_OFFSET_RAD
        );

        if (!latLng) return null;
        return {
          label: `WP${index + 1}`,
          lat: latLng.lat,
          lng: latLng.lng,
          x: point.x,
          y: point.y,
        };
      })
      .filter(Boolean);
  }, [coveragePoints.length, coverageFrameBaseGps, coverageFramePose, gpsCoveragePathPoints]);
  const coverageDebugNavNodes = useMemo(() => {
    if (coveragePoints.length < 3) return [];
    if (!currentGpsLatLng || !robotPoseInfo || debugPoints.length === 0) return [];

    return debugPoints
      .map((rawPoint, fallbackIndex) => {
        const point = readDebugPoint(rawPoint);
        const idx = point?.index ?? pointIndex(rawPoint, fallbackIndex);
        const lat = point?.latitude ?? null;
        const lng = point?.longitude ?? null;
        const vehicleTarget = debugPointVehicleTarget(point);
        const vehicleX = vehicleTarget?.x ?? null;
        const vehicleY = vehicleTarget?.y ?? null;
        const projectedVehicleLatLng = vehicleX !== null && vehicleY !== null
          ? projectMapXYToLatLng(
              vehicleX,
              vehicleY,
              currentGpsLatLng,
              robotPoseInfo,
              projectionHeadingOffsetRadRef.current
            )
          : null;
        const vehicleLatLng = lat !== null && lng !== null
          ? { lat, lng }
          : projectedVehicleLatLng;

        if (!vehicleLatLng) return null;
        return {
          label: `T${idx}`,
          lat: vehicleLatLng.lat,
          lng: vehicleLatLng.lng,
          x: vehicleX,
          y: vehicleY,
        };
      })
      .filter(Boolean);
  }, [coveragePoints.length, currentGpsLatLng, robotPoseInfo, debugPoints, pointIndex]);
  const coverageIntermediateNodes = coverageDebugNavNodes.length > 0
    ? coverageDebugNavNodes
    : coverageActualPathNodes.map((node, index) => ({
        ...node,
        label: `T${index + 1}`,
      }));
  const coverageHasActualPath = coverageActualPathNodes.length >= 2;
  const addCoverageManualNodeAfter = useCallback((anchorLabel) => {
    const idx = coverageRouteNodes.findIndex(n => n.label === anchorLabel);
    const anchor = anchorLabel === null ? null : coverageRouteNodes[idx];
    const next = anchorLabel === null ? coverageRouteNodes[0] : coverageRouteNodes[idx + 1];
    const lat = anchor && next ? (anchor.lat + next.lat) / 2 : (anchor || next)?.lat;
    const lng = anchor && next ? (anchor.lng + next.lng) / 2 : (anchor || next)?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const siblingCount = coverageManualNodes.filter(m => m.afterLabel === anchorLabel).length;
    const anchorPrefix = anchorLabel === null ? "T0" : anchorLabel;
    const newLabel = `${anchorPrefix}.${siblingCount + 1}`;

    setCoverageManualNodes(prev => [...prev, { label: newLabel, afterLabel: anchorLabel }]);
    setCoverageNodeOverrides(prev => ({ ...prev, [newLabel]: { lat, lng } }));
  }, [coverageRouteNodes, coverageManualNodes]);
  const removeCoverageManualNode = useCallback((label) => {
    setCoverageManualNodes(prev => prev.filter(m => m.label !== label));
    setCoverageNodeOverrides(prev => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
    setCoverageWaitPoints(prev => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }, []);
  const clearCoveragePlanner = useCallback(() => {
    setCoverageDrawingEnabled(false);
    setCoveragePoints([]);
    setCoverageWaitPoints({});
    setCoverageNodeOverrides({});
    setCoverageRemovedNodeLabels([]);
    setCoverageManualNodes([]);
    setSelectedCoverageNodeLabel(null);
    setCoveragePublishStatus("");
    setCoveragePublishError("");
    setCoverageStartStatus("");
    setCoverageStartError("");
    setCoverageCancelStatus("");
    setCoverageCancelError("");
    setGpsCoveragePathInfo(null);
    setGpsCoveragePathPoints([]);

    coveragePolygonRef.current?.remove();
    coveragePolygonRef.current = null;
    coverageSweepLineRef.current?.remove();
    coverageSweepLineRef.current = null;
    coverageGeneratedMarkersRef.current.forEach(marker => marker.remove());
    coverageGeneratedMarkersRef.current = [];
    coveragePointMarkersRef.current.forEach(marker => marker.remove());
    coveragePointMarkersRef.current = [];

    storageRemove(GPS_COVERAGE_STORAGE_KEY);
    showMissionNotice("Coverage alanı temizlendi", "muted");
    addLog("info", "GPS coverage alanı ve tarama noktaları temizlendi");
  }, [addLog, showMissionNotice]);
  const coverageRouteLengthM = useMemo(
    () => coverageIntermediateNodes.length >= 2
      ? coverageIntermediateNodes.slice(0, -1).reduce((sum, node, i) => sum + haversine(node, coverageIntermediateNodes[i + 1]), 0)
      : 0,
    [coverageIntermediateNodes]
  );
  const selectedNoGoZone = useMemo(
    () => noGoZones.find(zone => zone.id === selectedNoGoZoneId) || null,
    [noGoZones, selectedNoGoZoneId]
  );
  const noGoGroupCount = useMemo(
    () => new Set(noGoZones.map(zone => zone.groupId)).size + (draftNoGoPoints.length > 0 ? 1 : 0),
    [draftNoGoPoints.length, noGoZones]
  );
  const selectedNoGoPoints = useMemo(
    () => (selectedNoGoZone?.coordinates || []).map(normalizeGpsPoint).filter(Boolean),
    [selectedNoGoZone]
  );

  const buildNoGoZoneFromChecked = useCallback((checked, name, groupId) => {
    const now = nowIso();
    return {
      id: noGoZoneId(),
      name: (name || `Grup ${groupId} bölgesi`).trim(),
      groupId,
      enabled: true,
      type: "hard",
      bufferMeters: 0,
      coordinates: checked.points.map(point => ({
        latitude: point.lat,
        longitude: point.lng,
        ...(Number.isFinite(point.altitude) ? { altitude: point.altitude } : {})
      })),
      metadata: {
        created_at: now,
        updated_at: now,
        buffer_m: 0,
        keepout_buffer_m: 0
      }
    };
  }, []);

  const updateNoGoZonePoints = useCallback((zoneId, points) => {
    const checked = validateGpsPolygon(points);
    if (!checked.ok) {
      setNoGoPublishError(checked.warnings[0]);
      return false;
    }

    const now = nowIso();
    setNoGoZones(prev => prev.map(zone => (
      zone.id === zoneId
        ? {
            ...zone,
            coordinates: checked.points.map(point => ({
              latitude: point.lat,
              longitude: point.lng,
              ...(Number.isFinite(point.altitude) ? { altitude: point.altitude } : {})
            })),
            metadata: { ...(zone.metadata || {}), updated_at: now }
          }
        : zone
    )));
    setNoGoPublishError("");
    setNoGoPublishStatus(checked.warnings.join(" "));
    return true;
  }, []);

  const finishNoGoDraft = useCallback(() => {
    const checked = validateGpsPolygon(draftNoGoPointsRef.current);
    if (!checked.ok) {
      setNoGoPublishError(checked.warnings[0]);
      return;
    }

    setPendingNoGoZone(checked);
    setPendingNoGoName(`Grup ${draftNoGoGroupId} bölgesi`);
  }, [draftNoGoGroupId]);

  const commitPendingNoGoZone = useCallback(() => {
    if (!pendingNoGoZone) return;

    const zone = buildNoGoZoneFromChecked(pendingNoGoZone, pendingNoGoName || "Yasak bölge", draftNoGoGroupId);

    setNoGoZones(prev => [...prev, zone]);
    setSelectedNoGoZoneId(zone.id);
    setSelectedNoGoVertexIndex(null);
    setDraftNoGoPoints([]);
    setPendingNoGoZone(null);
    setPendingNoGoName("");
    setNoGoDrawingEnabled(false);
    setDraftNoGoGroupId(prev => prev + 1);
    setNoGoPublishError("");
    setNoGoPublishStatus(pendingNoGoZone.warnings.join(" "));
    showMissionNotice("Yasak bölge kaydedildi", "active");
  }, [buildNoGoZoneFromChecked, draftNoGoGroupId, pendingNoGoName, pendingNoGoZone, showMissionNotice]);

  const cancelNoGoDraft = useCallback(() => {
    setDraftNoGoPoints([]);
    setPendingNoGoZone(null);
    setPendingNoGoName("");
    setNoGoDrawingEnabled(false);
    setNoGoPublishError("");
    setNoGoPublishStatus("");
  }, []);

  const removeSelectedNoGoVertex = useCallback(() => {
    if (!selectedNoGoZone || selectedNoGoVertexIndex === null || selectedNoGoPoints.length <= 3) return;

    const nextPoints = selectedNoGoPoints.filter((_, index) => index !== selectedNoGoVertexIndex);
    if (updateNoGoZonePoints(selectedNoGoZone.id, nextPoints)) {
      setSelectedNoGoVertexIndex(null);
    }
  }, [selectedNoGoPoints, selectedNoGoVertexIndex, selectedNoGoZone, updateNoGoZonePoints]);

  const buildNoGoPayload = useCallback((zones = noGoZonesRef.current) => ({
    no_go_zones: (noGoMasterEnabled ? zones : [])
      .filter(zone => zone.enabled !== false)
      .map(zone => ({
        id: zone.id,
        name: zone.name,
        enabled: true,
        type: zone.type || "hard",
        group_id: zone.groupId,
        buffer_m: Number.isFinite(zone.bufferMeters) ? zone.bufferMeters : 0,
        keepout_buffer_m: Number.isFinite(zone.bufferMeters) ? zone.bufferMeters : 0,
        coordinates: (zone.coordinates || []).map(coord => ({
          latitude: coord.latitude,
          longitude: coord.longitude,
          ...(coord.altitude !== undefined ? { altitude: coord.altitude } : {})
        })),
        metadata: {
          ...(zone.metadata || {}),
          buffer_m: Number.isFinite(zone.bufferMeters) ? zone.bufferMeters : 0,
          keepout_buffer_m: Number.isFinite(zone.bufferMeters) ? zone.bufferMeters : 0
        }
      }))
  }), [noGoMasterEnabled]);

  const sendNoGoPayloadToRos = useCallback((payload, statusText, noticeText, offlineStatusText = "ROS bağlı değil; payload hazır ama yayınlanmadı.") => {
    setNoGoPublishing(true);
    setNoGoPublishError("");

    try {
      if (!ros || !isConnected) {
        setNoGoPublishStatus(offlineStatusText);
        return false;
      }

      publishNoGoPayload({
        ros,
        topicName: GPS_NO_GO_TOPIC,
        payload
      });
      setNoGoPublishStatus(statusText);
      addLog("info", `No-Go zones gönderildi topic=${GPS_NO_GO_TOPIC} active=${payload.no_go_zones.length}`);
      if (noticeText) showMissionNotice(noticeText, "active");
      return true;
    } catch (e) {
      setNoGoPublishError(e?.message || String(e));
      return false;
    } finally {
      setNoGoPublishing(false);
    }
  }, [addLog, isConnected, ros, showMissionNotice]);

  const deleteSelectedNoGoZone = useCallback(() => {
    if (!selectedNoGoZone) return;
    openConfirmDialog({
      title: "Yasak Bölgeyi Sil",
      message: `"${selectedNoGoZone.name}" yasak bölgesinin tamamı silinsin mi?`,
      confirmLabel: "Bölgeyi Sil",
      accent: "#ef4444",
      onConfirm: () => {
        const nextZones = noGoZonesRef.current.filter(zone => zone.id !== selectedNoGoZone.id);
        const payload = buildNoGoPayload(nextZones);

        setNoGoZones(nextZones);
        setSelectedNoGoZoneId(null);
        setSelectedNoGoVertexIndex(null);
        sendNoGoPayloadToRos(
          payload,
          `"${selectedNoGoZone.name}" silindi; ${payload.no_go_zones.length} aktif yasak bölge ${GPS_NO_GO_TOPIC} topic'ine gönderildi.`,
          "Seçili yasak bölge backend'den kaldırıldı",
          `"${selectedNoGoZone.name}" silindi; güncel no-go payload hazır ama ROS bağlı olmadığı için yayınlanmadı.`
        );
      }
    });
  }, [buildNoGoPayload, openConfirmDialog, selectedNoGoZone, sendNoGoPayloadToRos]);

  const deleteDraftNoGoZone = useCallback(() => {
    const draftCount = draftNoGoPointsRef.current.length;
    if (draftCount === 0 && !pendingNoGoZone) return;
    openConfirmDialog({
      title: "Taslak Bölgeyi Sil",
      message: "Taslak yasak bölgenin tamamı silinsin mi?",
      confirmLabel: "Taslağı Sil",
      accent: "#ef4444",
      onConfirm: () => {
        setDraftNoGoPoints([]);
        setPendingNoGoZone(null);
        setPendingNoGoName("");
        setNoGoDrawingEnabled(false);
        setSelectedNoGoVertexIndex(null);
        setNoGoPublishError("");
        setNoGoPublishStatus("Taslak yasak bölge silindi. ROS'a gönderilmiş kayıtlı bir bölge yoktu.");
      }
    });
  }, [openConfirmDialog, pendingNoGoZone]);

  const publishNoGoZones = useCallback(() => {
    if (!noGoEdgeAck) {
      setNoGoPublishError("Kaydetmeden önce kenarlar dahil tamamen yasak onayını işaretleyin.");
      return;
    }

    let zonesForPublish = [...noGoZonesRef.current];
    if (draftNoGoPointsRef.current.length >= 3) {
      const checkedDraft = validateGpsPolygon(draftNoGoPointsRef.current);
      if (!checkedDraft.ok) {
        setNoGoPublishError(checkedDraft.warnings[0]);
        return;
      }

      const autoZone = buildNoGoZoneFromChecked(
        checkedDraft,
        pendingNoGoName || `Grup ${draftNoGoGroupId} bölgesi`,
        draftNoGoGroupId
      );
      zonesForPublish = [...zonesForPublish, autoZone];
      setNoGoZones(zonesForPublish);
      setSelectedNoGoZoneId(autoZone.id);
      setSelectedNoGoVertexIndex(null);
      setDraftNoGoPoints([]);
      setPendingNoGoZone(null);
      setPendingNoGoName("");
      setNoGoDrawingEnabled(false);
      setDraftNoGoGroupId(prev => prev + 1);
      setNoGoPublishStatus("Taslak yasak bölge otomatik kaydedildi.");
    }

    const activeZones = noGoMasterEnabled ? zonesForPublish.filter(zone => zone.enabled !== false) : [];
    for (const zone of activeZones) {
      const checked = validateGpsPolygon(zone.coordinates || []);
      if (!checked.ok) {
        setNoGoPublishError(`${zone.name}: ${checked.warnings[0]}`);
        return;
      }
    }

    const payload = buildNoGoPayload(zonesForPublish);
    sendNoGoPayloadToRos(
      payload,
      `${payload.no_go_zones.length} aktif yasak bölge ${GPS_NO_GO_TOPIC} topic'ine gönderildi.`,
      "Aktif yasak bölgeler backend'e gönderildi",
      `${payload.no_go_zones.length} aktif yasak bölge payload'ı hazır; ROS bağlı olmadığı için yayınlanmadı.`
    );
  }, [buildNoGoPayload, buildNoGoZoneFromChecked, draftNoGoGroupId, noGoEdgeAck, noGoMasterEnabled, pendingNoGoName, sendNoGoPayloadToRos]);
  useCoverageMapLayers({
    mapRef,
    coveragePointMarkersRef,
    coveragePolygonRef,
    coverageSweepLineRef,
    coverageGeneratedMarkersRef,
    coveragePoints,
    coverageAnchor,
    coveragePathNodes: coverageActualPathNodes,
    coverageRouteNodes,
    coverageIntermediateNodes,
    coverageWaitPoints,
    selectedCoverageNodeLabel,
    suppressMapClicksFor,
    coverageVertexIcon,
    coverageIntermediateIcon,
    setCoveragePoints,
    setSelectedCoverageNodeLabel,
    setCoveragePlannerOpen: setCoveragePlannerOpenExclusive,
    constrainLatLngToPolygon,
    setCoveragePublishStatus,
    setCoverageNodeOverrides,
  });

  useNoGoMapLayers({
    mapRef,
    noGoLayerRefs,
    draftNoGoPoints,
    noGoMasterEnabled,
    noGoZones,
    selectedNoGoVertexIndex,
    selectedNoGoZoneId,
    suppressMapClicksFor,
    updateNoGoZonePoints,
    currentGpsLatLng,
    noGoDebugZones,
    robotPoseInfo,
    showNoGoKeepoutBuffer,
    robotLatLonRef,
    robotPoseRef,
    projectionHeadingOffsetRadRef,
    toNum,
    projectMapXYToLatLng,
    normalizeGpsPoint,
    noGoVertexIcon,
    noGoEdgeIcon,
    setDraftNoGoPoints,
    setNoGoPanelOpen: setNoGoPanelOpenExclusive,
    setSelectedNoGoZoneId,
    setSelectedNoGoVertexIndex,
  });

  const coveragePlannerTopicName = coveragePlannerTopic.trim();
  const coverageTopicIsGps = coveragePlannerTopicName.startsWith("/gps_coverage/");
  const coverageHasEditableState =
    coveragePoints.length > 0 ||
    Object.keys(coverageWaitPoints).length > 0 ||
    Object.keys(coverageNodeOverrides).length > 0 ||
    coverageRemovedNodeLabels.length > 0 ||
    coverageManualNodes.length > 0 ||
    selectedCoverageNodeLabel !== null ||
    Boolean(coveragePublishStatus) ||
    Boolean(coveragePublishError);
  const canPublishCoveragePolygon = isConnected && coveragePoints.length >= 3 && coverageTopicIsGps;
  const publishGpsCoveragePolygon = useCallback(() => {
    if (!ros || !isConnected) {
      setCoveragePublishError("ROS bağlı değil");
      return;
    }

    if (coveragePoints.length < 3) {
      setCoveragePublishError("Alan taraması için en az 3 köşe gerekli");
      return;
    }

    const topicName = coveragePlannerTopic.trim();
    if (!topicName) {
      setCoveragePublishError("Planner topic boş olamaz");
      return;
    }

    if (!topicName.startsWith("/gps_coverage/")) {
      setCoveragePublishError("GPSMission yalnızca /gps_coverage/* topic hattını kullanır");
      return;
    }

    setCoveragePublishing(true);
    setCoveragePublishError("");
    setGpsCoveragePathInfo(null);
    setGpsCoveragePathPoints([]);

    try {
      const payload = {
        polygon: coveragePoints.map(point => ({
          lat: point.lat,
          lon: point.lng,
        })),
        style: coverageStyle,
        line_spacing: Number(coverageLineSpacing),
        point_density: Number(coveragePointDensity),
        nav_pose_spacing: Number(coverageNavPoseSpacing),
        sweep_angle_deg: Number(coverageSweepAngle),
        diagonal_angle_deg: Number(coverageDiagonalAngle),
        heading_deg: Number(coverageHeadingDeg),
        curve_strength: Number(coverageCurveStrength),
        circle_direction: coverageCircleDirection,
        spiral_direction: coverageSpiralDirection,
        spiral_rotation: coverageSpiralRotation,
        start_radius: Number(coverageStartRadius),
        headland_passes: Number(coverageHeadlandPasses),
        boundary_direction: coverageBoundaryDirection,
        start_corner: Number(coverageStartCorner),
        nodes: [],
        wait_points: {},
        auto_start: false,
        source: "GPSMissionPlanner",
      };
      publishCoveragePolygon({
        ros,
        topicName,
        payload,
      });
      setCoveragePublishStatus(`Alan planner'a gönderildi: ${coveragePoints.length} köşe. Gerçek takip path'i /gps_coverage/path üzerinden beklenecek.`);
      addLog("info", `GPS coverage alan gönderildi topic=${topicName} corners=${coveragePoints.length}`);
      showMissionNotice("GPS coverage alanı planner'a gönderildi", "active");
    } catch (e) {
      setCoveragePublishError(e?.message || String(e));
    } finally {
      setCoveragePublishing(false);
    }
  }, [
    ros,
    isConnected,
    coveragePoints,
    coveragePlannerTopic,
    coverageRouteNodes,
    coverageStyle,
    coverageLineSpacing,
    coveragePointDensity,
    coverageNavPoseSpacing,
    coverageSweepAngle,
    coverageDiagonalAngle,
    coverageHeadingDeg,
    coverageCurveStrength,
    coverageCircleDirection,
    coverageSpiralDirection,
    coverageSpiralRotation,
    coverageStartRadius,
    coverageHeadlandPasses,
    coverageBoundaryDirection,
    coverageStartCorner,
    coverageWaitPoints,
    coverageIntermediateNodes,
    addLog,
    showMissionNotice,
  ]);
  const startGpsCoverage = useCallback(() => {
    if (!ros || !isConnected) {
      setCoverageStartError("ROS bağlı değil");
      return;
    }

    setCoverageStartStatus("");
    setCoverageStartError("");

    try {
      callCoverageStart({
        ros,
        serviceName: GPS_COVERAGE_START_SERVICE,
        onResult: result => {
        if (result?.success === false) {
          const message = result?.message || "GPS coverage başlatılamadı";
          setCoverageStartError(message);
          showMissionNotice(message, "danger");
          addLog("warn", `GPS coverage start reddedildi: ${message}`);
          return;
        }

        const message = result?.message || "GPS coverage Nav2 yürütmesi başlatıldı";
        setCoverageStartStatus(message);
        showMissionNotice(message, "active");
        addLog("info", `GPS coverage start: ${message}`);
      },
      onError: error => {
        const message = error?.message || String(error || "GPS coverage start servis hatası");
        setCoverageStartError(message);
        showMissionNotice(message, "danger");
        addLog("warn", `GPS coverage start hata: ${message}`);
      }});
    } catch (e) {
      const message = e?.message || String(e);
      setCoverageStartError(message);
    }
	  }, [ros, isConnected, addLog, showMissionNotice]);
  const cancelGpsCoverage = useCallback(() => {
    if (!ros || !isConnected) {
      setCoverageCancelError("ROS bağlı değil");
      return;
    }

    setCoverageCancelling(true);
    setCoverageCancelStatus("");
    setCoverageCancelError("");

    try {
      callCoverageCancel({
        ros,
        serviceName: GPS_COVERAGE_CANCEL_SERVICE,
        onResult: result => {
        setCoverageCancelling(false);
        if (result?.success === false) {
          const message = result?.message || "Aktif coverage görevi bulunamadı";
          setCoverageCancelError(message);
          showMissionNotice(message, "warn");
          addLog("warn", `GPS coverage cancel reddedildi: ${message}`);
          return;
        }

        const message = result?.message || "GPS coverage görevi iptal edildi";
        setCoverageCancelStatus(message);
        showMissionNotice(message, "danger");
        addLog("info", `GPS coverage cancel: ${message}`);
      },
      onError: error => {
        setCoverageCancelling(false);
        const message = error?.message || String(error || "GPS coverage cancel servis hatası");
        setCoverageCancelError(message);
        showMissionNotice(message, "danger");
        addLog("warn", `GPS coverage cancel hata: ${message}`);
      }});
    } catch (e) {
      setCoverageCancelling(false);
      const message = e?.message || String(e);
      setCoverageCancelError(message);
    }
  }, [ros, isConnected, addLog, showMissionNotice]);

  const offsetLineReady = isConnected && Boolean(currentGpsLatLng) && Boolean(robotPoseInfo);

  const startOffsetLineTracking = useCallback(() => {
    if (!ros || !isConnected) {
      setOffsetLineError("ROS bağlı değil");
      return;
    }
    if (!offsetLineReady) {
      setOffsetLineError("Görev hazırlığı tamam değil: GPS fix / TF bekleniyor");
      showMissionNotice("Offset takip engellendi: GPS fix / TF bekleniyor", "danger");
      return;
    }
    if (!offsetLineStart || !offsetLineEnd) {
      setOffsetLineError("Önce haritada 2 nokta seçin (referans çizgi)");
      return;
    }
    const lineLengthM = haversine(offsetLineStart, offsetLineEnd);
    if (lineLengthM < 0.3) {
      setOffsetLineError(`Referans çizgi çok kısa (${lineLengthM.toFixed(2)} m). En az 0.3 m olmalı.`);
      return;
    }
    const offsetM = Number(offsetLineDistanceCm) / 100;
    if (!Number.isFinite(offsetM) || offsetM <= 0 || offsetM > 5) {
      setOffsetLineError("Offset mesafesi 0-500 cm aralığında olmalı");
      return;
    }

    setOffsetLineError("");
    offsetLineTrailRef.current = [];
    offsetTrailPolylineRef.current?.setLatLngs([]);
    offsetLinePathRef.current = [];
    setOffsetLinePathPointCount(0);
    setOffsetLineRunState("PLANNED");

    const payload = {
      a: { lat: offsetLineStart.lat, lon: offsetLineStart.lng },
      b: { lat: offsetLineEnd.lat, lon: offsetLineEnd.lng },
      offset_m: offsetM,
      side: offsetLineSide,
      auto_start: true,
    };

    try {
      publishOffsetTrackingRequest({
        ros,
        publisherRef: offsetLineRequestPubRef,
        topicName: GPS_OFFSET_LINE_REQUEST_TOPIC,
        payload
      });
      addLog("info", `Offset takip isteği gönderildi: offset=${offsetLineDistanceCm}cm side=${offsetLineSide}`);
      showMissionNotice(`Offset takibi gönderildi: ${offsetLineDistanceCm}cm (${offsetLineSide === "left" ? "sol" : "sağ"})`, "active");
    } catch (e) {
      const message = e?.message || String(e);
      setOffsetLineError(message);
      setOffsetLineRunState("ERROR");
    }
  }, [
    ros, isConnected, offsetLineReady, offsetLineStart, offsetLineEnd,
    offsetLineDistanceCm, offsetLineSide, addLog, showMissionNotice
  ]);

  const cancelOffsetLineTracking = useCallback(() => {
    if (!ros || !isConnected) {
      setOffsetLineError("ROS bağlı değil");
      return;
    }

    try {
      callOffsetTrackingCancel({
        ros,
        serviceName: GPS_OFFSET_LINE_CANCEL_SERVICE,
        onResult: result => {
        if (result?.success === false) {
          const message = result?.message || "Aktif offset takibi bulunamadı";
          showMissionNotice(message, "warn");
          addLog("warn", `Offset takip cancel reddedildi: ${message}`);
          return;
        }
        setOffsetLineRunState("STOPPED");
        showMissionNotice("Offset takibi durduruldu", "danger");
        addLog("info", "Offset takip cancel: durduruldu");
      },
      onError: error => {
        const message = error?.message || String(error || "Offset takip cancel servis hatası");
        setOffsetLineError(message);
        showMissionNotice(message, "danger");
        addLog("warn", `Offset takip cancel hata: ${message}`);
      }});
    } catch (e) {
      setOffsetLineError(e?.message || String(e));
    }
  }, [ros, isConnected, addLog, showMissionNotice]);

  const resetOffsetLineDraft = useCallback(() => {
    setOffsetLineStart(null);
    setOffsetLineEnd(null);
    setOffsetLineError("");
    offsetLineTrailRef.current = [];
    offsetTrailPolylineRef.current?.setLatLngs([]);
    offsetLinePathRef.current = [];
    setOffsetLinePathPointCount(0);
    offsetLinePolylineRef.current?.setLatLngs([]);
    setOffsetLineRunState("IDLE");
    setOffsetLineStatusInfo(null);
  }, []);

	  const datumDistanceM = currentGpsLatLng ? haversine(currentGpsLatLng, GPS_DATUM) : null;
	  const datumBearingDeg = currentGpsLatLng ? bearingDeg(currentGpsLatLng, GPS_DATUM) : null;
	  const frameDebugBaseMap = gpsFrameDebugInfo?.base_map || {};
	  const frameDebugBackendGps = latLngFromPayload(gpsFrameDebugInfo?.base_gps);
	  const frameDebugBaseGps = frameDebugBackendGps || currentGpsLatLng;
	  const frameDebugBaseX = toNum(frameDebugBaseMap.x) ?? robotPoseInfo?.x ?? null;
	  const frameDebugBaseY = toNum(frameDebugBaseMap.y) ?? robotPoseInfo?.y ?? null;
	  const backendYawDeg = toNum(frameDebugBaseMap.yaw_deg);
	  const tfYawDeg = mapYawDeg;
	  const frameDebugPose = frameDebugBaseX !== null && frameDebugBaseY !== null && robotPoseInfo?.yaw !== undefined
	    ? {
	        x: frameDebugBaseX,
	        y: frameDebugBaseY,
	        yaw: robotPoseInfo.yaw
	      }
	    : null;
	  const frameDebugAxisMarkers = gpsFrameDebugInfo?.axis_markers || {};
	  const frameDebugPlusX =
	    latLngFromPayload(frameDebugAxisMarkers.map_plus_x) ||
	    (frameDebugBaseGps && frameDebugPose
	      ? projectMapXYToLatLng(frameDebugPose.x + 1.0, frameDebugPose.y, frameDebugBaseGps, frameDebugPose, NAVSAT_MAP_TO_ENU_OFFSET_RAD)
	      : null);
	  const frameDebugPlusY =
	    latLngFromPayload(frameDebugAxisMarkers.map_plus_y) ||
	    (frameDebugBaseGps && frameDebugPose
	      ? projectMapXYToLatLng(frameDebugPose.x, frameDebugPose.y + 1.0, frameDebugBaseGps, frameDebugPose, NAVSAT_MAP_TO_ENU_OFFSET_RAD)
	      : null);
	  const rosPlusXBearingDeg = frameDebugBaseGps && frameDebugPlusX ? bearingDeg(frameDebugBaseGps, frameDebugPlusX) : null;
	  const rosPlusYBearingDeg = frameDebugBaseGps && frameDebugPlusY ? bearingDeg(frameDebugBaseGps, frameDebugPlusY) : null;
	  const frameDebugProjectedBaseLinkPlusX =
	    frameDebugBaseGps && frameDebugPose
	      ? projectMapXYToLatLng(
	          frameDebugPose.x + Math.cos(frameDebugPose.yaw) * 1.0,
	          frameDebugPose.y + Math.sin(frameDebugPose.yaw) * 1.0,
	          frameDebugBaseGps,
	          frameDebugPose,
	          NAVSAT_MAP_TO_ENU_OFFSET_RAD
	        )
	      : null;
	  const projectedUiBearingDeg = frameDebugBaseGps && frameDebugProjectedBaseLinkPlusX
	    ? bearingDeg(frameDebugBaseGps, frameDebugProjectedBaseLinkPlusX)
	    : null;
	  const baseLinkCompassBearingDeg = tfYawDeg !== null
	    ? normalizeBearingDeg(90 - tfYawDeg)
	    : null;
	  const rosHeadingBearingDeg = projectedUiBearingDeg;
	  const uiHeadingBearingDeg = displayCompassBearingDeg;
	  const rosUiHeadingDiffDeg = rosHeadingBearingDeg !== null && uiHeadingBearingDeg !== null
	    ? normalizeSignedDeg(uiHeadingBearingDeg - rosHeadingBearingDeg)
	    : null;
	  const frameDebugSource = gpsFrameDebugInfo ? GPS_FRAME_DEBUG_TOPIC : "/tf + /fix fallback";
	  const gpsTfDx = Number.isFinite(gpsOdomInfo?.x) && Number.isFinite(robotPoseInfo?.x)
	    ? gpsOdomInfo.x - robotPoseInfo.x
	    : null;
  const gpsTfDy = Number.isFinite(gpsOdomInfo?.y) && Number.isFinite(robotPoseInfo?.y)
    ? gpsOdomInfo.y - robotPoseInfo.y
    : null;
  const gpsTfDistance = gpsTfDx !== null && gpsTfDy !== null
    ? Math.hypot(gpsTfDx, gpsTfDy)
    : null;
  const rtkStatusText = rtkInfo?.rtkStatus || "none";
  const lastDebugPoint = debugPoints.length ? readDebugPoint(debugPoints[debugPoints.length - 1]) : null;
  const missionColors = missionNoticeColors(missionNotice?.level);
  const missionReadiness = useMemo(() => buildMissionReadiness({
    isConnected,
    waypoints,
    currentGpsLatLng,
    rawGpsInfo,
    robotPoseInfo,
    gpsTfDistance,
    datumDistanceM,
    debugPoints,
    lastDebugPoint,
    nav2GoalInfo
  }), [
    isConnected,
    waypoints,
    currentGpsLatLng,
    rawGpsInfo,
    robotPoseInfo,
    gpsTfDistance,
    datumDistanceM,
    debugPoints,
    lastDebugPoint,
    nav2GoalInfo
  ]);
  const readinessHeaderColors = checkColors(missionReadiness.worstLevel);

  return (
    <>
      <style>{CSS}</style>

      <div
        ref={layoutRef}
        className="gmp-layout"
        style={{
          height: "calc(100vh - 56px)",
          width: "100%",
          display: "grid",
          gridTemplateRows: `minmax(0, 1fr) ${tableHeight}px`,
          gridTemplateColumns: `minmax(0, 1fr) ${actionPanelWidth}px`,
          overflow: "hidden",
          fontFamily: SANS,
          background: "#1b1b20",
          color: "#e6e6e6"
        }}
      >
        <div className="gmp-map-cell" style={{ gridColumn: "1", gridRow: "1", position: "relative", minHeight: 0 }}>
          <div ref={mapDivRef} style={{ width: "100%", height: "100%" }} />

          <div
            style={{
              position: "absolute",
              top: 6,
              right: 10,
              zIndex: 1000,
              color: "#f1f1f1",
              fontFamily: MONO,
              fontSize: "11px",
              lineHeight: 1.35,
              textAlign: "right",
              textShadow: "0 1px 2px #000"
            }}
          >
            <div>Distance: {totalDist !== null ? fmtDist(totalDist) : "0 m"}</div>
            <div>WP Count: {waypoints.length}</div>
	            <div>Map: Offline Satellite</div>
	          </div>

            <GPSMissionPlannerFrameDebugPanel
              formatSignedDeg={formatSignedDeg}
              rosUiHeadingDiffDeg={rosUiHeadingDiffDeg}
              tfYawDeg={tfYawDeg}
              baseLinkCompassBearingDeg={baseLinkCompassBearingDeg}
              showBaseLinkXAxisArrow={showBaseLinkXAxisArrow}
              setShowBaseLinkXAxisArrow={setShowBaseLinkXAxisArrow}
              rosHeadingBearingDeg={rosHeadingBearingDeg}
              projectionHeadingOffsetDeg={projectionHeadingOffsetDeg}
              projectedUiBearingDeg={projectedUiBearingDeg}
              showUiHeadingArrow={showUiHeadingArrow}
              setShowUiHeadingArrow={setShowUiHeadingArrow}
              uiHeadingBearingDeg={uiHeadingBearingDeg}
              showRosMapXAxisArrow={showRosMapXAxisArrow}
              setShowRosMapXAxisArrow={setShowRosMapXAxisArrow}
              rosPlusXBearingDeg={rosPlusXBearingDeg}
              showRosMapYAxisArrow={showRosMapYAxisArrow}
              setShowRosMapYAxisArrow={setShowRosMapYAxisArrow}
              rosPlusYBearingDeg={rosPlusYBearingDeg}
              frameDebugSource={frameDebugSource}
            />

            <label
              style={{
                position: "absolute",
                top: 354,
                left: 10,
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                background: "rgba(17,24,39,0.78)",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 4,
                color: "#e5e7eb",
                fontFamily: MONO,
                fontSize: "11px",
                lineHeight: 1.2,
                boxShadow: "0 4px 12px rgba(0,0,0,.22)"
              }}
            >
              <input
                type="checkbox"
                checked={centerOnRobot}
                onChange={() => {
                  setCenterOnRobot(v => {
                    const nextValue = !v;
                    publishUiState({
                      centerOnRobot: nextValue,
                      log: {
                        level: "info",
                        text: nextValue ? "Robotu takip et açıldı" : "Robotu takip et kapatıldı"
                      }
                    });
                    return nextValue;
                  });
                }}
              />
              Robotu takip et
            </label>

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

          {activeWaitIndex !== null && (
            <div
              style={{
                position: "absolute",
                top: missionNotice ? 50 : 8,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1100,
                width: "min(360px, calc(100% - 36px))",
                padding: "6px 10px",
                border: "1px solid #f59e0b",
                borderRadius: 4,
                background: "rgba(80, 56, 11, 0.92)",
                color: "#ffd784",
                boxShadow: "0 8px 24px rgba(0,0,0,.32)",
                fontFamily: MONO,
                fontSize: "11px",
                fontWeight: 800,
                lineHeight: 1.25,
                pointerEvents: "none",
                textAlign: "center"
              }}
            >
              <div>
                ⏳ HASSAS İŞLEM — WP {activeWaitIndex + 1}: {activeWaitRemaining}s kaldı
              </div>
              <div style={{ height: 4, marginTop: 5, borderRadius: 2, background: "rgba(245,158,11,0.25)" }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 2,
                    background: "#f59e0b",
                    width: `${activeWaitDurationRef.current
                      ? Math.min(100, Math.max(0, (activeWaitRemaining / activeWaitDurationRef.current) * 100))
                      : 0}%`,
                    transition: "width .25s linear"
                  }}
                />
              </div>
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

          <div className="gmp-heading-calibration">
            <div style={{ color: "#9ea0a8", fontWeight: 800 }}>Pusulaya Göre Araç Önü Kalibrasyonu</div>
            <div className="gmp-heading-grid">
              <div>Map yaw: {mapYawDeg !== null ? `${mapYawDeg.toFixed(1)}°` : "-"}</div>
              <div>TF bearing: {displayCompassBearingDeg !== null ? `${displayCompassBearingDeg.toFixed(1)}°` : "-"}</div>
              <div>IMU yaw: {imuInfo ? `${radToDeg(imuInfo.yaw).toFixed(1)}°` : "-"}</div>
              <div>IMU bearing: {imuInfo ? `${imuInfo.bearing.toFixed(1)}°` : "-"}</div>
              <div>Declination: {radToDeg(NAVSAT_MAGNETIC_DECLINATION_RAD).toFixed(1)}°</div>
              <div>Yaw offset: {radToDeg(NAVSAT_YAW_OFFSET_RAD).toFixed(1)}°</div>
              <div>Base Map→ENU: {NAVSAT_MAP_TO_ENU_OFFSET_DEG.toFixed(1)}°</div>
              <div>Girilen pusula: {lastCompassHeadingDeg !== null ? `${lastCompassHeadingDeg.toFixed(1)}°` : "-"}</div>
              <div>ROS'a gönderilen: {lastCompassHeadingDeg !== null ? `${lastCompassHeadingDeg.toFixed(1)}°` : "-"}</div>
            </div>
            <div className="gmp-heading-controls">
              <input
                type="number"
                step="0.1"
                value={compassHeadingInput}
                onChange={e => setCompassHeadingInput(e.target.value)}
                placeholder="örn. 273.5"
                title="Aracın önünün harici pusulada/telefon pusulasında baktığı değer. 0=Kuzey, 90=Doğu, 180=Güney, 270=Batı"
              />
              <button
                type="button"
                onClick={calibrateHeadingFromInput}
                title="Girilen araç önü pusula değerine göre kalibre et"
              >
                Kalibre Et
              </button>
              <button
                type="button"
                onClick={resetHeadingCorrection}
                title="Kalibrasyon düzeltmesini sıfırla"
              >
                Sıfırla
              </button>
            </div>
            <div className="gmp-heading-note">
              Buraya düzeltme açısı değil, aracın burnunun harici pusulada/telefon pusulasında baktığı değeri yaz. Örn: araç önü batıya bakıyorsa 270 gir. Kalibre Et bu değeri ROS parametresine gönderir; oklar ROS'tan gelen güncel TF/debug bilgileriyle yeniden çizilir.
            </div>
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
            {coverageDrawingEnabled
              ? "Coverage polygon çizimi aktif: haritaya tıkla, nokta ekle · Turuncu: alan · Mavi: preview"
              : "Haritaya tıkla: waypoint ekle · Sarı çizgi: WP rota · Cyan: /plan"}
          </div>

          <div
            className="gmp-derived-toggles"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <label className="gmp-derived-toggle">
              <input
                type="checkbox"
                checked={showDerivedGoalMarkers}
                onChange={e => setShowDerivedGoalMarkers(e.target.checked)}
              />
              <span>NAV/Goal marker</span>
            </label>

            <label className="gmp-derived-toggle gmp-plan-toggle">
              <input
                type="checkbox"
                checked={showGlobalPlan}
                onChange={e => setShowGlobalPlan(e.target.checked)}
              />
              <span>/plan</span>
            </label>

            <label className="gmp-derived-toggle">
              <input
                type="checkbox"
                checked={showNoGoKeepoutBuffer}
                onChange={e => setShowNoGoKeepoutBuffer(e.target.checked)}
              />
              <span>Nav2 Actual Keepout</span>
            </label>
          </div>

          <div className="gmp-map-actions">
            <NoGoMissionSection
              showPanel={false}
              panelOpen={noGoPanelOpen}
              setPanelOpen={setNoGoPanelOpenExclusive}
              drawingEnabled={noGoDrawingEnabled}
              setDrawingEnabled={setNoGoDrawingEnabled}
              setCoverageDrawingEnabled={setCoverageDrawingEnabled}
              setOffsetLineDrawingEnabled={setOffsetLineDrawingEnabled}
              draftNoGoPoints={draftNoGoPoints}
              setDraftNoGoPoints={setDraftNoGoPoints}
              pendingNoGoZone={pendingNoGoZone}
              setPendingNoGoZone={setPendingNoGoZone}
              pendingNoGoName={pendingNoGoName}
              setPendingNoGoName={setPendingNoGoName}
              draftNoGoGroupId={draftNoGoGroupId}
              finishNoGoDraft={finishNoGoDraft}
              cancelNoGoDraft={cancelNoGoDraft}
              noGoGroupCount={noGoGroupCount}
              noGoZones={noGoZones}
              selectedNoGoZoneId={selectedNoGoZoneId}
              setSelectedNoGoZoneId={setSelectedNoGoZoneId}
              selectedNoGoZone={selectedNoGoZone}
              selectedNoGoVertexIndex={selectedNoGoVertexIndex}
              setSelectedNoGoVertexIndex={setSelectedNoGoVertexIndex}
              selectedNoGoPoints={selectedNoGoPoints}
              setNoGoZones={setNoGoZones}
              noGoMasterEnabled={noGoMasterEnabled}
              setNoGoMasterEnabled={setNoGoMasterEnabled}
              showNoGoKeepoutBuffer={showNoGoKeepoutBuffer}
              setShowNoGoKeepoutBuffer={setShowNoGoKeepoutBuffer}
              noGoDebugZones={noGoDebugZones}
              noGoEdgeAck={noGoEdgeAck}
              setNoGoEdgeAck={setNoGoEdgeAck}
              noGoPublishing={noGoPublishing}
              noGoPublishStatus={noGoPublishStatus}
              noGoPublishError={noGoPublishError}
              setNoGoPublishStatus={setNoGoPublishStatus}
              setNoGoPublishError={setNoGoPublishError}
              NO_GO_DEBUG_TOPIC={NO_GO_DEBUG_TOPIC}
              GPS_NO_GO_TOPIC={GPS_NO_GO_TOPIC}
              commitPendingNoGoZone={commitPendingNoGoZone}
              deleteDraftNoGoZone={deleteDraftNoGoZone}
              updateNoGoZonePoints={updateNoGoZonePoints}
              removeSelectedNoGoVertex={removeSelectedNoGoVertex}
              deleteSelectedNoGoZone={deleteSelectedNoGoZone}
              publishNoGoZones={publishNoGoZones}
              nowIso={nowIso}
            />
            <OffsetTrackingMissionSection
              showPanel={false}
              panelOpen={offsetLinePanelOpen}
              setPanelOpen={setOffsetLinePanelOpenExclusive}
              drawingEnabled={offsetLineDrawingEnabled}
              setDrawingEnabled={setOffsetLineDrawingEnabled}
              setNoGoDrawingEnabled={setNoGoDrawingEnabled}
              setCoverageDrawingEnabled={setCoverageDrawingEnabled}
              cancelOffsetLineTracking={cancelOffsetLineTracking}
              isConnected={isConnected}
              offsetLineRunState={offsetLineRunState}
              offsetLineStart={offsetLineStart}
              offsetLineEnd={offsetLineEnd}
              haversine={haversine}
              resetOffsetLineDraft={resetOffsetLineDraft}
              offsetLineDistanceCm={offsetLineDistanceCm}
              setOffsetLineDistanceCm={setOffsetLineDistanceCm}
              offsetLineSide={offsetLineSide}
              setOffsetLineSide={setOffsetLineSide}
              startOffsetLineTracking={startOffsetLineTracking}
              offsetLineReady={offsetLineReady}
              offsetLinePathPointCount={offsetLinePathPointCount}
              offsetLineStatusInfo={offsetLineStatusInfo}
              offsetLineError={offsetLineError}
            />
            <CoverageMissionSection
              showPanel={false}
              plannerOpen={coveragePlannerOpen}
              setPlannerOpen={setCoveragePlannerOpenExclusive}
              drawingEnabled={coverageDrawingEnabled}
              setDrawingEnabled={setCoverageDrawingEnabled}
              setNoGoDrawingEnabled={setNoGoDrawingEnabled}
              setOffsetLineDrawingEnabled={setOffsetLineDrawingEnabled}
              isConnected={isConnected}
              coveragePoints={coveragePoints}
              setCoveragePoints={setCoveragePoints}
              clearCoveragePlanner={clearCoveragePlanner}
              coverageHasEditableState={coverageHasEditableState}
              coverageIntermediateNodes={coverageIntermediateNodes}
              coverageRouteLengthM={coverageRouteLengthM}
              coverageHasActualPath={coverageHasActualPath}
              gpsCoveragePathInfo={gpsCoveragePathInfo}
              coverageStyle={coverageStyle}
              setCoverageStyle={setCoverageStyle}
              coverageLineSpacing={coverageLineSpacing}
              setCoverageLineSpacing={setCoverageLineSpacing}
              coverageDiagonalAngle={coverageDiagonalAngle}
              setCoverageDiagonalAngle={setCoverageDiagonalAngle}
              coverageSweepAngle={coverageSweepAngle}
              setCoverageSweepAngle={setCoverageSweepAngle}
              coverageHeadingDeg={coverageHeadingDeg}
              setCoverageHeadingDeg={setCoverageHeadingDeg}
              coverageCurveStrength={coverageCurveStrength}
              setCoverageCurveStrength={setCoverageCurveStrength}
              coverageCircleDirection={coverageCircleDirection}
              setCoverageCircleDirection={setCoverageCircleDirection}
              coverageSpiralDirection={coverageSpiralDirection}
              setCoverageSpiralDirection={setCoverageSpiralDirection}
              coverageSpiralRotation={coverageSpiralRotation}
              setCoverageSpiralRotation={setCoverageSpiralRotation}
              coverageStartRadius={coverageStartRadius}
              setCoverageStartRadius={setCoverageStartRadius}
              coverageHeadlandPasses={coverageHeadlandPasses}
              setCoverageHeadlandPasses={setCoverageHeadlandPasses}
              coverageBoundaryDirection={coverageBoundaryDirection}
              setCoverageBoundaryDirection={setCoverageBoundaryDirection}
              coveragePointDensity={coveragePointDensity}
              setCoveragePointDensity={setCoveragePointDensity}
              coverageNavPoseSpacing={coverageNavPoseSpacing}
              setCoverageNavPoseSpacing={setCoverageNavPoseSpacing}
              coverageStartCorner={coverageStartCorner}
              setCoverageStartCorner={setCoverageStartCorner}
              coverageNodeOverrides={coverageNodeOverrides}
              setCoverageNodeOverrides={setCoverageNodeOverrides}
              coverageRemovedNodeLabels={coverageRemovedNodeLabels}
              setCoverageRemovedNodeLabels={setCoverageRemovedNodeLabels}
              coverageManualNodes={coverageManualNodes}
              setCoverageManualNodes={setCoverageManualNodes}
              setCoveragePublishStatus={setCoveragePublishStatus}
              setCoveragePublishError={setCoveragePublishError}
              coverageWaitPoints={coverageWaitPoints}
              setCoverageWaitPoints={setCoverageWaitPoints}
              selectedCoverageNodeLabel={selectedCoverageNodeLabel}
              setSelectedCoverageNodeLabel={setSelectedCoverageNodeLabel}
              addCoverageManualNodeAfter={addCoverageManualNodeAfter}
              removeCoverageManualNode={removeCoverageManualNode}
              coveragePlannerTopic={coveragePlannerTopic}
              setCoveragePlannerTopic={setCoveragePlannerTopic}
              coverageTopicIsGps={coverageTopicIsGps}
              publishGpsCoveragePolygon={publishGpsCoveragePolygon}
              canPublishCoveragePolygon={canPublishCoveragePolygon}
              coveragePublishing={coveragePublishing}
              coveragePublishStatus={coveragePublishStatus}
              coveragePublishError={coveragePublishError}
              startGpsCoverage={startGpsCoverage}
              cancelGpsCoverage={cancelGpsCoverage}
              coverageCancelling={coverageCancelling}
              coverageStartStatus={coverageStartStatus}
              coverageStartError={coverageStartError}
              coverageCancelStatus={coverageCancelStatus}
              coverageCancelError={coverageCancelError}
              coverageStartService={GPS_COVERAGE_START_SERVICE}
              coverageCancelService={GPS_COVERAGE_CANCEL_SERVICE}
            />
            <button
              className="gmp-mp-btn"
              onClick={startMission}
              disabled={!missionReadiness.canStart}
              style={{ background: "#b9ff2f" }}
            >
              ACTION START
            </button>
            <button
              className="gmp-mp-btn"
              onClick={toggleMissionStop}
              disabled={!isConnected}
              style={{ background: missionStopped ? "#38bdf8" : "#fbbf24" }}
            >
              {missionStopped ? "RESUME" : "STOP"}
            </button>
            <button
              className="gmp-mp-btn"
              onClick={cancelMission}
              disabled={!isConnected}
              style={{ background: "#ff7070" }}
            >
              ACTION CANCEL
            </button>
            <button className="gmp-mp-btn" onClick={clearAll} disabled={waypoints.length === 0}>
              CLEAR
            </button>
            <button className="gmp-mp-btn" onClick={openSaveRouteDialog} disabled={waypoints.length === 0}>
              ROTA KAYDET
            </button>
            <button className="gmp-mp-btn" onClick={() => setLoadRouteDialogOpen(true)} disabled={savedRoutes.length === 0}>
              KAYITLI ROTA YÜRÜT
            </button>
          </div>

          <NoGoMissionSection
            showTrigger={false}
            panelOpen={noGoPanelOpen}
            setPanelOpen={setNoGoPanelOpenExclusive}
            drawingEnabled={noGoDrawingEnabled}
            setDrawingEnabled={setNoGoDrawingEnabled}
            setCoverageDrawingEnabled={setCoverageDrawingEnabled}
            setOffsetLineDrawingEnabled={setOffsetLineDrawingEnabled}
            draftNoGoPoints={draftNoGoPoints}
            setDraftNoGoPoints={setDraftNoGoPoints}
            pendingNoGoZone={pendingNoGoZone}
            setPendingNoGoZone={setPendingNoGoZone}
            pendingNoGoName={pendingNoGoName}
            setPendingNoGoName={setPendingNoGoName}
            draftNoGoGroupId={draftNoGoGroupId}
            finishNoGoDraft={finishNoGoDraft}
            cancelNoGoDraft={cancelNoGoDraft}
            noGoGroupCount={noGoGroupCount}
            noGoZones={noGoZones}
            selectedNoGoZoneId={selectedNoGoZoneId}
            setSelectedNoGoZoneId={setSelectedNoGoZoneId}
            selectedNoGoZone={selectedNoGoZone}
            selectedNoGoVertexIndex={selectedNoGoVertexIndex}
            setSelectedNoGoVertexIndex={setSelectedNoGoVertexIndex}
            selectedNoGoPoints={selectedNoGoPoints}
            setNoGoZones={setNoGoZones}
            noGoMasterEnabled={noGoMasterEnabled}
            setNoGoMasterEnabled={setNoGoMasterEnabled}
            showNoGoKeepoutBuffer={showNoGoKeepoutBuffer}
            setShowNoGoKeepoutBuffer={setShowNoGoKeepoutBuffer}
            noGoDebugZones={noGoDebugZones}
            noGoEdgeAck={noGoEdgeAck}
            setNoGoEdgeAck={setNoGoEdgeAck}
            noGoPublishing={noGoPublishing}
            noGoPublishStatus={noGoPublishStatus}
            noGoPublishError={noGoPublishError}
            setNoGoPublishStatus={setNoGoPublishStatus}
            setNoGoPublishError={setNoGoPublishError}
            NO_GO_DEBUG_TOPIC={NO_GO_DEBUG_TOPIC}
            GPS_NO_GO_TOPIC={GPS_NO_GO_TOPIC}
            commitPendingNoGoZone={commitPendingNoGoZone}
            deleteDraftNoGoZone={deleteDraftNoGoZone}
            updateNoGoZonePoints={updateNoGoZonePoints}
            removeSelectedNoGoVertex={removeSelectedNoGoVertex}
            deleteSelectedNoGoZone={deleteSelectedNoGoZone}
            publishNoGoZones={publishNoGoZones}
            nowIso={nowIso}
          />
          <OffsetTrackingMissionSection
            showTrigger={false}
            panelOpen={offsetLinePanelOpen}
            setPanelOpen={setOffsetLinePanelOpenExclusive}
            drawingEnabled={offsetLineDrawingEnabled}
            setDrawingEnabled={setOffsetLineDrawingEnabled}
            setNoGoDrawingEnabled={setNoGoDrawingEnabled}
            setCoverageDrawingEnabled={setCoverageDrawingEnabled}
            cancelOffsetLineTracking={cancelOffsetLineTracking}
            isConnected={isConnected}
            offsetLineRunState={offsetLineRunState}
            offsetLineStart={offsetLineStart}
            offsetLineEnd={offsetLineEnd}
            haversine={haversine}
            resetOffsetLineDraft={resetOffsetLineDraft}
            offsetLineDistanceCm={offsetLineDistanceCm}
            setOffsetLineDistanceCm={setOffsetLineDistanceCm}
            offsetLineSide={offsetLineSide}
            setOffsetLineSide={setOffsetLineSide}
            startOffsetLineTracking={startOffsetLineTracking}
            offsetLineReady={offsetLineReady}
            offsetLinePathPointCount={offsetLinePathPointCount}
            offsetLineStatusInfo={offsetLineStatusInfo}
            offsetLineError={offsetLineError}
          />
          <CoverageMissionSection
            showTrigger={false}
            plannerOpen={coveragePlannerOpen}
            setPlannerOpen={setCoveragePlannerOpenExclusive}
            drawingEnabled={coverageDrawingEnabled}
            setDrawingEnabled={setCoverageDrawingEnabled}
            setNoGoDrawingEnabled={setNoGoDrawingEnabled}
            setOffsetLineDrawingEnabled={setOffsetLineDrawingEnabled}
            isConnected={isConnected}
            coveragePoints={coveragePoints}
            setCoveragePoints={setCoveragePoints}
            clearCoveragePlanner={clearCoveragePlanner}
            coverageHasEditableState={coverageHasEditableState}
            coverageIntermediateNodes={coverageIntermediateNodes}
            coverageRouteLengthM={coverageRouteLengthM}
            coverageHasActualPath={coverageHasActualPath}
            gpsCoveragePathInfo={gpsCoveragePathInfo}
            coverageStyle={coverageStyle}
            setCoverageStyle={setCoverageStyle}
            coverageLineSpacing={coverageLineSpacing}
            setCoverageLineSpacing={setCoverageLineSpacing}
            coverageDiagonalAngle={coverageDiagonalAngle}
            setCoverageDiagonalAngle={setCoverageDiagonalAngle}
            coverageSweepAngle={coverageSweepAngle}
            setCoverageSweepAngle={setCoverageSweepAngle}
            coverageHeadingDeg={coverageHeadingDeg}
            setCoverageHeadingDeg={setCoverageHeadingDeg}
            coverageCurveStrength={coverageCurveStrength}
            setCoverageCurveStrength={setCoverageCurveStrength}
            coverageCircleDirection={coverageCircleDirection}
            setCoverageCircleDirection={setCoverageCircleDirection}
            coverageSpiralDirection={coverageSpiralDirection}
            setCoverageSpiralDirection={setCoverageSpiralDirection}
            coverageSpiralRotation={coverageSpiralRotation}
            setCoverageSpiralRotation={setCoverageSpiralRotation}
            coverageStartRadius={coverageStartRadius}
            setCoverageStartRadius={setCoverageStartRadius}
            coverageHeadlandPasses={coverageHeadlandPasses}
            setCoverageHeadlandPasses={setCoverageHeadlandPasses}
            coverageBoundaryDirection={coverageBoundaryDirection}
            setCoverageBoundaryDirection={setCoverageBoundaryDirection}
            coveragePointDensity={coveragePointDensity}
            setCoveragePointDensity={setCoveragePointDensity}
            coverageNavPoseSpacing={coverageNavPoseSpacing}
            setCoverageNavPoseSpacing={setCoverageNavPoseSpacing}
            coverageStartCorner={coverageStartCorner}
            setCoverageStartCorner={setCoverageStartCorner}
            coverageNodeOverrides={coverageNodeOverrides}
            setCoverageNodeOverrides={setCoverageNodeOverrides}
            coverageRemovedNodeLabels={coverageRemovedNodeLabels}
            setCoverageRemovedNodeLabels={setCoverageRemovedNodeLabels}
            coverageManualNodes={coverageManualNodes}
            setCoverageManualNodes={setCoverageManualNodes}
            setCoveragePublishStatus={setCoveragePublishStatus}
            setCoveragePublishError={setCoveragePublishError}
            coverageWaitPoints={coverageWaitPoints}
            setCoverageWaitPoints={setCoverageWaitPoints}
            selectedCoverageNodeLabel={selectedCoverageNodeLabel}
            setSelectedCoverageNodeLabel={setSelectedCoverageNodeLabel}
            addCoverageManualNodeAfter={addCoverageManualNodeAfter}
            removeCoverageManualNode={removeCoverageManualNode}
            coveragePlannerTopic={coveragePlannerTopic}
            setCoveragePlannerTopic={setCoveragePlannerTopic}
            coverageTopicIsGps={coverageTopicIsGps}
            publishGpsCoveragePolygon={publishGpsCoveragePolygon}
            canPublishCoveragePolygon={canPublishCoveragePolygon}
            coveragePublishing={coveragePublishing}
            coveragePublishStatus={coveragePublishStatus}
            coveragePublishError={coveragePublishError}
            startGpsCoverage={startGpsCoverage}
            cancelGpsCoverage={cancelGpsCoverage}
            coverageCancelling={coverageCancelling}
            coverageStartStatus={coverageStartStatus}
            coverageStartError={coverageStartError}
            coverageCancelStatus={coverageCancelStatus}
            coverageCancelError={coverageCancelError}
            coverageStartService={GPS_COVERAGE_START_SERVICE}
            coverageCancelService={GPS_COVERAGE_CANCEL_SERVICE}
          />

          <div className="gmp-map-messages">
            <div style={{ color: "#9ea0a8", marginBottom: 3 }}>Mesajlar</div>
            <div>
              {diagLogs[0]?.text || "Waypoint, GPS fix ve görev mesajları burada görünür."}
            </div>
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
            flexDirection: "column",
            position: "relative"
          }}
        >
          <div
            className="gmp-action-resizer"
            onMouseDown={() => {
              actionPanelResizeRef.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            title="Action panel genişliğini ayarla"
          />

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
            <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
              <div style={{ color: "#9ea0a8", marginBottom: 3 }}>Status</div>
              <div style={{ color: isConnected ? "#39ff14" : "#ff6565", fontWeight: 800 }}>
                {globalStatus.toUpperCase()}
              </div>
              <div style={{ color: statusColor(), marginTop: 4 }}>{navStatus || "NAV -"}</div>
	              <div style={{ color: "#9ea0a8", marginTop: 4 }}>
	                Debug points: {debugPoints.length}
	              </div>
	              {fromLLWarning && (
	                <div style={{ color: "#fca5a5", border: "1px solid #7f1d1d", background: "#240b0b", padding: 6, marginTop: 6, lineHeight: 1.35 }}>
	                  {fromLLWarning}
	                </div>
	              )}
	            </div>

            <div
              style={{
                border: `1px solid ${readinessHeaderColors.border}`,
                background: readinessHeaderColors.bg,
                padding: 7,
                display: "grid",
                gap: 5
              }}
            >
              <div style={{ color: readinessHeaderColors.fg, fontWeight: 900 }}>
                Görev Hazırlığı: {missionReadiness.canStart ? "HAZIR" : "ENGELLİ"}
              </div>
              {missionReadiness.checks.map(check => {
                const colors = checkColors(check.level);
                const levelText = {
                  ok: "TAMAM",
                  warn: "UYARI",
                  danger: "HATA",
                  info: "BİLGİ"
                }[check.level] || check.level;

                return (
                  <div
                    key={check.id}
                    title={check.detail}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "74px minmax(0, 1fr)",
                      gap: 6,
                      alignItems: "baseline",
                      color: colors.fg,
                      lineHeight: 1.25
                    }}
                  >
                    <span style={{ fontWeight: 900, textTransform: "uppercase" }}>
                      {levelText}
                    </span>
                    <span style={{ color: "#d7d7d7", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {check.label}: {check.detail}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
              <div style={{ color: "#9ea0a8", marginBottom: 3 }}>Robot</div>
              {robotPoseInfo ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
                  <div>x: {robotPoseInfo.x.toFixed(2)}</div>
                  <div>y: {robotPoseInfo.y.toFixed(2)}</div>
                  <div>yaw: {mapYawDeg.toFixed(1)} deg</div>
                </div>
              ) : (
                <div style={{ color: "#777" }}>TF bekleniyor</div>
              )}
            </div>

            <GPSMissionPlannerDebugPanel
              fmtNum={fmtNum}
              fmtDeg={fmtDeg}
              radToDeg={radToDeg}
              formatSignedDeg={formatSignedDeg}
              rosStampText={rosStampText}
              covarianceText={covarianceText}
              rawGpsInfo={rawGpsInfo}
              rtkStatusText={rtkStatusText}
              GPS_DATUM={GPS_DATUM}
              datumDistanceM={datumDistanceM}
              datumBearingDeg={datumBearingDeg}
              robotPoseInfo={robotPoseInfo}
              mapYawDeg={mapYawDeg}
              gpsOdomInfo={gpsOdomInfo}
              globalOdomInfo={globalOdomInfo}
              gpsTfDx={gpsTfDx}
              gpsTfDy={gpsTfDy}
              gpsTfDistance={gpsTfDistance}
              debugDisplayYawDeg={debugDisplayYawDeg}
              displayCompassBearingDeg={displayCompassBearingDeg}
              lastCompassHeadingDeg={lastCompassHeadingDeg}
              NAVSAT_MAGNETIC_DECLINATION_RAD={NAVSAT_MAGNETIC_DECLINATION_RAD}
              NAVSAT_YAW_OFFSET_RAD={NAVSAT_YAW_OFFSET_RAD}
              NAVSAT_MAP_TO_ENU_OFFSET_DEG={NAVSAT_MAP_TO_ENU_OFFSET_DEG}
              projectionHeadingOffsetDeg={projectionHeadingOffsetDeg}
              frameDebugSource={frameDebugSource}
              frameDebugBaseX={frameDebugBaseX}
              frameDebugBaseY={frameDebugBaseY}
              tfYawDeg={tfYawDeg}
              backendYawDeg={backendYawDeg}
              frameDebugBaseGps={frameDebugBaseGps}
              baseLinkCompassBearingDeg={baseLinkCompassBearingDeg}
              projectedUiBearingDeg={projectedUiBearingDeg}
              uiHeadingBearingDeg={uiHeadingBearingDeg}
              rosPlusXBearingDeg={rosPlusXBearingDeg}
              rosPlusYBearingDeg={rosPlusYBearingDeg}
              rosUiHeadingDiffDeg={rosUiHeadingDiffDeg}
              GPS_FRAME_DEBUG_TOPIC={GPS_FRAME_DEBUG_TOPIC}
              gpsFrameDebugInfo={gpsFrameDebugInfo}
              activeBaseLayer={activeBaseLayer}
              orthoTilesLoaded={orthoTilesLoaded}
              ORTHO_TILE_BASE={ORTHO_TILE_BASE}
              lastDebugPoint={lastDebugPoint}
              gpsCoverageStatusInfo={gpsCoverageStatusInfo}
              gpsCoverageDebugInfo={gpsCoverageDebugInfo}
              gpsCoveragePathInfo={gpsCoveragePathInfo}
              noGoDebugZones={noGoDebugZones}
              NO_GO_DEBUG_TOPIC={NO_GO_DEBUG_TOPIC}
              showNoGoKeepoutBuffer={showNoGoKeepoutBuffer}
              offsetLineRunState={offsetLineRunState}
              offsetLineStatusInfo={offsetLineStatusInfo}
              offsetLinePathPointCount={offsetLinePathPointCount}
              offsetLineDebugInfo={offsetLineDebugInfo}
              offsetLineStart={offsetLineStart}
              offsetLineEnd={offsetLineEnd}
              haversine={haversine}
              nav2GoalInfo={nav2GoalInfo}
              globalPlanInfo={globalPlanInfo}
              localPlanInfo={localPlanInfo}
              centerOnRobot={centerOnRobot}
              setCenterOnRobot={setCenterOnRobot}
              publishUiState={publishUiState}
            />

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
	                  <th style={{ width: 112 }}>Dur/Dön</th>
                  <th style={{ width: 82 }}>Hız Çarpanı</th>
                  <th style={{ width: 96 }}>Hassas İşlem</th>
                  <th style={{ width: 58 }}>Delete</th>
                  <th style={{ width: 70 }}>Up/Down</th>
                  <th style={{ width: 70 }}>Dist</th>
                </tr>
              </thead>
              <tbody>
                {waypoints.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ color: "#8b8b92", height: 70, textAlign: "center" }}>
                      Haritaya tıklayarak rota waypointleri ekle.
                    </td>
                  </tr>
                ) : (
	                  waypoints.map((wp, i) => {
	                    const prev = i > 0 ? waypoints[i - 1] : null;
	                    const dist = prev ? haversine(prev, wp) : 0;

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
	                          <select
	                            value={waypointModeValue(wp.mode)}
	                            disabled={waypointEditLocked}
	                            onChange={e => updateMode(i, e.target.value)}
	                          >
	                            <option value="pass">PASS</option>
	                            <option value="corner">CORNER</option>
	                          </select>
	                          <label style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 3, color: "#d7d7d7", fontSize: 10 }}>
	                            <input
	                              type="checkbox"
	                              checked={waypointModeValue(wp.mode) === "corner"}
	                              disabled={waypointEditLocked}
	                              onChange={e => updateMode(i, e.target.checked ? "corner" : "pass")}
	                              style={{ width: 12, height: 12, accentColor: "#b9ff2f" }}
	                            />
	                            Dur ve sonraki segmente dön
	                          </label>
	                        </td>
                        <td>
                          {i < waypoints.length - 1 ? (
                            <input
                              type="number"
                              min="0.01"
                              max={MAX_WAYPOINT_SPEED_MULTIPLIER}
                              step="0.1"
                              disabled={waypointEditLocked}
                              value={wp.speed ?? String(DEFAULT_WAYPOINT_SPEED_MULTIPLIER)}
                              onChange={e => updateSpeed(i, e.target.value)}
                              title={`WP ${i + 1} -> WP ${i + 2} hız çarpanı`}
                            />
                          ) : (
                            <span style={{ color: "#8b8b92" }}>-</span>
                          )}
                        </td>
                        <td>
                          <label style={{ display: "flex", gap: 4, alignItems: "center", color: "#d7d7d7", fontSize: 10 }}>
                            <input
                              type="checkbox"
                              checked={Boolean(wp.waitSeconds)}
                              disabled={waypointEditLocked}
                              onChange={e => updateWaitSeconds(i, e.target.checked ? (wp.waitSeconds || 5) : null)}
                              style={{ width: 12, height: 12, accentColor: "#b9ff2f" }}
                            />
                            {wp.waitSeconds ? (
                              <input
                                type="number"
                                min="1"
                                max="3600"
                                step="1"
                                disabled={waypointEditLocked}
                                value={wp.waitSeconds}
                                onChange={e => updateWaitSeconds(i, e.target.value)}
                                title="Bu noktayı hassas işlem olarak işaretler; araç bu noktaya gelince burada belirtilen süre kadar bekler."
                                style={{ width: 50 }}
                              />
                            ) : (
                              <span style={{ color: "#6b7280" }}>—</span>
                            )}
                          </label>
                          {i === activeWaitIndex && (
                            <span
                              title="Araç bu noktada bekliyor"
                              style={{
                                display: "inline-block",
                                marginTop: 3,
                                padding: "1px 6px",
                                borderRadius: 3,
                                background: "#f59e0b",
                                color: "#1a1300",
                                fontWeight: 800,
                                fontSize: 10,
                                fontFamily: MONO
                              }}
                            >
                              ⏳ {activeWaitRemaining}s
                            </span>
                          )}
                        </td>
                        <td>
                          <button className="gmp-mp-btn" onClick={() => removeWaypoint(i)} disabled={waypointEditLocked}>X</button>
                        </td>
                        <td>
                          <button className="gmp-mp-btn" onClick={() => moveWaypoint(i, -1)} disabled={waypointEditLocked || i === 0}>▲</button>
                          <button className="gmp-mp-btn" onClick={() => moveWaypoint(i, 1)} disabled={waypointEditLocked || i === waypoints.length - 1}>▼</button>
                        </td>
                        <td>{dist.toFixed(1)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(saveRouteDialogOpen || loadRouteDialogOpen || confirmDialog) && (
          <div
            onClick={() => {
              setSaveRouteDialogOpen(false);
              setLoadRouteDialogOpen(false);
              closeConfirmDialog();
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,.72)",
              zIndex: 2500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1.2rem"
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: "min(920px, 100%)",
                maxHeight: "82vh",
                overflow: "auto",
                background: "#0b1020",
                border: "1px solid #1e293b",
                borderRadius: "0.7rem",
                boxShadow: "0 24px 60px rgba(0,0,0,.45)",
                padding: "1rem",
                display: "grid",
                gap: "0.85rem"
              }}
            >
              {saveRouteDialogOpen && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.7rem" }}>
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 900, fontSize: "1rem" }}>Rota Kaydet</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.15rem" }}>
                        Waypoint listesi, hassas işlem bilgileri ve rota önizlemesi Task Manager&apos;a kaydedilecek.
                      </div>
                    </div>
                    <button className="gmp-mp-btn" onClick={() => setSaveRouteDialogOpen(false)}>Kapat</button>
                  </div>

                  <div style={{ display: "grid", gap: "0.7rem", gridTemplateColumns: "minmax(0, 1fr) 300px" }}>
                    <div style={{ display: "grid", gap: "0.7rem" }}>
                      <div>
                        <div style={{ color: "#94a3b8", fontSize: "0.64rem", marginBottom: "0.2rem" }}>ROTA ADI</div>
                        <input
                          value={routeDraftName}
                          onChange={e => setRouteDraftName(e.target.value)}
                          placeholder="Örn. Havuz çevresi deneme rotası"
                          className="gmp-input"
                        />
                      </div>
                      <div>
                        <div style={{ color: "#94a3b8", fontSize: "0.64rem", marginBottom: "0.2rem" }}>AÇIKLAMA</div>
                        <textarea
                          value={routeDraftDescription}
                          onChange={e => setRouteDraftDescription(e.target.value)}
                          placeholder="İsteğe bağlı kısa açıklama"
                          className="gmp-input"
                          rows={5}
                          style={{ resize: "vertical" }}
                        />
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.66rem", lineHeight: "1.55" }}>
                        {waypoints.length} waypoint kaydedilecek. Sonradan Task Manager veya GPS Mission üzerinden tekrar açıp düzenleyebilirsin.
                      </div>
                    </div>

                    <div style={{ border: "1px solid #1f2937", borderRadius: "0.5rem", overflow: "hidden", background: "#020617" }}>
                      {routePreviewImage ? (
                        <img
                          src={routePreviewImage}
                          alt="Rota önizlemesi"
                          style={{ width: "100%", height: "100%", minHeight: "196px", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <div style={{ minHeight: "196px", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: MONO, fontSize: 12 }}>
                          {routePreviewBusy ? "Ortofoto önizleme hazırlanıyor..." : "Önizleme hazırlanamadı"}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.45rem" }}>
                    <button className="gmp-mp-btn" onClick={() => setSaveRouteDialogOpen(false)}>Vazgeç</button>
                    <button className="gmp-mp-btn" onClick={handleSaveCurrentRoute} style={{ background: "#b9ff2f" }} disabled={routeSaveBusy}>
                      {routeSaveBusy ? "Kaydediliyor..." : "Kaydet"}
                    </button>
                  </div>
                </>
              )}

              {loadRouteDialogOpen && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.7rem" }}>
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 900, fontSize: "1rem" }}>Kayıtlı Rota Yürüt</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.15rem" }}>
                        Kaydı seçtiğinde rota GPS Mission sayfasına açılır; istersen waypointleri düzenleyip sonra ACTION START verebilirsin.
                      </div>
                    </div>
                    <button className="gmp-mp-btn" onClick={() => setLoadRouteDialogOpen(false)}>Kapat</button>
                  </div>

                  {savedRoutes.length === 0 ? (
                    <div style={{ color: "#64748b", textAlign: "center", padding: "2rem 1rem" }}>
                      Henüz kayıtlı rota yok.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: "0.65rem" }}>
                      {savedRoutes.map(route => (
                        <SavedGpsRouteCard
                          key={route.id}
                          route={route}
                          actionLabel="Rotayı Aç"
                          onAction={handleLoadSavedRoute}
                          onDelete={handleDeleteSavedRoute}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {confirmDialog && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.7rem" }}>
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 900, fontSize: "1rem" }}>{confirmDialog.title}</div>
                      <div style={{ color: "#64748b", fontSize: "0.7rem", marginTop: "0.15rem" }}>
                        Bu işlem görünümü temizler ama diğer kayıtlı ayarları etkilemez.
                      </div>
                    </div>
                    <button className="gmp-mp-btn" onClick={closeConfirmDialog}>Kapat</button>
                  </div>

                  <div
                    style={{
                      border: `1px solid ${confirmDialog.accent}55`,
                      background: "rgba(2,6,23,.55)",
                      borderRadius: "0.65rem",
                      padding: "1rem",
                      color: "#e2e8f0",
                      lineHeight: "1.6",
                      fontSize: "0.86rem"
                    }}
                  >
                    {confirmDialog.message}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.45rem" }}>
                    <button className="gmp-mp-btn" onClick={closeConfirmDialog}>
                      {confirmDialog.cancelLabel || "Vazgeç"}
                    </button>
                    <button
                      className="gmp-mp-btn"
                      onClick={submitConfirmDialog}
                      style={{ background: confirmDialog.accent || "#ef4444", color: "#fff" }}
                    >
                      {confirmDialog.confirmLabel || "Onayla"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
 
