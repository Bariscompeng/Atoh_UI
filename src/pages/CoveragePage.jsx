import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function prettyErr(e) {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function quaternionToYaw(q) {
  const siny = 2.0 * (q.w * q.z + q.x * q.y);
  const cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
  return Math.atan2(siny, cosy);
}

function yawToQuaternion(yaw) {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  return null;
}

function findPolygonIntersections(lineStart, lineEnd, polygon) {
  const intersections = [];
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const pt = lineIntersection(lineStart.x, lineStart.y, lineEnd.x, lineEnd.y, p1.x, p1.y, p2.x, p2.y);
    if (pt) intersections.push(pt);
  }
  if (Math.abs(lineEnd.x - lineStart.x) > Math.abs(lineEnd.y - lineStart.y))
    intersections.sort((a, b) => a.x - b.x);
  else
    intersections.sort((a, b) => a.y - b.y);
  return intersections;
}

function generatePreviewPath(points, style, lineSpacing, sweepAngle, startCorner) {
  if (points.length !== 4) return [];
  const center = { x: points.reduce((s, p) => s + p.x, 0) / 4, y: points.reduce((s, p) => s + p.y, 0) / 4 };
  const sortedPoints = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const polygon = Array.from({ length: 4 }, (_, i) => sortedPoints[(i + startCorner) % 4]);
  const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x));
  const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y));
  const width = maxX - minX, height = maxY - minY;
  const path = [];

  if (style === "zigzag") {
    const numLines = Math.max(2, Math.floor(height / lineSpacing));
    const spacing = height / numLines;
    for (let i = 0; i <= numLines; i++) {
      const y = minY + i * spacing;
      const pts = findPolygonIntersections({ x: minX - 1, y }, { x: maxX + 1, y }, polygon);
      if (pts.length >= 2) {
        if (i % 2 === 0) { path.push(pts[0]); path.push(pts[pts.length - 1]); }
        else { path.push(pts[pts.length - 1]); path.push(pts[0]); }
      }
    }
  } else if (style === "ladder") {
    const numLines = Math.max(2, Math.floor(width / lineSpacing));
    const spacing = width / numLines;
    for (let i = 0; i <= numLines; i++) {
      const x = minX + i * spacing;
      const pts = findPolygonIntersections({ x, y: minY - 1 }, { x, y: maxY + 1 }, polygon);
      if (pts.length >= 2) {
        if (i % 2 === 0) { path.push(pts[0]); path.push(pts[pts.length - 1]); }
        else { path.push(pts[pts.length - 1]); path.push(pts[0]); }
      }
    }
  } else if (style === "diagonal") {
    const diagonal = Math.sqrt(width * width + height * height);
    const numLines = Math.max(2, Math.floor(diagonal / lineSpacing));
    const angleRad = (sweepAngle * Math.PI) / 180;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    for (let i = 0; i <= numLines; i++) {
      const offset = (i / numLines) * diagonal - diagonal / 2;
      const px = offset * cosA, py = offset * sinA;
      const ls = { x: center.x + px - diagonal * sinA, y: center.y + py + diagonal * cosA };
      const le = { x: center.x + px + diagonal * sinA, y: center.y + py - diagonal * cosA };
      const pts = findPolygonIntersections(ls, le, polygon);
      if (pts.length >= 2) {
        if (i % 2 === 0) { path.push(pts[0]); path.push(pts[pts.length - 1]); }
        else { path.push(pts[pts.length - 1]); path.push(pts[0]); }
      }
    }
  }
  return path;
}

// ─── Modes ────────────────────────────────────────────────────────────────────
const MODE_IDLE     = "idle";
const MODE_SELECT   = "select";
const MODE_GOALPOSE = "goalpose";

// ─── Component ────────────────────────────────────────────────────────────────
export default function CoveragePage() {
  const { ros, isConnected, status: globalStatus, errorText: globalErrorText, reconnect } = useROS();

  const [pageStatus, setPageStatus] = useState("");
  const [pageError,  setPageError]  = useState("");

  // Map
  const [mapTopicName, setMapTopicName] = useState("/map");
  const [mapInfo,      setMapInfo]      = useState(null);
  const [mapImageData, setMapImageData] = useState(null);
  const [mapLoading,   setMapLoading]   = useState(false);

  // Robot pose
  const [robotPose,  setRobotPose]  = useState(null);
  const [poseSource, setPoseSource] = useState("");

  // Interaction
  const [points,     setPoints]     = useState([]);
  const [activeMode, setActiveMode] = useState(MODE_IDLE);

  // Goal pose drag
  const goalDragRef  = useRef(null);
  const [goalDragEnd, setGoalDragEnd] = useState(null);

  // Path
  const [pathMsg,     setPathMsg]     = useState(null);
  const [showPreview, setShowPreview] = useState(true);

  // Exec
  const [execStatus,   setExecStatus]   = useState("idle");
  const [execFeedback, setExecFeedback] = useState("");

  // Style
  const [style,       setStyle]       = useState("zigzag");
  const [lineSpacing, setLineSpacing] = useState(0.6);
  const [sweepAngle,  setSweepAngle]  = useState(90);
  const [startCorner, setStartCorner] = useState(0);

  const [showSettings, setShowSettings] = useState(false);

  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const mapTopicRef  = useRef(null);
  const pathTopicRef = useRef(null);
  const amclRef      = useRef(null);
  const odomRef      = useRef(null);

  const fieldPolyTopic   = "/coverage/field_polygon";
  const pathTopicName    = "/coverage/path";
  const recomputeSrvName = "/coverage/recompute";
  const goalPoseTopic    = "/goal_pose";

  const previewPath = useMemo(
    () => generatePreviewPath(points, style, lineSpacing, sweepAngle, startCorner),
    [points, style, lineSpacing, sweepAngle, startCorner]
  );

  const displayStatus = pageStatus || globalStatus;
  const displayError  = pageError  || globalErrorText;

  // ── canvasToWorld ──────────────────────────────────────────────────────────
  const canvasToWorld = useCallback((cx, cy) => {
    if (!mapInfo || !canvasRef.current) return { wx: 0, wy: 0 };
    const sc = canvasRef.current.width / mapInfo.width;
    return {
      wx: mapInfo.originX + (cx / sc) * mapInfo.resolution,
      wy: mapInfo.originY + (mapInfo.height - cy / sc) * mapInfo.resolution,
    };
  }, [mapInfo]);

  // ── Subscribe /map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (mapTopicRef.current) { try { mapTopicRef.current.unsubscribe(); } catch {} }
    setMapLoading(true);
    setMapImageData(null);

    const topic = new ROSLIB.Topic({
      ros, name: mapTopicName,
      messageType: "nav_msgs/msg/OccupancyGrid",
      throttle_rate: 500, queue_size: 1,
    });
    topic.subscribe((msg) => {
      setMapLoading(false);
      if (!msg?.info?.width || !msg?.info?.height) { setPageError("Harita verisi geçersiz"); return; }
      setPageError("");
      const info = {
        resolution: msg.info.resolution, width: msg.info.width, height: msg.info.height,
        originX: msg.info.origin.position.x, originY: msg.info.origin.position.y,
      };
      setMapInfo(info);
      const w = info.width, h = info.height;
      const img = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = msg.data[i];
        const c = v < 0 ? 128 : 255 - clamp((v / 100) * 255, 0, 255);
        const idx = i * 4;
        img.data[idx] = c; img.data[idx+1] = c; img.data[idx+2] = c; img.data[idx+3] = 255;
      }
      setMapImageData(img);
    });
    mapTopicRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected, mapTopicName]);

  // ── Subscribe /coverage/path ───────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (pathTopicRef.current) { try { pathTopicRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({
      ros, name: pathTopicName, messageType: "nav_msgs/msg/Path",
      throttle_rate: 100, queue_size: 1,
    });
    topic.subscribe((msg) => setPathMsg(msg));
    pathTopicRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── Subscribe robot pose (amcl + odom fallback) ────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (amclRef.current) { try { amclRef.current.unsubscribe(); } catch {} }
    if (odomRef.current) { try { odomRef.current.unsubscribe(); } catch {} }

    let hasAmcl = false;

    const amcl = new ROSLIB.Topic({
      ros, name: "/amcl_pose",
      messageType: "geometry_msgs/msg/PoseWithCovarianceStamped",
      throttle_rate: 100, queue_size: 1,
    });
    amcl.subscribe((msg) => {
      hasAmcl = true;
      const p = msg.pose.pose;
      setRobotPose({ x: p.position.x, y: p.position.y, yaw: quaternionToYaw(p.orientation) });
      setPoseSource("amcl");
    });
    amclRef.current = amcl;

    const odom = new ROSLIB.Topic({
      ros, name: "/odom",
      messageType: "nav_msgs/msg/Odometry",
      throttle_rate: 100, queue_size: 1,
    });
    odom.subscribe((msg) => {
      if (hasAmcl) return;
      const p = msg.pose.pose;
      setRobotPose({ x: p.position.x, y: p.position.y, yaw: quaternionToYaw(p.orientation) });
      setPoseSource("odom");
    });
    odomRef.current = odom;

    return () => {
      try { amcl.unsubscribe(); } catch {}
      try { odom.unsubscribe(); } catch {}
    };
  }, [ros, isConnected]);

  // ── Draw canvas ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !mapInfo || !mapImageData) return;

    const rect  = container.getBoundingClientRect();
    const mapW  = mapInfo.width, mapH = mapInfo.height;
    const scale = Math.min(rect.width / mapW, rect.height / mapH);
    const drawW = Math.floor(mapW * scale);
    const drawH = Math.floor(mapH * scale);

    canvas.width  = drawW;
    canvas.height = drawH;
    canvas.style.width  = drawW + "px";
    canvas.style.height = drawH + "px";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw map
    const off = document.createElement("canvas");
    off.width = mapW; off.height = mapH;
    off.getContext("2d").putImageData(mapImageData, 0, 0);
    ctx.clearRect(0, 0, drawW, drawH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, drawW, drawH);

    const w2c = (wx, wy) => ({
      cx: ((wx - mapInfo.originX) / mapInfo.resolution) * scale,
      cy: (mapH - (wy - mapInfo.originY) / mapInfo.resolution) * scale,
    });

    const drawArrow = (fx, fy, tx, ty, color, head = 8, lw = 2) => {
      const angle = Math.atan2(ty - fy, tx - fx);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - head * Math.cos(angle - Math.PI / 6), ty - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(tx - head * Math.cos(angle + Math.PI / 6), ty - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath(); ctx.fill();
    };

    // Preview path
    if (showPreview && previewPath.length > 1) {
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < previewPath.length - 1; i++) {
        const { cx: x1, cy: y1 } = w2c(previewPath[i].x, previewPath[i].y);
        const { cx: x2, cy: y2 } = w2c(previewPath[i+1].x, previewPath[i+1].y);
        drawArrow(x1, y1, x2, y2, "#3b82f6", 10, 2);
      }
      const { cx: sx, cy: sy } = w2c(previewPath[0].x, previewPath[0].y);
      ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("S", sx, sy);
      const ep = previewPath[previewPath.length - 1];
      const { cx: ex, cy: ey } = w2c(ep.x, ep.y);
      ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("E", ex, ey);
      ctx.globalAlpha = 1;
    }

    // ROS path
    if (pathMsg?.poses?.length > 1 && !showPreview) {
      ctx.globalAlpha = 0.9; ctx.lineWidth = 2.5; ctx.strokeStyle = "#10b981"; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      pathMsg.poses.forEach((ps, i) => {
        const { cx, cy } = w2c(ps.pose.position.x, ps.pose.position.y);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // Polygon selection
    if (points.length > 0) {
      const cvsPts = points.map(p => w2c(p.x, p.y));
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#f97316"; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(cvsPts[0].cx, cvsPts[0].cy);
      for (let i = 1; i < cvsPts.length; i++) ctx.lineTo(cvsPts[i].cx, cvsPts[i].cy);
      if (points.length === 4) {
        ctx.closePath(); ctx.stroke();
        ctx.fillStyle = "rgba(249,115,22,0.07)"; ctx.fill();
      } else { ctx.stroke(); }
      cvsPts.forEach(({ cx, cy }, i) => {
        ctx.fillStyle = i === startCorner ? "#22c55e" : "#f97316";
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 11px monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), cx, cy);
      });
    }

    // Robot pose — sarı daire + yön oku
    if (robotPose) {
      const { cx: rx, cy: ry } = w2c(robotPose.x, robotPose.y);
      const arrowLen = 22;
      const ax = rx + arrowLen * Math.cos(-robotPose.yaw);
      const ay = ry + arrowLen * Math.sin(-robotPose.yaw);
      // Glow
      const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, 22);
      grad.addColorStop(0, "rgba(250,204,21,0.45)");
      grad.addColorStop(1, "rgba(250,204,21,0)");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(rx, ry, 22, 0, Math.PI * 2); ctx.fill();
      // Body
      ctx.fillStyle = "#facc15"; ctx.strokeStyle = "#0b1120"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(rx, ry, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Arrow
      drawArrow(rx, ry, ax, ay, "#0b1120", 7, 2.5);
      // Label
      ctx.fillStyle = "#facc15"; ctx.font = "bold 9px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("ROBOT", rx, ry + 14);
    }

    // Goal pose drag preview
    if (goalDragRef.current && goalDragEnd) {
      const { canvasX: gx, canvasY: gy } = goalDragRef.current;
      const { canvasX: ex, canvasY: ey } = goalDragEnd;
      // Circle
      ctx.fillStyle = "rgba(168,85,247,0.25)";
      ctx.strokeStyle = "#a855f7"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(gx, gy, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Arrow
      const len = Math.max(25, Math.sqrt((ex-gx)**2 + (ey-gy)**2));
      const ang = Math.atan2(ey - gy, ex - gx);
      const headX = gx + Math.min(len, 60) * Math.cos(ang);
      const headY = gy + Math.min(len, 60) * Math.sin(ang);
      drawArrow(gx, gy, headX, headY, "#a855f7", 12, 3);
      ctx.fillStyle = "#a855f7"; ctx.font = "bold 9px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("GOAL", gx, gy + 16);
    }

  }, [mapInfo, mapImageData, points, pathMsg, previewPath, showPreview, startCorner, robotPose, goalDragEnd]);

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  const getCanvasPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    return {
      canvasX: (e.clientX - r.left) * (canvas.width  / r.width),
      canvasY: (e.clientY - r.top)  * (canvas.height / r.height),
    };
  };

  const onCanvasMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapInfo) return;
    const { canvasX, canvasY } = getCanvasPos(e, canvas);
    const { wx, wy } = canvasToWorld(canvasX, canvasY);

    if (activeMode === MODE_SELECT) {
      setPoints(prev => prev.length >= 4 ? prev : [...prev, { x: wx, y: wy }]);
    } else if (activeMode === MODE_GOALPOSE) {
      goalDragRef.current = { worldX: wx, worldY: wy, canvasX, canvasY };
      setGoalDragEnd({ canvasX, canvasY });
    }
  }, [activeMode, mapInfo, canvasToWorld]);

  const onCanvasMouseMove = useCallback((e) => {
    if (activeMode !== MODE_GOALPOSE || !goalDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { canvasX, canvasY } = getCanvasPos(e, canvas);
    setGoalDragEnd({ canvasX, canvasY });
  }, [activeMode]);

  const onCanvasMouseUp = useCallback((e) => {
    if (activeMode !== MODE_GOALPOSE || !goalDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas || !mapInfo) return;
    const { canvasX, canvasY } = getCanvasPos(e, canvas);
    const { worldX: gx, worldY: gy, canvasX: sCX, canvasY: sCY } = goalDragRef.current;

    // dx/dy in canvas space; flip y for world yaw
    const dx =  (canvasX - sCX);
    const dy = -(canvasY - sCY);
    const yaw = Math.atan2(dy, dx);

    publishGoalPose(gx, gy, yaw);
    goalDragRef.current = null;
    setGoalDragEnd(null);
    setActiveMode(MODE_IDLE);
  }, [activeMode, mapInfo, canvasToWorld]);

  // ── Publish goal pose → /goal_pose ────────────────────────────────────────
  const publishGoalPose = useCallback((wx, wy, yaw) => {
    if (!ros || !isConnected) return;
    try {
      const topic = new ROSLIB.Topic({
        ros, name: goalPoseTopic,
        messageType: "geometry_msgs/msg/PoseStamped", queue_size: 1,
      });
      const q = yawToQuaternion(yaw);
      topic.publish({
        header: { frame_id: "map", stamp: { sec: Math.floor(Date.now() / 1000), nanosec: (Date.now() % 1000) * 1e6 } },
        pose: { position: { x: wx, y: wy, z: 0.0 }, orientation: q },
      });
      setPageStatus(`✅ Goal Pose → (${wx.toFixed(2)}, ${wy.toFixed(2)}) θ:${(yaw * 180 / Math.PI).toFixed(1)}°`);
      setPageError("");
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (err) {
      setPageError(`Goal Pose hatası: ${prettyErr(err)}`);
    }
  }, [ros, isConnected]);

  // ── Publish polygon ────────────────────────────────────────────────────────
  const publishPolygon = useCallback(() => {
    if (!ros || !isConnected || points.length !== 4) return;
    try {
      const topic = new ROSLIB.Topic({
        ros, name: fieldPolyTopic,
        messageType: "geometry_msgs/msg/PolygonStamped", queue_size: 1,
      });
      topic.publish({
        header: { frame_id: "map", stamp: { sec: Math.floor(Date.now() / 1000), nanosec: (Date.now() % 1000) * 1e6 } },
        polygon: { points: points.map(p => ({ x: p.x, y: p.y, z: 0.0 })) },
      });
      setPageStatus("✅ Polygon gönderildi — path hesaplanıp Nav2'ye otomatik gönderilecek");
      setPageError("");
      setExecStatus("sending");
      setExecFeedback("CoverageExecutorNode bekliyor...");
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (err) {
      setPageError(`Polygon hatası: ${prettyErr(err)}`);
    }
  }, [ros, isConnected, points]);

  // ── Set params + recompute ─────────────────────────────────────────────────
  const setParamAndRecompute = useCallback(() => {
    if (!ros || !isConnected) return;
    const setParam = (name, value) => new Promise((resolve, reject) => {
      const srv = new ROSLIB.Service({
        ros, name: "/coverage_planner_node/set_parameters",
        serviceType: "rcl_interfaces/srv/SetParameters",
      });
      const valueObj =
        typeof value === "string"        ? { type: 4, string_value: value }
        : Number.isInteger(value)        ? { type: 2, integer_value: value }
        :                                  { type: 3, double_value: value };
      srv.callService({ parameters: [{ name, value: valueObj }] }, resolve, reject);
    });

    Promise.all([
      setParam("style",           style),
      setParam("line_spacing",    lineSpacing),
      setParam("sweep_angle_deg", sweepAngle),
      setParam("start_corner",    startCorner),
    ])
      .then(() => { setPageStatus("✅ Parametreler set edildi"); callRecompute(); })
      .catch((err) => {
        setPageError(`Param hatası: ${prettyErr(err)} — recompute deneniyor`);
        callRecompute();
      });
  }, [ros, isConnected, style, lineSpacing, sweepAngle, startCorner]);

  // ── Recompute ─────────────────────────────────────────────────────────────
  const callRecompute = useCallback(() => {
    if (!ros || !isConnected) return;
    const srv = new ROSLIB.Service({ ros, name: recomputeSrvName, serviceType: "std_srvs/srv/Trigger" });
    srv.callService({},
      (res) => { if (res.success) { setPageStatus("✅ Path yeniden hesaplandı"); setPageError(""); } else setPageError(`Recompute: ${res.message}`); },
      (err) => setPageError(`Recompute hatası: ${prettyErr(err)}`)
    );
  }, [ros, isConnected]);

  // ── Execute path ──────────────────────────────────────────────────────────
  // CoverageExecutorNode'un auto_execute:true ayarıyla /coverage/path'i republish ediyoruz.
  // Bu republish → executor'un onPath() → Nav2 FollowPath action'ı tetikler.
  const executePath = useCallback(() => {
    if (!ros || !isConnected) { setPageError("ROS bağlı değil"); return; }
    if (!pathMsg || pathMsg.poses.length < 2) { setPageError("Path yok — önce Polygon Gönder"); return; }

    setExecStatus("sending");
    setExecFeedback("Republish ediliyor...");
    setPageError("");

    try {
      const topic = new ROSLIB.Topic({
        ros, name: pathTopicName, messageType: "nav_msgs/msg/Path", queue_size: 1,
      });
      topic.publish({
        header: {
          frame_id: pathMsg.header?.frame_id || "map",
          stamp: { sec: Math.floor(Date.now() / 1000), nanosec: (Date.now() % 1000) * 1e6 },
        },
        poses: pathMsg.poses,
      });
      setExecStatus("accepted");
      setExecFeedback(`${pathMsg.poses.length} waypoint → CoverageExecutorNode → Nav2`);
      setPageStatus("✅ Path Nav2 FollowPath action'a gönderildi");
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (err) {
      setExecStatus("error");
      setPageError(`Execute hatası: ${prettyErr(err)}`);
    }
  }, [ros, isConnected, pathMsg]);

  const clearAll = () => {
    setPoints([]); setPathMsg(null);
    setExecStatus("idle"); setExecFeedback("");
    goalDragRef.current = null; setGoalDragEnd(null);
    setActiveMode(MODE_IDLE);
  };

  // ── Cursor ─────────────────────────────────────────────────────────────────
  const canvasCursor = activeMode === MODE_SELECT ? "crosshair" : activeMode === MODE_GOALPOSE ? "cell" : "default";

  const execBtnColor = { idle: "#334155", sending: "#d97706", accepted: "#2563eb", running: "#2563eb", done: "#10b981", error: "#ef4444" };
  const execBtnLabel = {
    idle:     "🚀 Path Çalıştır (Nav2)",
    sending:  "⏳ Gönderiliyor...",
    accepted: "✅ Nav2'ye Gönderildi",
    running:  "🏃 Araç Hareket Ediyor",
    done:     "✅ Tamamlandı",
    error:    "❌ Hata — Tekrar Dene",
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "calc(100vh - 56px)", width: "100vw", background: "#060d1a", color: "white", padding: "0.5rem", fontFamily: "'JetBrains Mono','Fira Code',monospace", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto", height: "calc(100vh - 68px)", display: "flex", flexDirection: "column", gap: "0.4rem" }}>

        {/* HEADER */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.3rem" }}>🌾</span>
            <h1 style={{ margin: 0, fontSize: "0.95rem", fontWeight: "800", letterSpacing: "0.15em", color: "#e2e8f0" }}>COVERAGE PLANNER</h1>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {!isConnected
              ? <button onClick={reconnect} style={btnS("#2563eb")}>🔌 Bağlan</button>
              : <span style={{ fontSize: "0.65rem", color: "#10b981", fontWeight: "700" }}>● ROS BAĞLI</span>}
            <button onClick={() => setShowSettings(v => !v)} style={btnS("#1e293b", "1px solid #334155")}>⚙ Ayarlar</button>
          </div>
        </div>

        {/* STATUS BAR */}
        <div style={{ flexShrink: 0, background: "#0d1829", borderRadius: "0.3rem", padding: "0.4rem 0.75rem", border: `1px solid ${isConnected ? "#064e3b" : "#7f1d1d"}`, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ color: isConnected ? "#10b981" : "#f87171", fontWeight: "700", fontSize: "0.65rem" }}>{isConnected ? "●" : "○"}</span>
          <span style={{ fontSize: "0.7rem", color: "#94a3b8", flex: 1 }}>{displayStatus}</span>
          {displayError && <span style={{ fontSize: "0.65rem", color: "#f87171" }}>⚠ {displayError}</span>}
          {robotPose && (
            <span style={{ fontSize: "0.65rem", color: "#facc15", fontWeight: "600", marginLeft: "auto" }}>
              🤖 [{poseSource}] x:{robotPose.x.toFixed(2)} y:{robotPose.y.toFixed(2)} θ:{(robotPose.yaw * 180 / Math.PI).toFixed(1)}°
            </span>
          )}
        </div>

        {/* SETTINGS */}
        {showSettings && (
          <div style={{ flexShrink: 0, background: "#0d1829", borderRadius: "0.4rem", padding: "0.75rem", border: "1px solid #1e3a5f", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))", gap: "0.6rem" }}>
            <div><div style={lblS}>MAP TOPIC</div><input type="text" value={mapTopicName} onChange={e => setMapTopicName(e.target.value)} style={inpS} /></div>
            <div><div style={lblS}>STİL</div>
              <select value={style} onChange={e => setStyle(e.target.value)} style={inpS}>
                <option value="zigzag">↔ Zigzag</option>
                <option value="ladder">↕ Ladder</option>
                <option value="diagonal">↗ Diagonal</option>
              </select>
            </div>
            <div><div style={lblS}>ARALIK (m)</div><input type="number" min="0.1" max="3" step="0.1" value={lineSpacing} onChange={e => setLineSpacing(Number(e.target.value))} style={inpS} /></div>
            <div><div style={lblS}>SWEEP (°)</div><input type="number" min="0" max="180" step="5" value={sweepAngle} onChange={e => setSweepAngle(Number(e.target.value))} style={inpS} /></div>
            <div><div style={lblS}>BAŞLANGIÇ KÖŞESİ</div>
              <select value={startCorner} onChange={e => setStartCorner(Number(e.target.value))} style={inpS}>
                {[0,1,2,3].map(v => <option key={v} value={v}>Köşe {v+1}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", justifyContent: "flex-end" }}>
              <button onClick={setParamAndRecompute} disabled={!isConnected} style={btnS(isConnected ? "#1d4ed8" : "#1e293b")}>📤 Uygula + Recompute</button>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.65rem", color: "#94a3b8", cursor: "pointer" }}>
                <input type="checkbox" checked={showPreview} onChange={e => setShowPreview(e.target.checked)} /> Preview
              </label>
            </div>
          </div>
        )}

        {/* MAIN */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr", gap: "0.4rem", minHeight: 0 }}>

          {/* LEFT */}
          <div style={{ background: "#0d1829", borderRadius: "0.4rem", padding: "0.75rem", border: "1px solid #162032", display: "flex", flexDirection: "column", gap: "0.5rem", overflow: "auto" }}>

            {/* Style */}
            <div>
              <div style={lblS}>PATH STİLİ</div>
              <div style={{ display: "flex", gap: "0.3rem" }}>
                {[{n:"zigzag",i:"↔"},{n:"ladder",i:"↕"},{n:"diagonal",i:"↗"}].map(s => (
                  <button key={s.n} onClick={() => setStyle(s.n)}
                    style={{ flex: 1, padding: "0.4rem 0.15rem", background: style===s.n?"#1d4ed8":"#162032", border: style===s.n?"1px solid #3b82f6":"1px solid #1e293b", borderRadius: "0.25rem", color: "white", cursor: "pointer", fontSize: "0.6rem", fontWeight: style===s.n?"700":"400" }}>
                    {s.i} {s.n}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #162032" }} />

            {/* Modes */}
            <div>
              <div style={lblS}>MOD SEÇ</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>

                {/* Polygon select mode */}
                <button onClick={() => setActiveMode(m => m === MODE_SELECT ? MODE_IDLE : MODE_SELECT)}
                  style={{ padding: "0.55rem 0.5rem", textAlign: "left", background: activeMode===MODE_SELECT?"rgba(249,115,22,0.12)":"#162032", border: `1px solid ${activeMode===MODE_SELECT?"#f97316":"#1e293b"}`, borderRadius: "0.3rem", color: activeMode===MODE_SELECT?"#f97316":"#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700" }}>
                  {activeMode===MODE_SELECT?"✅":"⬜"} Alan Seçimi ({points.length}/4)
                </button>

                {/* 2D Nav Goal mode */}
                <button onClick={() => {
                    if (!isConnected) { setPageError("Önce ROS'a bağlanın"); return; }
                    setActiveMode(m => m === MODE_GOALPOSE ? MODE_IDLE : MODE_GOALPOSE);
                    goalDragRef.current = null; setGoalDragEnd(null);
                  }}
                  style={{ padding: "0.55rem 0.5rem", textAlign: "left", background: activeMode===MODE_GOALPOSE?"rgba(168,85,247,0.12)":"#162032", border: `1px solid ${activeMode===MODE_GOALPOSE?"#a855f7":"#1e293b"}`, borderRadius: "0.3rem", color: activeMode===MODE_GOALPOSE?"#c084fc":"#94a3b8", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700" }}>
                  {activeMode===MODE_GOALPOSE?"🟣":"⬜"} 2D Nav Goal (RViz gibi)
                </button>

                {activeMode === MODE_GOALPOSE && (
                  <div style={{ padding: "0.4rem", background: "rgba(168,85,247,0.07)", border: "1px solid #6b21a8", borderRadius: "0.25rem", fontSize: "0.6rem", color: "#c4b5fd", lineHeight: "1.7" }}>
                    📍 Haritada <b>tıkla</b> = konum<br/>
                    🔄 <b>Sürükle</b> = yön<br/>
                    🖱 <b>Bırak</b> = /goal_pose gönder
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #162032" }} />

            {/* Points */}
            <div style={crdS}>
              <div style={lblS}>NOKTALAR <span style={{ color: points.length===4?"#10b981":"#f97316" }}>{points.length}/4</span></div>
              {points.length === 0
                ? <div style={{ fontSize: "0.6rem", color: "#1e293b" }}>Alan seçim modunda haritaya tıkla</div>
                : points.map((p, i) => (
                  <div key={i} style={{ fontSize: "0.6rem", color: i===startCorner?"#22c55e":"#60a5fa", lineHeight: "1.8" }}>
                    {i+1}: ({p.x.toFixed(2)}, {p.y.toFixed(2)}) {i===startCorner?"⭐":""}
                  </div>
                ))
              }
            </div>

            {/* Robot */}
            <div style={crdS}>
              <div style={lblS}>ROBOT POZİSYONU</div>
              {robotPose
                ? <div style={{ fontSize: "0.65rem", color: "#facc15", lineHeight: "1.7" }}>
                    <div>x: {robotPose.x.toFixed(3)} m</div>
                    <div>y: {robotPose.y.toFixed(3)} m</div>
                    <div>θ: {(robotPose.yaw * 180 / Math.PI).toFixed(1)}°</div>
                    <div style={{ color: "#475569", fontSize: "0.55rem" }}>src: {poseSource}</div>
                  </div>
                : <div style={{ fontSize: "0.6rem", color: "#334155" }}>
                    Pose alınamadı<br/>
                    <span style={{ color: "#1e293b" }}>/amcl_pose | /odom</span>
                  </div>
              }
            </div>

            {/* Path info */}
            {pathMsg?.poses?.length > 0 && (
              <div style={{ ...crdS, border: "1px solid #064e3b" }}>
                <div style={lblS}>AKTİF PATH</div>
                <div style={{ fontSize: "0.65rem", color: "#10b981" }}>{pathMsg.poses.length} waypoint</div>
                <div style={{ fontSize: "0.55rem", color: "#475569" }}>frame: {pathMsg.header?.frame_id||"?"}</div>
                {execFeedback && <div style={{ fontSize: "0.55rem", color: "#60a5fa", marginTop: "0.15rem" }}>{execFeedback}</div>}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <button onClick={publishPolygon} disabled={points.length!==4||!isConnected}
                style={{ ...btnS(points.length===4&&isConnected?"#065f46":"#162032"), padding: "0.7rem", fontSize: "0.75rem", opacity: points.length===4&&isConnected?1:0.4 }}>
                📤 Polygon Gönder
              </button>
              <button onClick={executePath} disabled={!pathMsg||pathMsg.poses.length<2||!isConnected}
                style={{ ...btnS(execBtnColor[execStatus]), padding: "0.7rem", fontSize: "0.75rem", fontWeight: "800", opacity: pathMsg?.poses?.length>1&&isConnected?1:0.4, transition: "background 0.3s" }}>
                {execBtnLabel[execStatus]}
              </button>
              <button onClick={clearAll}
                style={{ ...btnS("transparent","1px solid #1e293b"), padding: "0.4rem", fontSize: "0.65rem", color: "#475569" }}>
                🗑 Temizle
              </button>
            </div>

            {/* Flow guide */}
            <div style={{ fontSize: "0.55rem", color: "#334155", lineHeight: "1.9", borderTop: "1px solid #162032", paddingTop: "0.4rem" }}>
              <div style={{ color: "#475569", fontWeight: "700" }}>COVERAGE AKIŞI:</div>
              <div>1 → Stil seç</div>
              <div>2 → Alan Seçimi (4 nokta)</div>
              <div>3 → Polygon Gönder</div>
              <div>4 → Path Çalıştır</div>
              <div style={{ marginTop: "0.3rem", color: "#334155" }}>TEK HEDEF: 2D Nav Goal</div>
            </div>
          </div>

          {/* MAP */}
          <div style={{ background: "#0d1829", borderRadius: "0.4rem", padding: "0.75rem", border: "1px solid #162032", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem", flexShrink: 0, flexWrap: "wrap", gap: "0.3rem" }}>
              <span style={{ fontSize: "0.7rem", fontWeight: "700", color: "#e2e8f0", letterSpacing: "0.1em" }}>🗺 HARİTA</span>
              <div style={{ display: "flex", gap: "0.6rem", fontSize: "0.58rem" }}>
                <span style={{ color: "#f97316" }}>🟠 Alan</span>
                <span style={{ color: "#3b82f6" }}>🔵 Preview</span>
                <span style={{ color: "#10b981" }}>🟢 ROS Path</span>
                <span style={{ color: "#facc15" }}>🟡 Robot</span>
                <span style={{ color: "#a855f7" }}>🟣 Goal</span>
                <span style={{ color: "#22c55e" }}>● S</span>
                <span style={{ color: "#ef4444" }}>● E</span>
              </div>
            </div>

            <div ref={containerRef} style={{ flex: 1, background: "#040810", borderRadius: "0.3rem", border: "1px solid #162032", overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
              {mapImageData ? (
                <canvas
                  ref={canvasRef}
                  onMouseDown={onCanvasMouseDown}
                  onMouseMove={onCanvasMouseMove}
                  onMouseUp={onCanvasMouseUp}
                  onMouseLeave={() => { if (activeMode===MODE_GOALPOSE) { goalDragRef.current=null; setGoalDragEnd(null); }}}
                  style={{ cursor: canvasCursor, display: "block", maxWidth: "100%", maxHeight: "100%" }}
                />
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🗺</div>
                  <div style={{ fontSize: "0.8rem", color: "#1e293b" }}>{mapLoading ? "Yükleniyor..." : "Bağlantı bekleniyor"}</div>
                  <div style={{ fontSize: "0.65rem", color: "#162032", marginTop: "0.2rem" }}>{mapTopicName}</div>
                </div>
              )}

              {mapInfo && (
                <div style={{ position: "absolute", bottom: 5, right: 7, fontSize: "0.55rem", color: "#1e293b" }}>
                  {mapInfo.width}×{mapInfo.height} · {mapInfo.resolution.toFixed(3)}m/px
                </div>
              )}
              {activeMode === MODE_SELECT && (
                <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(249,115,22,0.1)", border: "1px solid #f97316", borderRadius: "0.2rem", padding: "0.2rem 0.45rem", fontSize: "0.6rem", color: "#fb923c", fontWeight: "700" }}>
                  ✚ ALAN SEÇİMİ ({points.length}/4)
                </div>
              )}
              {activeMode === MODE_GOALPOSE && (
                <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(168,85,247,0.1)", border: "1px solid #a855f7", borderRadius: "0.2rem", padding: "0.2rem 0.45rem", fontSize: "0.6rem", color: "#c084fc", fontWeight: "700" }}>
                  🎯 2D NAV GOAL — Tıkla + Sürükle
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inline style helpers ─────────────────────────────────────────────────────
const btnS = (bg, border = "none") => ({
  padding: "0.4rem 0.75rem", background: bg, border,
  borderRadius: "0.3rem", color: "white", fontWeight: "700",
  cursor: "pointer", fontSize: "0.7rem",
});
const inpS = {
  width: "100%", padding: "0.4rem", background: "#162032",
  border: "1px solid #1e293b", borderRadius: "0.25rem",
  color: "white", fontSize: "0.7rem", outline: "none", boxSizing: "border-box",
};
const lblS = { fontSize: "0.55rem", color: "#334155", letterSpacing: "0.1em", marginBottom: "0.3rem" };
const crdS = { background: "#060d1a", borderRadius: "0.3rem", padding: "0.5rem", border: "1px solid #162032" };
