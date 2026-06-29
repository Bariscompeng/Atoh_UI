import React, { useEffect, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";
import { useNavigate } from "react-router-dom";
import SavedGpsRouteCard from "../features/gpsMission/routes/SavedGpsRouteCard";
import {
  createGpsRoutePreviewImage,
  deleteSavedGpsMissionRoute,
  gpsMissionRoutesChangedEventName,
  queueGpsMissionDraftRouteOpen,
  queueGpsMissionRouteOpen,
  readSavedGpsMissionRoutes
} from "../utils/gpsMissionRoutes";

// ── Helpers ──────────────────────────────────────────────────────────────────
const rad2deg = (r) => ((r * 180) / Math.PI).toFixed(1);
const quatToYaw = (q) =>
  Math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z));
const yawToQuat = (yaw) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });
const prettyErr = (e) => (e?.message || String(e)).slice(0, 120);
const ts = () => ({ sec: Math.floor(Date.now() / 1000), nanosec: (Date.now() % 1000) * 1e6 });
const waypointSpeedValue = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(3.0, n) : 1.0;
};
const waypointWaitSecondsValue = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.max(1, Math.round(n))) : undefined;
};

// ── Mode definitions ─────────────────────────────────────────────────────────
const MODE_LABELS = {
  manual:     { label: "MANUEL",  color: "#f59e0b", icon: "🔧", desc: "Operatör kontrol" },
  autonomous: { label: "OTONOM",  color: "#10b981", icon: "🤖", desc: "Otonom navigasyon" },
  task:       { label: "GÖREV",   color: "#3b82f6", icon: "📋", desc: "Görev yöneticisi aktif" },
};

// ── Mode → Allowed cmd_vel sources ───────────────────────────────────────────
const MODE_SOURCES = {
  manual:     { allowed: ["cmd_vel_joystick", "cmd_vel_keyboard", "cmd_vel_gateway"], blocked: ["cmd_vel", "cmd_vel_human_follow"] },
  autonomous: { allowed: ["cmd_vel", "cmd_vel_human_follow", "cmd_vel_gateway", "cmd_vel_joystick"], blocked: ["cmd_vel_keyboard"] },
  task:       { allowed: ["cmd_vel", "cmd_vel_human_follow", "cmd_vel_joystick"],                    blocked: ["cmd_vel_keyboard", "cmd_vel_gateway"] },
};
const ALL_SOURCES = [
  { name: "cmd_vel_joystick",    label: "Joystick",      prio: 95, icon: "🕹️" },
  { name: "cmd_vel_keyboard",    label: "Klavye",         prio: 94, icon: "⌨️" },
  { name: "cmd_vel_human_follow",label: "İnsan Takibi",   prio: 88, icon: "🚶" },
  { name: "cmd_vel",             label: "Nav2",           prio: 85, icon: "🧭" },
  { name: "cmd_vel_gateway",     label: "Gateway/Web",    prio: 80, icon: "🌐" },
];

// ── Styles ───────────────────────────────────────────────────────────────────
const cardS = { background: "#0d1829", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid #162032" };
const lblS = { fontSize: "0.6rem", fontWeight: "800", letterSpacing: "0.12em", color: "#475569", marginBottom: "0.4rem" };
const valS = { fontSize: "0.85rem", fontWeight: "700", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code',monospace" };
const btnS = (bg, border) => ({ padding: "0.45rem 0.75rem", background: bg || "#162032", border: border || "1px solid #1e3a5f", borderRadius: "0.35rem", color: "white", cursor: "pointer", fontSize: "0.65rem", fontWeight: "700", fontFamily: "inherit", transition: "all 0.2s" });
const pillS = (active, color) => ({ padding: "0.5rem 0.8rem", background: active ? `${color}18` : "#0a1020", border: `2px solid ${active ? color : "#1e293b"}`, borderRadius: "0.5rem", color: active ? color : "#475569", cursor: "pointer", fontSize: "0.7rem", fontWeight: active ? "800" : "600", fontFamily: "inherit", transition: "all 0.25s", display: "flex", alignItems: "center", gap: "0.4rem", flex: 1, justifyContent: "center" });
const inputS = { width: "100%", padding: "0.4rem", background: "#0a1020", border: "1px solid #1e3a5f", borderRadius: "0.25rem", color: "#e2e8f0", fontSize: "0.75rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

// ── Sabit konum GPS varsayılanları ───────────────────────────────────────────
const LEGACY_HOME_GPS   = { lat: 39.8935863, lon: 32.7717426, yaw: -16.3 };
const LEGACY_CHARGE_GPS = { lat: 39.8936533, lon: 32.7716855, yaw: -214.8 };
const DEFAULT_HOME_GPS   = { lat: 39.7961831, lon: 32.5312344, yaw: -16.3 };
const DEFAULT_CHARGE_GPS = { lat: 39.7962284, lon: 32.5313263, yaw: -214.8 };
const BED_LOCATIONS = [
  { id: "bed-1", name: "Yatak-1", mode: "gps", lat: 39.7961957, lon: 32.5312284 },
  { id: "bed-2", name: "Yatak-2", mode: "gps", lat: 39.7962241, lon: 32.5312753 },
  { id: "bed-3", name: "Yatak-3", mode: "gps", lat: 39.7962403, lon: 32.5312984 },
  { id: "bed-4", name: "Yatak-4", mode: "gps", lat: 39.7962575, lon: 32.5313236 },
  { id: "bed-5", name: "Yatak-5", mode: "gps", lat: 39.7962722, lon: 32.5313474 },
  { id: "bed-6", name: "Yatak-6", mode: "gps", lat: 39.7962872, lon: 32.5313725 },
  { id: "bed-7", name: "Yatak-7", mode: "gps", lat: 39.7963031, lon: 32.5313953 },
];
const BED_PREVIEW_IMAGES = Object.fromEntries(
  BED_LOCATIONS.map(loc => [loc.id, `/bed-previews/${loc.name.toLowerCase()}.png`])
);
const closeGps = (a, b) =>
  Math.abs(Number(a?.lat) - b.lat) < 0.000001 &&
  Math.abs(Number(a?.lon) - b.lon) < 0.000001;
const loadGps = (key, def, legacy) => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    if (!stored || closeGps(stored, legacy)) {
      localStorage.setItem(key, JSON.stringify(def));
      return def;
    }
    return { ...def, ...stored };
  } catch {
    return def;
  }
};
const TASK_UI_STORAGE_KEY = "atoh2_task_manager_ui_state_v1";
const TASK_LOG_STORAGE_KEY = "atoh2_task_manager_logs_v1";
const READY_TASK_QUEUE_STORAGE_KEY = "atoh2_ready_task_queue_v1";
const loadJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
const saveJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* best-effort local cache */ } };
const hasText = (value) => String(value ?? "").trim() !== "";
const optionalNumber = (value) => {
  if (!hasText(value)) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const normalizeReadyTaskQueue = (rawQueue) => (
  Array.isArray(rawQueue)
    ? rawQueue
        .map((item, index) => {
          const lat = Number(item?.lat);
          const lon = Number(item?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return {
            id: String(item?.id || `ready-task-${Date.now()}-${index}`),
            name: String(item?.name || `Hazır Görev ${index + 1}`),
            lat,
            lon,
            sourceId: String(item?.sourceId || ""),
          };
        })
        .filter(Boolean)
    : []
);

// ═════════════════════════════════════════════════════════════════════════════
export default function TaskManagerPage() {
  const { ros, isConnected, reconnect, operationMode, setOperationMode } = useROS();
  const navigate = useNavigate();
  const [initialUi] = useState(() => loadJson(TASK_UI_STORAGE_KEY, {}));

  // ── State ──────────────────────────────────────────────────────────────────
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [robotPose, setRobotPose] = useState(null);
  const [poseSource, setPoseSource] = useState("");
  const [goalPose, setGoalPose] = useState(null);
  const [goalX, setGoalX] = useState(initialUi.goalX || "");
  const [goalY, setGoalY] = useState(initialUi.goalY || "");
  const [goalYaw, setGoalYaw] = useState(initialUi.goalYaw || "0");
  const [taskState, setTaskState] = useState({ name: "", state: "IDLE", observers: [] });
  const [taskRegistry, setTaskRegistry] = useState({ packs: [], tasks: [], observers: [] });
  const [logs, setLogs] = useState(() => loadJson(TASK_LOG_STORAGE_KEY, []));
  const logEndRef = useRef(null);
  const [coverageStatus, setCoverageStatus] = useState(null);
  const [customCmd, setCustomCmd] = useState(initialUi.customCmd || "");
  const [taskDistance, setTaskDistance] = useState(initialUi.taskDistance || "100");
  const [muxActiveSource, setMuxActiveSource] = useState("(none)");
  const [activeTab, setActiveTab] = useState(initialUi.activeTab || "genel"); // "genel" | "gps"
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [readyTaskQueue, setReadyTaskQueue] = useState(() => normalizeReadyTaskQueue(loadJson(READY_TASK_QUEUE_STORAGE_KEY, [])));
  const [customLocations, setCustomLocations] = useState(() => {
    try { return JSON.parse(localStorage.getItem("atoh2_custom_locations") || "[]"); } catch { return []; }
  });
  const [savedRoutes, setSavedRoutes] = useState(() => readSavedGpsMissionRoutes());
  const [newLocName, setNewLocName] = useState(initialUi.newLocName || "");
  const [newLocMode, setNewLocMode] = useState(initialUi.newLocMode || "xy"); // "xy" | "gps"
  const [newLocX, setNewLocX] = useState(initialUi.newLocX || "");
  const [newLocY, setNewLocY] = useState(initialUi.newLocY || "");
  const [newLocLat, setNewLocLat] = useState(initialUi.newLocLat || "");
  const [newLocLon, setNewLocLon] = useState(initialUi.newLocLon || "");
  const [newLocYaw, setNewLocYaw] = useState(initialUi.newLocYaw || "0");
  const [activeTaskLabel, setActiveTaskLabel] = useState(initialUi.activeTaskLabel || "");
  // Eve Dön / Şarja Git GPS hedefleri — düzenlenebilir, localStorage'da kalıcı
  const [homeGps, setHomeGps] = useState(() => loadGps("atoh2_home_gps", DEFAULT_HOME_GPS, LEGACY_HOME_GPS));
  const [chargeGps, setChargeGps] = useState(() => loadGps("atoh2_charge_gps", DEFAULT_CHARGE_GPS, LEGACY_CHARGE_GPS));
  const [editHome, setEditHome] = useState(!!initialUi.editHome);
  const [editCharge, setEditCharge] = useState(!!initialUi.editCharge);

  // Refs
  const recoverySubRef = useRef(null);
  const amclSubRef = useRef(null);
  const odomSubRef = useRef(null);
  const tfSubRef = useRef(null);
  const tfCache = useRef({ mapToOdom: null, odomToBase: null });
  const stateSubRef = useRef(null);
  const statusSubRef = useRef(null);
  const registrySubRef = useRef(null);
  const goalSubRef = useRef(null);
  const goalTaskSubRef = useRef(null);
  const gpsGoalSubRef = useRef(null);
  const gpsStatusSubRef = useRef(null);
  const coverageSubRef = useRef(null);
  const muxLogSubRef = useRef(null);
  const autoListDone = useRef(false);
  const pendingCommandRef = useRef(null);
  const lastStateLogRef = useRef("");
  const lastGoalLogRef = useRef("");
  const gpsWaypointPubRef = useRef(null);
  const directGpsTaskRef = useRef(false);

  // ── Log helper ─────────────────────────────────────────────────────────────
  const addLog = useCallback((type, msg) => {
    const time = new Date().toLocaleTimeString("tr-TR");
    setLogs((prev) => [...prev.slice(-80), { id: Date.now() + Math.random(), time, type, msg }]);
  }, []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { saveJson(TASK_LOG_STORAGE_KEY, logs.slice(-80)); }, [logs]);
  useEffect(() => { saveJson(READY_TASK_QUEUE_STORAGE_KEY, readyTaskQueue); }, [readyTaskQueue]);

  useEffect(() => {
    saveJson(TASK_UI_STORAGE_KEY, {
      activeTab,
      goalX,
      goalY,
      goalYaw,
      customCmd,
      taskDistance,
      newLocName,
      newLocMode,
      newLocX,
      newLocY,
      newLocLat,
      newLocLon,
      newLocYaw,
      activeTaskLabel,
      editHome,
      editCharge,
    });
  }, [
    activeTab,
    goalX,
    goalY,
    goalYaw,
    customCmd,
    taskDistance,
    newLocName,
    newLocMode,
    newLocX,
    newLocY,
    newLocLat,
    newLocLon,
    newLocYaw,
    activeTaskLabel,
    editHome,
    editCharge,
  ]);

  // ── Özel GPS görevleri → localStorage'a kalıcı kayıt ─────────────────────────
  useEffect(() => {
    try { localStorage.setItem("atoh2_custom_locations", JSON.stringify(customLocations)); } catch {}
  }, [customLocations]);

  useEffect(() => {
    const syncSavedRoutes = () => setSavedRoutes(readSavedGpsMissionRoutes());
    syncSavedRoutes();
    window.addEventListener(gpsMissionRoutesChangedEventName(), syncSavedRoutes);
    return () => window.removeEventListener(gpsMissionRoutesChangedEventName(), syncSavedRoutes);
  }, []);

  // ── Eve Dön / Şarja Git GPS hedefleri → localStorage'a kalıcı kayıt ──────────
  useEffect(() => { try { localStorage.setItem("atoh2_home_gps", JSON.stringify(homeGps)); } catch {} }, [homeGps]);
  useEffect(() => { try { localStorage.setItem("atoh2_charge_gps", JSON.stringify(chargeGps)); } catch {} }, [chargeGps]);
  useEffect(() => {
    return () => {
      try { gpsWaypointPubRef.current?.unadvertise(); } catch {}
    };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // AUTO-LIST: Bağlantı kurulduğunda registry'yi otomatik al
  // (transient_local rosbridge'de güvenilmez, list komutu daha sağlam)
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ros || !isConnected || autoListDone.current) return;
    autoListDone.current = true;
    const timer = setTimeout(() => {
      const topic = new ROSLIB.Topic({ ros, name: "/task_manager/run_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
      topic.publish({ data: "list" });
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
      addLog("info", "📋 Otomatik registry sorgusu (list)");
    }, 1500);
    return () => clearTimeout(timer);
  }, [ros, isConnected]);

  // Bağlantı koptuğunda auto-list flag sıfırla
  useEffect(() => {
    if (!isConnected) autoListDone.current = false;
  }, [isConnected]);

  // ══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ══════════════════════════════════════════════════════════════════════════

  // ── /tcs/recovery ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (recoverySubRef.current) { try { recoverySubRef.current.unsubscribe(); } catch {} }
    const subscribeWith = (msgType) => {
      const topic = new ROSLIB.Topic({ ros, name: "/tcs/recovery", messageType: msgType, throttle_rate: 500, queue_length: 1 });
      topic.subscribe((msg) => {
        let val = msg.data !== undefined
          ? (typeof msg.data === "boolean" ? (msg.data ? 1 : 0) : typeof msg.data === "string" ? parseInt(msg.data, 10) : Number(msg.data))
          : null;
        if (val !== null && !isNaN(val)) { setRecoveryActive(val === 1); }
      });
      recoverySubRef.current = topic;
    };
    ros.getTopicType("/tcs/recovery", (type) => subscribeWith(type || "std_msgs/msg/Int32"), () => subscribeWith("std_msgs/msg/Int32"));
    return () => { if (recoverySubRef.current) { try { recoverySubRef.current.unsubscribe(); } catch {} } };
  }, [ros, isConnected]);

  // ── Robot Pose (yalnızca TF chain) ─────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    [amclSubRef, tfSubRef, odomSubRef].forEach(r => { if (r.current) { try { r.current.unsubscribe(); } catch {} } });
    tfCache.current = { mapToOdom: null, odomToBase: null };

    const chainTF = () => {
      const { mapToOdom, odomToBase } = tfCache.current;
      if (!mapToOdom || !odomToBase) return;
      const c1 = Math.cos(mapToOdom.yaw), s1 = Math.sin(mapToOdom.yaw);
      const x = mapToOdom.x + odomToBase.x * c1 - odomToBase.y * s1;
      const y = mapToOdom.y + odomToBase.x * s1 + odomToBase.y * c1;
      const yaw = mapToOdom.yaw + odomToBase.yaw;
      setRobotPose({ x, y, yaw }); setPoseSource("TF");
    };

    const tf = new ROSLIB.Topic({ ros, name: "/tf", messageType: "tf2_msgs/msg/TFMessage", throttle_rate: 500, queue_length: 1 });
    tf.subscribe((msg) => {
      if (!msg.transforms) return;
      for (const t of msg.transforms) {
        const parent = (t.header?.frame_id || "").replace(/^\//, "");
        const child = (t.child_frame_id || "").replace(/^\//, "");
        const pos = t.transform?.translation, rot = t.transform?.rotation;
        if (!pos || !rot) continue;
        const yaw = quatToYaw(rot);
        if (parent === "map" && child === "odom") { tfCache.current.mapToOdom = { x: pos.x, y: pos.y, yaw }; chainTF(); }
        else if (parent === "odom" && child === "base_link") { tfCache.current.odomToBase = { x: pos.x, y: pos.y, yaw }; chainTF(); }
      }
    });
    tfSubRef.current = tf;

    return () => { try { tf.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /goal_pose (Nav2 doğrudan) ─────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (goalSubRef.current) { try { goalSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", throttle_rate: 200, queue_length: 1 });
    topic.subscribe((msg) => {
      const p = msg.pose;
      const nextGoal = { x: p.position.x, y: p.position.y, yaw: quatToYaw(p.orientation) };
      const goalKey = `/goal_pose|${nextGoal.x.toFixed(3)}|${nextGoal.y.toFixed(3)}|${nextGoal.yaw.toFixed(3)}`;
      setGoalPose(nextGoal);
      if (goalKey !== lastGoalLogRef.current) {
        lastGoalLogRef.current = goalKey;
        addLog("info", `⬅️ /goal_pose alındı: x=${nextGoal.x.toFixed(2)}, y=${nextGoal.y.toFixed(2)}, yaw=${rad2deg(nextGoal.yaw)}°`);
      }
    });
    goalSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected, addLog]);

  // ── /goal_pose_task (Task Manager plugin'in yayınladığı hedef) ─────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (goalTaskSubRef.current) { try { goalTaskSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/goal_pose_task", messageType: "geometry_msgs/msg/PoseStamped", throttle_rate: 200, queue_length: 1 });
    topic.subscribe((msg) => {
      const p = msg.pose;
      const nextGoal = { x: p.position.x, y: p.position.y, yaw: quatToYaw(p.orientation) };
      const goalKey = `/goal_pose_task|${nextGoal.x.toFixed(3)}|${nextGoal.y.toFixed(3)}|${nextGoal.yaw.toFixed(3)}`;
      setGoalPose(nextGoal);
      pendingCommandRef.current = null;
      if (goalKey !== lastGoalLogRef.current) {
        lastGoalLogRef.current = goalKey;
        addLog("info", `⬅️ /goal_pose_task alındı: x=${nextGoal.x.toFixed(2)}, y=${nextGoal.y.toFixed(2)}, yaw=${rad2deg(nextGoal.yaw)}°`);
      }
    });
    goalTaskSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected, addLog]);

  // ── /gps_waypoint_nav/goal_pose (GPS waypoint bridge hedefi) ──────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (gpsGoalSubRef.current) { try { gpsGoalSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/gps_waypoint_nav/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", throttle_rate: 200, queue_length: 1 });
    topic.subscribe((msg) => {
      const p = msg.pose;
      const nextGoal = { x: p.position.x, y: p.position.y, yaw: quatToYaw(p.orientation) };
      const goalKey = `/gps_waypoint_nav/goal_pose|${nextGoal.x.toFixed(3)}|${nextGoal.y.toFixed(3)}|${nextGoal.yaw.toFixed(3)}`;
      setGoalPose(nextGoal);
      if (goalKey !== lastGoalLogRef.current) {
        lastGoalLogRef.current = goalKey;
        addLog("info", `⬅️ /gps_waypoint_nav/goal_pose alındı: x=${nextGoal.x.toFixed(2)}, y=${nextGoal.y.toFixed(2)}, yaw=${rad2deg(nextGoal.yaw)}°`);
      }
    });
    gpsGoalSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected, addLog]);

  // ── /gps_waypoint_nav/status ───────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (gpsStatusSubRef.current) { try { gpsStatusSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/gps_waypoint_nav/status", messageType: "std_msgs/msg/String", throttle_rate: 200, queue_length: 10 });
    topic.subscribe((msg) => {
      const text = String(msg?.data || "");
      if (/(complete|error|rejected|stopped|cancel)/i.test(text)) {
        directGpsTaskRef.current = false;
      }
    });
    gpsStatusSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /task_manager/state ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (stateSubRef.current) { try { stateSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/task_manager/state", messageType: "std_msgs/msg/String", throttle_rate: 500, queue_length: 1 });
    topic.subscribe((msg) => {
      try {
        const j = JSON.parse(msg.data);
        const nextState = { name: j.active_task?.name || "", state: j.active_task?.state || "IDLE", observers: j.active_observers || [] };
        const stateKey = `${nextState.name}|${nextState.state}|${nextState.observers.join(",")}`;
        setTaskState(nextState);
        if (stateKey !== lastStateLogRef.current) {
          lastStateLogRef.current = stateKey;
          addLog("info", `⬅️ /task_manager/state: ${nextState.name || "-"} → ${nextState.state}`);
        }
        if (nextState.name || nextState.state?.toUpperCase() !== "IDLE") pendingCommandRef.current = null;
      } catch (err) {
        addLog("error", `/task_manager/state JSON okunamadı: ${prettyErr(err)}`);
      }
    });
    stateSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected, addLog]);

  // ── /task_manager/status (2 JSON format desteği) ───────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (statusSubRef.current) { try { statusSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/task_manager/status", messageType: "std_msgs/msg/String", throttle_rate: 100, queue_length: 10 });
    topic.subscribe((msg) => {
      try {
        const j = JSON.parse(msg.data);
        // Format 1: emit_status → {level, message}
        if (j.message !== undefined) {
          if (!j.message.includes("heartbeat")) {
            pendingCommandRef.current = null;
            addLog((j.level || "info").toLowerCase(), `⬅️ /task_manager/status: ${j.message}`);
          }
          return;
        }
        // Format 2: StatusPublisher → {level, type, payload}
        if (j.type !== undefined && j.payload !== undefined) {
          const level = (j.level || "info").toLowerCase();
          if (["tasks", "observers", "packs"].includes(j.type)) {
            pendingCommandRef.current = null;
            try { const data = typeof j.payload === "string" ? JSON.parse(j.payload) : j.payload; addLog(level, `⬅️ ${j.type}: [${(data[j.type] || []).join(", ")}]`); } catch { addLog(level, `⬅️ ${j.type}: ${JSON.stringify(j.payload)}`); }
            return;
          }
          const ps = typeof j.payload === "string" ? j.payload : JSON.stringify(j.payload);
          if (!ps.includes("heartbeat")) {
            pendingCommandRef.current = null;
            addLog(level, `⬅️ /task_manager/status: ${ps}`);
          }
        }
      } catch (err) {
        addLog("error", `/task_manager/status JSON okunamadı: ${prettyErr(err)}`);
      }
    });
    statusSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /task_manager/registry ─────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (registrySubRef.current) { try { registrySubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/task_manager/registry", messageType: "std_msgs/msg/String", queue_length: 1 });
    topic.subscribe((msg) => { try { const j = JSON.parse(msg.data); setTaskRegistry({ packs: j.packs || [], tasks: j.tasks || [], observers: j.observers || [] }); addLog("info", `Registry: ${(j.tasks || []).length} görev, ${(j.observers || []).length} observer`); } catch {} });
    registrySubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /coverage/path ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (coverageSubRef.current) { try { coverageSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/coverage/path", messageType: "nav_msgs/msg/Path", throttle_rate: 2000, queue_length: 1 });
    topic.subscribe((msg) => { setCoverageStatus({ waypointCount: msg.poses?.length || 0, frameId: msg.header?.frame_id || "map", lastUpdate: new Date().toLocaleTimeString("tr-TR") }); });
    coverageSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /log/text (cmd_vel_mux aktif kaynak) ───────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (muxLogSubRef.current) { try { muxLogSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/log/text", messageType: "std_msgs/msg/String", throttle_rate: 200, queue_length: 5 });
    topic.subscribe((msg) => {
      const txt = msg.data || "";
      const b = txt.match(/best_source=(\S+)/); if (b) setMuxActiveSource(b[1]);
      const m = txt.match(/mode_changed:\s*\S+\s*->\s*(\S+)/); if (m) addLog("info", `🔄 MUX mod: ${m[1]}`);
    });
    muxLogSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLISHERS
  // ══════════════════════════════════════════════════════════════════════════

  const sendRunCmd = useCallback((cmdStr) => {
    if (!ros || !isConnected) { addLog("error", "ROS bağlı değil!"); return; }
    const isRunCommand = /^run\s+/i.test(cmdStr.trim());
    const publishCommand = () => {
      try {
        const topic = new ROSLIB.Topic({ ros, name: "/task_manager/run_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
        topic.advertise();
        topic.publish({ data: cmdStr });
        pendingCommandRef.current = { cmd: cmdStr, sentAt: Date.now() };
        addLog("info", `📤 /task_manager/run_cmd gönderildi: ${cmdStr}`);
        setTimeout(() => { try { topic.unadvertise(); } catch {} }, 800);
        setTimeout(() => {
          const pending = pendingCommandRef.current;
          if (pending?.cmd === cmdStr && Date.now() - pending.sentAt >= 2200) {
            addLog("warn", `ROS publish çağrısı yapıldı ama Task Manager'dan henüz state/status/goal geri gelmedi: ${cmdStr}`);
          }
        }, 2400);
      } catch (err) {
        addLog("error", `Gönderim hatası: ${prettyErr(err)}`);
      }
    };

    if (isRunCommand && operationMode !== "task") {
      setOperationMode("task");
      addLog("info", `📤 /mod gönderildi: task (görev komutundan önce)`);
      setTimeout(publishCommand, 120);
      return;
    }

    publishCommand();
  }, [ros, isConnected, addLog, operationMode, setOperationMode]);

  const ensureGpsWaypointPublisher = useCallback(() => {
    if (gpsWaypointPubRef.current) return gpsWaypointPubRef.current;
    if (!ros) return null;

    const topic = new ROSLIB.Topic({
      ros,
      name: "/ui/gps_waypoint",
      messageType: "std_msgs/String",
      queue_size: 1,
    });

    topic.advertise();
    gpsWaypointPubRef.current = topic;
    return topic;
  }, [ros]);

  const publishGpsWaypoint = useCallback((payload, label) => {
    const topic = ensureGpsWaypointPublisher();
    if (!topic) {
      addLog("error", "GPS waypoint publisher hazır değil!");
      return false;
    }

    const missionWaypointPayload = {
      latitude: Number(payload?.latitude ?? payload?.lat),
      longitude: Number(payload?.longitude ?? payload?.lon ?? payload?.lng),
    };

    if (!Number.isFinite(missionWaypointPayload.latitude) || !Number.isFinite(missionWaypointPayload.longitude)) {
      addLog("error", "GPS waypoint payload geçersiz!");
      return false;
    }

    if (Number.isFinite(Number(payload?.altitude ?? payload?.alt))) {
      missionWaypointPayload.altitude = Number(payload.altitude ?? payload.alt);
    }

    const waitSeconds = waypointWaitSecondsValue(payload?.wait_seconds ?? payload?.waitSeconds);
    if (waitSeconds) {
      missionWaypointPayload.wait_seconds = waitSeconds;
    }

    const speedMultiplier = waypointSpeedValue(payload?.speed_multiplier ?? payload?.speedMultiplier ?? payload?.speed);
    if (Number.isFinite(speedMultiplier) && speedMultiplier !== 1.0) {
      missionWaypointPayload.speed_multiplier = speedMultiplier;
      missionWaypointPayload.speed = speedMultiplier;
    }

    topic.publish({ data: JSON.stringify(missionWaypointPayload) });
    directGpsTaskRef.current = true;
    addLog("info", `📤 /ui/gps_waypoint gönderildi: ${label} (${missionWaypointPayload.latitude.toFixed(7)}, ${missionWaypointPayload.longitude.toFixed(7)})`);
    return true;
  }, [ensureGpsWaypointPublisher, addLog]);

  const cancelDirectGpsWaypoint = useCallback(() => {
    const topic = ensureGpsWaypointPublisher();
    if (!topic) return false;

    topic.publish({ data: JSON.stringify({ command: "cancel" }) });
    directGpsTaskRef.current = false;
    addLog("warn", "🛑 /ui/gps_waypoint cancel gönderildi");
    return true;
  }, [ensureGpsWaypointPublisher, addLog]);

  // Direkt Nav2 — CoveragePage 2D Nav Goal tarzı (task manager bypass)
  const sendDirectNav2Goal = useCallback((x, y, yawRad) => {
    if (!ros || !isConnected) { addLog("error", "ROS bağlı değil!"); return; }
    try {
      const topic = new ROSLIB.Topic({ ros, name: "/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", queue_size: 1 });
      topic.publish({ header: { frame_id: "map", stamp: ts() }, pose: { position: { x, y, z: 0.0 }, orientation: yawToQuat(yawRad) } });
      setGoalPose({ x, y, yaw: yawRad });
      addLog("warn", `⚡ Direkt Nav2 → (${x.toFixed(2)}, ${y.toFixed(2)}) — Task Manager bypass!`);
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (err) { addLog("error", `Goal hatası: ${prettyErr(err)}`); }
  }, [ros, isConnected, addLog]);

  const publishMode = useCallback((mode) => {
    setOperationMode(mode);
    addLog("info", `🔄 Mod: ${mode.toUpperCase()}`);
    if (mode === "manual" && taskState.name) {
      sendRunCmd(`stop ${taskState.name}`);
      addLog("warn", "Manuel Mod: Aktif otonom görev durduruldu.");
    }
  }, [setOperationMode, addLog, taskState.name, sendRunCmd]);

  // ══════════════════════════════════════════════════════════════════════════
  // ACTION HANDLERS — Görevler Task Manager üzerinden
  // ══════════════════════════════════════════════════════════════════════════

  const handleStop = useCallback(() => {
    if (directGpsTaskRef.current) {
      cancelDirectGpsWaypoint();
      setActiveTaskLabel("");
      return;
    }
    if (taskState.name) { sendRunCmd(`stop ${taskState.name}`); setActiveTaskLabel(""); }
    else addLog("warn", "Durdurulacak aktif görev yok!");
  }, [taskState.name, sendRunCmd, addLog, cancelDirectGpsWaypoint]);

  // FIX: Mesafe görevi artık Task Manager üzerinden → GoPose plugin Nav2'ye iletir
  const handleDistanceTask = useCallback((distStr) => {
    const dist = parseFloat(distStr);
    if (isNaN(dist) || dist <= 0) { addLog("error", "Geçerli mesafe girin!"); return; }
    if (!robotPose) { addLog("error", "Robot pozisyonu henüz alınamadı!"); return; }
    const targetX = robotPose.x + dist * Math.cos(robotPose.yaw);
    const targetY = robotPose.y + dist * Math.sin(robotPose.yaw);
    // Task Manager → GoPose plugin → Nav2 (plugin /goal_pose_task'a yayınlar)
    sendRunCmd(`run GoPose {"x":${targetX.toFixed(4)},"y":${targetY.toFixed(4)},"yaw":${robotPose.yaw.toFixed(4)}}`);
    addLog("info", `🎯 ${dist}m ileri → GoPose(${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
  }, [robotPose, sendRunCmd, addLog]);

  // FIX: Manuel hedef de Task Manager üzerinden
  const handleManualGoal = useCallback(() => {
    const x = parseFloat(goalX), y = parseFloat(goalY);
    const yaw = (parseFloat(goalYaw) || 0) * (Math.PI / 180);
    if (isNaN(x) || isNaN(y)) { addLog("error", "Geçerli X ve Y girin!"); return; }
    sendRunCmd(`run GoPose {"x":${x.toFixed(4)},"y":${y.toFixed(4)},"yaw":${yaw.toFixed(4)}}`);
  }, [goalX, goalY, goalYaw, sendRunCmd, addLog]);

  // Direkt Nav2'ye gönder (emergency / task manager bypass)
  const handleDirectNav2 = useCallback(() => {
    const x = parseFloat(goalX), y = parseFloat(goalY);
    const yaw = (parseFloat(goalYaw) || 0) * (Math.PI / 180);
    if (isNaN(x) || isNaN(y)) { addLog("error", "Geçerli X ve Y girin!"); return; }
    sendDirectNav2Goal(x, y, yaw);
  }, [goalX, goalY, goalYaw, sendDirectNav2Goal, addLog]);

  const handleCustomCmd = useCallback(() => {
    if (!customCmd.trim()) return;
    sendRunCmd(customCmd.trim());
    setCustomCmd("");
  }, [customCmd, sendRunCmd]);

  // ── GPS Görevleri sekmesi: kullanıcı tanımlı görev ekle/sil/çalıştır ────────
  const handleAddLocation = useCallback(() => {
    const name = newLocName.trim();
    if (!name) { addLog("error", "Görev adı girin!"); return; }
    if (newLocMode === "gps") {
      const lat = parseFloat(newLocLat), lon = parseFloat(newLocLon);
      if (isNaN(lat) || isNaN(lon)) { addLog("error", "Geçerli Lat ve Lon girin!"); return; }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { addLog("error", "Lat/Lon aralık dışı!"); return; }
      const yaw = optionalNumber(newLocYaw);
      if (hasText(newLocYaw) && yaw === null) { addLog("error", "Yaw boş bırakılabilir veya sayı olmalı."); return; }
      const nextLocation = { id: Date.now(), name, mode: "gps", lat, lon };
      if (yaw !== null && yaw !== 0) nextLocation.yaw = yaw;
      setCustomLocations((prev) => [...prev, nextLocation]);
      addLog("info", `📍 Yeni GPS görevi eklendi: ${name} (${lat.toFixed(6)}, ${lon.toFixed(6)})`);
    } else {
      const x = parseFloat(newLocX), y = parseFloat(newLocY);
      const yaw = (parseFloat(newLocYaw) || 0) * (Math.PI / 180);
      if (isNaN(x) || isNaN(y)) { addLog("error", "Geçerli X ve Y girin!"); return; }
      setCustomLocations((prev) => [...prev, { id: Date.now(), name, mode: "xy", x, y, yaw }]);
      addLog("info", `📍 Yeni görev eklendi: ${name} (${x.toFixed(2)}, ${y.toFixed(2)})`);
    }
    setNewLocName(""); setNewLocX(""); setNewLocY(""); setNewLocLat(""); setNewLocLon(""); setNewLocYaw(newLocMode === "gps" ? "" : "0");
  }, [newLocName, newLocMode, newLocX, newLocY, newLocLat, newLocLon, newLocYaw, addLog]);

  const handleRemoveLocation = useCallback((id) => {
    setCustomLocations((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleGoToLocation = useCallback((loc) => {
    if (loc.mode === "gps") {
      publishGpsWaypoint({ latitude: loc.lat, longitude: loc.lon }, loc.name);
    } else {
      sendRunCmd(`run GoPose {"x":${loc.x.toFixed(4)},"y":${loc.y.toFixed(4)},"yaw":${loc.yaw.toFixed(4)},"mode":"map"}`);
    }
    setActiveTaskLabel(loc.name);
  }, [sendRunCmd, publishGpsWaypoint]);

  const handleOpenSavedRoute = useCallback((route) => {
    if (!route?.id) return;
    queueGpsMissionRouteOpen(route.id);
    addLog("info", `🗺 GPS rota GPS Mission sayfasında açılıyor: ${route.name}`);
    navigate("/gps-mission");
  }, [addLog, navigate]);

  const handleDeleteSavedRoute = useCallback((route) => {
    if (!route?.id) return;
    deleteSavedGpsMissionRoute(route.id);
    setSavedRoutes(readSavedGpsMissionRoutes());
    addLog("info", `🗑 Kayıtlı rota silindi: ${route.name}`);
  }, [addLog]);

  const handleGoHome = useCallback(() => {
    const lat = Number(homeGps.lat), lon = Number(homeGps.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      addLog("error", "Eve Dön hedefi geçersiz: lat/lon sayı olmalı.");
      return;
    }
    publishGpsWaypoint({ latitude: lat, longitude: lon }, "Eve Dön");
    setActiveTaskLabel("Eve Dön");
  }, [homeGps, addLog, publishGpsWaypoint]);
  const handleGoCharge = useCallback(() => {
    const lat = Number(chargeGps.lat), lon = Number(chargeGps.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      addLog("error", "Şarja Git hedefi geçersiz: lat/lon sayı olmalı.");
      return;
    }
    publishGpsWaypoint({ latitude: lat, longitude: lon }, "Şarja Git");
    setActiveTaskLabel("Şarja Git");
  }, [chargeGps, addLog, publishGpsWaypoint]);

  const handleQueueReadyTask = useCallback((task) => {
    const lat = Number(task?.lat);
    const lon = Number(task?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      addLog("error", `${task?.name || "Hazır görev"} için geçerli GPS koordinatı yok.`);
      return;
    }

    const queuedItem = {
      id: `ready-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceId: String(task?.id || task?.name || ""),
      name: String(task?.name || "Hazır görev"),
      lat,
      lon
    };

    setReadyTaskQueue(prev => [...prev, queuedItem]);
    addLog("info", `🧾 Sıraya eklendi: ${queuedItem.name}`);
  }, [addLog]);

  const handleRemoveQueuedReadyTask = useCallback((itemId) => {
    setReadyTaskQueue(prev => prev.filter(item => item.id !== itemId));
  }, []);

  const handleMoveQueuedReadyTask = useCallback((itemId, direction) => {
    setReadyTaskQueue(prev => {
      const index = prev.findIndex(item => item.id === itemId);
      if (index < 0) return prev;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }, []);

  const handleClearReadyTaskQueue = useCallback(() => {
    setReadyTaskQueue([]);
    addLog("info", "🗑 Hazır görev sırası temizlendi");
  }, [addLog]);

  const handleOpenReadyTaskQueueInGpsMission = useCallback(() => {
    if (readyTaskQueue.length === 0) {
      addLog("warn", "Önce sıraya en az bir hazır görev ekleyin.");
      return;
    }

    const routeName = readyTaskQueue.length === 1
      ? `Hazır görev: ${readyTaskQueue[0].name}`
      : `Hazır görev sırası (${readyTaskQueue.length} nokta)`;

    const route = {
      id: `task-manager-ready-queue-${Date.now()}`,
      name: routeName,
      description: readyTaskQueue.map((item, index) => `${index + 1}. ${item.name}`).join(" → "),
      waypoints: readyTaskQueue.map(item => ({
        lat: item.lat,
        lng: item.lon,
        speed: "1.00",
        mode: "pass"
      })),
      previewImage: createGpsRoutePreviewImage(
        readyTaskQueue.map(item => ({ lat: item.lat, lng: item.lon })),
        routeName
      ),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    queueGpsMissionDraftRouteOpen(route);
    addLog("info", `🗺 Hazır görev sırası GPS Mission sayfasına açılıyor: ${routeName}`);
    navigate("/gps-mission");
  }, [addLog, navigate, readyTaskQueue]);

  // ── Color helpers ──────────────────────────────────────────────────────────
  // Gerçek plugin durumları: CONFIGURED, RUNNING, SUCCEEDED, FAILED, STOPPED (bkz. go_pose/go_home/go_charge .cpp)
  const stateColor = (s) => { switch ((s || "").toUpperCase()) { case "RUNNING": return "#3b82f6"; case "IDLE": return "#475569"; case "DONE": case "SUCCESS": case "SUCCEEDED": return "#10b981"; case "ERROR": case "FAILED": return "#ef4444"; case "STOPPED": return "#f59e0b"; default: return "#f59e0b"; } };
  const stateLabelTR = (s) => { switch ((s || "").toUpperCase()) { case "RUNNING": return "DEVAM EDİYOR"; case "DONE": case "SUCCESS": case "SUCCEEDED": return "TAMAMLANDI"; case "STOPPED": return "İPTAL EDİLDİ"; case "ERROR": case "FAILED": return "BAŞARISIZ"; case "CONFIGURED": return "BAŞLATILIYOR"; case "IDLE": default: return "BEKLEMEDE"; } };
  const logColor = (t) => { switch (t) { case "error": return "#f87171"; case "warn": return "#fbbf24"; case "info": return "#60a5fa"; default: return "#94a3b8"; } };
  const recoveryColor = recoveryActive ? "#ef4444" : "#10b981";
  const currentMode = operationMode || "manual";
  const renderLogPanel = (title = "📝 DURUM KAYITLARI") => (
    <div style={{ ...cardS, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div style={{ ...lblS, display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span>
        <button
          onClick={() => {
            setLogs([]);
            try { localStorage.removeItem(TASK_LOG_STORAGE_KEY); } catch {}
          }}
          style={{ ...btnS("transparent", "none"), padding: "0.1rem 0.3rem", fontSize: "0.5rem", color: "#334155" }}
        >
          Temizle
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", fontSize: "0.6rem", lineHeight: "1.7" }}>
        {logs.length === 0 && <div style={{ color: "#1e293b", padding: "1rem", textAlign: "center" }}>Henüz kayıt yok…</div>}
        {logs.map((l) => (
          <div key={l.id} style={{ color: logColor(l.type) }}>
            <span style={{ color: "#334155" }}>[{l.time}]</span> {l.msg}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="page-root" style={{ height: "calc(100vh - 56px)", width: "100%", background: "#060d1a", color: "white", padding: "0.5rem", fontFamily: "'JetBrains Mono','Fira Code','Segoe UI',monospace", overflow: "hidden", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "0.4rem" }}>

      {/* HEADER */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div style={{ width: "34px", height: "34px", borderRadius: "8px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", boxShadow: "0 0 16px #3b82f644" }}>📋</div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: "800", letterSpacing: "0.12em", color: "#f1f5f9" }}>GÖREV YÖNETİCİSİ</div>
            <div style={{ fontSize: "0.55rem", color: "#475569", letterSpacing: "0.06em" }}>TASK MANAGER &middot; NAV2 CONTROLLER</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: recoveryActive ? "rgba(239,68,68,0.1)" : "#0f1e35", borderRadius: "0.4rem", padding: "0.3rem 0.6rem", border: `1px solid ${recoveryActive ? "#7f1d1d" : "#1e3a5f"}`, animation: recoveryActive ? "pulse 1.5s infinite" : "none" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: recoveryColor, boxShadow: `0 0 8px ${recoveryColor}` }} />
            <span style={{ fontSize: "0.6rem", fontWeight: "700", color: recoveryColor }}>{recoveryActive ? "GERİ ÇEKİLME AKTİF" : "Normal"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: "#0f1e35", borderRadius: "0.4rem", padding: "0.3rem 0.6rem", border: "1px solid #1e3a5f" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isConnected ? "#10b981" : "#ef4444", boxShadow: `0 0 8px ${isConnected ? "#10b981" : "#ef4444"}` }} />
            <span style={{ fontSize: "0.6rem", fontWeight: "600", color: isConnected ? "#10b981" : "#ef4444" }}>{isConnected ? "ROS BAĞLI" : "BAĞLI DEĞİL"}</span>
          </div>
          {!isConnected && <button onClick={reconnect} style={btnS("#2563eb")}>⟳ Bağlan</button>}
        </div>
      </div>

      {/* TABS */}
      <div style={{ flexShrink: 0, display: "flex", gap: "0.3rem" }}>
        {[["genel", "📋", "Genel"], ["gps", "📍", "GPS Görevleri"]].map(([key, icon, label]) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{ padding: "0.45rem 1rem", background: activeTab === key ? "#1d4ed8" : "#0d1829", border: `1px solid ${activeTab === key ? "#3b82f6" : "#162032"}`, borderBottom: activeTab === key ? "1px solid #1d4ed8" : "1px solid #162032", borderRadius: "0.4rem 0.4rem 0 0", color: activeTab === key ? "white" : "#64748b", cursor: "pointer", fontSize: "0.7rem", fontWeight: "700", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span>{icon}</span><span>{label}</span>
          </button>
        ))}
      </div>

      {/* GENEL TAB — Nav2 / Mesafe / Manuel hedef / Loglar */}
      {activeTab === "genel" && (
      <div className="grid-collapse" style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr 280px", gap: "0.4rem", minHeight: 0 }}>

        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", overflow: "auto" }}>
          {/* MODE */}
          <div style={cardS}>
            <div style={lblS}>OPERASYON MODU → /mod</div>
            <div style={{ display: "flex", gap: "0.3rem" }}>
              {Object.entries(MODE_LABELS).map(([key, m]) => (
                <button key={key} onClick={() => publishMode(key)} style={pillS(currentMode === key, m.color)}>
                  <span>{m.icon}</span><span>{m.label}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: "0.55rem", color: "#334155", marginTop: "0.3rem", textAlign: "center" }}>Aktif: {MODE_LABELS[currentMode]?.desc}</div>
          </div>

          {/* TASK STATE */}
          <div style={cardS}>
            <div style={lblS}>AKTİF GÖREV</div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: stateColor(taskState.state), boxShadow: `0 0 8px ${stateColor(taskState.state)}` }} />
              <span style={{ ...valS, color: stateColor(taskState.state) }}>{stateLabelTR(taskState.state)}</span>
            </div>
            {taskState.name && <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Görev: <span style={{ color: "#e2e8f0", fontWeight: "700" }}>{taskState.name}</span></div>}
            {taskState.observers.length > 0 && <div style={{ fontSize: "0.55rem", color: "#334155" }}>Observers: {taskState.observers.join(", ")}</div>}
          </div>

          {/* QUICK TASKS — Hepsi Task Manager üzerinden */}
          <div style={{ ...cardS, flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
            <div style={lblS}>HIZLI GÖREVLER (Task Manager)</div>
            <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.4rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.6rem", color: "#64748b" }}>Mesafe:</span>
              <input value={taskDistance} onChange={(e) => setTaskDistance(e.target.value)} style={{ ...inputS, flex: 1, padding: "0.3rem 0.4rem", fontSize: "0.7rem" }} />
              <span style={{ fontSize: "0.55rem", color: "#475569" }}>m</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <button onClick={() => handleDistanceTask(taskDistance)} disabled={!isConnected} style={{ ...btnS("#162032"), padding: "0.5rem 0.6rem", textAlign: "left", display: "flex", alignItems: "center", gap: "0.4rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.68rem" }}>
                <span style={{ fontSize: "0.9rem" }}>🚀</span><span>{taskDistance || "?"}m İleri</span>
              </button>
              <button onClick={() => handleDistanceTask("50")} disabled={!isConnected} style={{ ...btnS("#162032"), padding: "0.5rem 0.6rem", textAlign: "left", display: "flex", alignItems: "center", gap: "0.4rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.68rem" }}>
                <span style={{ fontSize: "0.9rem" }}>📏</span><span>50m İleri</span>
              </button>
              <button onClick={() => handleDistanceTask("10")} disabled={!isConnected} style={{ ...btnS("#162032"), padding: "0.5rem 0.6rem", textAlign: "left", display: "flex", alignItems: "center", gap: "0.4rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.68rem" }}>
                <span style={{ fontSize: "0.9rem" }}>📐</span><span>10m İleri</span>
              </button>
              <button onClick={handleStop} disabled={!isConnected} style={{ ...btnS("#7f1d1d"), padding: "0.5rem 0.6rem", textAlign: "left", display: "flex", alignItems: "center", gap: "0.4rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.68rem" }}>
                <span style={{ fontSize: "0.9rem" }}>⏹</span><span>Dur{taskState.name ? ` (${taskState.name})` : ""}</span>
              </button>
            </div>

            {/* Custom cmd */}
            <div style={{ marginTop: "0.5rem", borderTop: "1px solid #162032", paddingTop: "0.4rem" }}>
              <div style={lblS}>ÖZEL KOMUT</div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <input value={customCmd} onChange={(e) => setCustomCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCustomCmd()} placeholder='run TaskName {"key":"val"}' style={{ ...inputS, flex: 1, padding: "0.35rem 0.4rem", fontSize: "0.65rem" }} />
                <button onClick={handleCustomCmd} disabled={!isConnected} style={{ ...btnS("#1d4ed8"), opacity: isConnected ? 1 : 0.4 }}>▶</button>
              </div>
              <div style={{ fontSize: "0.48rem", color: "#1e293b", marginTop: "0.2rem", lineHeight: "1.6" }}>list | run TaskName | run TaskName {"{json}"} | stop TaskName</div>
            </div>

            {/* Registry tasks */}
            <div style={{ marginTop: "0.4rem", borderTop: "1px solid #162032", paddingTop: "0.35rem" }}>
              <div style={{ ...lblS, display: "flex", justifyContent: "space-between" }}>
                <span>KAYITLI GÖREVLER ({taskRegistry.tasks.length})</span>
                <button onClick={() => sendRunCmd("list")} disabled={!isConnected} style={{ ...btnS("transparent", "none"), padding: "0.1rem 0.3rem", fontSize: "0.5rem", color: "#3b82f6", opacity: isConnected ? 1 : 0.4 }}>⟳</button>
              </div>
              {taskRegistry.tasks.length === 0
                ? <div style={{ fontSize: "0.55rem", color: "#1e293b" }}>Registry boş → ⟳ ile yenile</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    {taskRegistry.tasks.map((t, i) => (
                      <button key={i} onClick={() => sendRunCmd(`run ${t.name}`)} disabled={!isConnected} style={{ ...btnS("#0d1829", "1px solid #1e293b"), padding: "0.35rem 0.5rem", fontSize: "0.6rem", textAlign: "left", opacity: isConnected ? 1 : 0.4 }}>
                        ▸ {t.name} <span style={{ color: "#334155", fontSize: "0.5rem" }}>({t.class})</span>
                      </button>
                    ))}
                  </div>
              }
            </div>
          </div>
        </div>

        {/* CENTER */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minHeight: 0 }}>
          {/* Position cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", flexShrink: 0 }}>
            <div style={{ ...cardS, borderColor: "#0f4c75" }}>
              <div style={lblS}>🚗 ARAÇ KONUMU {poseSource && <span style={{ color: "#334155" }}>({poseSource})</span>}</div>
              {robotPose ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                  {[["X", robotPose.x.toFixed(3)], ["Y", robotPose.y.toFixed(3)], ["YAW", `${rad2deg(robotPose.yaw)}°`]].map(([l, v]) => (
                    <div key={l}><div style={{ fontSize: "0.5rem", color: "#475569" }}>{l}</div><div style={{ ...valS, color: "#38bdf8" }}>{v}</div></div>
                  ))}
                </div>
              ) : <div style={{ fontSize: "0.65rem", color: "#334155" }}>Veri bekleniyor…</div>}
            </div>
            <div style={{ ...cardS, borderColor: "#4c1d95" }}>
              <div style={lblS}>📍 HEDEF (Nav2 / Task)</div>
              {goalPose ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                  {[["X", goalPose.x.toFixed(3)], ["Y", goalPose.y.toFixed(3)], ["YAW", `${rad2deg(goalPose.yaw)}°`]].map(([l, v]) => (
                    <div key={l}><div style={{ fontSize: "0.5rem", color: "#475569" }}>{l}</div><div style={{ ...valS, color: "#a78bfa" }}>{v}</div></div>
                  ))}
                </div>
              ) : <div style={{ fontSize: "0.65rem", color: "#334155" }}>Hedef belirlenmedi</div>}
            </div>
          </div>

          {/* Distance */}
          {robotPose && goalPose && (
            <div style={{ ...cardS, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "1.5rem", background: "linear-gradient(135deg, #0d1829, #111d33)", borderColor: "#1e3a5f" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.5rem", color: "#475569" }}>KALAN MESAFE</div>
                <div style={{ fontSize: "1.4rem", fontWeight: "900", color: "#fbbf24" }}>{Math.hypot(goalPose.x - robotPose.x, goalPose.y - robotPose.y).toFixed(2)}<span style={{ fontSize: "0.6rem", color: "#78716c" }}> m</span></div>
              </div>
              <div style={{ width: "1px", height: "30px", background: "#1e3a5f" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.5rem", color: "#475569" }}>BEARING</div>
                <div style={{ fontSize: "1.4rem", fontWeight: "900", color: "#60a5fa" }}>{rad2deg(Math.atan2(goalPose.y - robotPose.y, goalPose.x - robotPose.x))}°</div>
              </div>
            </div>
          )}

          {/* Manual goal — Task Manager (birincil) + Direkt Nav2 (ikincil) */}
          <div style={{ ...cardS, flexShrink: 0 }}>
            <div style={lblS}>📌 HEDEF BELİRLE</div>
            <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              {[["X (m)", goalX, setGoalX], ["Y (m)", goalY, setGoalY], ["YAW (°)", goalYaw, setGoalYaw]].map(([l, v, s]) => (
                <div key={l} style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.5rem", color: "#475569", marginBottom: "0.15rem" }}>{l}</div>
                  <input value={v} onChange={(e) => s(e.target.value)} placeholder="0.0" style={inputS} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.4rem" }}>
              <button onClick={handleManualGoal} disabled={!isConnected} style={{ ...btnS("#7c3aed"), flex: 2, opacity: isConnected ? 1 : 0.4, fontSize: "0.7rem" }}>
                🎯 GoPose (Task Manager)
              </button>
              <button onClick={handleDirectNav2} disabled={!isConnected} style={{ ...btnS("#162032", "1px solid #334155"), flex: 1, opacity: isConnected ? 1 : 0.4, fontSize: "0.6rem", color: "#64748b" }}>
                ⚡ Direkt Nav2
              </button>
            </div>
            {robotPose && (
              <button onClick={() => { setGoalX(robotPose.x.toFixed(3)); setGoalY(robotPose.y.toFixed(3)); setGoalYaw(rad2deg(robotPose.yaw)); }}
                style={{ ...btnS("transparent", "1px solid #1e293b"), marginTop: "0.3rem", fontSize: "0.55rem", color: "#475569", width: "100%" }}>
                📋 Mevcut pozisyonu kopyala
              </button>
            )}
          </div>

          {/* Logs */}
          {renderLogPanel()}
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", overflow: "auto" }}>
          {/* Recovery */}
          <div style={{ ...cardS, borderColor: recoveryActive ? "#7f1d1d" : "#162032", background: recoveryActive ? "rgba(127,29,29,0.12)" : "#0d1829" }}>
            <div style={lblS}>🛡 GERİ ÇEKİLME → /tcs/recovery</div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: recoveryActive ? "radial-gradient(circle,#ef4444 0%,#7f1d1d 70%)" : "radial-gradient(circle,#10b981 0%,#064e3b 70%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", boxShadow: recoveryActive ? "0 0 20px #ef444488" : "0 0 12px #10b98144", animation: recoveryActive ? "pulse 1.5s infinite" : "none" }}>
                {recoveryActive ? "⚠️" : "✅"}
              </div>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: "800", color: recoveryActive ? "#f87171" : "#10b981" }}>{recoveryActive ? "AKTİF (1)" : "PASİF (0)"}</div>
                <div style={{ fontSize: "0.55rem", color: "#475569" }}>{recoveryActive ? "Araç geri çekilme modunda" : "Normal operasyon"}</div>
              </div>
            </div>
          </div>

          {/* Coverage */}
          <div style={cardS}>
            <div style={lblS}>🗺 COVERAGE</div>
            {coverageStatus ? (
              <div>
                {[["Waypoint", coverageStatus.waypointCount, "#10b981", "700"], ["Frame", coverageStatus.frameId, "#94a3b8", "400"], ["Güncelleme", coverageStatus.lastUpdate, "#64748b", "400"]].map(([l, v, c, w]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                    <span style={{ fontSize: "0.6rem", color: "#64748b" }}>{l}</span>
                    <span style={{ fontSize: "0.65rem", color: c, fontWeight: w }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ fontSize: "0.6rem", color: "#1e293b" }}>Bekleniyor…</div>}
            <a href="/coverage" style={{ display: "block", marginTop: "0.4rem", textAlign: "center", padding: "0.4rem", borderRadius: "0.25rem", background: "#162032", border: "1px solid #1e3a5f", color: "#60a5fa", fontSize: "0.65rem", fontWeight: "700", textDecoration: "none" }}>🗺 Coverage Planner →</a>
          </div>

          {/* MUX SOURCE MATRIX */}
          <div style={cardS}>
            <div style={lblS}>🔀 CMD_VEL MUX</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              {ALL_SOURCES.map((src) => {
                const modeInfo = MODE_SOURCES[currentMode] || MODE_SOURCES.manual;
                const isAllowed = modeInfo.allowed.includes(src.name);
                const isActive = muxActiveSource === src.name;
                return (
                  <div key={src.name} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.4rem", borderRadius: "0.25rem", background: isActive ? "rgba(59,130,246,0.12)" : isAllowed ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${isActive ? "#3b82f6" : isAllowed ? "#064e3b" : "#7f1d1d44"}`, opacity: isAllowed ? 1 : 0.5 }}>
                    <span style={{ fontSize: "0.75rem", width: "18px", textAlign: "center" }}>{src.icon}</span>
                    <span style={{ flex: 1, fontSize: "0.58rem", fontWeight: isActive ? "800" : "600", color: isActive ? "#60a5fa" : isAllowed ? "#94a3b8" : "#475569" }}>{src.label}</span>
                    <span style={{ fontSize: "0.5rem", color: "#334155" }}>P:{src.prio}</span>
                    <span style={{ fontSize: "0.5rem", fontWeight: "700", padding: "0.1rem 0.25rem", borderRadius: "0.15rem", background: isActive ? "#1d4ed8" : isAllowed ? "#064e3b" : "#7f1d1d", color: isActive ? "#93c5fd" : isAllowed ? "#6ee7b7" : "#fca5a5" }}>
                      {isActive ? "AKTİF" : isAllowed ? "İZİNLİ" : "ENGELLİ"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: "0.48rem", color: "#1e293b", marginTop: "0.3rem", textAlign: "center" }}>Mod: {MODE_LABELS[currentMode]?.label} → /cmd_vel_serial</div>
          </div>

          {/* Compass */}
          <div style={{ ...cardS, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={lblS}>🧭 YÖN</div>
            <svg width="110" height="110" viewBox="-55 -55 110 110">
              <circle cx="0" cy="0" r="50" fill="none" stroke="#1e3a5f" strokeWidth="2"/><circle cx="0" cy="0" r="48" fill="#0a1020"/>
              {[["N",0],["E",90],["S",180],["W",270]].map(([l,a]) => { const r=((a-90)*Math.PI)/180; return <text key={l} x={42*Math.cos(r)} y={42*Math.sin(r)+3} fill="#475569" fontSize="8" fontWeight="700" textAnchor="middle">{l}</text>; })}
              {Array.from({length:36},(_,i) => { const a=(i*10-90)*(Math.PI/180); return <line key={i} x1={(i%9===0?33:36)*Math.cos(a)} y1={(i%9===0?33:36)*Math.sin(a)} x2={38*Math.cos(a)} y2={38*Math.sin(a)} stroke={i%9===0?"#475569":"#1e293b"} strokeWidth={i%9===0?1.5:0.5}/>; })}
              {robotPose && <g transform={`rotate(${-(robotPose.yaw*180)/Math.PI+90})`}><polygon points="0,-30 -7,10 0,4 7,10" fill="#3b82f6" opacity="0.9"/></g>}
              {robotPose && goalPose && <g transform={`rotate(${-(Math.atan2(goalPose.y-robotPose.y,goalPose.x-robotPose.x)*180)/Math.PI+90})`}><circle cx="0" cy="-38" r="5" fill="#a78bfa" opacity="0.85"/></g>}
              <circle cx="0" cy="0" r="3" fill="#1e293b"/>
            </svg>
            <div style={{ fontSize: "0.55rem", color: "#334155", marginTop: "0.2rem", display: "flex", gap: "0.5rem" }}>
              <span><span style={{ color: "#3b82f6" }}>▲</span> Araç</span>
              <span><span style={{ color: "#a78bfa" }}>●</span> Hedef</span>
            </div>
          </div>

          {/* Registry */}
          <div style={cardS}>
            <div style={lblS}>📦 REGISTRY</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.3rem", textAlign: "center" }}>
              {[["Pack", taskRegistry.packs.length, "#3b82f6"], ["Görev", taskRegistry.tasks.length, "#10b981"], ["Observer", taskRegistry.observers.length, "#f59e0b"]].map(([l, v, c]) => (
                <div key={l}><div style={{ fontSize: "1rem", fontWeight: "900", color: c }}>{v}</div><div style={{ fontSize: "0.5rem", color: "#475569" }}>{l}</div></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* GPS TAB — Sabit konumlar (Eve Dön / Şarja Git) + kullanıcı tanımlı görevler */}
      {activeTab === "gps" && (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem", minHeight: 0 }}>

        {/* DURUM ÇUBUĞU: aktif görev / durum / durdur + araç konumu + görev noktası + kalan mesafe */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 0.9fr", gap: "0.4rem", flexShrink: 0 }}>
          <div style={{ ...cardS, borderColor: `${stateColor(taskState.state)}55` }}>
            <div style={lblS}>📡 GÖREV DURUMU</div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: stateColor(taskState.state), boxShadow: `0 0 8px ${stateColor(taskState.state)}`, animation: taskState.state?.toUpperCase() === "RUNNING" ? "pulse 1.5s infinite" : "none" }} />
              <span style={{ ...valS, color: stateColor(taskState.state) }}>{stateLabelTR(taskState.state)}</span>
            </div>
            <div style={{ fontSize: "0.65rem", color: "#94a3b8", marginBottom: "0.4rem" }}>
              {activeTaskLabel ? <>Görev: <span style={{ color: "#e2e8f0", fontWeight: "700" }}>{activeTaskLabel}</span></> : "Aktif görev yok"}
            </div>
            <button onClick={handleStop} disabled={!isConnected || !taskState.name} style={{ ...btnS("#7f1d1d"), width: "100%", opacity: (isConnected && taskState.name) ? 1 : 0.4 }}>⏹ Durdur / İptal Et</button>
          </div>

          <div style={{ ...cardS, borderColor: "#0f4c75" }}>
            <div style={lblS}>🚗 ARAÇ KONUMU {poseSource && <span style={{ color: "#334155" }}>({poseSource})</span>}</div>
            {robotPose ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                {[["X", robotPose.x.toFixed(3)], ["Y", robotPose.y.toFixed(3)], ["YAW", `${rad2deg(robotPose.yaw)}°`]].map(([l, v]) => (
                  <div key={l}><div style={{ fontSize: "0.5rem", color: "#475569" }}>{l}</div><div style={{ ...valS, color: "#38bdf8" }}>{v}</div></div>
                ))}
              </div>
            ) : <div style={{ fontSize: "0.65rem", color: "#334155" }}>Veri bekleniyor…</div>}
          </div>

          <div style={{ ...cardS, borderColor: "#4c1d95" }}>
            <div style={lblS}>📍 GÖREV NOKTASI</div>
            {goalPose ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                {[["X", goalPose.x.toFixed(3)], ["Y", goalPose.y.toFixed(3)], ["YAW", `${rad2deg(goalPose.yaw)}°`]].map(([l, v]) => (
                  <div key={l}><div style={{ fontSize: "0.5rem", color: "#475569" }}>{l}</div><div style={{ ...valS, color: "#a78bfa" }}>{v}</div></div>
                ))}
              </div>
            ) : <div style={{ fontSize: "0.65rem", color: "#334155" }}>Hedef belirlenmedi</div>}
          </div>

          <div style={{ ...cardS, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0d1829, #111d33)" }}>
            <div style={{ fontSize: "0.5rem", color: "#475569" }}>KALAN MESAFE</div>
            <div style={{ fontSize: "1.3rem", fontWeight: "900", color: "#fbbf24" }}>
              {robotPose && goalPose ? Math.hypot(goalPose.x - robotPose.x, goalPose.y - robotPose.y).toFixed(2) : "—"}
              <span style={{ fontSize: "0.55rem", color: "#78716c" }}> m</span>
            </div>
            {robotPose && goalPose && <div style={{ fontSize: "0.55rem", color: "#60a5fa", marginTop: "0.2rem" }}>↗ {rad2deg(Math.atan2(goalPose.y - robotPose.y, goalPose.x - robotPose.x))}°</div>}
          </div>
        </div>

        {/* ALT: Sol kolon (sabit konumlar + yeni görev + log) | Sağ kolon (kayıtlı görevler) */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", minHeight: 0 }}>
          {/* LEFT: Sabit konumlar + yeni görev ekleme formu + log */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", overflow: "auto", paddingRight: "0.1rem" }}>
            <div style={cardS}>
              <div style={lblS}>📍 SABİT KONUMLAR (GPS · Task Manager)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {/* EVE DÖN */}
                <div style={{ background: "#0a1020", border: "1px solid #0f4c75", borderRadius: "0.35rem", padding: "0.4rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <button onClick={() => handleQueueReadyTask({ id: "home", name: "Eve Dön", lat: Number(homeGps.lat), lon: Number(homeGps.lon) })} disabled={!isConnected} style={{ ...btnS("#0f4c75"), flex: 1, padding: "0.5rem 0.6rem", display: "flex", alignItems: "center", gap: "0.5rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.75rem" }}>
                      <span style={{ fontSize: "1.1rem" }}>🏠</span><span>Sıraya Ekle: Eve Dön</span>
                    </button>
                    <button onClick={() => setEditHome((v) => !v)} style={{ ...btnS("transparent", "1px solid #1e3a5f"), fontSize: "0.6rem", color: "#60a5fa" }}>{editHome ? "✓ Kapat" : "✎ Düzenle"}</button>
                  </div>
                  {!editHome ? (
                    <div style={{ fontSize: "0.58rem", color: "#64748b", marginTop: "0.35rem", fontFamily: "'JetBrains Mono',monospace" }}>
                      Lat: <span style={{ color: "#38bdf8" }}>{Number(homeGps.lat).toFixed(7)}</span> · Lon: <span style={{ color: "#38bdf8" }}>{Number(homeGps.lon).toFixed(7)}</span> · Yaw: <span style={{ color: "#38bdf8" }}>{homeGps.yaw}</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.35rem" }}>
                      {[["LAT", "lat"], ["LON", "lon"], ["YAW", "yaw"]].map(([l, k]) => (
                        <div key={k} style={{ flex: 1 }}>
                          <div style={{ fontSize: "0.45rem", color: "#475569", marginBottom: "0.1rem" }}>{l}</div>
                          <input value={homeGps[k]} onChange={(e) => setHomeGps((p) => ({ ...p, [k]: e.target.value }))} style={{ ...inputS, padding: "0.3rem", fontSize: "0.6rem" }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* ŞARJA GİT */}
                <div style={{ background: "#0a1020", border: "1px solid #4c1d95", borderRadius: "0.35rem", padding: "0.4rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <button onClick={() => handleQueueReadyTask({ id: "charge", name: "Şarja Git", lat: Number(chargeGps.lat), lon: Number(chargeGps.lon) })} disabled={!isConnected} style={{ ...btnS("#4c1d95"), flex: 1, padding: "0.5rem 0.6rem", display: "flex", alignItems: "center", gap: "0.5rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.75rem" }}>
                      <span style={{ fontSize: "1.1rem" }}>🔋</span><span>Sıraya Ekle: Şarja Git</span>
                    </button>
                    <button onClick={() => setEditCharge((v) => !v)} style={{ ...btnS("transparent", "1px solid #4c1d95"), fontSize: "0.6rem", color: "#a78bfa" }}>{editCharge ? "✓ Kapat" : "✎ Düzenle"}</button>
                  </div>
                  {!editCharge ? (
                    <div style={{ fontSize: "0.58rem", color: "#64748b", marginTop: "0.35rem", fontFamily: "'JetBrains Mono',monospace" }}>
                      Lat: <span style={{ color: "#a78bfa" }}>{Number(chargeGps.lat).toFixed(7)}</span> · Lon: <span style={{ color: "#a78bfa" }}>{Number(chargeGps.lon).toFixed(7)}</span> · Yaw: <span style={{ color: "#a78bfa" }}>{chargeGps.yaw}</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.35rem" }}>
                      {[["LAT", "lat"], ["LON", "lon"], ["YAW", "yaw"]].map(([l, k]) => (
                        <div key={k} style={{ flex: 1 }}>
                          <div style={{ fontSize: "0.45rem", color: "#475569", marginBottom: "0.1rem" }}>{l}</div>
                          <input value={chargeGps[k]} onChange={(e) => setChargeGps((p) => ({ ...p, [k]: e.target.value }))} style={{ ...inputS, padding: "0.3rem", fontSize: "0.6rem" }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: "0.5rem", color: "#334155", marginTop: "0.5rem", lineHeight: "1.6" }}>
                Eve Dön / Şarja Git, GoHome / GoCharge plugin'lerine lat/lon hedefi ile gönderilir. Buradaki değerler tarayıcıda saklanır; ✎ Düzenle ile değiştirebilirsiniz.
              </div>
            </div>

            <div style={cardS}>
              <div style={lblS}>🧾 HAZIR GÖREV SIRASI</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {readyTaskQueue.length === 0 ? (
                  <div style={{ fontSize: "0.62rem", color: "#334155", padding: "0.4rem 0.1rem" }}>
                    Eve Dön, Şarja Git veya Yatak görevlerine basınca burada sıra oluşur.
                  </div>
                ) : (
                  readyTaskQueue.map((item, index) => (
                    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.42rem 0.5rem", background: "#0a1020", border: "1px solid #1e293b", borderRadius: "0.35rem" }}>
                      <div style={{ width: 22, height: 22, borderRadius: "999px", background: "#1d4ed8", color: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.58rem", fontWeight: 800 }}>
                        {index + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.66rem", color: "#e2e8f0", fontWeight: 700 }}>{item.name}</div>
                        <div style={{ fontSize: "0.5rem", color: "#64748b" }}>
                          Lat:{item.lat.toFixed(6)} Lon:{item.lon.toFixed(6)}
                        </div>
                      </div>
                      <button onClick={() => handleMoveQueuedReadyTask(item.id, "up")} style={{ ...btnS("#162032"), fontSize: "0.58rem", padding: "0.28rem 0.42rem" }} disabled={index === 0}>▲</button>
                      <button onClick={() => handleMoveQueuedReadyTask(item.id, "down")} style={{ ...btnS("#162032"), fontSize: "0.58rem", padding: "0.28rem 0.42rem" }} disabled={index === readyTaskQueue.length - 1}>▼</button>
                      <button onClick={() => handleRemoveQueuedReadyTask(item.id)} style={{ ...btnS("#7f1d1d"), fontSize: "0.58rem", padding: "0.28rem 0.42rem" }}>✕</button>
                    </div>
                  ))
                )}
                <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.15rem" }}>
                  <button onClick={handleOpenReadyTaskQueueInGpsMission} disabled={!isConnected || readyTaskQueue.length === 0} style={{ ...btnS("#16a34a"), flex: 1, opacity: isConnected && readyTaskQueue.length > 0 ? 1 : 0.4, fontSize: "0.68rem" }}>
                    ▶ Sıralı İşlem Başlat
                  </button>
                  <button onClick={handleClearReadyTaskQueue} disabled={readyTaskQueue.length === 0} style={{ ...btnS("#162032"), fontSize: "0.64rem", opacity: readyTaskQueue.length > 0 ? 1 : 0.4 }}>
                    Temizle
                  </button>
                </div>
                <div style={{ fontSize: "0.5rem", color: "#334155", lineHeight: "1.6" }}>
                  Başlat dediğinde sıra GPS Mission sayfasında rota olarak açılır. Orada waypoint hızı ve hassas işlem süreleri düzenlenebilir.
                </div>
              </div>
            </div>

            <div style={cardS}>
              <div style={lblS}>➕ YENİ GÖREV EKLE</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {/* MOD SEÇİMİ: XY (harita) veya Lat/Lon (GPS) */}
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  {[["xy", "📐 X / Y (m)"], ["gps", "🛰 Lat / Lon"]].map(([key, label]) => (
                    <button key={key} onClick={() => setNewLocMode(key)}
                      style={{ ...pillS(newLocMode === key, key === "gps" ? "#10b981" : "#3b82f6"), padding: "0.4rem 0.5rem", fontSize: "0.62rem" }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: "0.5rem", color: "#475569", marginBottom: "0.15rem" }}>GÖREV ADI</div>
                  <input value={newLocName} onChange={(e) => setNewLocName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddLocation()} placeholder="örn. Ofise Git" style={inputS} />
                </div>
                {newLocMode === "gps" ? (
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    {[["LAT", newLocLat, setNewLocLat, "39.7961831"], ["LON", newLocLon, setNewLocLon, "32.5312344"], ["YAW", newLocYaw, setNewLocYaw, "opsiyonel"]].map(([l, v, s, ph]) => (
                      <div key={l} style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.5rem", color: "#475569", marginBottom: "0.15rem" }}>{l}</div>
                        <input value={v} onChange={(e) => s(e.target.value)} placeholder={ph} style={inputS} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    {[["X (m)", newLocX, setNewLocX], ["Y (m)", newLocY, setNewLocY], ["YAW (°)", newLocYaw, setNewLocYaw]].map(([l, v, s]) => (
                      <div key={l} style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.5rem", color: "#475569", marginBottom: "0.15rem" }}>{l}</div>
                        <input value={v} onChange={(e) => s(e.target.value)} placeholder="0.0" style={inputS} />
                      </div>
                    ))}
                  </div>
                )}
                {robotPose && newLocMode === "xy" && (
                  <button onClick={() => { setNewLocX(robotPose.x.toFixed(3)); setNewLocY(robotPose.y.toFixed(3)); setNewLocYaw(rad2deg(robotPose.yaw)); }}
                    style={{ ...btnS("transparent", "1px solid #1e293b"), fontSize: "0.55rem", color: "#475569" }}>
                    📋 Mevcut pozisyonu kopyala
                  </button>
                )}
                <button onClick={handleAddLocation} style={{ ...btnS("#1d4ed8"), marginTop: "0.2rem", fontSize: "0.7rem" }}>＋ Görev Ekle</button>
              </div>
            </div>
            </div>
            <div style={{ minHeight: "190px", flex: "0 0 230px", display: "flex", minWidth: 0 }}>
              {renderLogPanel("📝 ROS GÖNDERİM / GERİ BİLDİRİM LOGU")}
            </div>
          </div>

          {/* RIGHT: Kayıtlı görevler */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minHeight: 0, overflow: "hidden" }}>
            <div style={{ ...cardS, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              <div style={{ ...lblS, display: "flex", justifyContent: "space-between" }}>
                <span>📋 KAYITLI GÖREVLER ({BED_LOCATIONS.length + customLocations.length})</span>
              </div>
              <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <div style={{ fontSize: "0.52rem", color: "#475569", fontWeight: 800, letterSpacing: "0.08em", marginTop: 2 }}>
                  HAZIR YATAK GÖREVLERİ
                </div>
                {BED_LOCATIONS.map((loc) => {
                  const isActive = activeTaskLabel === loc.name && taskState.state?.toUpperCase() === "RUNNING";
                  const previewImage = BED_PREVIEW_IMAGES[loc.id] || "";
                  return (
                    <div key={loc.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.5rem 0.6rem", background: isActive ? "rgba(16,185,129,0.12)" : "#071613", border: `1px solid ${isActive ? "#10b981" : "#064e3b"}`, borderRadius: "0.3rem" }}>
                      <button
                        type="button"
                        onClick={() => setSelectedPreview({ name: loc.name, src: previewImage })}
                        style={{ width: 66, flex: "0 0 66px", alignSelf: "stretch", borderRadius: "0.35rem", overflow: "hidden", border: `1px solid ${isActive ? "rgba(134,239,172,0.55)" : "rgba(110,231,183,0.24)"}`, background: "#03110d", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer" }}
                        title={`${loc.name} görselini büyüt`}
                      >
                        <img
                          src={previewImage}
                          alt={`${loc.name} önizleme`}
                          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.72rem", fontWeight: "800", color: isActive ? "#86efac" : "#d1fae5" }}>
                          {isActive && "▶ "}{loc.name}
                          <span style={{ fontSize: "0.45rem", fontWeight: "700", marginLeft: "0.35rem", padding: "0.05rem 0.25rem", borderRadius: "0.15rem", background: "#064e3b", color: "#6ee7b7" }}>GPS</span>
                        </div>
                        <div style={{ fontSize: "0.55rem", color: "#64748b" }}>
                          Lat:{Number(loc.lat).toFixed(6)} Lon:{Number(loc.lon).toFixed(6)}
                        </div>
                      </div>
                      <button onClick={() => handleQueueReadyTask(loc)} disabled={!isConnected} style={{ ...btnS("#065f46"), fontSize: "0.62rem", opacity: isConnected ? 1 : 0.4 }}>＋ Sıraya Ekle</button>
                    </div>
                  );
                })}
                <div style={{ fontSize: "0.52rem", color: "#475569", fontWeight: 800, letterSpacing: "0.08em", marginTop: 6 }}>
                  KULLANICI GÖREVLERİ
                </div>
                {customLocations.length === 0
                  ? <div style={{ fontSize: "0.6rem", color: "#1e293b", textAlign: "center", padding: "0.7rem" }}>Henüz özel görev eklenmedi.</div>
                  : customLocations.map((loc) => {
                    const isActive = activeTaskLabel === loc.name && taskState.state?.toUpperCase() === "RUNNING";
                    return (
                      <div key={loc.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.5rem 0.6rem", background: isActive ? "rgba(59,130,246,0.1)" : "#0a1020", border: `1px solid ${isActive ? "#3b82f6" : "#1e293b"}`, borderRadius: "0.3rem" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.72rem", fontWeight: "700", color: isActive ? "#93c5fd" : "#e2e8f0" }}>
                            {isActive && "▶ "}{loc.name}
                            <span style={{ fontSize: "0.45rem", fontWeight: "700", marginLeft: "0.35rem", padding: "0.05rem 0.25rem", borderRadius: "0.15rem", background: loc.mode === "gps" ? "#064e3b" : "#1e3a5f", color: loc.mode === "gps" ? "#6ee7b7" : "#93c5fd" }}>{loc.mode === "gps" ? "GPS" : "XY"}</span>
                          </div>
                          <div style={{ fontSize: "0.55rem", color: "#64748b" }}>
                            {loc.mode === "gps"
                              ? <>Lat:{Number(loc.lat).toFixed(6)} Lon:{Number(loc.lon).toFixed(6)} YAW:{optionalNumber(loc.yaw) ? loc.yaw : ""}</>
                              : <>X:{loc.x.toFixed(2)} Y:{loc.y.toFixed(2)} YAW:{rad2deg(loc.yaw)}°</>}
                          </div>
                        </div>
                        <button onClick={() => handleGoToLocation(loc)} disabled={!isConnected} style={{ ...btnS("#0f4c75"), fontSize: "0.62rem", opacity: isConnected ? 1 : 0.4 }}>▶ Git</button>
                        <button onClick={() => handleRemoveLocation(loc.id)} style={{ ...btnS("#7f1d1d"), fontSize: "0.62rem" }}>🗑</button>
                      </div>
                    );
                  })
                }
                <div style={{ fontSize: "0.52rem", color: "#475569", fontWeight: 800, letterSpacing: "0.08em", marginTop: 6 }}>
                  KAYITLI ROTALAR ({savedRoutes.length})
                </div>
                {savedRoutes.length === 0 ? (
                  <div style={{ fontSize: "0.6rem", color: "#1e293b", textAlign: "center", padding: "0.7rem" }}>
                    GPS Mission tarafından kaydedilmiş rota yok.
                  </div>
                ) : (
                  savedRoutes.map(route => (
                    <SavedGpsRouteCard
                      key={route.id}
                      route={route}
                      actionLabel="Bu Rotayı Yürüt"
                      onAction={handleOpenSavedRoute}
                      onDelete={handleDeleteSavedRoute}
                      onPreview={(selectedRoute) => setSelectedPreview({ name: selectedRoute.name, src: selectedRoute.previewImage })}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {selectedPreview && (
        <div
          onClick={() => setSelectedPreview(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.82)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", zIndex: 1000 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(92vw, 820px)", maxHeight: "88vh", background: "#08111f", border: "1px solid #1e3a5f", borderRadius: "1rem", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.45)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.9rem 1rem", borderBottom: "1px solid rgba(148,163,184,0.18)" }}>
              <div style={{ color: "#e2e8f0", fontWeight: 800, fontSize: "0.95rem" }}>{selectedPreview.name}</div>
              <button onClick={() => setSelectedPreview(null)} style={{ ...btnS("#162032", "1px solid #334155"), fontSize: "0.7rem" }}>Kapat</button>
            </div>
            <div style={{ padding: "1rem", background: "#020817" }}>
              <img
                src={selectedPreview.src}
                alt={`${selectedPreview.name} büyük önizleme`}
                style={{ display: "block", width: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: "0.75rem", border: "1px solid rgba(148,163,184,0.16)" }}
              />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        input:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 1px #3b82f633; }
        button:hover:not(:disabled) { filter: brightness(1.2); }
        button:active:not(:disabled) { transform: scale(0.97); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a1020; }
        ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 4px; }
      `}</style>
    </div>
  );
}
