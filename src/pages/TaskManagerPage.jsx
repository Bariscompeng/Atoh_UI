import React, { useEffect, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

// ── Helpers ──────────────────────────────────────────────────────────────────
const rad2deg = (r) => ((r * 180) / Math.PI).toFixed(1);
const quatToYaw = (q) =>
  Math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z));
const yawToQuat = (yaw) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });
const prettyErr = (e) => (e?.message || String(e)).slice(0, 120);
const ts = () => ({ sec: Math.floor(Date.now() / 1000), nanosec: (Date.now() % 1000) * 1e6 });

// ── Mode definitions ─────────────────────────────────────────────────────────
const MODE_LABELS = {
  manual:     { label: "MANUEL",  color: "#f59e0b", icon: "🔧", desc: "Operatör kontrol" },
  autonomous: { label: "OTONOM",  color: "#10b981", icon: "🤖", desc: "Otonom navigasyon" },
  task:       { label: "GÖREV",   color: "#3b82f6", icon: "📋", desc: "Görev yöneticisi aktif" },
};

// ── Mode → Allowed cmd_vel sources ───────────────────────────────────────────
// FIX: Otonom modda joystick İZİNLİ → acil müdahale için operatör her zaman override edebilir
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
const cardS = {
  background: "#0d1829", borderRadius: "0.5rem",
  padding: "0.75rem", border: "1px solid #162032",
};
const lblS = {
  fontSize: "0.6rem", fontWeight: "800",
  letterSpacing: "0.12em", color: "#475569", marginBottom: "0.4rem",
};
const valS = {
  fontSize: "0.85rem", fontWeight: "700", color: "#e2e8f0",
  fontFamily: "'JetBrains Mono','Fira Code',monospace",
};
const btnS = (bg, border) => ({
  padding: "0.45rem 0.75rem", background: bg || "#162032",
  border: border || "1px solid #1e3a5f", borderRadius: "0.35rem",
  color: "white", cursor: "pointer", fontSize: "0.65rem",
  fontWeight: "700", fontFamily: "inherit", transition: "all 0.2s",
});
const pillS = (active, color) => ({
  padding: "0.5rem 0.8rem",
  background: active ? `${color}18` : "#0a1020",
  border: `2px solid ${active ? color : "#1e293b"}`,
  borderRadius: "0.5rem", color: active ? color : "#475569",
  cursor: "pointer", fontSize: "0.7rem",
  fontWeight: active ? "800" : "600", fontFamily: "inherit",
  transition: "all 0.25s", display: "flex", alignItems: "center",
  gap: "0.4rem", flex: 1, justifyContent: "center",
});
const inputS = {
  width: "100%", padding: "0.4rem", background: "#0a1020",
  border: "1px solid #1e3a5f", borderRadius: "0.25rem",
  color: "#e2e8f0", fontSize: "0.75rem", fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

// ─────────────────────────────────────────────────────────────────────────────
export default function TaskManagerPage() {
  // operationMode artık ROSContext'te → sayfa değişse bile kalıcı
  const { ros, isConnected, reconnect, operationMode, setOperationMode } = useROS();

  // ── State ──────────────────────────────────────────────────────────────────
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [recoveryRaw, setRecoveryRaw] = useState(null);

  const [robotPose, setRobotPose]   = useState(null);
  const [poseSource, setPoseSource] = useState("");

  const [goalPose, setGoalPose] = useState(null);
  const [goalX, setGoalX]       = useState("");
  const [goalY, setGoalY]       = useState("");
  const [goalYaw, setGoalYaw]   = useState("0");

  const [taskState, setTaskState]       = useState({ name: "", state: "IDLE", observers: [] });
  const [taskRegistry, setTaskRegistry] = useState({ packs: [], tasks: [], observers: [] });

  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);

  const [coverageStatus, setCoverageStatus] = useState(null);
  const [customCmd, setCustomCmd] = useState("");
  const [taskDistance, setTaskDistance] = useState("100");
  const [muxActiveSource, setMuxActiveSource] = useState("(none)");

  // Refs
  const recoverySubRef = useRef(null);
  const amclSubRef = useRef(null);
  const odomSubRef = useRef(null);
  const tfSubRef = useRef(null);
  // TF transform cache: map→odom ve odom→base_link
  const tfCache = useRef({ mapToOdom: null, odomToBase: null });
  const stateSubRef = useRef(null);
  const statusSubRef = useRef(null);
  const registrySubRef = useRef(null);
  const goalSubRef = useRef(null);
  const coverageSubRef = useRef(null);
  const muxLogSubRef = useRef(null);

  // ── Log helper ─────────────────────────────────────────────────────────────
  const addLog = useCallback((type, msg) => {
    const time = new Date().toLocaleTimeString("tr-TR");
    setLogs((prev) => [...prev.slice(-80), { id: Date.now() + Math.random(), time, type, msg }]);
  }, []);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  // ──────────────────────────────────────────────────────────────────────────
  // SUBSCRIPTIONS
  // ──────────────────────────────────────────────────────────────────────────

  // ── /tcs/recovery ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (recoverySubRef.current) { try { recoverySubRef.current.unsubscribe(); } catch {} }

    const subscribeWith = (msgType) => {
      const topic = new ROSLIB.Topic({ ros, name: "/tcs/recovery", messageType: msgType, throttle_rate: 500, queue_length: 1 });
      topic.subscribe((msg) => {
        let val = null;
        if (msg.data !== undefined) {
          val = typeof msg.data === "boolean" ? (msg.data ? 1 : 0)
              : typeof msg.data === "string"  ? parseInt(msg.data, 10)
              : Number(msg.data);
        }
        if (val !== null && !isNaN(val)) {
          setRecoveryRaw(val);
          setRecoveryActive(val === 1);
        }
      });
      recoverySubRef.current = topic;
      addLog("info", `📡 /tcs/recovery (${msgType})`);
    };

    ros.getTopicType("/tcs/recovery",
      (type) => subscribeWith(type || "std_msgs/msg/Int32"),
      ()     => subscribeWith("std_msgs/msg/Int32")
    );
    return () => { if (recoverySubRef.current) { try { recoverySubRef.current.unsubscribe(); } catch {} } };
  }, [ros, isConnected]);

  // ── Robot Pose (TF chain: map→odom→base_link, AMCL fallback) ─────────────
  // Coverage sayfasıyla aynı yöntem: /tf topic'inden transform zinciri hesapla
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (amclSubRef.current) { try { amclSubRef.current.unsubscribe(); } catch {} }
    if (tfSubRef.current)   { try { tfSubRef.current.unsubscribe(); } catch {} }
    if (odomSubRef.current) { try { odomSubRef.current.unsubscribe(); } catch {} }

    let lastAmclTime = 0;
    let lastTfTime = 0;
    tfCache.current = { mapToOdom: null, odomToBase: null };

    // TF transform zinciri: map→base_link = map→odom ⊗ odom→base_link
    const chainTF = () => {
      const { mapToOdom, odomToBase } = tfCache.current;
      if (!mapToOdom || !odomToBase) return;

      // 2D transform composition:
      // T_map_base = T_map_odom * T_odom_base
      const c1 = Math.cos(mapToOdom.yaw), s1 = Math.sin(mapToOdom.yaw);
      const x = mapToOdom.x + odomToBase.x * c1 - odomToBase.y * s1;
      const y = mapToOdom.y + odomToBase.x * s1 + odomToBase.y * c1;
      const yaw = mapToOdom.yaw + odomToBase.yaw;

      lastTfTime = Date.now();
      // AMCL son 2sn içinde geldiyse TF'yi ezme
      if (Date.now() - lastAmclTime < 2000) return;

      setRobotPose({ x, y, yaw });
      setPoseSource("TF");
    };

    // 1) /tf subscribe → map→odom ve odom→base_link transform'larını yakala
    const tfTopic = new ROSLIB.Topic({
      ros, name: "/tf",
      messageType: "tf2_msgs/msg/TFMessage",
      throttle_rate: 100, queue_length: 5,
    });
    tfTopic.subscribe((msg) => {
      if (!msg.transforms) return;
      for (const t of msg.transforms) {
        const parent = (t.header?.frame_id || "").replace(/^\//, "");
        const child  = (t.child_frame_id || "").replace(/^\//, "");
        const pos = t.transform?.translation;
        const rot = t.transform?.rotation;
        if (!pos || !rot) continue;

        const yaw = quatToYaw(rot);

        if (parent === "map" && child === "odom") {
          tfCache.current.mapToOdom = { x: pos.x, y: pos.y, yaw };
          chainTF();
        } else if (parent === "odom" && child === "base_link") {
          tfCache.current.odomToBase = { x: pos.x, y: pos.y, yaw };
          chainTF();
        }
      }
    });
    tfSubRef.current = tfTopic;

    // 2) /amcl_pose → en yüksek öncelik
    const amcl = new ROSLIB.Topic({
      ros, name: "/amcl_pose",
      messageType: "geometry_msgs/msg/PoseWithCovarianceStamped",
      throttle_rate: 200, queue_length: 1,
    });
    amcl.subscribe((msg) => {
      lastAmclTime = Date.now();
      const p = msg.pose.pose;
      setRobotPose({ x: p.position.x, y: p.position.y, yaw: quatToYaw(p.orientation) });
      setPoseSource("AMCL");
    });
    amclSubRef.current = amcl;

    // 3) /odom → en düşük öncelik (sadece TF ve AMCL yoksa)
    const odom = new ROSLIB.Topic({
      ros, name: "/odom",
      messageType: "nav_msgs/msg/Odometry",
      throttle_rate: 200, queue_length: 1,
    });
    odom.subscribe((msg) => {
      // AMCL veya TF son 2sn içinde geldiyse odom'u kullanma
      if (Date.now() - lastAmclTime < 2000) return;
      if (Date.now() - lastTfTime < 2000) return;
      const p = msg.pose.pose;
      setRobotPose({ x: p.position.x, y: p.position.y, yaw: quatToYaw(p.orientation) });
      setPoseSource("ODOM");
    });
    odomSubRef.current = odom;

    return () => {
      try { amcl.unsubscribe(); } catch {}
      try { tfTopic.unsubscribe(); } catch {}
      try { odom.unsubscribe(); } catch {}
    };
  }, [ros, isConnected]);

  // ── /goal_pose ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (goalSubRef.current) { try { goalSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", throttle_rate: 200, queue_length: 1 });
    topic.subscribe((msg) => {
      const p = msg.pose;
      setGoalPose({ x: p.position.x, y: p.position.y, yaw: quatToYaw(p.orientation) });
    });
    goalSubRef.current = topic;
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
        setTaskState({
          name: j.active_task?.name || "",
          state: j.active_task?.state || "IDLE",
          observers: j.active_observers || [],
        });
      } catch {}
    });
    stateSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /task_manager/status ───────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (statusSubRef.current) { try { statusSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/task_manager/status", messageType: "std_msgs/msg/String", throttle_rate: 100, queue_length: 10 });
    topic.subscribe((msg) => {
      try {
        const j = JSON.parse(msg.data);

        if (j.message !== undefined) {
          if (!j.message.includes("heartbeat")) {
            addLog((j.level || "info").toLowerCase(), j.message);
          }
          return;
        }

        if (j.type !== undefined && j.payload !== undefined) {
          const level = (j.level || "info").toLowerCase();
          if (["tasks", "observers", "packs"].includes(j.type)) {
            try {
              const data = typeof j.payload === "string" ? JSON.parse(j.payload) : j.payload;
              const items = data[j.type] || [];
              addLog(level, `${j.type}: [${items.join(", ")}]`);
            } catch {
              addLog(level, `${j.type}: ${typeof j.payload === "string" ? j.payload : JSON.stringify(j.payload)}`);
            }
            return;
          }
          const payloadStr = typeof j.payload === "string" ? j.payload : JSON.stringify(j.payload);
          if (!payloadStr.includes("heartbeat")) addLog(level, payloadStr);
        }
      } catch {}
    });
    statusSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /task_manager/registry ─────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (registrySubRef.current) { try { registrySubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/task_manager/registry", messageType: "std_msgs/msg/String", queue_length: 1 });
    topic.subscribe((msg) => {
      try {
        const j = JSON.parse(msg.data);
        setTaskRegistry({ packs: j.packs || [], tasks: j.tasks || [], observers: j.observers || [] });
        addLog("info", `Registry: ${(j.tasks || []).length} görev, ${(j.observers || []).length} observer`);
      } catch {}
    });
    registrySubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /coverage/path ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (coverageSubRef.current) { try { coverageSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/coverage/path", messageType: "nav_msgs/msg/Path", throttle_rate: 2000, queue_length: 1 });
    topic.subscribe((msg) => {
      setCoverageStatus({ waypointCount: msg.poses?.length || 0, frameId: msg.header?.frame_id || "map", lastUpdate: new Date().toLocaleTimeString("tr-TR") });
    });
    coverageSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ── /log/text (cmd_vel_mux aktif kaynak takibi) ────────────────────────────
  useEffect(() => {
    if (!ros || !isConnected) return;
    if (muxLogSubRef.current) { try { muxLogSubRef.current.unsubscribe(); } catch {} }
    const topic = new ROSLIB.Topic({ ros, name: "/log/text", messageType: "std_msgs/msg/String", throttle_rate: 200, queue_length: 5 });
    topic.subscribe((msg) => {
      const txt = msg.data || "";
      const bestMatch = txt.match(/best_source=(\S+)/);
      if (bestMatch) setMuxActiveSource(bestMatch[1]);
      const modeMatch = txt.match(/mode_changed:\s*\S+\s*->\s*(\S+)/);
      if (modeMatch) addLog("info", `🔄 MUX mod: ${modeMatch[1]}`);
    });
    muxLogSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [ros, isConnected]);

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLISHERS
  // ──────────────────────────────────────────────────────────────────────────

  const sendRunCmd = useCallback((cmdStr) => {
    if (!ros || !isConnected) { addLog("error", "ROS bağlı değil!"); return; }
    try {
      const topic = new ROSLIB.Topic({ ros, name: "/task_manager/run_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
      topic.publish({ data: cmdStr });
      addLog("info", `📤 Komut: ${cmdStr}`);
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (err) { addLog("error", `Gönderim hatası: ${prettyErr(err)}`); }
  }, [ros, isConnected, addLog]);

  const sendGoalPose = useCallback((x, y, yawRad) => {
    if (!ros || !isConnected) { addLog("error", "ROS bağlı değil!"); return; }
    try {
      const topic = new ROSLIB.Topic({ ros, name: "/goal_pose", messageType: "geometry_msgs/msg/PoseStamped", queue_size: 1 });
      topic.publish({ header: { frame_id: "map", stamp: ts() }, pose: { position: { x, y, z: 0.0 }, orientation: yawToQuat(yawRad) } });
      setGoalPose({ x, y, yaw: yawRad });
      addLog("info", `📍 Nav2 Goal → (${x.toFixed(2)}, ${y.toFixed(2)}) θ:${rad2deg(yawRad)}°`);
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (err) { addLog("error", `Goal Pose hatası: ${prettyErr(err)}`); }
  }, [ros, isConnected, addLog]);

  // publishMode → ROSContext.setOperationMode kullanır (context /mod publish eder)
  // NOT: Görevler C++ backend'de çalışır → sayfa değişse bile devam eder
  const publishMode = useCallback((mode) => {
    setOperationMode(mode); // context üzerinden /mod publish + state güncelle
    addLog("info", `🔄 Mod: ${mode.toUpperCase()}`);

    // Manuel moda geçişte aktif otonom görevi durdur
    if (mode === "manual" && taskState.name) {
      sendRunCmd(`stop ${taskState.name}`);
      addLog("warn", "Manuel Mod: Aktif otonom görev durduruldu.");
    }
  }, [setOperationMode, addLog, taskState.name, sendRunCmd]);

  // ──────────────────────────────────────────────────────────────────────────
  // ACTION HANDLERS
  // ──────────────────────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    if (taskState.name) {
      sendRunCmd(`stop ${taskState.name}`);
    } else {
      addLog("warn", "Durdurulacak aktif görev yok!");
    }
  }, [taskState.name, sendRunCmd, addLog]);

  const handleDistanceTask = useCallback((distStr) => {
    const dist = parseFloat(distStr);
    if (isNaN(dist) || dist <= 0) { addLog("error", "Geçerli mesafe girin!"); return; }
    if (!robotPose) { addLog("error", "Robot pozisyonu henüz alınamadı!"); return; }
    const targetX = robotPose.x + dist * Math.cos(robotPose.yaw);
    const targetY = robotPose.y + dist * Math.sin(robotPose.yaw);
    sendGoalPose(targetX, targetY, robotPose.yaw);
    addLog("info", `🎯 ${dist}m ileri → (${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
  }, [robotPose, sendGoalPose, addLog]);

  const handleManualGoal = useCallback(() => {
    const x = parseFloat(goalX), y = parseFloat(goalY);
    const yaw = (parseFloat(goalYaw) || 0) * (Math.PI / 180);
    if (isNaN(x) || isNaN(y)) { addLog("error", "Geçerli X ve Y girin!"); return; }
    sendGoalPose(x, y, yaw);
  }, [goalX, goalY, goalYaw, sendGoalPose, addLog]);

  const handleCustomCmd = useCallback(() => {
    if (!customCmd.trim()) return;
    sendRunCmd(customCmd.trim());
    setCustomCmd("");
  }, [customCmd, sendRunCmd]);

  // ── Color helpers ──────────────────────────────────────────────────────────
  const stateColor = (s) => {
    switch ((s || "").toUpperCase()) {
      case "RUNNING": return "#3b82f6"; case "IDLE": return "#475569";
      case "DONE": case "SUCCESS": return "#10b981";
      case "ERROR": case "FAILED": return "#ef4444"; default: return "#f59e0b";
    }
  };
  const logColor = (t) => {
    switch (t) { case "error": return "#f87171"; case "warn": return "#fbbf24"; case "info": return "#60a5fa"; default: return "#94a3b8"; }
  };
  const recoveryColor = recoveryActive ? "#ef4444" : "#10b981";

  // Güvenli mod erişimi (undefined koruması)
  const currentMode = operationMode || "manual";

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "calc(100vh - 56px)", width: "100vw", background: "#060d1a", color: "white", padding: "0.5rem", fontFamily: "'JetBrains Mono','Fira Code','Segoe UI',monospace", overflow: "hidden", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "0.4rem" }}>

      {/* ═══ HEADER ═══ */}
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
            {recoveryRaw !== null && <span style={{ fontSize: "0.5rem", color: "#475569" }}>({recoveryRaw})</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: "#0f1e35", borderRadius: "0.4rem", padding: "0.3rem 0.6rem", border: "1px solid #1e3a5f" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isConnected ? "#10b981" : "#ef4444", boxShadow: `0 0 8px ${isConnected ? "#10b981" : "#ef4444"}` }} />
            <span style={{ fontSize: "0.6rem", fontWeight: "600", color: isConnected ? "#10b981" : "#ef4444" }}>{isConnected ? "ROS BAĞLI" : "BAĞLI DEĞİL"}</span>
          </div>
          {!isConnected && <button onClick={reconnect} style={btnS("#2563eb")}>⟳ Bağlan</button>}
        </div>
      </div>

      {/* ═══ MAIN GRID ═══ */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr 280px", gap: "0.4rem", minHeight: 0 }}>

        {/* ═══ LEFT ═══ */}
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
              <span style={{ ...valS, color: stateColor(taskState.state) }}>{taskState.state || "IDLE"}</span>
            </div>
            {taskState.name && <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Görev: <span style={{ color: "#e2e8f0", fontWeight: "700" }}>{taskState.name}</span></div>}
            {taskState.observers.length > 0 && <div style={{ fontSize: "0.55rem", color: "#334155" }}>Observers: {taskState.observers.join(", ")}</div>}
          </div>

          {/* QUICK TASKS */}
          <div style={{ ...cardS, flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
            <div style={lblS}>HIZLI GÖREVLER</div>
            <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.4rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.6rem", color: "#64748b" }}>Mesafe:</span>
              <input value={taskDistance} onChange={(e) => setTaskDistance(e.target.value)} style={{ ...inputS, flex: 1, padding: "0.3rem 0.4rem", fontSize: "0.7rem" }} />
              <span style={{ fontSize: "0.55rem", color: "#475569" }}>m</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {[
                { label: `${taskDistance || "?"}m İleri`, icon: "🚀", action: () => handleDistanceTask(taskDistance) },
                { label: "50m İleri",  icon: "📏", action: () => handleDistanceTask("50") },
                { label: "10m İleri",  icon: "📐", action: () => handleDistanceTask("10") },
                { label: "Başlangıca", icon: "🏠", action: () => sendRunCmd("run GoHome") },
              ].map((t, i) => (
                <button key={i} onClick={t.action} disabled={!isConnected} style={{ ...btnS("#162032"), padding: "0.5rem 0.6rem", textAlign: "left", display: "flex", alignItems: "center", gap: "0.4rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.68rem" }}>
                  <span style={{ fontSize: "0.9rem" }}>{t.icon}</span><span>{t.label}</span>
                </button>
              ))}
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
              <div style={{ fontSize: "0.48rem", color: "#1e293b", marginTop: "0.2rem", lineHeight: "1.6" }}>
                Komutlar: list | run TaskName | run TaskName {"{json}"} | stop TaskName
              </div>
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
                      <button key={i} onClick={() => sendRunCmd(`run ${t.name}`)} disabled={!isConnected}
                        style={{ ...btnS("#0d1829", "1px solid #1e293b"), padding: "0.35rem 0.5rem", fontSize: "0.6rem", textAlign: "left", opacity: isConnected ? 1 : 0.4 }}>
                        ▸ {t.name} <span style={{ color: "#334155", fontSize: "0.5rem" }}>({t.class})</span>
                      </button>
                    ))}
                  </div>
              }
            </div>
          </div>
        </div>

        {/* ═══ CENTER ═══ */}
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
              <div style={lblS}>📍 HEDEF (NAV2)</div>
              {goalPose ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                  {[["X", goalPose.x.toFixed(3)], ["Y", goalPose.y.toFixed(3)], ["YAW", `${rad2deg(goalPose.yaw)}°`]].map(([l, v]) => (
                    <div key={l}><div style={{ fontSize: "0.5rem", color: "#475569" }}>{l}</div><div style={{ ...valS, color: "#a78bfa" }}>{v}</div></div>
                  ))}
                </div>
              ) : <div style={{ fontSize: "0.65rem", color: "#334155" }}>Hedef belirlenmedi</div>}
            </div>
          </div>

          {/* Distance info */}
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

          {/* Manual goal */}
          <div style={{ ...cardS, flexShrink: 0 }}>
            <div style={lblS}>📌 MANUEL HEDEF → /goal_pose</div>
            <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              {[["X (m)", goalX, setGoalX], ["Y (m)", goalY, setGoalY], ["YAW (°)", goalYaw, setGoalYaw]].map(([l, v, s]) => (
                <div key={l} style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.5rem", color: "#475569", marginBottom: "0.15rem" }}>{l}</div>
                  <input value={v} onChange={(e) => s(e.target.value)} placeholder="0.0" style={inputS} />
                </div>
              ))}
              <button onClick={handleManualGoal} disabled={!isConnected} style={{ ...btnS("#7c3aed"), padding: "0.4rem 0.75rem", marginTop: "0.85rem", opacity: isConnected ? 1 : 0.4, fontSize: "0.75rem" }}>🎯</button>
            </div>
            {robotPose && (
              <button onClick={() => { setGoalX(robotPose.x.toFixed(3)); setGoalY(robotPose.y.toFixed(3)); setGoalYaw(rad2deg(robotPose.yaw)); }}
                style={{ ...btnS("transparent", "1px solid #1e293b"), marginTop: "0.3rem", fontSize: "0.55rem", color: "#475569" }}>
                📋 Mevcut pozisyonu kopyala
              </button>
            )}
          </div>

          {/* Logs */}
          <div style={{ ...cardS, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div style={{ ...lblS, display: "flex", justifyContent: "space-between" }}>
              <span>📝 DURUM KAYITLARI</span>
              <button onClick={() => setLogs([])} style={{ ...btnS("transparent", "none"), padding: "0.1rem 0.3rem", fontSize: "0.5rem", color: "#334155" }}>Temizle</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", fontSize: "0.6rem", lineHeight: "1.7" }}>
              {logs.length === 0 && <div style={{ color: "#1e293b", padding: "1rem", textAlign: "center" }}>Henüz kayıt yok…</div>}
              {logs.map((l) => <div key={l.id} style={{ color: logColor(l.type) }}><span style={{ color: "#334155" }}>[{l.time}]</span> {l.msg}</div>)}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* ═══ RIGHT ═══ */}
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
            <div style={lblS}>🔀 CMD_VEL MUX → Kaynak Durumu</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              {ALL_SOURCES.map((src) => {
                const modeInfo = MODE_SOURCES[currentMode] || MODE_SOURCES.manual;
                const isAllowed = modeInfo.allowed.includes(src.name);
                const isActive = muxActiveSource === src.name;
                return (
                  <div key={src.name} style={{
                    display: "flex", alignItems: "center", gap: "0.4rem",
                    padding: "0.3rem 0.4rem", borderRadius: "0.25rem",
                    background: isActive ? "rgba(59,130,246,0.12)" : isAllowed ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
                    border: `1px solid ${isActive ? "#3b82f6" : isAllowed ? "#064e3b" : "#7f1d1d44"}`,
                    opacity: isAllowed ? 1 : 0.5,
                  }}>
                    <span style={{ fontSize: "0.75rem", width: "18px", textAlign: "center" }}>{src.icon}</span>
                    <span style={{ flex: 1, fontSize: "0.58rem", fontWeight: isActive ? "800" : "600", color: isActive ? "#60a5fa" : isAllowed ? "#94a3b8" : "#475569" }}>
                      {src.label}
                    </span>
                    <span style={{ fontSize: "0.5rem", color: "#334155" }}>P:{src.prio}</span>
                    <span style={{
                      fontSize: "0.5rem", fontWeight: "700", padding: "0.1rem 0.25rem",
                      borderRadius: "0.15rem",
                      background: isActive ? "#1d4ed8" : isAllowed ? "#064e3b" : "#7f1d1d",
                      color: isActive ? "#93c5fd" : isAllowed ? "#6ee7b7" : "#fca5a5",
                    }}>
                      {isActive ? "AKTİF" : isAllowed ? "İZİNLİ" : "ENGELLİ"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: "0.48rem", color: "#1e293b", marginTop: "0.3rem", textAlign: "center" }}>
              Mod: {(MODE_LABELS[currentMode]?.label || currentMode)} → çıkış: /cmd_vel_serial
            </div>
          </div>

          {/* Compass */}
          <div style={{ ...cardS, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={lblS}>🧭 YÖN</div>
            <svg width="110" height="110" viewBox="-55 -55 110 110">
              <circle cx="0" cy="0" r="50" fill="none" stroke="#1e3a5f" strokeWidth="2"/>
              <circle cx="0" cy="0" r="48" fill="#0a1020"/>
              {/* Yön etiketleri — ROS konvansiyonu: 0°=Doğu, 90°=Kuzey */}
              {[["N",0],["E",90],["S",180],["W",270]].map(([l,a]) => {
                const r=((a-90)*Math.PI)/180;
                return <text key={l} x={42*Math.cos(r)} y={42*Math.sin(r)+3} fill="#475569" fontSize="8" fontWeight="700" textAnchor="middle">{l}</text>;
              })}
              {/* Çizgi işaretleri */}
              {Array.from({length:36},(_,i) => {
                const a=(i*10-90)*(Math.PI/180);
                return <line key={i} x1={(i%9===0?33:36)*Math.cos(a)} y1={(i%9===0?33:36)*Math.sin(a)} x2={38*Math.cos(a)} y2={38*Math.sin(a)} stroke={i%9===0?"#475569":"#1e293b"} strokeWidth={i%9===0?1.5:0.5}/>;
              })}
              {/* Robot yön oku — ROS: yaw=0 → doğu (saat yönünün tersi pozitif) */}
              {robotPose && (() => {
                const deg = -(robotPose.yaw * 180) / Math.PI + 90;
                return (
                  <g transform={`rotate(${deg})`}>
                    <polygon points="0,-30 -7,10 0,4 7,10" fill="#3b82f6" opacity="0.9"/>
                    <polygon points="0,-30 -3,2 3,2" fill="#60a5fa"/>
                  </g>
                );
              })()}
              {/* Hedef yön noktası */}
              {robotPose && goalPose && (() => {
                const bearing = Math.atan2(goalPose.y - robotPose.y, goalPose.x - robotPose.x);
                const deg = -(bearing * 180) / Math.PI + 90;
                return (
                  <g transform={`rotate(${deg})`}>
                    <circle cx="0" cy="-38" r="5" fill="#a78bfa" opacity="0.85"/>
                    <circle cx="0" cy="-38" r="2.5" fill="#c4b5fd"/>
                  </g>
                );
              })()}
              <circle cx="0" cy="0" r="3" fill="#1e293b"/>
              <circle cx="0" cy="0" r="1.5" fill="#334155"/>
            </svg>
            <div style={{ fontSize: "0.55rem", color: "#334155", marginTop: "0.2rem", display: "flex", gap: "0.5rem" }}>
              <span><span style={{ color: "#3b82f6" }}>▲</span> Araç {robotPose ? `(${rad2deg(robotPose.yaw)}°)` : ""}</span>
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
