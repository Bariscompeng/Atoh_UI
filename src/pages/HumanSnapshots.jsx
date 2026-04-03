import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

const LS_KEY = "human_snapshots_settings_v1";
const LS_PID_KEY = "human_follow_pid_settings_v1";
const MAX_LOGS = 120;

function uint8ToBase64(u8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk)
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(binary);
}

function decodeCompressedData(data) {
  if (typeof data === "string") { const bytes = Math.floor((data.length * 3) / 4); return { b64: data, bytes }; }
  if (Array.isArray(data)) { const u8 = new Uint8Array(data); return { b64: uint8ToBase64(u8), bytes: u8.length }; }
  if (data instanceof Uint8Array) return { b64: uint8ToBase64(data), bytes: data.length };
  if (data?.buffer && typeof data.byteLength === "number") { try { const u8 = new Uint8Array(data.buffer); return { b64: uint8ToBase64(u8), bytes: u8.length }; } catch {} }
  if (data && typeof data === "object") {
    if (typeof data.length === "number" && data.length > 0) { try { const u8 = new Uint8Array(data.length); for (let i = 0; i < data.length; i++) u8[i] = data[i] ?? 0; return { b64: uint8ToBase64(u8), bytes: u8.length }; } catch {} }
    const nums = Object.keys(data).map(Number).filter(Number.isFinite).sort((a,b) => a-b);
    if (nums.length > 0) { const u8 = new Uint8Array(nums.length); nums.forEach((n,i) => u8[i] = data[String(n)] ?? 0); return { b64: uint8ToBase64(u8), bytes: u8.length }; }
  }
  return { b64: null, bytes: 0 };
}

const loadSettings = () => { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const saveSettings = (s) => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {} };
const loadPIDSettings = () => { try { const r = localStorage.getItem(LS_PID_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const savePIDSettings = (s) => { try { localStorage.setItem(LS_PID_KEY, JSON.stringify(s)); } catch {} };
const ts = () => { const n = new Date(); return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}:${String(n.getSeconds()).padStart(2,"0")}.${String(n.getMilliseconds()).padStart(3,"0")}`; };

function classifyMotion(linear, angular) {
  const m = Math.abs(linear) > 0.001 || Math.abs(angular) > 0.001;
  if (!m) return { label: "BEKLE", color: "#2a4060", icon: "■" };
  if (Math.abs(linear) > 0.001 && Math.abs(angular) < 0.05) return { label: "İLERİ", color: "#00ff88", icon: "▲" };
  if (Math.abs(linear) < 0.001 && angular > 0.05) return { label: "SOL DÖN", color: "#00d4ff", icon: "◀" };
  if (Math.abs(linear) < 0.001 && angular < -0.05) return { label: "SAĞ DÖN", color: "#ff6b9d", icon: "▶" };
  if (linear > 0 && angular > 0.05) return { label: "SOL+İLERİ", color: "#00ff88", icon: "↖" };
  if (linear > 0 && angular < -0.05) return { label: "SAĞ+İLERİ", color: "#00ff88", icon: "↗" };
  return { label: "HAREKET", color: "#ffd700", icon: "◆" };
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Barlow+Condensed:wght@400;600;700;800&display=swap');
  .hs-scroll::-webkit-scrollbar{width:3px}.hs-scroll::-webkit-scrollbar-track{background:transparent}.hs-scroll::-webkit-scrollbar-thumb{background:#0a2040;border-radius:2px}.hs-scroll::-webkit-scrollbar-thumb:hover{background:#00d4ff33}
  .hs-btn{transition:all 0.15s ease;outline:none}.hs-btn:hover:not(:disabled){filter:brightness(1.25);transform:translateY(-1px)}.hs-btn:active:not(:disabled){transform:translateY(0)}
  .hs-row{transition:background 0.08s}.hs-row:hover{background:rgba(0,212,255,0.03)!important}
  @keyframes hspulse{0%,100%{opacity:1;box-shadow:0 0 6px #00ff88}50%{opacity:.5;box-shadow:0 0 12px #00ff88}}
  @keyframes hsdrawer{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
  .hs-drawer{animation:hsdrawer 0.22s cubic-bezier(.4,0,.2,1) both}
  input[type=range]{-webkit-appearance:none;appearance:none;background:transparent}
  input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:#071428}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;margin-top:-5px;cursor:pointer}
`;

function PIDSlider({ label, value, onChange, min, max, step, accent = "#00d4ff" }) {
  const pct = ((+value - +min) / (+max - +min)) * 100;
  const dec = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
        <span style={{ fontSize: "0.58rem", fontWeight: "600", color: "#1e4060", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{label}</span>
        <span style={{ fontSize: "0.68rem", fontWeight: "700", color: accent, fontFamily: "'JetBrains Mono',monospace", background: `${accent}12`, padding: "0.08rem 0.35rem", borderRadius: "3px", border: `1px solid ${accent}30` }}>{(+value).toFixed(dec)}</span>
      </div>
      <div style={{ position: "relative", height: "16px", display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: "3px", top: "50%", transform: "translateY(-50%)", borderRadius: "2px", background: "#071428" }} />
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "3px", top: "50%", transform: "translateY(-50%)", borderRadius: "2px", background: `linear-gradient(90deg,${accent}44,${accent})` }} />
        <input type="range" value={value} onChange={onChange} min={min} max={max} step={step}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "16px" }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 6px)`, width: "13px", height: "13px", borderRadius: "50%", background: "#040d1a", border: `2px solid ${accent}`, boxShadow: `0 0 7px ${accent}77`, pointerEvents: "none" }} />
      </div>
    </div>
  );
}

function Section({ title, accent, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: "0.5rem", border: `1px solid ${accent}20`, borderRadius: "5px", overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", padding: "0.4rem 0.6rem", background: `${accent}08`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.58rem", fontWeight: "700", color: accent, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{title}</span>
        <span style={{ fontSize: "0.55rem", color: `${accent}88` }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "0.6rem 0.6rem 0.2rem" }}>{children}</div>}
    </div>
  );
}

export default function HumanSnapshots() {
  const { ros, isConnected, status: globalStatus, humanFollowEnabled, toggleHumanFollow } = useROS();

  const defaults = useMemo(() => ({ imageTopic: "/human_debug_snapshot/jpeg", messageType: "sensor_msgs/CompressedImage", throttleMs: 50, fitMode: "contain" }), []);
  const pidDefs = useMemo(() => ({ kp_yaw: 1.2, deadband_x: 0.03, max_angular_z: 1.0, v_max: 0.35, a_go: 0.03, a_stop: 0.12, min_conf: 0.35, target_timeout_sec: 0.35, ex_lowpass_alpha: 1.0, invert_ex: false, ex_offset: 0.0 }), []);

  const [settings, setSettings] = useState(() => ({ ...defaults, ...(loadSettings() || {}) }));
  const [pid, setPid] = useState(() => ({ ...pidDefs, ...(loadPIDSettings() || {}) }));
  const [showSettings, setShowSettings] = useState(false);

  const [imgSrc, setImgSrc] = useState(null);
  const [frames, setFrames] = useState(0);
  const [lastBytes, setLastBytes] = useState(0);
  const [fps, setFps] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState("");
  const [tuneStatus, setTuneStatus] = useState("");
  const [tuneLoading, setTuneLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logPaused, setLogPaused] = useState(false);
  const [cmdVel, setCmdVel] = useState(null);
  const [target, setTarget] = useState(null);

  const logPausedRef = useRef(false);
  const logEndRef = useRef(null);
  const subRef = useRef(null);
  const cvSubRef = useRef(null);
  const tgtSubRef = useRef(null);
  const prevCmdRef = useRef(null);
  const fpsRef = useRef({ t0: performance.now(), n: 0 });

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { savePIDSettings(pid); }, [pid]);
  useEffect(() => { logPausedRef.current = logPaused; }, [logPaused]);
  useEffect(() => { if (!logPaused && logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [logs, logPaused]);

  const addLog = useCallback((e) => {
    if (logPausedRef.current) return;
    setLogs(p => { const n = [...p, e]; return n.length > MAX_LOGS ? n.slice(-MAX_LOGS) : n; });
  }, []);

  // Image
  useEffect(() => {
    if (!ros || !isConnected) return;
    try { subRef.current?.unsubscribe(); } catch {}
    setImgSrc(null); setFrames(0); setLastBytes(0); setFps(0);
    fpsRef.current = { t0: performance.now(), n: 0 };
    const sub = new ROSLIB.Topic({ ros, name: settings.imageTopic, messageType: settings.messageType, queue_length: 1, throttle_rate: Math.max(0, +settings.throttleMs || 0) });
    subRef.current = sub;
    sub.subscribe((msg) => {
      const { b64, bytes } = decodeCompressedData(msg.data);
      setLastBytes(bytes);
      if (!b64 || !bytes) return;
      setImgSrc(`data:image/jpeg;base64,${b64}`);
      setFrames(c => c + 1);
      const now = performance.now(), st = fpsRef.current; st.n++;
      if (now - st.t0 >= 1000) { setFps((st.n * 1000) / (now - st.t0)); st.t0 = now; st.n = 0; }
    });
    return () => { try { sub.unsubscribe(); } catch {}; subRef.current = null; };
  }, [ros, isConnected, settings.imageTopic, settings.messageType, settings.throttleMs]);

  // cmd_vel
  useEffect(() => {
    if (!ros || !isConnected) return;
    try { cvSubRef.current?.unsubscribe(); } catch {}
    let sub;
    try { sub = new ROSLIB.Topic({ ros, name: "/cmd_vel_human_follow", messageType: "geometry_msgs/Twist", queue_length: 1, throttle_rate: 100 }); }
    catch { return; }
    cvSubRef.current = sub;
    sub.subscribe((msg) => {
      try {
        const linear = msg?.linear?.x ?? 0, angular = msg?.angular?.z ?? 0;
        const isZero = Math.abs(linear) < 0.001 && Math.abs(angular) < 0.001;
        if (isZero && (prevCmdRef.current?.isZero ?? true)) { setCmdVel({ linear, angular }); return; }
        prevCmdRef.current = { isZero };
        setCmdVel({ linear, angular });
        addLog({ id: Date.now() + Math.random(), time: ts(), type: "cmd", motion: classifyMotion(linear, angular), linear, angular });
      } catch {}
    });
    return () => { try { sub.unsubscribe(); } catch {}; cvSubRef.current = null; };
  }, [ros, isConnected, addLog]);

  // target
  useEffect(() => {
    if (!ros || !isConnected) return;
    try { tgtSubRef.current?.unsubscribe(); } catch {}
    let sub;
    try { sub = new ROSLIB.Topic({ ros, name: "/humans/target", messageType: "std_msgs/String", queue_length: 1, throttle_rate: 500 }); }
    catch { return; }
    tgtSubRef.current = sub;
    sub.subscribe((msg) => {
      try {
        let info; try { info = JSON.parse(msg.data); } catch { info = { raw: msg.data }; }
        setTarget(info);
        addLog({ id: Date.now() + Math.random(), time: ts(), type: "target", data: info });
      } catch {}
    });
    return () => { try { sub.unsubscribe(); } catch {}; tgtSubRef.current = null; };
  }, [ros, isConnected, addLog]);

  const handleToggle = () => {
    if (!ros || !isConnected) { setNotice("ERR: ROS BAĞLI DEĞİL"); return; }
    setPublishing(true); setNotice("");
    try {
      const next = toggleHumanFollow();
      addLog({ id: Date.now(), time: ts(), type: "system", message: next ? "▶ FOLLOW ON" : "■ FOLLOW OFF", color: next ? "#00ff88" : "#ff4444" });
      setNotice(next ? "FOLLOW: ACTIVE" : "FOLLOW: STOPPED");
      setTimeout(() => setNotice(""), 2500);
    } catch (e) { setNotice(`ERR: ${e.message}`); }
    finally { setPublishing(false); }
  };

  const applyPID = () => {
    if (!ros || !isConnected) { setTuneStatus("ERR: no ROS"); return; }
    if (+pid.a_go >= +pid.a_stop) { setTuneStatus("ERR: a_go must be < a_stop"); setTimeout(() => setTuneStatus(""), 3000); return; }
    setTuneLoading(true); setTuneStatus("SENDING...");
    try {
      const client = new ROSLIB.Service({ ros, name: "/human_follow/tune", serviceType: "atoh2_human_msgs/TunePid" });
      const req = Object.fromEntries(["kp_yaw","deadband_x","max_angular_z","v_max","a_go","a_stop","min_conf","target_timeout_sec","ex_lowpass_alpha","ex_offset"].map(k => [k, +pid[k]]));
      req.invert_ex = !!pid.invert_ex;
      const tid = setTimeout(() => { setTuneStatus("ERR: timeout 5s"); setTuneLoading(false); setTimeout(() => setTuneStatus(""), 3000); }, 5000);
      client.callService(req, (res) => {
        clearTimeout(tid);
        setTuneStatus(res.success ? `OK: ${res.message}` : `ERR: ${res.message}`);
        if (res.success) addLog({ id: Date.now(), time: ts(), type: "system", message: `PID UPDATED kp=${pid.kp_yaw} vmax=${pid.v_max}`, color: "#00d4ff" });
        setTuneLoading(false); setTimeout(() => setTuneStatus(""), 3000);
      });
    } catch (e) { setTuneStatus(`ERR: ${e.message}`); setTuneLoading(false); setTimeout(() => setTuneStatus(""), 3000); }
  };

  const motion = cmdVel ? classifyMotion(cmdVel.linear, cmdVel.angular) : null;
  const active = humanFollowEnabled && isConnected;

  return (
    <>
      <style>{CSS}</style>
      <div style={{ height: "calc(100vh - 56px)", width: "100vw", background: "#030b17", color: "white", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", fontFamily: "'Barlow Condensed',sans-serif", position: "relative" }}>

        {/* Scanline overlay */}
        <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,212,255,0.006) 3px,rgba(0,212,255,0.006) 4px)", pointerEvents: "none", zIndex: 0 }} />

        {/* ══════ HEADER ══════════════════════════════════════════════ */}
        <header style={{ flexShrink: 0, padding: "0.45rem 0.85rem", borderBottom: "1px solid #071830", background: "#030b17", display: "flex", alignItems: "center", gap: "0.65rem", zIndex: 20, position: "relative" }}>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <div style={{ position: "relative", width: "32px", height: "32px", border: "1px solid #00d4ff33", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", background: "#00d4ff06", fontSize: "1rem" }}>
              🎯
              {active && <div style={{ position: "absolute", top: "-2px", right: "-2px", width: "7px", height: "7px", borderRadius: "50%", background: "#00ff88", animation: "hspulse 1.6s infinite" }} />}
            </div>
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: "800", letterSpacing: "0.14em", color: "#ddeeff", lineHeight: 1 }}>HUMAN TRACKING</div>
              <div style={{ fontSize: "0.5rem", color: "#0d2a45", letterSpacing: "0.16em", fontFamily: "'JetBrains Mono',monospace" }}>VISION · CONTROL · LOG</div>
            </div>
          </div>

          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.22rem 0.55rem", border: `1px solid ${isConnected ? "#00ff8833" : "#ff444433"}`, borderRadius: "4px", background: isConnected ? "#00ff8806" : "#ff444406" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: isConnected ? "#00ff88" : "#ff4444", boxShadow: isConnected ? "0 0 6px #00ff88" : "0 0 6px #ff4444", flexShrink: 0 }} />
            <span style={{ fontSize: "0.6rem", fontWeight: "700", color: isConnected ? "#00ff88" : "#ff5555", letterSpacing: "0.08em", fontFamily: "'JetBrains Mono',monospace" }}>{globalStatus.toUpperCase()}</span>
          </div>

          {/* Notice */}
          {notice && <span style={{ fontSize: "0.58rem", color: "#00d4ff", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em", padding: "0.2rem 0.5rem", border: "1px solid #00d4ff33", borderRadius: "3px", background: "#00d4ff06" }}>{notice}</span>}

          {/* Stats */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1.25rem" }}>
            {[["FRAME", frames], ["FPS", fps.toFixed(1)], ["BYTE", lastBytes]].map(([l, v]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: "700", color: "#8aaccc", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: "0.44rem", color: "#0d2a45", letterSpacing: "0.12em" }}>{l}</div>
              </div>
            ))}
          </div>

          {/* CTA buttons — ALWAYS VISIBLE */}
          <div style={{ display: "flex", gap: "0.4rem", marginLeft: "0.5rem" }}>
            <button className="hs-btn" onClick={handleToggle} disabled={publishing || !isConnected}
              style={{ padding: "0.38rem 0.85rem", borderRadius: "4px", background: humanFollowEnabled ? "#00ff8810" : "#ff444410", border: `1px solid ${humanFollowEnabled ? "#00ff8855" : "#ff444455"}`, color: humanFollowEnabled ? "#00ff88" : "#ff6666", cursor: !isConnected ? "not-allowed" : "pointer", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.08em", fontFamily: "'Barlow Condensed',sans-serif", opacity: !isConnected ? 0.4 : 1, boxShadow: humanFollowEnabled ? "0 0 14px #00ff8820" : "none" }}>
              {publishing ? "···" : humanFollowEnabled ? "● FOLLOW ON" : "○ FOLLOW OFF"}
            </button>
            <button className="hs-btn" onClick={() => setShowSettings(s => !s)}
              style={{ padding: "0.38rem 0.7rem", borderRadius: "4px", background: showSettings ? "#00d4ff10" : "transparent", border: `1px solid ${showSettings ? "#00d4ff44" : "#071830"}`, color: showSettings ? "#00d4ff" : "#1e4060", cursor: "pointer", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.06em", fontFamily: "'Barlow Condensed',sans-serif" }}>
              ⚙ CONFIG
            </button>
          </div>
        </header>

        {/* ══════ BODY ════════════════════════════════════════════════ */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>

          {/* Image + Log column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

            {/* Camera feed */}
            <div style={{ flex: "1 1 0", background: "#020810", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0, borderBottom: "1px solid #071830", position: "relative" }}>
              {/* Corner brackets */}
              {[[{top:8,left:8},{borderTop:"1px solid #00d4ff2a",borderLeft:"1px solid #00d4ff2a"}],
                [{top:8,right:8},{borderTop:"1px solid #00d4ff2a",borderRight:"1px solid #00d4ff2a"}],
                [{bottom:8,left:8},{borderBottom:"1px solid #00d4ff2a",borderLeft:"1px solid #00d4ff2a"}],
                [{bottom:8,right:8},{borderBottom:"1px solid #00d4ff2a",borderRight:"1px solid #00d4ff2a"}]].map(([pos,brd],i) => (
                <div key={i} style={{ position:"absolute", width:14, height:14, zIndex:2, pointerEvents:"none", ...pos, ...brd }} />
              ))}
              {imgSrc ? (
                <>
                  <div style={{ flex:1, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <img src={imgSrc} alt="feed" style={{ maxWidth:"100%", maxHeight:"100%", objectFit:settings.fitMode, display:"block" }} />
                  </div>
                  <div style={{ padding:"0.28rem 0.75rem", background:"#020810", borderTop:"1px solid #071830", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
                    <span style={{ fontSize:"0.52rem", color:"#0d2a45", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.06em" }}>LIVE · {settings.imageTopic}</span>
                    <span style={{ fontSize:"0.6rem", fontWeight:"700", color: fps>20?"#00ff88":fps>10?"#ffd700":"#ff4444", fontFamily:"'JetBrains Mono',monospace" }}>{fps.toFixed(1)} FPS</span>
                  </div>
                </>
              ) : (
                <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"0.5rem" }}>
                  <div style={{ fontSize:"2rem", opacity:0.15 }}>📷</div>
                  <div style={{ fontSize:"0.6rem", color:"#071830", letterSpacing:"0.14em", fontFamily:"'JetBrains Mono',monospace" }}>NO SIGNAL</div>
                </div>
              )}
            </div>

            {/* Log */}
            <div style={{ flex:"0 0 210px", display:"flex", flexDirection:"column", overflow:"hidden", background:"#020810" }}>
              {/* Log header */}
              <div style={{ padding:"0.32rem 0.7rem", borderBottom:"1px solid #071830", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", background:"#030b17" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", minWidth:0, overflow:"hidden" }}>
                  <span style={{ fontSize:"0.55rem", fontWeight:"700", color:"#0d2a45", letterSpacing:"0.14em", fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>CTRL·LOG</span>
                  <span style={{ fontSize:"0.52rem", color: logPaused?"#ffd700":"#0d2a45", fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>{logPaused?"⏸ PAUSED":`${logs.length}/${MAX_LOGS}`}</span>
                  {cmdVel && (
                    <div style={{ display:"flex", alignItems:"center", gap:"0.4rem", overflow:"hidden" }}>
                      <div style={{ width:"18px", height:"18px", borderRadius:"3px", background: motion?`${motion.color}14`:"#071830", border:`1px solid ${motion?motion.color+"44":"#071830"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"0.6rem", flexShrink:0, boxShadow: motion&&Math.abs(cmdVel.linear)>0.001?`0 0 7px ${motion.color}33`:"none" }}>
                        {motion?.icon ?? "·"}
                      </div>
                      <span style={{ fontSize:"0.62rem", fontWeight:"700", color: motion?.color??"#0d2a45", flexShrink:0, fontFamily:"'JetBrains Mono',monospace" }}>{motion?.label}</span>
                      <span style={{ fontSize:"0.55rem", color:"#0d2a45", fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>
                        L:<b style={{color:"#1e4060"}}>{cmdVel.linear.toFixed(3)}</b> A:<b style={{color:"#1e4060"}}>{cmdVel.angular.toFixed(3)}</b>
                      </span>
                      {target && <span style={{ fontSize:"0.52rem", color:"#00d4ff66", fontFamily:"'JetBrains Mono',monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"110px" }}>TGT:{target.raw??JSON.stringify(target)}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", gap:"0.3rem", flexShrink:0 }}>
                  <button className="hs-btn" onClick={() => setLogPaused(p => !p)}
                    style={{ padding:"0.16rem 0.45rem", borderRadius:"3px", background: logPaused?"#ffd70010":"#00d4ff08", border:`1px solid ${logPaused?"#ffd70044":"#00d4ff1a"}`, color: logPaused?"#ffd700":"#00d4ff55", cursor:"pointer", fontSize:"0.55rem", fontWeight:"700", fontFamily:"'JetBrains Mono',monospace" }}>
                    {logPaused ? "▶ RUN" : "⏸ PAUSE"}
                  </button>
                  <button className="hs-btn" onClick={() => { setLogs([]); setCmdVel(null); setTarget(null); }}
                    style={{ padding:"0.16rem 0.45rem", borderRadius:"3px", background:"transparent", border:"1px solid #071830", color:"#0d2a45", cursor:"pointer", fontSize:"0.55rem", fontFamily:"'JetBrains Mono',monospace" }}>CLR</button>
                </div>
              </div>

              {/* Log rows */}
              <div className="hs-scroll" style={{ flex:1, overflowY:"auto", overflowX:"hidden", padding:"0.22rem 0.45rem" }}>
                {logs.length === 0 ? (
                  <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span style={{ fontSize:"0.55rem", color:"#071830", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.1em" }}>AWAITING DATA STREAM</span>
                  </div>
                ) : logs.map((log) => {
                  if (log.type === "cmd") {
                    const act = Math.abs(log.linear) > 0.001 || Math.abs(log.angular) > 0.001;
                    return (
                      <div key={log.id} className="hs-row" style={{ display:"flex", gap:"0.35rem", alignItems:"center", padding:"0.1rem 0.25rem", marginBottom:"0.04rem", borderLeft:`2px solid ${act?log.motion.color+"66":"#071830"}`, borderRadius:"0 2px 2px 0" }}>
                        <span style={{ fontSize:"0.5rem", color:"#071830", whiteSpace:"nowrap", flexShrink:0, fontFamily:"'JetBrains Mono',monospace" }}>{log.time}</span>
                        <span style={{ fontSize:"0.58rem", flexShrink:0 }}>{log.motion.icon}</span>
                        <span style={{ fontSize:"0.58rem", fontWeight:"700", color: act?log.motion.color:"#0d2a45", flexShrink:0, minWidth:"56px", fontFamily:"'JetBrains Mono',monospace" }}>{log.motion.label}</span>
                        <span style={{ fontSize:"0.52rem", color:"#0d2a45", fontFamily:"'JetBrains Mono',monospace" }}>L=<span style={{color:"#1e4060"}}>{log.linear.toFixed(3)}</span> A=<span style={{color:"#1e4060"}}>{log.angular.toFixed(3)}</span></span>
                      </div>
                    );
                  }
                  if (log.type === "target") return (
                    <div key={log.id} className="hs-row" style={{ display:"flex", gap:"0.35rem", alignItems:"center", padding:"0.1rem 0.25rem", marginBottom:"0.04rem", borderLeft:"2px solid #00d4ff22", borderRadius:"0 2px 2px 0" }}>
                      <span style={{ fontSize:"0.5rem", color:"#071830", whiteSpace:"nowrap", flexShrink:0, fontFamily:"'JetBrains Mono',monospace" }}>{log.time}</span>
                      <span style={{ fontSize:"0.52rem", color:"#00d4ff55", fontFamily:"'JetBrains Mono',monospace", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>TGT {log.data?.raw??JSON.stringify(log.data)}</span>
                    </div>
                  );
                  if (log.type === "system") return (
                    <div key={log.id} className="hs-row" style={{ display:"flex", gap:"0.35rem", alignItems:"center", padding:"0.1rem 0.25rem", marginBottom:"0.04rem", borderLeft:`2px solid ${log.color}44`, borderRadius:"0 2px 2px 0" }}>
                      <span style={{ fontSize:"0.5rem", color:"#071830", whiteSpace:"nowrap", flexShrink:0, fontFamily:"'JetBrains Mono',monospace" }}>{log.time}</span>
                      <span style={{ fontSize:"0.58rem", color:log.color, fontWeight:"700", fontFamily:"'JetBrains Mono',monospace" }}>{log.message}</span>
                    </div>
                  );
                  return null;
                })}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>

          {/* ══════ SETTINGS DRAWER (overlay, backdrop close) ══════════ */}
          {showSettings && (
            <div style={{ position:"absolute", inset:0, zIndex:50, display:"flex", justifyContent:"flex-end" }}>
              {/* Backdrop */}
              <div style={{ position:"absolute", inset:0, background:"rgba(2,8,18,0.75)", backdropFilter:"blur(3px)" }} onClick={() => setShowSettings(false)} />

              {/* Drawer panel */}
              <div className="hs-drawer" style={{ position:"relative", width:"320px", height:"100%", background:"#030b17", borderLeft:"1px solid #071830", display:"flex", flexDirection:"column", overflow:"hidden", zIndex:1 }}>

                {/* Drawer header — CLOSE BUTTON ALWAYS HERE */}
                <div style={{ padding:"0.5rem 0.7rem", borderBottom:"1px solid #071830", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", background:"#020810" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
                    <div style={{ width:"3px", height:"16px", background:"#00d4ff", borderRadius:"2px", boxShadow:"0 0 8px #00d4ff" }} />
                    <span style={{ fontSize:"0.65rem", fontWeight:"800", color:"#1e4060", letterSpacing:"0.14em", fontFamily:"'JetBrains Mono',monospace" }}>SYSTEM CONFIG</span>
                  </div>
                  <button className="hs-btn" onClick={() => setShowSettings(false)}
                    style={{ width:"26px", height:"26px", borderRadius:"4px", background:"#ff444410", border:"1px solid #ff444440", color:"#ff6666", cursor:"pointer", fontSize:"0.8rem", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"700" }}>✕</button>
                </div>

                {/* Drawer scroll */}
                <div className="hs-scroll" style={{ flex:1, overflowY:"auto", padding:"0.65rem" }}>

                  <Section title="Görüntü" accent="#00d4ff">
                    {[["TOPIC", "imageTopic"], ["MSG TYPE", "messageType"]].map(([lbl, key]) => (
                      <div key={key} style={{ marginBottom:"0.55rem" }}>
                        <div style={{ fontSize:"0.5rem", color:"#0d2a45", letterSpacing:"0.12em", marginBottom:"0.22rem", fontFamily:"'JetBrains Mono',monospace" }}>{lbl}</div>
                        <input value={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                          style={{ width:"100%", padding:"0.3rem 0.45rem", background:"#020810", border:"1px solid #071830", borderRadius:"3px", color:"#00d4ff", fontSize:"0.6rem", fontFamily:"'JetBrains Mono',monospace", boxSizing:"border-box", outline:"none" }} />
                      </div>
                    ))}
                    <button className="hs-btn" onClick={() => setSettings(defaults)} style={{ padding:"0.28rem 0.55rem", borderRadius:"3px", background:"transparent", border:"1px solid #071830", color:"#0d2a45", cursor:"pointer", fontSize:"0.55rem", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.08em" }}>RESET DEFAULTS</button>
                  </Section>

                  <Section title="Yaw Kontrol" accent="#00d4ff">
                    <PIDSlider label="KP Yaw" value={pid.kp_yaw} onChange={e => setPid(s=>({...s,kp_yaw:+e.target.value}))} min="0" max="10" step="0.1" accent="#00d4ff" />
                    <PIDSlider label="Deadband X" value={pid.deadband_x} onChange={e => setPid(s=>({...s,deadband_x:+e.target.value}))} min="0" max="0.5" step="0.01" accent="#00d4ff" />
                    <PIDSlider label="Max Angular Z" value={pid.max_angular_z} onChange={e => setPid(s=>({...s,max_angular_z:+e.target.value}))} min="0" max="5" step="0.1" accent="#00d4ff" />
                  </Section>

                  <Section title="İleri Kontrol" accent="#00ff88">
                    <PIDSlider label="V Max" value={pid.v_max} onChange={e => setPid(s=>({...s,v_max:+e.target.value}))} min="0" max="2" step="0.05" accent="#00ff88" />
                    <PIDSlider label="A Go" value={pid.a_go} onChange={e => setPid(s=>({...s,a_go:+e.target.value}))} min="0" max="1" step="0.01" accent="#00ff88" />
                    <PIDSlider label="A Stop" value={pid.a_stop} onChange={e => setPid(s=>({...s,a_stop:+e.target.value}))} min="0" max="1" step="0.01" accent="#00ff88" />
                  </Section>

                  <Section title="Algılama" accent="#ffd700">
                    <PIDSlider label="Min Conf" value={pid.min_conf} onChange={e => setPid(s=>({...s,min_conf:+e.target.value}))} min="0" max="1" step="0.05" accent="#ffd700" />
                    <PIDSlider label="Target Timeout" value={pid.target_timeout_sec} onChange={e => setPid(s=>({...s,target_timeout_sec:+e.target.value}))} min="0.05" max="5" step="0.05" accent="#ffd700" />
                    <PIDSlider label="Lowpass Alpha" value={pid.ex_lowpass_alpha} onChange={e => setPid(s=>({...s,ex_lowpass_alpha:+e.target.value}))} min="0" max="1" step="0.05" accent="#ffd700" />
                  </Section>

                  <Section title="Kalibrasyon" accent="#ff6b9d">
                    <PIDSlider label="EX Offset" value={pid.ex_offset} onChange={e => setPid(s=>({...s,ex_offset:+e.target.value}))} min="-1" max="1" step="0.05" accent="#ff6b9d" />
                    <div style={{ display:"flex", alignItems:"center", gap:"0.55rem", marginBottom:"0.75rem" }}>
                      <div onClick={() => setPid(s=>({...s,invert_ex:!s.invert_ex}))}
                        style={{ width:"32px", height:"16px", borderRadius:"8px", background: pid.invert_ex?"#ff6b9d18":"#071830", border:`1px solid ${pid.invert_ex?"#ff6b9d55":"#071830"}`, position:"relative", cursor:"pointer", transition:"all 0.2s", flexShrink:0 }}>
                        <div style={{ position:"absolute", top:"2px", left: pid.invert_ex?"17px":"2px", width:"11px", height:"11px", borderRadius:"50%", background: pid.invert_ex?"#ff6b9d":"#0d2a45", transition:"left 0.2s" }} />
                      </div>
                      <span style={{ fontSize:"0.56rem", color:"#1e4060", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.08em" }}>INVERT EX</span>
                    </div>
                  </Section>

                  {tuneStatus && (
                    <div style={{ padding:"0.35rem 0.5rem", background: tuneStatus.startsWith("OK")?"#00ff8806":"#ff444406", border:`1px solid ${tuneStatus.startsWith("OK")?"#00ff8833":"#ff444433"}`, borderRadius:"3px", marginBottom:"0.6rem", fontSize:"0.58rem", color: tuneStatus.startsWith("OK")?"#00ff88":"#ff6666", fontFamily:"'JetBrains Mono',monospace" }}>
                      {tuneStatus}
                    </div>
                  )}

                  <div style={{ display:"flex", gap:"0.4rem" }}>
                    <button className="hs-btn" onClick={applyPID} disabled={tuneLoading || !isConnected}
                      style={{ flex:1, padding:"0.45rem", borderRadius:"4px", background: isConnected&&!tuneLoading?"#00d4ff10":"transparent", border:`1px solid ${isConnected?"#00d4ff33":"#071830"}`, color: isConnected&&!tuneLoading?"#00d4ff":"#0d2a45", cursor: isConnected&&!tuneLoading?"pointer":"not-allowed", fontSize:"0.65rem", fontWeight:"700", letterSpacing:"0.1em", fontFamily:"'JetBrains Mono',monospace", opacity: tuneLoading||!isConnected?0.5:1 }}>
                      {tuneLoading ? "SENDING..." : "▶ APPLY PID"}
                    </button>
                    <button className="hs-btn" onClick={() => setPid(pidDefs)} disabled={tuneLoading}
                      style={{ padding:"0.45rem 0.65rem", borderRadius:"4px", background:"transparent", border:"1px solid #071830", color:"#0d2a45", cursor: tuneLoading?"not-allowed":"pointer", fontSize:"0.62rem", fontFamily:"'JetBrains Mono',monospace", opacity: tuneLoading?0.5:1 }}>RESET</button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
