// ═════════════════════════════════════════════════════════════════════════════
//  CoveragePage.jsx  —  useMapLoader gömülü (QoS fix)
// ═════════════════════════════════════════════════════════════════════════════

import React, {
  useEffect, useMemo, useRef, useState, useCallback,
} from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

// ─── useMapLoader (gömülü — ayrı dosya gerekmez) ─────────────────────────────
// SORUN: map_server transient_local QoS yayınlar, rosbridge volatile subscribe
// eder → hotspot/geç bağlanmada harita gelmiyor.
// ÇÖZÜM: Önce /map_server/map servisi dene (nav2 built-in, QoS sorunu yok),
//         başarısız olursa /map topic'e fallback yap.
const clampV = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function parseOccupancyGrid(msg) {
  if (!msg?.info?.width || !msg?.info?.height) return null;
  const info = {
    resolution: msg.info.resolution,
    width:      msg.info.width,
    height:     msg.info.height,
    originX:    msg.info.origin.position.x,
    originY:    msg.info.origin.position.y,
  };
  const img = new ImageData(info.width, info.height);
  for (let i = 0; i < info.width * info.height; i++) {
    const v = msg.data[i];
    const c = v < 0 ? 128 : 255 - clampV(Math.round((v / 100) * 255), 0, 255);
    img.data[i * 4] = c; img.data[i * 4 + 1] = c; img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255;
  }
  return { info, imageData: img };
}

function useMapLoader(ros, isConnected, mapTopicName = "/map") {
  const [mapInfo,      setMapInfo]      = useState(null);
  const [mapImageData, setMapImageData] = useState(null);
  const [mapLoading,   setMapLoading]   = useState(false);
  const [mapError,     setMapError]     = useState("");
  const [mapSource,    setMapSource]    = useState("");

  const subRef      = useRef(null);
  const watchdogRef = useRef(null);
  const mountedRef  = useRef(true);
  const hasMapRef   = useRef(false);

  const clearTimers = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  const cleanupSub = useCallback(() => {
    if (subRef.current) { try { subRef.current.unsubscribe(); } catch {} subRef.current = null; }
    clearTimers();
  }, [clearTimers]);

  const applyMap = useCallback((msg, source) => {
    if (!mountedRef.current) return false;
    const result = parseOccupancyGrid(msg);
    if (!result) return false;
    setMapInfo(result.info);
    setMapImageData(result.imageData);
    setMapLoading(false);
    setMapError("");
    setMapSource(source);
    hasMapRef.current = true;
    return true;
  }, []);

  // eslint-disable-next-line no-use-before-define
  const subscribeToTopic = useCallback(() => {
    if (!ros || !isConnected || !mountedRef.current) return;
    cleanupSub();
    const topic = new ROSLIB.Topic({
      ros, name: mapTopicName,
      messageType: "nav_msgs/msg/OccupancyGrid",
      throttle_rate: 1000, queue_size: 1,
    });
    topic.subscribe(msg => {
      clearTimers();
      applyMap(msg, `topic: ${mapTopicName}`);
    });
    subRef.current = topic;
    // 8 sn içinde mesaj gelmezse servisi tekrar dene
    watchdogRef.current = setTimeout(() => {
      if (!hasMapRef.current && mountedRef.current) {
        setMapError("Topic'ten mesaj gelmedi — servis tekrar deneniyor");
        tryService(); // eslint-disable-line no-use-before-define
      }
    }, 8000);
  }, [ros, isConnected, mapTopicName, cleanupSub, applyMap, clearTimers]); // eslint-disable-line

  const tryService = useCallback(() => {
    if (!ros || !isConnected || !mountedRef.current) return;
    setMapLoading(true);
    if (!hasMapRef.current) setMapError("Harita yükleniyor...");

    const svc = new ROSLIB.Service({ ros, name: "/map_server/map", serviceType: "nav_msgs/srv/GetMap" });
    const timeout = setTimeout(() => {
      if (!mountedRef.current) return;
      setMapError("map_server servisi yanıt vermedi → topic deneniyor");
      subscribeToTopic();
    }, 4000);

    svc.callService({},
      res => {
        clearTimeout(timeout);
        if (!mountedRef.current) return;
        const msg = res?.map ?? res;
        if (applyMap(msg, "/map_server/map (servis)")) {
          subscribeToTopic(); // arka planda topic'i de dinle (güncellemeler için)
        } else {
          setMapError("Servis boş döndü → topic deneniyor");
          subscribeToTopic();
        }
      },
      () => {
        clearTimeout(timeout);
        if (!mountedRef.current) return;
        setMapError(`/map_server/map yok → ${mapTopicName} topic deneniyor`);
        subscribeToTopic();
      },
    );
  }, [ros, isConnected, mapTopicName, applyMap, subscribeToTopic]);

  useEffect(() => {
    mountedRef.current = true;
    if (!ros || !isConnected) { cleanupSub(); return; }
    hasMapRef.current = false;
    tryService();
    return () => { mountedRef.current = false; cleanupSub(); };
  }, [ros, isConnected]); // eslint-disable-line

  useEffect(() => {
    if (!ros || !isConnected) return;
    hasMapRef.current = false;
    setMapInfo(null); setMapImageData(null); setMapSource("");
    tryService();
  }, [mapTopicName]); // eslint-disable-line

  const reloadMap = useCallback(() => {
    if (!ros || !isConnected) return;
    cleanupSub();
    hasMapRef.current = false;
    setMapInfo(null); setMapImageData(null); setMapSource("");
    setMapLoading(true); setMapError("Yenileniyor...");
    tryService();
  }, [ros, isConnected, cleanupSub, tryService]);

  return { mapInfo, mapImageData, mapLoading, mapError, mapSource, reloadMap };
}
// ─── /useMapLoader ────────────────────────────────────────────────────────────

// ─── Diğer Helpers ────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function prettyErr(e) {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}
function quaternionToYaw(q) {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}
function yawToQuaternion(yaw) {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

// ─── Geometry ─────────────────────────────────────────────────────────────────
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  const E = 1e-9;
  if (t >= -E && t <= 1 + E && u >= -E && u <= 1 + E)
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  return null;
}
function polygonIntersections(ls, le, poly) {
  const raw = [];
  for (let i = 0; i < poly.length; i++) {
    const pt = lineIntersection(ls.x, ls.y, le.x, le.y,
      poly[i].x, poly[i].y, poly[(i + 1) % poly.length].x, poly[(i + 1) % poly.length].y);
    if (pt) raw.push(pt);
  }
  const E = 1e-6, uniq = [];
  for (const pt of raw)
    if (!uniq.some(p => Math.abs(p.x - pt.x) < E && Math.abs(p.y - pt.y) < E)) uniq.push(pt);
  if (Math.abs(le.x - ls.x) > Math.abs(le.y - ls.y)) uniq.sort((a, b) => a.x - b.x);
  else uniq.sort((a, b) => a.y - b.y);
  return uniq;
}

function generatePreviewPath(points, style, lineSpacing, sweepAngle, startCorner) {
  if (points.length !== 4) return [];
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const poly = Array.from({ length: 4 }, (_, i) => sorted[(i + startCorner) % 4]);
  const minX = Math.min(...poly.map(p => p.x)), maxX = Math.max(...poly.map(p => p.x));
  const minY = Math.min(...poly.map(p => p.y)), maxY = Math.max(...poly.map(p => p.y));
  const pad = Math.max(maxX - minX, maxY - minY) * 2 + 2;
  const path = [], ok = (a, b) => Math.abs(b.x - a.x) > 1e-5 || Math.abs(b.y - a.y) > 1e-5;

  if (style === "zigzag") {
    let flip = false;
    for (let y = minY + lineSpacing * 0.5; y <= maxY + 1e-6; y += lineSpacing) {
      const pts = polygonIntersections({ x: minX - pad, y }, { x: maxX + pad, y }, poly);
      if (pts.length >= 2) { const [a, b] = [pts[0], pts[pts.length - 1]]; if (!ok(a, b)) continue; if (flip) { path.push(b); path.push(a); } else { path.push(a); path.push(b); } flip = !flip; }
    }
  } else if (style === "ladder") {
    let flip = false;
    for (let x = minX + lineSpacing * 0.5; x <= maxX + 1e-6; x += lineSpacing) {
      const pts = polygonIntersections({ x, y: minY - pad }, { x, y: maxY + pad }, poly);
      if (pts.length >= 2) { const [a, b] = [pts[0], pts[pts.length - 1]]; if (!ok(a, b)) continue; if (flip) { path.push(b); path.push(a); } else { path.push(a); path.push(b); } flip = !flip; }
    }
  } else if (style === "diagonal") {
    const ar = ((sweepAngle % 360) * Math.PI) / 180, cA = Math.cos(ar), sA = Math.sin(ar);
    const dL = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) * 1.5 + 1;
    let flip = false;
    for (let off = -dL; off <= dL + 1e-6; off += lineSpacing) {
      const pcx = cx - off * sA, pcy = cy + off * cA;
      const pts = polygonIntersections({ x: pcx - dL * cA, y: pcy - dL * sA }, { x: pcx + dL * cA, y: pcy + dL * sA }, poly);
      if (pts.length >= 2) { const [a, b] = [pts[0], pts[pts.length - 1]]; if (!ok(a, b)) continue; if (flip) { path.push(b); path.push(a); } else { path.push(a); path.push(b); } flip = !flip; }
    }
  }
  return path;
}

function previewToPoses(path) {
  return path.map((pt, i) => {
    let yaw = 0;
    if (i < path.length - 1) yaw = Math.atan2(path[i + 1].y - pt.y, path[i + 1].x - pt.x);
    else if (i > 0) yaw = Math.atan2(pt.y - path[i - 1].y, pt.x - path[i - 1].x);
    return { header: { frame_id: "map", stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 } }, pose: { position: { x: pt.x, y: pt.y, z: 0 }, orientation: yawToQuaternion(yaw) } };
  });
}

const MODE_IDLE = "idle", MODE_SELECT = "select", MODE_GOALPOSE = "goalpose", MODE_PRECISION = "precision";

// ─────────────────────────────────────────────────────────────────────────────
export default function CoveragePage() {
  const { ros, isConnected, status: gSt, errorText: gErr, reconnect } = useROS();
  const [pageStatus, setPageStatus] = useState("");
  const [pageError,  setPageError]  = useState("");

  // ── Map — useMapLoader (QoS fix, ayrı dosya gerekmez) ────────────────────
  const [mapTopicName, setMapTopicName] = useState("/map");
  const { mapInfo, mapImageData, mapLoading, mapError: mapLoaderError, mapSource, reloadMap } =
    useMapLoader(ros, isConnected, mapTopicName);
  // Not: mapTRef ve /map useEffect silindi — hook yönetiyor.

  // Robot
  const [robotPose,  setRobotPose]  = useState(null);
  const [poseSource, setPoseSource] = useState("");
  const robotPoseRef = useRef(null);
  useEffect(() => { robotPoseRef.current = robotPose; }, [robotPose]);

  // Interaction
  const [points,     setPoints]     = useState([]);
  const [activeMode, setActiveMode] = useState(MODE_IDLE);
  const [goalEnabled,      setGoalEnabled]      = useState(false);
  const [precisionEnabled, setPrecisionEnabled] = useState(false);
  const [pwPopup, setPwPopup] = useState(null);
  const [pwPhase, setPwPhase] = useState(null);
  const goalDragRef  = useRef(null);
  const [goalDragEnd, setGoalDragEnd] = useState(null);

  // Coverage settings
  const [style,       setStyle]       = useState("zigzag");
  const [lineSpacing, setLineSpacing] = useState(0.4);
  const [sweepAngle,  setSweepAngle]  = useState(90);
  const [startCorner, setStartCorner] = useState(0);
  const [execMode,    setExecMode]    = useState("navigate_through_poses");

  // Path
  const [pathMsg,     setPathMsg]     = useState(null);
  const [showPreview, setShowPreview] = useState(true);

  // Executor
  const [execStatus,        setExecStatus]       = useState("IDLE");
  const [execProgress,      setExecProgress]     = useState(0);
  const [isRunning,         setIsRunning]        = useState(false);
  const [executorAvailable, setExecutorAvailable]= useState(false);
  const seqRef = useRef({ active: false, cancel: false });

  const [showSettings, setShowSettings] = useState(false);

  // Offset Tracking
  const [offsetEnabled, setOffsetEnabled] = useState(false);
  const [otOffset,      setOtOffset]      = useState("0.5");
  const [otSide,        setOtSide]        = useState("left");
  const [otSpacing,     setOtSpacing]     = useState("1.0");
  const [otStatus,      setOtStatus]      = useState("IDLE");
  const [otLog,         setOtLog]         = useState("");
  const otCmdRef = useRef(null);
  const otSubRef = useRef(null);

  // Refs
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const pathTRef     = useRef(null);
  const amclRef      = useRef(null);

  // Computed
  const previewPath = useMemo(
    () => generatePreviewPath(points, style, lineSpacing, sweepAngle, startCorner),
    [points, style, lineSpacing, sweepAngle, startCorner],
  );

  const estimatedLines = useMemo(() => {
    if (points.length !== 4) return 0;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (style === "zigzag") return Math.max(0, Math.floor(h / lineSpacing));
    if (style === "ladder") return Math.max(0, Math.floor(w / lineSpacing));
    return Math.max(0, Math.floor(Math.sqrt(w * w + h * h) / lineSpacing));
  }, [points, style, lineSpacing]);

  const canvasToWorld = useCallback((cx, cy) => {
    if (!mapInfo || !canvasRef.current) return { wx: 0, wy: 0 };
    const sc = canvasRef.current.width / mapInfo.width;
    return { wx: mapInfo.originX + (cx / sc) * mapInfo.resolution, wy: mapInfo.originY + (mapInfo.height - cy / sc) * mapInfo.resolution };
  }, [mapInfo]);

  // /coverage/path
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (pathTRef.current) { try { pathTRef.current.unsubscribe(); } catch {} }
    const t = new ROSLIB.Topic({ ros, name: "/coverage/path", messageType: "nav_msgs/msg/Path", throttle_rate: 100, queue_size: 1 });
    t.subscribe(msg => { setPathMsg(msg); setPageStatus(`✅ ROS path alındı: ${msg.poses.length} waypoint`); });
    pathTRef.current = t;
    return () => { try { t.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // /coverage/status + /coverage/progress
  useEffect(() => {
    if (!ros || !isConnected) return;
    const statusT = new ROSLIB.Topic({ ros, name: "/coverage/status", messageType: "std_msgs/msg/String", throttle_rate: 200, queue_size: 1 });
    statusT.subscribe(msg => {
      const s = msg.data || "";
      setExecStatus(s); setIsRunning(s.startsWith("EXECUTING"));
      if (["COMPLETED", "CANCELED", "IDLE"].includes(s)) setIsRunning(false);
      setExecutorAvailable(true);
    });
    const progT = new ROSLIB.Topic({ ros, name: "/coverage/progress", messageType: "std_msgs/msg/Float32", throttle_rate: 200, queue_size: 1 });
    progT.subscribe(msg => setExecProgress(msg.data || 0));
    return () => { try { statusT.unsubscribe(); } catch {} try { progT.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // TF → robot pose
  useEffect(() => {
    if (!ros || !isConnected) return;
    const allTFs = {};
    const proc = msg => {
      if (!msg?.transforms) return;
      for (const t of msg.transforms) {
        const child = (t.child_frame_id || "").replace(/^\//, ""), parent = (t.header?.frame_id || "").replace(/^\//, "");
        if (!child || !parent || !t.transform?.translation) continue;
        allTFs[child] = { parent, tx: t.transform.translation.x, ty: t.transform.translation.y, qx: t.transform.rotation.x, qy: t.transform.rotation.y, qz: t.transform.rotation.z, qw: t.transform.rotation.w };
      }
      const target = allTFs["base_link"] ? "base_link" : allTFs["base_footprint"] ? "base_footprint" : null;
      if (!target) return;
      const chain = []; let cur = target; const vis = new Set();
      while (cur && cur !== "map" && !vis.has(cur)) { vis.add(cur); const tf = allTFs[cur]; if (!tf) break; chain.push({ ...tf }); cur = tf.parent; }
      if (cur !== "map") return;
      chain.reverse();
      let wx = 0, wy = 0, wyaw = 0;
      for (const tf of chain) { const ty = quaternionToYaw({ x: tf.qx, y: tf.qy, z: tf.qz, w: tf.qw }); const cY = Math.cos(wyaw), sY = Math.sin(wyaw); wx = wx + cY * tf.tx - sY * tf.ty; wy = wy + sY * tf.tx + cY * tf.ty; wyaw += ty; }
      setRobotPose({ x: wx, y: wy, yaw: wyaw }); setPoseSource(`tf→${target}`);
    };
    const tf  = new ROSLIB.Topic({ ros, name: "/tf",        messageType: "tf2_msgs/msg/TFMessage", throttle_rate: 100,  queue_size: 1 });
    const tfs = new ROSLIB.Topic({ ros, name: "/tf_static", messageType: "tf2_msgs/msg/TFMessage", throttle_rate: 1000, queue_size: 1 });
    tf.subscribe(proc); tfs.subscribe(proc);
    const fb = setTimeout(() => {
      if (Object.keys(allTFs).length > 0) return;
      const a = new ROSLIB.Topic({ ros, name: "/amcl_pose", messageType: "geometry_msgs/msg/PoseWithCovarianceStamped", throttle_rate: 200, queue_size: 1 });
      a.subscribe(msg => { const p = msg.pose.pose; setRobotPose({ x: p.position.x, y: p.position.y, yaw: quaternionToYaw(p.orientation) }); setPoseSource("amcl"); });
      amclRef.current = a;
    }, 3000);
    return () => { clearTimeout(fb); try { tf.unsubscribe(); } catch {} try { tfs.unsubscribe(); } catch {} try { if (amclRef.current) amclRef.current.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // Canvas draw
  useEffect(() => {
    const canvas = canvasRef.current, container = containerRef.current;
    if (!canvas || !container || !mapInfo || !mapImageData) return;
    const rect = container.getBoundingClientRect();
    const scale = Math.min(rect.width / mapInfo.width, rect.height / mapInfo.height);
    const dW = Math.floor(mapInfo.width * scale), dH = Math.floor(mapInfo.height * scale);
    canvas.width = dW; canvas.height = dH; canvas.style.width = dW + "px"; canvas.style.height = dH + "px";
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const off = document.createElement("canvas"); off.width = mapInfo.width; off.height = mapInfo.height;
    off.getContext("2d").putImageData(mapImageData, 0, 0);
    ctx.clearRect(0, 0, dW, dH); ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0, 0, dW, dH);
    const w2c = (wx, wy) => ({ cx: ((wx - mapInfo.originX) / mapInfo.resolution) * scale, cy: (mapInfo.height - (wy - mapInfo.originY) / mapInfo.resolution) * scale });
    const arr = (fx, fy, tx, ty, col, h = 8, lw = 2) => {
      const a = Math.atan2(ty - fy, tx - fx);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - h * Math.cos(a - Math.PI / 6), ty - h * Math.sin(a - Math.PI / 6)); ctx.lineTo(tx - h * Math.cos(a + Math.PI / 6), ty - h * Math.sin(a + Math.PI / 6)); ctx.closePath(); ctx.fill();
    };
    if (showPreview && previewPath.length > 1) {
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < previewPath.length - 1; i++) { const { cx: x1, cy: y1 } = w2c(previewPath[i].x, previewPath[i].y); const { cx: x2, cy: y2 } = w2c(previewPath[i + 1].x, previewPath[i + 1].y); arr(x1, y1, x2, y2, "#3b82f6", 10, 2); }
      const { cx: sx, cy: sy } = w2c(previewPath[0].x, previewPath[0].y);
      ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("S", sx, sy);
      const ep = previewPath[previewPath.length - 1]; const { cx: ex, cy: ey } = w2c(ep.x, ep.y);
      ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText("E", ex, ey);
      ctx.globalAlpha = 1;
    }
    if (pathMsg?.poses?.length > 1) {
      ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.strokeStyle = "#10b981"; ctx.setLineDash([6, 3]);
      ctx.beginPath(); pathMsg.poses.forEach((ps, i) => { const { cx, cy } = w2c(ps.pose.position.x, ps.pose.position.y); if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy); });
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      pathMsg.poses.forEach((ps, i) => { const { cx, cy } = w2c(ps.pose.position.x, ps.pose.position.y); ctx.fillStyle = i === 0 ? "#22c55e" : i === pathMsg.poses.length - 1 ? "#ef4444" : "rgba(16,185,129,0.5)"; ctx.beginPath(); ctx.arc(cx, cy, i === 0 || i === pathMsg.poses.length - 1 ? 6 : 3, 0, Math.PI * 2); ctx.fill(); });
    }
    if (points.length > 0) {
      const cvs = points.map(p => w2c(p.x, p.y));
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#f97316"; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(cvs[0].cx, cvs[0].cy); for (let i = 1; i < cvs.length; i++) ctx.lineTo(cvs[i].cx, cvs[i].cy);
      if (points.length === 4) { ctx.closePath(); ctx.stroke(); ctx.fillStyle = "rgba(249,115,22,0.07)"; ctx.fill(); } else ctx.stroke();
      cvs.forEach(({ cx, cy }, i) => { ctx.fillStyle = i === startCorner ? "#22c55e" : "#f97316"; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(i + 1), cx, cy); });
    }
    if (robotPose) {
      const { cx: rx, cy: ry } = w2c(robotPose.x, robotPose.y);
      const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, 22); g.addColorStop(0, "rgba(250,204,21,0.45)"); g.addColorStop(1, "rgba(250,204,21,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rx, ry, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#facc15"; ctx.strokeStyle = "#0b1120"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(rx, ry, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const aL = 22, ax = rx + aL * Math.cos(-robotPose.yaw), ay = ry + aL * Math.sin(-robotPose.yaw);
      arr(rx, ry, ax, ay, "#0b1120", 7, 2.5);
      ctx.fillStyle = "#facc15"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("ROBOT", rx, ry + 14);
    }
    if (goalDragRef.current && goalDragEnd) {
      const { canvasX: gx, canvasY: gy } = goalDragRef.current; const { canvasX: ex2, canvasY: ey2 } = goalDragEnd;
      ctx.fillStyle = "rgba(168,85,247,0.25)"; ctx.strokeStyle = "#a855f7"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(gx, gy, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const len = Math.max(25, Math.sqrt((ex2 - gx) ** 2 + (ey2 - gy) ** 2)), ang = Math.atan2(ey2 - gy, ex2 - gx);
      arr(gx, gy, gx + Math.min(len, 60) * Math.cos(ang), gy + Math.min(len, 60) * Math.sin(ang), "#a855f7", 12, 3);
    }
  }, [mapInfo, mapImageData, points, pathMsg, previewPath, showPreview, startCorner, robotPose, goalDragEnd]);

  // Canvas events
  const gcp = (e, c) => { const r = c.getBoundingClientRect(); return { canvasX: (e.clientX - r.left) * (c.width / r.width), canvasY: (e.clientY - r.top) * (c.height / r.height) }; };
  const onMouseDown = useCallback(e => {
    const c = canvasRef.current; if (!c || !mapInfo) return;
    const { canvasX: cx, canvasY: cy } = gcp(e, c); const { wx, wy } = canvasToWorld(cx, cy);
    if (activeMode === MODE_SELECT) setPoints(prev => prev.length >= 4 ? prev : [...prev, { x: wx, y: wy }]);
    else if (goalEnabled || precisionEnabled || offsetEnabled) { goalDragRef.current = { worldX: wx, worldY: wy, canvasX: cx, canvasY: cy }; setGoalDragEnd({ canvasX: cx, canvasY: cy }); }
  }, [activeMode, goalEnabled, precisionEnabled, offsetEnabled, mapInfo, canvasToWorld]);
  const onMouseMove = useCallback(e => {
    if ((!goalEnabled && !precisionEnabled && !offsetEnabled) || !goalDragRef.current) return;
    const c = canvasRef.current; if (!c) return; setGoalDragEnd(gcp(e, c));
  }, [goalEnabled, precisionEnabled, offsetEnabled]);
  const onMouseUp = useCallback(e => {
    if ((!goalEnabled && !precisionEnabled && !offsetEnabled) || !goalDragRef.current) return;
    const c = canvasRef.current; if (!c || !mapInfo) return;
    const { canvasX, canvasY } = gcp(e, c); const { worldX: gx, worldY: gy, canvasX: sCX, canvasY: sCY } = goalDragRef.current;
    const yaw = Math.atan2(-(canvasY - sCY), canvasX - sCX);
    if (goalEnabled || offsetEnabled) pubGoal(gx, gy, yaw);
    if (precisionEnabled) sendPrecisionWorkAt(gx, gy, yaw);
    goalDragRef.current = null; setGoalDragEnd(null);
  }, [goalEnabled, precisionEnabled, offsetEnabled, mapInfo]);

  const pubGoal = useCallback((wx, wy, yaw) => {
    if (!ros || !isConnected) return;
    if (offsetEnabled && otCmdRef.current) {
      const rp = robotPoseRef.current;
      const ax = rp ? rp.x : 0, ay = rp ? rp.y : 0;
      const params = { ax, ay, bx: wx, by: wy, offset_m: parseFloat(otOffset) || 0.5, side: otSide, waypoint_spacing_m: parseFloat(otSpacing) || 1.0 };
      otCmdRef.current.publish({ data: `run OffsetTracking ${JSON.stringify(params)}` });
      setOtStatus("RUNNING");
      setOtLog(`[${new Date().toLocaleTimeString("tr-TR")}] A:(${ax.toFixed(2)},${ay.toFixed(2)}) → B:(${wx.toFixed(2)},${wy.toFixed(2)})`);
      setPageStatus(`✅ OffsetTracking başlatıldı → offset:${otOffset}m ${otSide}`);
      return;
    }
    const t = new ROSLIB.Topic({ ros, name: "/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", queue_size: 1 });
    t.publish({ header: { frame_id: "map", stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 } }, pose: { position: { x: wx, y: wy, z: 0 }, orientation: yawToQuaternion(yaw) } });
    setPageStatus(`✅ Goal → (${wx.toFixed(2)},${wy.toFixed(2)}) θ:${(yaw * 180 / Math.PI).toFixed(1)}°`);
    setTimeout(() => { try { t.unadvertise(); } catch {} }, 500);
  }, [ros, isConnected, offsetEnabled, otOffset, otSide, otSpacing]);

  const sendPrecisionWorkAt = useCallback((wx, wy, yaw) => {
    if (!ros || !isConnected) return;
    const cmd = `run PrecisionWorkAt {"goal":{"x":${wx.toFixed(4)},"y":${wy.toFixed(4)},"yaw":${yaw.toFixed(4)}}}`;
    const t = new ROSLIB.Topic({ ros, name: "/task_manager/run_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
    t.publish({ data: cmd });
    setTimeout(() => { try { t.unadvertise(); } catch {} }, 500);
    setPwPopup(null); setPwPhase("MOVING");
    setPageStatus(`🎯 PrecisionWorkAt → (${wx.toFixed(2)},${wy.toFixed(2)}) θ:${(yaw * 180 / Math.PI).toFixed(1)}° | hedefe gidiliyor...`);
  }, [ros, isConnected]);

  const sendOperatorCmd = useCallback((cmd) => {
    if (!ros || !isConnected) return;
    const t = new ROSLIB.Topic({ ros, name: "/precision_work/operator_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
    t.publish({ data: cmd });
    setTimeout(() => { try { t.unadvertise(); } catch {} }, 500);
    setPwPopup(null);
    if (cmd === "return_home") { setPwPhase("RESUMING"); setPageStatus("🔄 Başlangıç konumuna dönülüyor..."); }
    else { setPwPhase(null); setPageStatus("▶ Devam Et seçildi → robot serbest."); }
  }, [ros, isConnected]);

  const publishPolygon = useCallback(() => {
    if (!ros || !isConnected || points.length !== 4) return;
    const t = new ROSLIB.Topic({ ros, name: "/coverage/field_polygon", messageType: "geometry_msgs/msg/PolygonStamped", queue_size: 1 });
    t.publish({ header: { frame_id: "map", stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 } }, polygon: { points: points.map(p => ({ x: p.x, y: p.y, z: 0 })) } });
    setPageStatus("📤 Polygon gönderildi → planner path hesaplıyor..."); setPageError("");
    setTimeout(() => { try { t.unadvertise(); } catch {} }, 500);
  }, [ros, isConnected, points]);

  const setRosParam = useCallback((node, name, value) => {
    if (!ros || !isConnected) return Promise.resolve();
    return new Promise(r => {
      const v = typeof value === "string" ? { type: 4, string_value: value } : Number.isInteger(value) ? { type: 2, integer_value: value } : { type: 3, double_value: value };
      new ROSLIB.Service({ ros, name: `/${node}/set_parameters`, serviceType: "rcl_interfaces/srv/SetParameters" }).callService({ parameters: [{ name, value: v }] }, r, r);
    });
  }, [ros, isConnected]);

  const callTrigger = useCallback(name => new Promise((res, rej) =>
    new ROSLIB.Service({ ros, name, serviceType: "std_srvs/srv/Trigger" }).callService({}, res, rej)), [ros]);

  const recompute = useCallback(async () => {
    if (!ros || !isConnected) return;
    await Promise.allSettled([
      setRosParam("coverage_planner_node", "style",              style),
      setRosParam("coverage_planner_node", "line_spacing",       lineSpacing),
      setRosParam("coverage_planner_node", "sweep_angle_deg",    sweepAngle),
      setRosParam("coverage_planner_node", "diagonal_angle_deg", sweepAngle),
      setRosParam("coverage_planner_node", "start_corner",       startCorner),
    ]);
    try { const r = await callTrigger("/coverage/recompute"); if (r.success) setPageStatus("✅ Path yeniden hesaplandı"); else setPageError("Recompute: " + r.message); }
    catch (e) { setPageError("Recompute: " + prettyErr(e)); }
  }, [ros, isConnected, style, lineSpacing, sweepAngle, startCorner, setRosParam, callTrigger]);

  const startFallbackSequential = useCallback(async () => {
    const poses = pathMsg?.poses?.length >= 2 ? pathMsg.poses : previewPath.length >= 2 ? previewToPoses(previewPath) : null;
    if (!poses || poses.length < 2) { setPageError("Path yok — 4 nokta seçin ve Polygon Gönder'e basın"); return; }
    seqRef.current = { active: true, cancel: false };
    setIsRunning(true); setExecProgress(0); setExecStatus(`EXECUTING 0/${poses.length}`);
    const goalTopic = new ROSLIB.Topic({ ros, name: "/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", queue_size: 1 });
    for (let i = 0; i < poses.length; i++) {
      if (seqRef.current.cancel) break;
      setExecProgress(i / poses.length); setExecStatus(`EXECUTING ${i}/${poses.length}`);
      setPageStatus(`🏃 WP ${i + 1}/${poses.length} → (${poses[i].pose.position.x.toFixed(2)}, ${poses[i].pose.position.y.toFixed(2)})`);
      goalTopic.publish({ header: { frame_id: "map", stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 } }, pose: poses[i].pose });
      const result = await new Promise(resolve => {
        const start = Date.now();
        const check = setInterval(() => {
          if (seqRef.current.cancel) { clearInterval(check); resolve("cancel"); return; }
          if (Date.now() - start > 90000) { clearInterval(check); resolve("timeout"); return; }
          const rp = robotPoseRef.current;
          if (rp) { const dx = poses[i].pose.position.x - rp.x, dy = poses[i].pose.position.y - rp.y; if (Math.sqrt(dx * dx + dy * dy) < 0.45) { clearInterval(check); resolve("ok"); return; } }
        }, 300);
      });
      if (result === "cancel") break;
      if (result === "timeout") setPageStatus(`⚠ WP ${i + 1} timeout → sonraki`);
      setExecProgress((i + 1) / poses.length);
      await new Promise(r => setTimeout(r, 200));
    }
    try { goalTopic.unadvertise(); } catch {}
    seqRef.current.active = false; setIsRunning(false);
    if (!seqRef.current.cancel) { setExecStatus("COMPLETED"); setExecProgress(1); setPageStatus("✅ Coverage tamamlandı!"); }
    else { setExecStatus("CANCELED"); setPageStatus("⏹ İptal edildi"); }
  }, [ros, pathMsg, previewPath]);

  const startCoverage = useCallback(async () => {
    if (!ros || !isConnected) { setPageError("ROS bağlı değil"); return; }
    setPageError("");
    await setRosParam("coverage_executor_node", "execution_mode", execMode).catch(() => {});
    if (executorAvailable) {
      try {
        const r = await callTrigger("/coverage/start");
        if (r.success) { setPageStatus("▶ Coverage başlatıldı (C++ executor)"); setIsRunning(true); }
        else { setPageError("Start: " + r.message + (r.message.includes("No path") ? " — önce Polygon Gönder'e basın" : "")); }
      } catch { setPageError("Executor servisi yok — Fallback sequential başlatılıyor"); startFallbackSequential(); }
    } else { setPageStatus("⚠ C++ executor bulunamadı — JS sequential fallback"); startFallbackSequential(); }
  }, [ros, isConnected, execMode, executorAvailable, callTrigger, setRosParam, startFallbackSequential]);

  const cancelCoverage = useCallback(async () => {
    seqRef.current.cancel = true; setIsRunning(false); setExecStatus("CANCELED");
    if (executorAvailable) { try { await callTrigger("/coverage/cancel"); } catch {} }
    try { const cv = new ROSLIB.Topic({ ros, name: "/cmd_vel", messageType: "geometry_msgs/msg/Twist", queue_size: 1 }); cv.publish({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }); setTimeout(() => { try { cv.unadvertise(); } catch {} }, 500); } catch {}
    setPageStatus("⏹ İptal edildi");
  }, [ros, executorAvailable, callTrigger]);

  const clearAll = () => { cancelCoverage(); setPoints([]); setPathMsg(null); setExecStatus("IDLE"); setExecProgress(0); goalDragRef.current = null; setGoalDragEnd(null); setActiveMode(MODE_IDLE); setIsRunning(false); setPageStatus(""); setPageError(""); };

  // Offset Tracking — /task_manager/run_cmd + state subscriber
  useEffect(() => {
    if (!ros || !isConnected) { try { otSubRef.current?.unsubscribe(); } catch {} otSubRef.current = null; otCmdRef.current = null; return; }
    otCmdRef.current = new ROSLIB.Topic({ ros, name: "/task_manager/run_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
    const sub = new ROSLIB.Topic({ ros, name: "/task_manager/state", messageType: "std_msgs/msg/String", throttle_rate: 300, queue_length: 1 });
    sub.subscribe(msg => {
      try {
        const parsed = JSON.parse(msg.data || "{}");
        const task = parsed.active_task;
        if (!task) { setOtStatus(prev => prev === "RUNNING" ? "IDLE" : prev); setPwPhase(prev => { if (prev !== null) setPwPopup(null); return null; }); return; }
        if (task.name === "OffsetTracking") { const s = (task.state || "IDLE").toUpperCase(); setOtStatus(s); setOtLog(`[${new Date().toLocaleTimeString("tr-TR")}] → ${s}`); }
        else if (task.name === "PrecisionWorkAt") {
          const phase = (task.state || "").toUpperCase(); setPwPhase(phase);
          if (phase === "WORKING") { setPwPopup(prev => prev || { open: true }); setPageStatus("🎯 Hedefe ulaşıldı → operatör kararı bekleniyor"); }
          else if (phase === "MOVING") setPageStatus("🚀 PrecisionWorkAt → hedefe gidiliyor...");
          else if (phase === "RESUMING") { setPwPopup(null); setPageStatus("🔄 Başlangıç konumuna dönülüyor..."); }
          else if (["SUCCEEDED", "FAILED", "STOPPED"].includes(phase)) { setPwPopup(null); setPwPhase(null); if (phase === "SUCCEEDED") setPageStatus("✅ PrecisionWorkAt tamamlandı."); }
          setOtStatus(prev => prev === "RUNNING" ? "IDLE" : prev);
        } else { setOtStatus(prev => prev === "RUNNING" ? "IDLE" : prev); setPwPhase(prev => { if (prev !== null) { setPwPopup(null); if (prev === "RESUMING") setPageStatus("✅ Başlangıç konumuna döndü."); } return null; }); }
      } catch {}
    });
    otSubRef.current = sub;
    return () => { try { sub.unsubscribe(); } catch {} otSubRef.current = null; otCmdRef.current = null; };
  }, [ros, isConnected]);

  const stopOffsetTracking = useCallback(() => {
    if (!otCmdRef.current || !isConnected) return;
    otCmdRef.current.publish({ data: "stop OffsetTracking" });
    setOtStatus("IDLE"); setOtLog(`[${new Date().toLocaleTimeString("tr-TR")}] Durduruldu`);
  }, [isConnected]);

  const [wpDone, wpTotal] = useMemo(() => { const m = execStatus.match(/(\d+)\/(\d+)/); if (m) return [parseInt(m[1]), parseInt(m[2])]; if (execStatus === "COMPLETED") return [1, 1]; return [0, 0]; }, [execStatus]);
  const progressPct  = wpTotal > 0 ? wpDone / wpTotal : execProgress;
  const statusColor  = execStatus.startsWith("EXECUTING") ? "#3b82f6" : execStatus === "COMPLETED" ? "#10b981" : execStatus === "CANCELED" ? "#f97316" : execStatus.startsWith("ERROR") ? "#ef4444" : "#475569";
  const canvasCursor = activeMode === MODE_SELECT ? "crosshair" : (goalEnabled || precisionEnabled || offsetEnabled) ? "cell" : "default";
  const displayStatus = pageStatus || gSt;
  const displayError  = pageError || mapLoaderError || gErr;   // ← mapLoaderError eklendi

  return (
    <>
      {/* OPERATÖR KARAR POPUP */}
      {pwPopup && pwPhase === "WORKING" && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 10000, background: "#0d1829", border: "2px solid #f59e0b", borderRadius: 10, padding: "1rem 1.25rem", minWidth: 260, boxShadow: "0 0 30px rgba(245,158,11,0.35)", fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#f59e0b", marginBottom: "0.6rem" }}>🎯 HEDEFE ULAŞILDI — KARAR VERİN</div>
          <div style={{ fontSize: "0.6rem", color: "#94a3b8", marginBottom: "0.9rem" }}>Robot hassas işlem bölgesinde bekliyor.</div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => sendOperatorCmd("return_home")} style={{ flex: 1, padding: "0.5rem 0.25rem", background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: "0.3rem", color: "#ef4444", cursor: "pointer", fontSize: "0.65rem", fontWeight: 700 }}>🔄 Geri Dön</button>
            <button onClick={() => sendOperatorCmd("continue")} style={{ flex: 1, padding: "0.5rem 0.25rem", background: "rgba(16,185,129,0.15)", border: "1px solid #10b981", borderRadius: "0.3rem", color: "#10b981", cursor: "pointer", fontSize: "0.65rem", fontWeight: 700 }}>▶ Devam Et</button>
          </div>
        </div>
      )}
      {pwPhase === "MOVING" && !pwPopup && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 10000, background: "#0d1829", border: "2px solid #3b82f6", borderRadius: 10, padding: "0.75rem 1.25rem", minWidth: 240, fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#3b82f6" }}>🚀 HEDEFE GİDİYOR...</div>
        </div>
      )}
      {pwPhase === "RESUMING" && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 10000, background: "#0d1829", border: "2px solid #3b82f6", borderRadius: 10, padding: "0.75rem 1.25rem", minWidth: 240, fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#3b82f6" }}>🔄 BAŞLANGIÇA DÖNÜYOR...</div>
        </div>
      )}

    <div style={{ minHeight: "calc(100vh - 56px)", width: "100vw", background: "#060d1a", color: "white", padding: "0.5rem", fontFamily: "'JetBrains Mono','Fira Code',monospace", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto", height: "calc(100vh - 68px)", display: "flex", flexDirection: "column", gap: "0.4rem" }}>

        {/* HEADER */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.3rem" }}>🌾</span>
            <h1 style={{ margin: 0, fontSize: "0.95rem", fontWeight: "800", letterSpacing: "0.15em", color: "#e2e8f0" }}>COVERAGE PLANNER</h1>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {!isConnected ? <button onClick={reconnect} style={bS("#2563eb")}>🔌 Bağlan</button> : <span style={{ fontSize: "0.65rem", color: "#10b981", fontWeight: "700" }}>● ROS BAĞLI</span>}
            <button onClick={() => setShowSettings(v => !v)} style={bS("#1e293b", "1px solid #334155")}>⚙ Ayarlar</button>
          </div>
        </div>

        {/* STATUS BAR */}
        <div style={{ flexShrink: 0, background: "#0d1829", borderRadius: "0.3rem", padding: "0.4rem 0.75rem", border: `1px solid ${isConnected ? "#064e3b" : "#7f1d1d"}`, display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <span style={{ color: isConnected ? "#10b981" : "#f87171", fontWeight: "700", fontSize: "0.65rem" }}>{isConnected ? "●" : "○"}</span>
          <span style={{ fontSize: "0.7rem", color: "#94a3b8", flex: 1 }}>{displayStatus}</span>
          <span style={{ fontSize: "0.6rem", color: statusColor, fontWeight: "700", padding: "0.1rem 0.5rem", border: `1px solid ${statusColor}33`, borderRadius: "4px" }}>{execStatus}</span>
          {displayError && <span style={{ fontSize: "0.65rem", color: "#f87171" }}>⚠ {displayError}</span>}
          {robotPose && <span style={{ fontSize: "0.65rem", color: "#facc15", fontWeight: "600", marginLeft: "auto" }}>🤖 [{poseSource}] x:{robotPose.x.toFixed(2)} y:{robotPose.y.toFixed(2)} θ:{(robotPose.yaw * 180 / Math.PI).toFixed(1)}°</span>}
        </div>

        {/* SETTINGS */}
        {showSettings && (
          <div style={{ flexShrink: 0, background: "#0d1829", borderRadius: "0.4rem", padding: "0.75rem", border: "1px solid #1e3a5f", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: "0.6rem" }}>
            <div><div style={lS}>MAP TOPIC</div><input type="text" value={mapTopicName} onChange={e => setMapTopicName(e.target.value)} style={iS} /></div>
            <div><div style={lS}>STİL</div><select value={style} onChange={e => setStyle(e.target.value)} style={iS}><option value="zigzag">↔ Zigzag</option><option value="ladder">↕ Ladder</option><option value="diagonal">↗ Diagonal</option></select></div>
            <div>
              <div style={lS}>ARALIK (m)</div>
              <input type="number" min="0.05" max="5" step="0.05" value={lineSpacing} onChange={e => setLineSpacing(Number(e.target.value))} style={iS} />
              {points.length === 4 && <div style={{ fontSize: "0.55rem", marginTop: "0.1rem", color: estimatedLines < 2 ? "#ef4444" : estimatedLines < 4 ? "#f97316" : "#10b981" }}>≈ {estimatedLines} çizgi{estimatedLines < 2 ? " — çok büyük!" : ""}</div>}
            </div>
            <div><div style={lS}>SWEEP (°)</div><input type="number" min="0" max="180" step="5" value={sweepAngle} onChange={e => setSweepAngle(Number(e.target.value))} style={iS} /></div>
            <div><div style={lS}>BAŞLANGIÇ KÖŞESİ</div><select value={startCorner} onChange={e => setStartCorner(Number(e.target.value))} style={iS}>{[0, 1, 2, 3].map(v => <option key={v} value={v}>Köşe {v + 1}</option>)}</select></div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", justifyContent: "flex-end" }}>
              <button onClick={recompute} disabled={!isConnected} style={bS(isConnected ? "#1d4ed8" : "#1e293b")}>📤 Uygula + Recompute</button>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.65rem", color: "#94a3b8", cursor: "pointer" }}><input type="checkbox" checked={showPreview} onChange={e => setShowPreview(e.target.checked)} /> Preview</label>
            </div>
          </div>
        )}

        {/* MAIN */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr", gap: "0.4rem", minHeight: 0 }}>

          {/* LEFT PANEL */}
          <div style={{ background: "#0d1829", borderRadius: "0.4rem", padding: "0.75rem", border: "1px solid #162032", display: "flex", flexDirection: "column", gap: "0.5rem", overflow: "auto" }}>

            {/* Executor indicator */}
            <div style={{ padding: "0.4rem 0.5rem", borderRadius: "0.3rem", background: executorAvailable ? "rgba(16,185,129,0.07)" : "rgba(245,158,11,0.07)", border: `1px solid ${executorAvailable ? "#064e3b" : "#78350f"}`, fontSize: "0.6rem" }}>
              {executorAvailable ? <span style={{ color: "#10b981" }}>✓ C++ Executor bağlı — Nav2 waypoint takibi aktif</span> : <span style={{ color: "#f59e0b" }}>⚠ C++ Executor yok — JS fallback kullanılacak</span>}
            </div>

            {/* Map source (useMapLoader) */}
            {mapSource && (
              <div style={{ padding: "0.3rem 0.5rem", borderRadius: "0.3rem", background: "rgba(96,165,250,0.07)", border: "1px solid #1e3a5f", fontSize: "0.55rem", color: "#60a5fa" }}>
                🗺 {mapSource}
              </div>
            )}

            {/* Style */}
            <div>
              <div style={lS}>COVERAGE STİLİ</div>
              <div style={{ display: "flex", gap: "0.3rem" }}>
                {[{ n: "zigzag", i: "↔" }, { n: "ladder", i: "↕" }, { n: "diagonal", i: "↗" }].map(s => (
                  <button key={s.n} onClick={() => setStyle(s.n)} style={{ flex: 1, padding: "0.4rem 0.1rem", background: style === s.n ? "#1d4ed8" : "#162032", border: style === s.n ? "1px solid #3b82f6" : "1px solid #1e293b", borderRadius: "0.25rem", color: "white", cursor: "pointer", fontSize: "0.58rem", fontWeight: style === s.n ? "700" : "400" }}>{s.i} {s.n}</button>
                ))}
              </div>
            </div>

            {/* Spacing */}
            <div style={cS}>
              <div style={lS}>ARALIK — <span style={{ color: estimatedLines < 2 ? "#ef4444" : estimatedLines < 4 ? "#f97316" : "#10b981" }}>≈ {estimatedLines || "?"} çizgi</span></div>
              <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                <button onClick={() => setLineSpacing(v => Math.max(0.05, +(v - 0.05).toFixed(2)))} style={{ ...bS("#162032", "1px solid #1e293b"), padding: "0.2rem 0.6rem", fontSize: "1rem" }}>−</button>
                <span style={{ flex: 1, textAlign: "center", fontSize: "0.9rem", fontWeight: "700" }}>{lineSpacing.toFixed(2)}<span style={{ fontSize: "0.55rem", color: "#475569" }}> m</span></span>
                <button onClick={() => setLineSpacing(v => Math.min(5, +(v + 0.05).toFixed(2)))} style={{ ...bS("#162032", "1px solid #1e293b"), padding: "0.2rem 0.6rem", fontSize: "1rem" }}>+</button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #162032" }} />

            {/* Modes */}
            <div>
              <div style={lS}>MOD SEÇ</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <button onClick={() => setActiveMode(m => m === MODE_SELECT ? MODE_IDLE : MODE_SELECT)} style={{ padding: "0.55rem 0.5rem", textAlign: "left", background: activeMode === MODE_SELECT ? "rgba(249,115,22,0.12)" : "#162032", border: `1px solid ${activeMode === MODE_SELECT ? "#f97316" : "#1e293b"}`, borderRadius: "0.3rem", color: activeMode === MODE_SELECT ? "#f97316" : "#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700" }}>
                  {activeMode === MODE_SELECT ? "✅" : "⬜"} Alan Seçimi ({points.length}/4)
                </button>
                <button onClick={() => { if (!isConnected) { setPageError("Bağlanın"); return; } setGoalEnabled(v => !v); goalDragRef.current = null; setGoalDragEnd(null); }} style={{ padding: "0.55rem 0.5rem", textAlign: "left", background: goalEnabled ? "rgba(168,85,247,0.12)" : "#162032", border: `1px solid ${goalEnabled ? "#a855f7" : "#1e293b"}`, borderRadius: "0.3rem", color: goalEnabled ? "#c084fc" : "#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700" }}>
                  {goalEnabled ? "🟣" : "⬜"} 2D Nav Goal
                </button>
                <button onClick={() => { if (!isConnected) { setPageError("Bağlanın"); return; } setPrecisionEnabled(v => !v); goalDragRef.current = null; setGoalDragEnd(null); }} style={{ padding: "0.55rem 0.5rem", textAlign: "left", background: precisionEnabled ? "rgba(245,158,11,0.12)" : "#162032", border: `1px solid ${precisionEnabled ? "#f59e0b" : "#1e293b"}`, borderRadius: "0.3rem", color: precisionEnabled ? "#f59e0b" : "#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700" }}>
                  {precisionEnabled ? "🟡" : "⬜"} 🎯 Hassas İşlem
                </button>
                <button onClick={() => { if (!isConnected) { setPageError("Bağlanın"); return; } setOffsetEnabled(v => !v); if (otStatus === "RUNNING") stopOffsetTracking(); goalDragRef.current = null; setGoalDragEnd(null); }} style={{ padding: "0.55rem 0.5rem", textAlign: "left", background: offsetEnabled ? "rgba(14,165,233,0.12)" : "#162032", border: `1px solid ${offsetEnabled ? "#0ea5e9" : "#1e293b"}`, borderRadius: "0.3rem", color: offsetEnabled ? "#0ea5e9" : "#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700" }}>
                  {offsetEnabled ? "🔵" : "⬜"} 📐 Offset Takibi
                  {otStatus === "RUNNING" && <span style={{ marginLeft: "0.4rem", fontSize: "0.55rem", color: "#0ea5e9", background: "rgba(14,165,233,0.15)", padding: "0.05rem 0.3rem", borderRadius: 3 }}>RUNNING</span>}
                </button>
              </div>
            </div>

            {/* Offset Tracking ayarları */}
            {offsetEnabled && (
              <div style={{ ...cS, border: `1px solid ${otStatus === "RUNNING" ? "rgba(14,165,233,0.4)" : "#1e3a5f"}`, background: "rgba(14,165,233,0.03)" }}>
                <div style={{ ...lS, color: "#0ea5e9" }}>📐 OFFSETTAKİBİ AYARLARI</div>
                <div style={{ fontSize: "0.58rem", color: "#475569", marginBottom: "0.4rem" }}>Haritadan 2D Nav Goal ile hedef seçince robot mevcut konumdan o noktaya offset mesafede gider.</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.3rem", marginBottom: "0.3rem" }}>
                  <div><div style={lS}>OFFSET (m)</div><input type="text" inputMode="decimal" value={otOffset} onChange={e => setOtOffset(e.target.value)} style={{ ...iS, fontSize: "0.65rem" }} /></div>
                  <div><div style={lS}>WP ARALIĞI (m)</div><input type="text" inputMode="decimal" value={otSpacing} onChange={e => setOtSpacing(e.target.value)} style={{ ...iS, fontSize: "0.65rem" }} /></div>
                </div>
                <div style={{ marginBottom: "0.3rem" }}>
                  <div style={lS}>YÖN</div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    {["left", "right"].map(s => (<button key={s} onClick={() => setOtSide(s)} style={{ flex: 1, ...bS(otSide === s ? "#1d4ed8" : "#162032", otSide === s ? "1px solid #3b82f6" : "1px solid #1e293b"), fontSize: "0.6rem" }}>{s === "left" ? "← SOL" : "SAĞ →"}</button>))}
                  </div>
                </div>
                {otStatus === "RUNNING" && <button onClick={stopOffsetTracking} style={{ ...bS("#7f1d1d", "1px solid #ef4444"), width: "100%", fontSize: "0.65rem", color: "#fca5a5", marginBottom: "0.3rem" }}>⛔ Offset Takibini Durdur</button>}
                {otLog && <div style={{ fontSize: "0.52rem", color: "#334155", wordBreak: "break-all", marginTop: "0.2rem" }}>{otLog}</div>}
              </div>
            )}

            <div style={{ borderTop: "1px solid #162032" }} />

            {/* Points */}
            <div style={cS}>
              <div style={lS}>NOKTALAR <span style={{ color: points.length === 4 ? "#10b981" : "#f97316" }}>{points.length}/4</span></div>
              {points.length === 0 ? <div style={{ fontSize: "0.6rem", color: "#1e293b" }}>Alan seçimde tıkla</div> : points.map((p, i) => <div key={i} style={{ fontSize: "0.6rem", color: i === startCorner ? "#22c55e" : "#60a5fa", lineHeight: "1.8" }}>{i + 1}: ({p.x.toFixed(2)}, {p.y.toFixed(2)}) {i === startCorner ? "⭐" : ""}</div>)}
            </div>

            {/* Robot */}
            <div style={cS}>
              <div style={lS}>ROBOT</div>
              {robotPose ? <div style={{ fontSize: "0.65rem", color: "#facc15", lineHeight: "1.7" }}>x:{robotPose.x.toFixed(3)} y:{robotPose.y.toFixed(3)} θ:{(robotPose.yaw * 180 / Math.PI).toFixed(1)}°<div style={{ color: poseSource.includes("odom") ? "#f97316" : "#10b981", fontSize: "0.5rem" }}>{poseSource}</div></div> : <div style={{ fontSize: "0.6rem", color: "#334155" }}>Bekleniyor...</div>}
            </div>

            {/* Path info */}
            {pathMsg?.poses?.length > 0 && (
              <div style={{ ...cS, border: "1px solid #064e3b" }}>
                <div style={lS}>ROS PATH ✅</div>
                <div style={{ fontSize: "0.65rem", color: "#10b981", fontWeight: "700" }}>{pathMsg.poses.length} waypoint</div>
                <div style={{ fontSize: "0.5rem", color: "#475569" }}>frame: {pathMsg.header?.frame_id || "?"}</div>
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* Execution mode */}
            <div style={cS}>
              <div style={lS}>NAV2 MODU (C++ Executor)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                {[{ k: "navigate_through_poses", l: "NavigateThroughPoses", d: "RViz gibi — tüm WP sırayla", c: "#3b82f6" }, { k: "sequential", l: "Sequential", d: "Her WP ayrı NavigateToPose", c: "#10b981" }].map(m => (
                  <button key={m.k} onClick={() => setExecMode(m.k)} style={{ padding: "0.4rem 0.5rem", textAlign: "left", background: execMode === m.k ? `${m.c}22` : "#0a1020", border: `1px solid ${execMode === m.k ? m.c : "#162032"}`, borderRadius: "0.25rem", color: execMode === m.k ? m.c : "#475569", cursor: "pointer", fontSize: "0.58rem", fontWeight: execMode === m.k ? "700" : "400" }}>
                    {execMode === m.k ? "◉" : "○"} {m.l}<div style={{ fontSize: "0.5rem", color: "#334155", marginTop: "0.1rem" }}>{m.d}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Progress */}
            {(isRunning || execStatus === "COMPLETED") && (
              <div style={{ ...cS, border: `1px solid ${execStatus === "COMPLETED" ? "#064e3b" : "#1d4ed8"}` }}>
                <div style={lS}>İLERLEME — <span style={{ color: statusColor }}>{execStatus === "COMPLETED" ? "✅ Tamamlandı" : `${wpDone}/${wpTotal} WP`}</span></div>
                <div style={{ height: "6px", background: "#0a1020", borderRadius: "3px", overflow: "hidden", marginTop: "0.3rem" }}><div style={{ width: `${Math.round(progressPct * 100)}%`, height: "100%", background: execStatus === "COMPLETED" ? "#10b981" : "#3b82f6", borderRadius: "3px", transition: "width 0.4s" }} /></div>
                <div style={{ fontSize: "0.55rem", color: "#475569", marginTop: "0.2rem" }}>{Math.round(progressPct * 100)}%</div>
              </div>
            )}

            {/* BUTTONS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <div style={{ fontSize: "0.5rem", color: "#334155", marginBottom: "0.1rem" }}>ADIM 1 — PLANNER'A GÖNDER</div>
              <button onClick={publishPolygon} disabled={points.length !== 4 || !isConnected} style={{ ...bS(points.length === 4 && isConnected ? "#065f46" : "#162032"), padding: "0.65rem", fontSize: "0.75rem", opacity: points.length === 4 && isConnected ? 1 : 0.4 }}>📐 Polygon Gönder → Planner</button>
              <div style={{ fontSize: "0.5rem", color: "#334155", marginBottom: "0.1rem" }}>ADIM 2 — NAV2'YE GÖNDER</div>
              <button onClick={startCoverage} disabled={!isConnected || isRunning} style={{ ...bS(isRunning ? "#1d4ed8" : "#7c3aed"), padding: "0.75rem", fontSize: "0.8rem", fontWeight: "800", opacity: isConnected ? 1 : 0.4 }}>{isRunning ? `🏃 ${wpDone}/${wpTotal} WP...` : "🚀 Coverage Başlat"}</button>
              <button onClick={cancelCoverage} disabled={!isRunning} style={{ ...bS(isRunning ? "#991b1b" : "#162032", isRunning ? "1px solid #ef4444" : "1px solid #1e293b"), padding: "0.7rem", fontSize: "0.75rem", fontWeight: "800", opacity: isRunning ? 1 : 0.35, color: isRunning ? "#fca5a5" : "#475569" }}>⛔ Durdur</button>
              <button onClick={clearAll} style={{ ...bS("transparent", "1px solid #1e293b"), padding: "0.4rem", fontSize: "0.65rem", color: "#475569" }}>🗑 Temizle</button>

              {/* Haritayı Yenile — useMapLoader QoS fix */}
              <button onClick={reloadMap} disabled={!isConnected || mapLoading} style={{ ...bS("#0f2137", "1px solid #1e3a5f"), padding: "0.4rem", fontSize: "0.65rem", color: mapLoading ? "#475569" : "#60a5fa", opacity: isConnected ? 1 : 0.4 }}>
                {mapLoading ? "⏳ Harita yükleniyor..." : "🗺 Haritayı Yenile"}
              </button>
            </div>

            {/* Flow guide */}
            <div style={{ fontSize: "0.5rem", color: "#334155", lineHeight: "1.9", borderTop: "1px solid #162032", paddingTop: "0.4rem" }}>
              <div style={{ color: "#475569", fontWeight: "700" }}>DOĞRU AKIŞ:</div>
              <div>1 → Stil seç + 4 nokta işaretle</div>
              <div>2 → 📐 Polygon Gönder (planner path üretir)</div>
              <div>3 → Path haritada yeşil görünür</div>
              <div>4 → 🚀 Coverage Başlat</div>
              <div style={{ color: "#10b981", marginTop: "0.2rem" }}>✓ C++ executor Nav2'yi yönetir</div>
              <div style={{ color: "#60a5fa", fontSize: "0.48rem" }}>⚠ Executor yoksa JS fallback devreye girer</div>
            </div>
          </div>

          {/* MAP */}
          <div style={{ background: "#0d1829", borderRadius: "0.4rem", padding: "0.75rem", border: "1px solid #162032", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem", flexShrink: 0, flexWrap: "wrap", gap: "0.3rem" }}>
              <span style={{ fontSize: "0.7rem", fontWeight: "700", color: "#e2e8f0" }}>🗺 HARİTA</span>
              <div style={{ display: "flex", gap: "0.6rem", fontSize: "0.58rem" }}>
                <span style={{ color: "#f97316" }}>🟠 Alan</span>
                <span style={{ color: "#3b82f6" }}>🔵 Preview</span>
                <span style={{ color: "#10b981" }}>🟢 ROS Path (waypoints)</span>
                <span style={{ color: "#facc15" }}>🟡 Robot</span>
                <span style={{ color: "#22c55e" }}>● Start</span>
                <span style={{ color: "#ef4444" }}>● End</span>
              </div>
            </div>
            <div ref={containerRef} style={{ flex: 1, background: "#040810", borderRadius: "0.3rem", border: "1px solid #162032", overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
              {mapImageData
                ? <canvas ref={canvasRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { if (goalEnabled || precisionEnabled || offsetEnabled) { goalDragRef.current = null; setGoalDragEnd(null); } }} style={{ cursor: canvasCursor, display: "block", maxWidth: "100%", maxHeight: "100%" }} />
                : <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🗺</div>
                    <div style={{ fontSize: "0.8rem", color: "#1e293b" }}>{mapLoading ? "Yükleniyor..." : "Bağlantı bekleniyor"}</div>
                    {mapLoaderError && <div style={{ fontSize: "0.65rem", color: "#f59e0b", marginTop: "0.3rem" }}>{mapLoaderError}</div>}
                  </div>
              }
              {mapInfo && <div style={{ position: "absolute", bottom: 5, right: 7, fontSize: "0.55rem", color: "#1e293b" }}>{mapInfo.width}×{mapInfo.height} · {mapInfo.resolution.toFixed(3)}m/px</div>}
              {mapSource && <div style={{ position: "absolute", bottom: 5, left: 7, fontSize: "0.5rem", color: "#1e3a5f" }}>{mapSource}</div>}
              {activeMode === MODE_SELECT && <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(249,115,22,0.1)", border: "1px solid #f97316", borderRadius: "0.2rem", padding: "0.2rem 0.45rem", fontSize: "0.6rem", color: "#fb923c", fontWeight: "700" }}>✚ ALAN SEÇİMİ ({points.length}/4) — Sol tık: nokta ekle</div>}
              {(goalEnabled || precisionEnabled || offsetEnabled) && activeMode !== MODE_SELECT && (
                <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,0.6)", border: "1px solid #334155", borderRadius: "0.2rem", padding: "0.2rem 0.6rem", fontSize: "0.6rem", color: "#e2e8f0", fontWeight: "700", display: "flex", gap: "0.6rem" }}>
                  {goalEnabled      && <span style={{ color: "#c084fc" }}>🟣 Nav Goal</span>}
                  {precisionEnabled && <span style={{ color: "#f59e0b" }}>🎯 Hassas İşlem</span>}
                  {offsetEnabled    && <span style={{ color: "#0ea5e9" }}>📐 Offset Takibi ({otOffset}m {otSide})</span>}
                  <span style={{ color: "#475569" }}>→ Tıkla + Sürükle yön</span>
                </div>
              )}
              {isRunning && <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "rgba(13,24,41,0.9)", border: "1px solid #1d4ed8", borderRadius: "6px", padding: "0.3rem 1rem", fontSize: "0.65rem", color: "#60a5fa", fontWeight: "700" }}>🏃 {execStatus}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

const bS = (bg, border = "none") => ({ padding: "0.4rem 0.75rem", background: bg, border, borderRadius: "0.3rem", color: "white", fontWeight: "700", cursor: "pointer", fontSize: "0.7rem" });
const iS = { width: "100%", padding: "0.4rem", background: "#162032", border: "1px solid #1e293b", borderRadius: "0.25rem", color: "white", fontSize: "0.7rem", outline: "none", boxSizing: "border-box" };
const lS = { fontSize: "0.55rem", color: "#334155", letterSpacing: "0.1em", marginBottom: "0.3rem" };
const cS = { background: "#060d1a", borderRadius: "0.3rem", padding: "0.5rem", border: "1px solid #162032" };
