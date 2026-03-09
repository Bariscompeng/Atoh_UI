import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

const LS_KEY = "human_snapshots_settings_v1";
const LS_PID_KEY = "human_follow_pid_settings_v1";
const MAX_LOGS = 120;

function uint8ToBase64(u8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeCompressedData(data) {
  if (typeof data === "string") {
    const bytes = Math.floor((data.length * 3) / 4);
    return { b64: data, bytes };
  }
  if (Array.isArray(data)) {
    const u8 = new Uint8Array(data);
    return { b64: uint8ToBase64(u8), bytes: u8.length };
  }
  if (data instanceof Uint8Array) {
    return { b64: uint8ToBase64(data), bytes: data.length };
  }
  if (data && data.buffer && typeof data.byteLength === "number") {
    try {
      const u8 = new Uint8Array(data.buffer);
      return { b64: uint8ToBase64(u8), bytes: u8.length };
    } catch {}
  }
  if (data && typeof data === "object") {
    if (typeof data.length === "number" && data.length > 0) {
      try {
        const u8 = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) u8[i] = data[i] ?? 0;
        return { b64: uint8ToBase64(u8), bytes: u8.length };
      } catch {}
    }
    const keys = Object.keys(data);
    const nums = keys.map((k) => Number(k)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (nums.length > 0) {
      const u8 = new Uint8Array(nums.length);
      for (let i = 0; i < nums.length; i++) u8[i] = data[String(nums[i])] ?? 0;
      return { b64: uint8ToBase64(u8), bytes: u8.length };
    }
  }
  return { b64: null, bytes: 0 };
}

function loadSettings() {
  try { const raw = localStorage.getItem(LS_KEY); if (!raw) return null; return JSON.parse(raw); } catch { return null; }
}
function saveSettings(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {} }
function loadPIDSettings() {
  try { const raw = localStorage.getItem(LS_PID_KEY); if (!raw) return null; return JSON.parse(raw); } catch { return null; }
}
function savePIDSettings(s) { try { localStorage.setItem(LS_PID_KEY, JSON.stringify(s)); } catch {} }

function formatTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}.${String(now.getMilliseconds()).padStart(3,"0")}`;
}

function classifyMotion(linear, angular) {
  const moving = Math.abs(linear) > 0.001 || Math.abs(angular) > 0.001;
  if (!moving) return { label: "BEKLE", color: "#64748b", icon: "⏸" };
  if (Math.abs(linear) > 0.001 && Math.abs(angular) < 0.05) return { label: "İLERİ", color: "#10b981", icon: "↑" };
  if (Math.abs(linear) < 0.001 && angular > 0.05) return { label: "SOL DÖN", color: "#60a5fa", icon: "↺" };
  if (Math.abs(linear) < 0.001 && angular < -0.05) return { label: "SAĞ DÖN", color: "#f472b6", icon: "↻" };
  if (linear > 0 && angular > 0.05) return { label: "SOL+İLERİ", color: "#34d399", icon: "↖" };
  if (linear > 0 && angular < -0.05) return { label: "SAĞ+İLERİ", color: "#a78bfa", icon: "↗" };
  return { label: "HAREKET", color: "#fbbf24", icon: "⬡" };
}

// ─── Gelişmiş PID Slider Bileşeni ─────────────────────────────────────────────
function PIDSlider({ label, value, onChange, min, max, step, unit = "", accent = "#10b981" }) {
  const numMin = parseFloat(min);
  const numMax = parseFloat(max);
  const numStep = parseFloat(step);
  const pct = ((value - numMin) / (numMax - numMin)) * 100;

  const clamp = (v) => Math.min(numMax, Math.max(numMin, v));
  const round = (v) => Math.round(v / numStep) * numStep;

  const handleStep = (dir) => {
    const next = clamp(round(parseFloat(value) + dir * numStep));
    onChange({ target: { value: String(next) } });
  };

  const handleInput = (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) onChange({ target: { value: String(clamp(v)) } });
  };

  return (
    <div style={{ marginBottom: "0.875rem" }}>
      {/* Label row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.7rem", fontWeight: "600", color: "#94a3b8", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {/* Stepper buttons */}
          <button
            onClick={() => handleStep(-1)}
            style={{ width: "20px", height: "20px", borderRadius: "4px", background: "#1e293b", border: `1px solid #334155`, color: "#64748b", cursor: "pointer", fontSize: "0.8rem", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", userSelect: "none" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}
          >−</button>
          {/* Direct number input */}
          <input
            type="number"
            value={parseFloat(value).toFixed(step.toString().includes('.') ? step.toString().split('.')[1].length : 0)}
            onChange={handleInput}
            step={step}
            min={min}
            max={max}
            style={{
              width: "64px", padding: "0.15rem 0.35rem", background: "#0f172a",
              border: `1px solid #334155`, borderRadius: "4px",
              color: accent, fontSize: "0.72rem", fontWeight: "700",
              fontFamily: "'Courier New', monospace", textAlign: "center",
              outline: "none", transition: "border-color 0.15s",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = accent; }}
            onBlur={e => { e.currentTarget.style.borderColor = "#334155"; }}
          />
          <button
            onClick={() => handleStep(1)}
            style={{ width: "20px", height: "20px", borderRadius: "4px", background: "#1e293b", border: `1px solid #334155`, color: "#64748b", cursor: "pointer", fontSize: "0.8rem", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", userSelect: "none" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}
          >+</button>
          {unit && <span style={{ fontSize: "0.6rem", color: "#475569", minWidth: "18px" }}>{unit}</span>}
        </div>
      </div>

      {/* Track + Thumb */}
      <div style={{ position: "relative", height: "22px", display: "flex", alignItems: "center" }}>
        {/* Background track */}
        <div style={{ position: "absolute", left: 0, right: 0, height: "4px", borderRadius: "2px", background: "#1e293b" }} />
        {/* Filled portion */}
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "4px", borderRadius: "2px", background: `linear-gradient(90deg, ${accent}88, ${accent})`, transition: "width 0.1s" }} />
        {/* Range input (invisible but functional) */}
        <input
          type="range" value={value} onChange={onChange}
          min={min} max={max} step={step}
          style={{
            position: "absolute", left: 0, right: 0, width: "100%",
            opacity: 0, cursor: "pointer", height: "22px", margin: 0,
            WebkitAppearance: "none", appearance: "none",
          }}
        />
        {/* Visual thumb */}
        <div style={{
          position: "absolute", left: `calc(${pct}% - 8px)`,
          width: "16px", height: "16px", borderRadius: "50%",
          background: accent, border: "2px solid #0f172a",
          boxShadow: `0 0 6px ${accent}88`,
          pointerEvents: "none", transition: "left 0.05s",
        }} />
      </div>

      {/* Min / Max labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.2rem" }}>
        <span style={{ fontSize: "0.58rem", color: "#334155" }}>{numMin}</span>
        <span style={{ fontSize: "0.58rem", color: "#334155" }}>{numMax}</span>
      </div>
    </div>
  );
}

// ─── Ayar Grubu Kartı ──────────────────────────────────────────────────────────
function SettingGroup({ title, icon, accent, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background: "#0a1628", borderRadius: "0.5rem", border: `1px solid ${accent}33`, overflow: "hidden", marginBottom: "0.75rem" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.75rem", background: "transparent", border: "none", cursor: "pointer", color: "white" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: accent, boxShadow: `0 0 6px ${accent}` }} />
          <span style={{ fontSize: "0.72rem", fontWeight: "800", color: accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>{icon} {title}</span>
        </div>
        <span style={{ fontSize: "0.7rem", color: "#475569", transition: "transform 0.2s", display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: "0.25rem 0.75rem 0.75rem" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Ana Bileşen ───────────────────────────────────────────────────────────────
export default function HumanSnapshots() {
  const { ros, isConnected, status: globalStatus, errorText: globalErrorText } = useROS();

  const defaults = useMemo(() => ({
    imageTopic: "/human_debug_snapshot/jpeg",
    messageType: "sensor_msgs/CompressedImage",
    throttleMs: 50,
    fitMode: "contain",
    showSettings: false,
  }), []);

  const pidDefaults = useMemo(() => ({
    kp_yaw: 1.2, deadband_x: 0.03, max_angular_z: 1.0,
    v_max: 0.35, a_go: 0.03, a_stop: 0.12,
    min_conf: 0.35, target_timeout_sec: 0.35,
    ex_lowpass_alpha: 1.0, invert_ex: false, ex_offset: 0.0,
  }), []);

  const initial = useMemo(() => ({ ...defaults, ...(loadSettings() || {}) }), [defaults]);
  const initialPID = useMemo(() => ({ ...pidDefaults, ...(loadPIDSettings() || {}) }), [pidDefaults]);

  const [settings, setSettings] = useState(initial);
  const [pidSettings, setPidSettings] = useState(initialPID);
  const [imgSrc, setImgSrc] = useState(null);
  const [frames, setFrames] = useState(0);
  const [lastBytes, setLastBytes] = useState(0);
  const [humanFollowEnabled, setHumanFollowEnabled] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [localError, setLocalError] = useState("");
  const [tuningStatus, setTuningStatus] = useState("");
  const [tuningLoading, setTuningLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logPaused, setLogPaused] = useState(false);
  const [cmdVelData, setCmdVelData] = useState(null);
  const [targetData, setTargetData] = useState(null);
  const logPausedRef = useRef(false);
  const logEndRef = useRef(null);
  const subRef = useRef(null);
  const cmdVelSubRef = useRef(null);
  const targetSubRef = useRef(null);
  const prevCmdRef = useRef(null);
  const fpsRef = useRef({ t0: performance.now(), n: 0, fps: 0 });
  const [fps, setFps] = useState(0);

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { savePIDSettings(pidSettings); }, [pidSettings]);

  const addLog = useCallback((entry) => {
    if (logPausedRef.current) return;
    setLogs((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });
  }, []);

  useEffect(() => { logPausedRef.current = logPaused; }, [logPaused]);

  useEffect(() => {
    if (logPaused) return;
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs, logPaused]);

  // Görüntü subscription
  useEffect(() => {
    if (!ros || !isConnected) return;
    try { if (subRef.current) subRef.current.unsubscribe(); } catch {}
    setImgSrc(null); setFrames(0); setLastBytes(0); setFps(0);
    fpsRef.current = { t0: performance.now(), n: 0, fps: 0 };
    const sub = new ROSLIB.Topic({
      ros, name: settings.imageTopic, messageType: settings.messageType,
      queue_length: 1, throttle_rate: Math.max(0, Number(settings.throttleMs) || 0),
    });
    subRef.current = sub;
    sub.subscribe((msg) => {
      const { b64, bytes } = decodeCompressedData(msg.data);
      setLastBytes(bytes);
      if (!b64 || bytes === 0) return;
      setImgSrc(`data:image/jpeg;base64,${b64}`);
      setFrames((c) => c + 1);
      const now = performance.now();
      const st = fpsRef.current;
      st.n += 1;
      const dt = now - st.t0;
      if (dt >= 1000) { st.fps = (st.n * 1000) / dt; st.t0 = now; st.n = 0; setFps(st.fps); }
    });
    return () => { try { sub.unsubscribe(); } catch {}; subRef.current = null; };
  }, [ros, isConnected, settings.imageTopic, settings.messageType, settings.throttleMs]);

  // cmd_vel subscription
  useEffect(() => {
    if (!ros || !isConnected) return;
    try { if (cmdVelSubRef.current) cmdVelSubRef.current.unsubscribe(); } catch {}
    let sub;
    try {
      sub = new ROSLIB.Topic({ ros, name: "/cmd_vel_human_follow", messageType: "geometry_msgs/Twist", queue_length: 1, throttle_rate: 100 });
    } catch (e) { return; }
    cmdVelSubRef.current = sub;
    sub.subscribe((msg) => {
      try {
        const linear = msg?.linear?.x ?? 0;
        const angular = msg?.angular?.z ?? 0;
        const isZero = Math.abs(linear) < 0.001 && Math.abs(angular) < 0.001;
        const wasZero = prevCmdRef.current?.isZero ?? true;
        if (isZero && wasZero) { setCmdVelData({ linear, angular }); return; }
        prevCmdRef.current = { isZero };
        setCmdVelData({ linear, angular });
        const motion = classifyMotion(linear, angular);
        addLog({ id: Date.now() + Math.random(), time: formatTime(), type: "cmd", motion, linear, angular });
      } catch {}
    });
    return () => { try { sub.unsubscribe(); } catch {}; cmdVelSubRef.current = null; };
  }, [ros, isConnected, addLog]);

  // target subscription
  useEffect(() => {
    if (!ros || !isConnected) return;
    try { if (targetSubRef.current) targetSubRef.current.unsubscribe(); } catch {}
    let sub;
    try {
      sub = new ROSLIB.Topic({ ros, name: "/humans/target", messageType: "std_msgs/String", queue_length: 1, throttle_rate: 500 });
    } catch (e) { return; }
    targetSubRef.current = sub;
    sub.subscribe((msg) => {
      try {
        let info = null;
        try { info = JSON.parse(msg.data); } catch { info = { raw: msg.data }; }
        setTargetData(info);
        addLog({ id: Date.now() + Math.random(), time: formatTime(), type: "target", data: info });
      } catch {}
    });
    return () => { try { sub.unsubscribe(); } catch {}; targetSubRef.current = null; };
  }, [ros, isConnected, addLog]);

  const toggleHumanFollow = () => {
    if (!ros || !isConnected) { setLocalError("⚠ ROSBridge bağlı değil!"); return; }
    setPublishing(true); setLocalError("");
    try {
      const newState = !humanFollowEnabled;
      const enableTopic = new ROSLIB.Topic({ ros, name: "/human_follow/enable", messageType: "std_msgs/Bool" });
      enableTopic.publish({ data: newState });
      setHumanFollowEnabled(newState);
      addLog({ id: Date.now(), time: formatTime(), type: "system", message: newState ? "▶ Human Follow ETKİNLEŞTİRİLDİ" : "⏹ Human Follow DURDURULDU", color: newState ? "#10b981" : "#ef4444" });
      setLocalError(newState ? "✓ Human Follow ON" : "✓ Human Follow OFF");
      setTimeout(() => setLocalError(""), 2000);
    } catch (e) { setLocalError(`⚠ Hata: ${e.message}`); }
    finally { setPublishing(false); }
  };

  const onApplyPIDTuning = () => {
    if (!ros || !isConnected) { setTuningStatus("⚠ ROS bağlantısı yok!"); return; }
    if (pidSettings.a_go >= pidSettings.a_stop) {
      setTuningStatus(`⚠ Hata: A_go (${pidSettings.a_go.toFixed(3)}) < A_stop (${pidSettings.a_stop.toFixed(3)}) olmalı!`);
      setTimeout(() => setTuningStatus(""), 3000); return;
    }
    setTuningLoading(true); setTuningStatus("↗ PID ayarları gönderiliyor...");
    try {
      const client = new ROSLIB.Service({ ros, name: "/human_follow/tune", serviceType: "atoh2_human_msgs/TunePid" });
      const request = {
        kp_yaw: parseFloat(pidSettings.kp_yaw), deadband_x: parseFloat(pidSettings.deadband_x),
        max_angular_z: parseFloat(pidSettings.max_angular_z), v_max: parseFloat(pidSettings.v_max),
        a_go: parseFloat(pidSettings.a_go), a_stop: parseFloat(pidSettings.a_stop),
        min_conf: parseFloat(pidSettings.min_conf), target_timeout_sec: parseFloat(pidSettings.target_timeout_sec),
        ex_lowpass_alpha: parseFloat(pidSettings.ex_lowpass_alpha),
        invert_ex: Boolean(pidSettings.invert_ex), ex_offset: parseFloat(pidSettings.ex_offset),
      };
      const timeoutId = setTimeout(() => {
        setTuningStatus("⚠ Hata: Service timeout (5s). Node çalışıyor mu?");
        setTuningLoading(false); setTimeout(() => setTuningStatus(""), 3000);
      }, 5000);
      client.callService(request, (response) => {
        clearTimeout(timeoutId);
        if (response.success) {
          setTuningStatus(`✓ Başarılı! ${response.message}`);
          addLog({ id: Date.now(), time: formatTime(), type: "system", message: `✓ PID güncellendi: kp_yaw=${pidSettings.kp_yaw} v_max=${pidSettings.v_max}`, color: "#60a5fa" });
        } else { setTuningStatus(`✗ Hata: ${response.message}`); }
        setTuningLoading(false); setTimeout(() => setTuningStatus(""), 3000);
      });
    } catch (e) {
      setTuningStatus(`⚠ Hata: ${e.message}`);
      setTuningLoading(false); setTimeout(() => setTuningStatus(""), 3000);
    }
  };

  const motion = cmdVelData ? classifyMotion(cmdVelData.linear, cmdVelData.angular) : null;
  const displayError = localError || globalErrorText;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: "calc(100vh - 56px)", width: "100vw",
      background: "#070d1a",
      color: "white", padding: "0.6rem",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      overflow: "hidden", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: "0.6rem",
    }}>

      {/* ── HEADER BAR ──────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem" }}>
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #10b981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", boxShadow: "0 0 12px #10b98166" }}>
            👁
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: "800", letterSpacing: "0.1em", color: "#f1f5f9" }}>YOLO SNAPSHOT</div>
            <div style={{ fontSize: "0.6rem", color: "#475569", letterSpacing: "0.06em" }}>HUMAN TRACKING DASHBOARD</div>
          </div>
        </div>

        {/* Status pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "#0f1e35", borderRadius: "0.5rem", padding: "0.35rem 0.75rem", border: "1px solid #1e3a5f" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isConnected ? "#10b981" : "#ef4444", boxShadow: isConnected ? "0 0 8px #10b981" : "0 0 8px #ef4444" }} />
            <span style={{ fontSize: "0.68rem", fontWeight: "600", color: isConnected ? "#10b981" : "#ef4444" }}>{globalStatus}</span>
          </div>
          {displayError && (
            <span style={{ fontSize: "0.65rem", color: displayError.includes("✓") ? "#10b981" : "#f87171", borderLeft: "1px solid #1e3a5f", paddingLeft: "0.75rem" }}>{displayError}</span>
          )}
          <div style={{ borderLeft: "1px solid #1e3a5f", paddingLeft: "0.75rem", display: "flex", gap: "0.75rem" }}>
            {[
              { label: "KARE", value: frames },
              { label: "FPS", value: fps.toFixed(1) },
              { label: "BAYT", value: lastBytes },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.65rem", fontWeight: "700", color: "#e2e8f0" }}>{value}</div>
                <div style={{ fontSize: "0.52rem", color: "#475569", letterSpacing: "0.04em" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={toggleHumanFollow}
            disabled={publishing || !isConnected}
            style={{
              padding: "0.45rem 1rem", borderRadius: "0.5rem",
              background: humanFollowEnabled
                ? "linear-gradient(135deg, #059669, #10b981)"
                : "linear-gradient(135deg, #991b1b, #ef4444)",
              border: "none", color: "white",
              cursor: publishing || !isConnected ? "not-allowed" : "pointer",
              fontSize: "0.78rem", fontWeight: "700", letterSpacing: "0.04em",
              opacity: publishing || !isConnected ? 0.5 : 1,
              boxShadow: humanFollowEnabled ? "0 0 14px #10b98155" : "0 0 14px #ef444455",
              transition: "all 0.25s",
            }}
          >
            {publishing ? "↻ Gönderiliyor..." : humanFollowEnabled ? "⏹ FOLLOW ON" : "▶ FOLLOW OFF"}
          </button>
          <button
            onClick={() => setSettings((s) => ({ ...s, showSettings: !s.showSettings }))}
            style={{
              padding: "0.45rem 0.75rem", borderRadius: "0.5rem",
              background: settings.showSettings ? "#1e3a5f" : "#0f1e35",
              border: `1px solid ${settings.showSettings ? "#3b82f6" : "#1e3a5f"}`,
              color: settings.showSettings ? "#60a5fa" : "#64748b",
              cursor: "pointer", fontSize: "0.78rem", fontWeight: "600", transition: "all 0.2s",
            }}
          >
            ⚙ {settings.showSettings ? "Kapat" : "Ayarlar"}
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", gap: "0.6rem", minHeight: 0, overflow: "hidden" }}>

        {/* LEFT: Image + Log */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.6rem", minWidth: 0, overflow: "hidden" }}>

          {/* Image viewer */}
          <div style={{
            flex: "1 1 0", background: "#0a1628", borderRadius: "0.5rem",
            border: "1px solid #1e293b", overflow: "hidden",
            display: "flex", flexDirection: "column", minHeight: 0,
          }}>
            {imgSrc ? (
              <>
                <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#050c1a" }}>
                  <img src={imgSrc} alt="human_debug" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: settings.fitMode, display: "block" }} />
                </div>
                <div style={{ background: "#0a1628", borderTop: "1px solid #1e293b", padding: "0.3rem 0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.65rem", color: "#475569", flexShrink: 0 }}>
                  <span>🎞 {frames} kare</span>
                  <span style={{ color: fps > 20 ? "#10b981" : fps > 10 ? "#fbbf24" : "#ef4444", fontWeight: "700" }}>{fps.toFixed(1)} FPS</span>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#1e3a5f" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem", opacity: 0.4 }}>👁</div>
                <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#334155" }}>Görüntü Bekleniyor</div>
                <div style={{ fontSize: "0.68rem", color: "#1e293b", marginTop: "0.25rem" }}>{settings.imageTopic}</div>
              </div>
            )}
          </div>

          {/* Log panel */}
          <div style={{
            flex: "0 0 220px", background: "#050c1a", borderRadius: "0.5rem",
            border: "1px solid #0f1e35", display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Log header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.35rem 0.65rem", borderBottom: "1px solid #0f1e35", flexShrink: 0, background: "#0a1628" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", overflow: "hidden", minWidth: 0 }}>
                <span style={{ fontSize: "0.65rem", fontWeight: "800", color: "#334155", letterSpacing: "0.08em", flexShrink: 0 }}>
                  CONTROLLER LOG
                </span>
                <span style={{ fontSize: "0.58rem", background: "#0f172a", color: logPaused ? "#fbbf24" : "#334155", borderRadius: "999px", padding: "0.08rem 0.4rem", fontWeight: "600", flexShrink: 0 }}>
                  {logPaused ? "⏸ DURDURULDU" : `${logs.length}/${MAX_LOGS}`}
                </span>
                {cmdVelData && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", overflow: "hidden", minWidth: 0 }}>
                    <span style={{ fontSize: "0.65rem", fontWeight: "700", color: motion?.color ?? "#64748b", flexShrink: 0 }}>
                      {motion?.icon} {motion?.label}
                    </span>
                    <span style={{ fontSize: "0.6rem", color: "#475569", flexShrink: 0 }}>
                      lin=<b style={{ color: "#94a3b8" }}>{cmdVelData.linear.toFixed(3)}</b>{" "}
                      ang=<b style={{ color: "#94a3b8" }}>{cmdVelData.angular.toFixed(3)}</b>
                    </span>
                    {targetData && (
                      <span style={{ fontSize: "0.6rem", color: "#93c5fd", background: "#0f1e35", borderRadius: "0.2rem", padding: "0.08rem 0.3rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "140px" }}>
                        🎯 {targetData.raw ?? JSON.stringify(targetData)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.4rem" }}>
                <button onClick={() => setLogPaused(p => !p)} style={{ padding: "0.2rem 0.5rem", borderRadius: "0.3rem", background: logPaused ? "#78350f" : "#0f1e35", border: `1px solid ${logPaused ? "#d97706" : "#1e3a5f"}`, color: logPaused ? "#fbbf24" : "#3b82f6", cursor: "pointer", fontSize: "0.62rem", fontWeight: "700" }}>
                  {logPaused ? "▶ DEVAM" : "⏸ DUR"}
                </button>
                <button onClick={() => { setLogs([]); setCmdVelData(null); setTargetData(null); }} style={{ padding: "0.2rem 0.5rem", borderRadius: "0.3rem", background: "#0a1628", border: "1px solid #1e293b", color: "#475569", cursor: "pointer", fontSize: "0.62rem", fontWeight: "600" }}>
                  🗑 TEMİZLE
                </button>
              </div>
            </div>

            {/* Log rows */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0.25rem 0.4rem", fontFamily: "'Courier New', monospace" }}>
              {logs.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#1e3a5f", fontSize: "0.68rem", gap: "0.3rem" }}>
                  <div style={{ fontSize: "1.2rem" }}>📡</div>
                  <div>Human Follow aktif edilince loglar görünür</div>
                </div>
              ) : (
                logs.map((log) => {
                  if (log.type === "cmd") {
                    const active = Math.abs(log.linear) > 0.001 || Math.abs(log.angular) > 0.001;
                    return (
                      <div key={log.id} style={{ display: "flex", gap: "0.3rem", alignItems: "center", padding: "0.1rem 0.2rem", borderRadius: "0.2rem", marginBottom: "0.06rem", background: active ? `${log.motion.color}0a` : "transparent", borderLeft: `2px solid ${log.motion.color}55` }}>
                        <span style={{ fontSize: "0.55rem", color: "#1e3a5f", whiteSpace: "nowrap", flexShrink: 0 }}>{log.time}</span>
                        <span style={{ fontSize: "0.63rem", flexShrink: 0 }}>{log.motion.icon}</span>
                        <span style={{ fontSize: "0.62rem", fontWeight: "700", color: log.motion.color, flexShrink: 0, minWidth: "64px" }}>{log.motion.label}</span>
                        <span style={{ fontSize: "0.58rem", color: "#334155" }}>
                          lin=<span style={{ color: "#64748b" }}>{log.linear.toFixed(3)}</span>{" "}
                          ang=<span style={{ color: "#64748b" }}>{log.angular.toFixed(3)}</span>
                        </span>
                      </div>
                    );
                  }
                  if (log.type === "target") {
                    return (
                      <div key={log.id} style={{ display: "flex", gap: "0.3rem", alignItems: "center", padding: "0.1rem 0.2rem", borderRadius: "0.2rem", marginBottom: "0.06rem", borderLeft: "2px solid #1d4ed855" }}>
                        <span style={{ fontSize: "0.55rem", color: "#1e3a5f", whiteSpace: "nowrap", flexShrink: 0 }}>{log.time}</span>
                        <span style={{ fontSize: "0.63rem" }}>🎯</span>
                        <span style={{ fontSize: "0.58rem", color: "#60a5fa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {log.data?.raw ?? JSON.stringify(log.data)}
                        </span>
                      </div>
                    );
                  }
                  if (log.type === "system") {
                    return (
                      <div key={log.id} style={{ display: "flex", gap: "0.3rem", alignItems: "center", padding: "0.1rem 0.2rem", borderRadius: "0.2rem", marginBottom: "0.06rem", borderLeft: `2px solid ${log.color}55` }}>
                        <span style={{ fontSize: "0.55rem", color: "#1e3a5f", whiteSpace: "nowrap", flexShrink: 0 }}>{log.time}</span>
                        <span style={{ fontSize: "0.62rem", color: log.color, fontWeight: "600" }}>{log.message}</span>
                      </div>
                    );
                  }
                  return null;
                })
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* RIGHT: Settings Panel (only when open) */}
        {settings.showSettings && (
          <div style={{
            width: "320px", flexShrink: 0,
            background: "#0a1628", borderRadius: "0.5rem",
            border: "1px solid #1e293b", display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Settings header */}
            <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #1e293b", flexShrink: 0, background: "#0f1e35", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: "800", color: "#94a3b8", letterSpacing: "0.08em" }}>⚙ AYARLAR</span>
              <button onClick={() => setSettings(s => ({ ...s, showSettings: false }))} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1 }}>✕</button>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>

              {/* Görüntü Ayarları */}
              <SettingGroup title="Görüntü Ayarları" icon="🖼" accent="#60a5fa">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.62rem", fontWeight: "600", color: "#475569", letterSpacing: "0.05em", marginBottom: "0.25rem", textTransform: "uppercase" }}>Topic</label>
                    <input
                      value={settings.imageTopic}
                      onChange={(e) => setSettings(s => ({ ...s, imageTopic: e.target.value }))}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: "0.375rem", color: "#93c5fd", fontSize: "0.72rem", fontFamily: "'Courier New', monospace", boxSizing: "border-box", outline: "none" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.62rem", fontWeight: "600", color: "#475569", letterSpacing: "0.05em", marginBottom: "0.25rem", textTransform: "uppercase" }}>Message Type</label>
                    <input
                      value={settings.messageType}
                      onChange={(e) => setSettings(s => ({ ...s, messageType: e.target.value }))}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: "0.375rem", color: "#93c5fd", fontSize: "0.72rem", fontFamily: "'Courier New', monospace", boxSizing: "border-box", outline: "none" }}
                    />
                  </div>
                  <button
                    onClick={() => setSettings(defaults)}
                    style={{ padding: "0.35rem 0.6rem", borderRadius: "0.375rem", background: "#0f172a", border: "1px solid #1e3a5f", color: "#475569", cursor: "pointer", fontSize: "0.65rem", fontWeight: "600", width: "fit-content" }}
                  >
                    ↺ Varsayılanlara Dön
                  </button>
                </div>
              </SettingGroup>

              {/* PID: Yaw */}
              <SettingGroup title="Yaw Kontrolü" icon="🔄" accent="#60a5fa">
                <PIDSlider label="KP Yaw Kazanç" value={pidSettings.kp_yaw} onChange={e => setPidSettings(s => ({ ...s, kp_yaw: parseFloat(e.target.value) }))} min="0" max="10" step="0.1" accent="#60a5fa" />
                <PIDSlider label="Deadband X" value={pidSettings.deadband_x} onChange={e => setPidSettings(s => ({ ...s, deadband_x: parseFloat(e.target.value) }))} min="0" max="0.5" step="0.01" accent="#60a5fa" />
                <PIDSlider label="Max Angular Z" value={pidSettings.max_angular_z} onChange={e => setPidSettings(s => ({ ...s, max_angular_z: parseFloat(e.target.value) }))} min="0" max="5" step="0.1" accent="#60a5fa" />
              </SettingGroup>

              {/* PID: İleri */}
              <SettingGroup title="İleri Kontrolü" icon="↑" accent="#34d399">
                <PIDSlider label="V Max" value={pidSettings.v_max} onChange={e => setPidSettings(s => ({ ...s, v_max: parseFloat(e.target.value) }))} min="0" max="2" step="0.05" accent="#34d399" />
                <PIDSlider label="A Go" value={pidSettings.a_go} onChange={e => setPidSettings(s => ({ ...s, a_go: parseFloat(e.target.value) }))} min="0" max="1" step="0.01" accent="#34d399" />
                <PIDSlider label="A Stop" value={pidSettings.a_stop} onChange={e => setPidSettings(s => ({ ...s, a_stop: parseFloat(e.target.value) }))} min="0" max="1" step="0.01" accent="#34d399" />
              </SettingGroup>

              {/* PID: Algılama */}
              <SettingGroup title="Algılama & Filtreleme" icon="🎯" accent="#fbbf24">
                <PIDSlider label="Min Confidence" value={pidSettings.min_conf} onChange={e => setPidSettings(s => ({ ...s, min_conf: parseFloat(e.target.value) }))} min="0" max="1" step="0.05" accent="#fbbf24" />
                <PIDSlider label="Target Timeout" value={pidSettings.target_timeout_sec} onChange={e => setPidSettings(s => ({ ...s, target_timeout_sec: parseFloat(e.target.value) }))} min="0.05" max="5" step="0.05" unit="s" accent="#fbbf24" />
                <PIDSlider label="Lowpass Alpha" value={pidSettings.ex_lowpass_alpha} onChange={e => setPidSettings(s => ({ ...s, ex_lowpass_alpha: parseFloat(e.target.value) }))} min="0" max="1" step="0.05" accent="#fbbf24" />
              </SettingGroup>

              {/* PID: Kalibrasyon */}
              <SettingGroup title="Kalibrasyon" icon="⚖" accent="#f87171">
                <PIDSlider label="EX Offset" value={pidSettings.ex_offset} onChange={e => setPidSettings(s => ({ ...s, ex_offset: parseFloat(e.target.value) }))} min="-1" max="1" step="0.05" accent="#f87171" />
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", marginTop: "0.5rem" }}>
                  <div
                    onClick={() => setPidSettings(s => ({ ...s, invert_ex: !s.invert_ex }))}
                    style={{ width: "36px", height: "20px", borderRadius: "10px", background: pidSettings.invert_ex ? "#f87171" : "#1e293b", border: `1px solid ${pidSettings.invert_ex ? "#f87171" : "#334155"}`, position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}
                  >
                    <div style={{ position: "absolute", top: "2px", left: pidSettings.invert_ex ? "17px" : "2px", width: "14px", height: "14px", borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: "500" }}>EX'i Ters Çevir</span>
                </label>
              </SettingGroup>

              {/* Tuning status */}
              {tuningStatus && (
                <div style={{ padding: "0.4rem 0.6rem", background: tuningStatus.includes("✓") ? "#064e3b" : "#450a0a", border: `1px solid ${tuningStatus.includes("✓") ? "#10b981" : "#ef4444"}`, borderRadius: "0.375rem", marginBottom: "0.75rem", fontSize: "0.68rem", color: tuningStatus.includes("✓") ? "#10b981" : "#f87171", fontWeight: "600" }}>
                  {tuningStatus}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={onApplyPIDTuning}
                  disabled={tuningLoading || !isConnected}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: "0.4rem", background: isConnected && !tuningLoading ? "linear-gradient(135deg, #1d4ed8, #3b82f6)" : "#1e293b", border: "none", color: "white", cursor: isConnected && !tuningLoading ? "pointer" : "not-allowed", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.04em", opacity: tuningLoading || !isConnected ? 0.5 : 1 }}>
                  {tuningLoading ? "↻ Uygulanıyor..." : "▶ UYGULA"}
                </button>
                <button
                  onClick={() => setPidSettings(pidDefaults)}
                  disabled={tuningLoading}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: "0.4rem", background: "#0f172a", border: "1px solid #1e293b", color: "#64748b", cursor: tuningLoading ? "not-allowed" : "pointer", fontSize: "0.72rem", fontWeight: "600", opacity: tuningLoading ? 0.5 : 1 }}>
                  ↺ Sıfırla
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
