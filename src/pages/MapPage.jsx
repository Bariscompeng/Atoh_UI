import React, { useEffect, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

const BG      = "#04090f";
const SURFACE = "#07111d";
const BORDER  = "#0f2236";
const BORDER2 = "#162d46";
const TEXT    = "#c8dde8";
const TEXT2   = "#4a7a96";
const TEXT3   = "#1e3a52";
const ACCENT  = "#0ea5e9";
const MONO    = "'JetBrains Mono','Fira Code',monospace";

const btnStyle = (color, bg, border) => ({
  padding: "0.42rem 0.75rem", background: bg, border,
  borderRadius: 5, color, cursor: "pointer",
  fontWeight: 700, fontSize: "0.65rem", fontFamily: MONO,
  transition: "all 0.15s", whiteSpace: "nowrap",
});
const inpStyle = {
  width: "100%", padding: "0.42rem 0.55rem",
  background: "#03070e", border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: "0.68rem",
  outline: "none", fontFamily: MONO, boxSizing: "border-box",
};
const lblStyle = {
  fontSize: "0.53rem", color: TEXT3, letterSpacing: "0.1em",
  marginBottom: "0.3rem", textTransform: "uppercase",
};

function canvasToMap(cssX, cssY, mapInfo, scale, offsetX, offsetY) {
  const mh  = mapInfo.height;
  const res = mapInfo.resolution;
  const ox  = mapInfo.origin.position.x;
  const oy  = mapInfo.origin.position.y;
  const mapPxX = (cssX - offsetX) / scale;
  const mapPxY = (cssY - offsetY) / scale;
  return { x: mapPxX * res + ox, y: (mh - mapPxY) * res + oy };
}

function CtxItem({ icon, label, sublabel, color, disabled, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: "0.55rem",
        width: "100%", padding: "0.45rem 0.85rem",
        background: hover && !disabled ? "rgba(255,255,255,0.04)" : "transparent",
        border: "none", cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left", opacity: disabled ? 0.35 : 1,
        transition: "background 0.1s",
      }}>
      <span style={{ fontSize: "0.85rem", width: 20, textAlign: "center" }}>{icon}</span>
      <div>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, color, fontFamily: MONO }}>{label}</div>
        {sublabel && <div style={{ fontSize: "0.5rem", color: "#1e3a52", marginTop: 1 }}>{sublabel}</div>}
      </div>
    </button>
  );
}

export default function MapPage() {
  const { ros, isConnected, status: globalStatus, errorText: globalErrorText, reconnect } = useROS();

  const [mapTopic,     setMapTopic]     = useState("/map");
  const [poseTopic,    setPoseTopic]    = useState("/amcl_pose");
  const [mapData,      setMapData]      = useState(null);
  const [robotPose,    setRobotPose]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [zoomLevel,    setZoomLevel]    = useState(1);
  const [clickedGoal,  setClickedGoal]  = useState(null);
  const [ctxMenu,      setCtxMenu]      = useState(null);
  const [feedback,     setFeedback]     = useState(null);
  const [alert,        setAlert]        = useState(null); // {found, score, image_b64, robot_pose}

  const canvasRef   = useRef(null);
  const viewportRef = useRef(null);
  const renderRef   = useRef({ scale: 1, offsetX: 0, offsetY: 0 });

  const showFeedback = useCallback((msg, color = "#10b981") => {
    setFeedback({ msg, color });
    setTimeout(() => setFeedback(null), 3000);
  }, []);

  const sendRunCmd = useCallback((cmdStr) => {
    if (!ros || !isConnected) { showFeedback("ROS bağlı değil!", "#ef4444"); return; }
    try {
      const topic = new ROSLIB.Topic({ ros, name: "/task_manager/run_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
      topic.publish({ data: cmdStr });
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
    } catch (e) { showFeedback("Hata: " + e?.message, "#ef4444"); }
  }, [ros, isConnected, showFeedback]);

  const sendGoPose = useCallback((x, y, yaw = 0) => {
    sendRunCmd(`run GoPose {"goal":{"x":${x.toFixed(4)},"y":${y.toFixed(4)},"yaw":${yaw.toFixed(4)}}}`);
    showFeedback(`🎯 GoPose → (${x.toFixed(2)}, ${y.toFixed(2)})`);
  }, [sendRunCmd, showFeedback]);

  const sendPrecisionWorkAt = useCallback((x, y, yaw = 0, returnHome = false) => {
    sendRunCmd(`run PrecisionWorkAt {"goal":{"x":${x.toFixed(4)},"y":${y.toFixed(4)},"yaw":${yaw.toFixed(4)}},"return_home":${returnHome}}`);
    showFeedback(`🔧 PrecisionWorkAt → (${x.toFixed(2)}, ${y.toFixed(2)})`, "#f59e0b");
  }, [sendRunCmd, showFeedback]);

  const sendOperatorCmd = useCallback((cmd) => {
    if (!ros || !isConnected) return;
    try {
      const topic = new ROSLIB.Topic({ ros, name: "/precision_work/operator_cmd", messageType: "std_msgs/msg/String", queue_size: 1 });
      topic.publish({ data: cmd });
      setTimeout(() => { try { topic.unadvertise(); } catch {} }, 500);
      setAlert(null);
      showFeedback(cmd === "continue" ? "✅ Devam et komutu gönderildi" : "↩ Geri dön komutu gönderildi", cmd === "continue" ? "#10b981" : "#f59e0b");
    } catch (e) { showFeedback("Hata: " + e?.message, "#ef4444"); }
  }, [ros, isConnected, showFeedback]);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const handleCanvasClick = useCallback((e) => {
    if (!mapData || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { scale, offsetX, offsetY } = renderRef.current;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const world = canvasToMap(cssX, cssY, mapData.info, scale, offsetX, offsetY);

    if (e.type === "contextmenu") {
      e.preventDefault();
      setCtxMenu({ screenX: e.clientX, screenY: e.clientY, worldX: world.x, worldY: world.y });
      return;
    }
    setClickedGoal({ x: world.x, y: world.y });
    setCtxMenu(null);
  }, [mapData]);

  useEffect(() => {
    if (!ctxMenu) return;
    const h = () => closeCtxMenu();
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [ctxMenu, closeCtxMenu]);

  useEffect(() => {
    if (!ros || !isConnected) { setMapData(null); setRobotPose(null); return; }
    const mapSub = new ROSLIB.Topic({ ros, name: mapTopic, messageType: "nav_msgs/OccupancyGrid", queue_length: 1, throttle_rate: 200 });
    mapSub.subscribe(msg => setMapData(msg));
    const poseSub = new ROSLIB.Topic({ ros, name: poseTopic, messageType: "geometry_msgs/PoseWithCovarianceStamped", queue_length: 1, throttle_rate: 100 });
    poseSub.subscribe(msg => { if (msg?.pose?.pose) setRobotPose(msg.pose.pose); });
    return () => { try { mapSub.unsubscribe(); } catch {} try { poseSub.unsubscribe(); } catch {} };
  }, [ros, isConnected, mapTopic, poseTopic]);

  // /precision_work/result subscription
  useEffect(() => {
    if (!ros || !isConnected) return;
    const sub = new ROSLIB.Topic({ ros, name: "/precision_work/result", messageType: "std_msgs/msg/String", queue_length: 1 });
    sub.subscribe(msg => {
      try {
        const data = JSON.parse(msg.data);
        if (data.found) {
          setAlert(data);
          showFeedback("🚨 İNSAN TESPİT EDİLDİ!", "#ef4444");
        } else {
          setAlert(null);
          showFeedback("✅ İnsan bulunamadı, devam ediliyor", "#10b981");
        }
      } catch {}
    });
    return () => { try { sub.unsubscribe(); } catch {} };
  }, [ros, isConnected, showFeedback]);

  useEffect(() => {
    if (!mapData || !canvasRef.current || !viewportRef.current) return;
    const { width: mw, height: mh, resolution, origin } = mapData.info;
    if (!mw || !mh || mw <= 0 || mh <= 0) return; // harita boyutu henüz geçerli değil

    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    const dpr    = window.devicePixelRatio || 1;
    const vw     = Math.max(1, viewportRef.current.clientWidth);
    const vh     = Math.max(1, viewportRef.current.clientHeight);
    canvas.width  = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = false;
    const scale   = Math.min(vw / mw, vh / mh) * zoomLevel;
    const offsetX = (vw - mw * scale) / 2;
    const offsetY = (vh - mh * scale) / 2;
    renderRef.current = { scale, offsetX, offsetY };

    const tmp = document.createElement("canvas");
    tmp.width = mw; tmp.height = mh;
    const tmpCtx = tmp.getContext("2d");
    const img = tmpCtx.createImageData(mw, mh);
    for (let i = 0; i < mapData.data.length; i++) {
      const v = mapData.data[i];
      const c = v === -1 ? 128 : v === 0 ? 205 : 0;
      const idx = i * 4;
      img.data[idx] = c; img.data[idx+1] = c; img.data[idx+2] = c; img.data[idx+3] = 255;
    }
    tmpCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();

    // Hedef noktası
    if (clickedGoal) {
      const gpx = (clickedGoal.x - origin.position.x) / resolution;
      const gpy = mh - (clickedGoal.y - origin.position.y) / resolution;
      const gcx = offsetX + gpx * scale;
      const gcy = offsetY + gpy * scale;
      ctx.beginPath(); ctx.arc(gcx, gcy, 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2.5;
      ctx.shadowColor = "#f59e0b"; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(gcx, gcy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#f59e0b"; ctx.fill();
      ctx.font = `bold 11px ${MONO}`;
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(`(${clickedGoal.x.toFixed(2)}, ${clickedGoal.y.toFixed(2)})`, gcx + 12, gcy - 6);
    }

    // Robot
    if (robotPose) {
      const px = (robotPose.position.x - origin.position.x) / resolution;
      const py = mh - (robotPose.position.y - origin.position.y) / resolution;
      const cx = offsetX + px * scale;
      const cy = offsetY + py * scale;
      const q  = robotPose.orientation;
      const yaw = Math.atan2(2*(q.w*q.z + q.x*q.y), 1 - 2*(q.y*q.y + q.z*q.z));
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 22);
      grad.addColorStop(0, "rgba(14,165,233,0.4)"); grad.addColorStop(1, "rgba(14,165,233,0)");
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI*2); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI*2);
      ctx.fillStyle = ACCENT; ctx.shadowColor = ACCENT; ctx.shadowBlur = 10; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-yaw);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, 0);
      ctx.strokeStyle = "#facc15"; ctx.shadowColor = "#facc15"; ctx.shadowBlur = 6;
      ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
      ctx.restore();
    }
  }, [mapData, robotPose, zoomLevel, clickedGoal]);

  return (
    <div style={{
      height: "calc(100vh - 56px)", background: BG,
      backgroundImage: "radial-gradient(rgba(14,165,233,0.06) 1px, transparent 1px)",
      backgroundSize: "24px 24px", color: TEXT, padding: "0.65rem",
      fontFamily: MONO, overflow: "auto",
      display: "flex", flexDirection: "column", gap: "0.5rem",
      boxSizing: "border-box", position: "relative",
    }}>

      {/* HEADER */}
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <div style={{ width: 32, height: 32, background: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.35)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>🗺️</div>
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.14em", color: ACCENT }}>LIVE MAP</div>
            <div style={{ fontSize: "0.55rem", color: TEXT2, marginTop: 1 }}>SAĞ TIK → komut menüsü &nbsp;·&nbsp; SOL TIK → koordinat işaretle</div>
          </div>
        </div>
        <button onClick={() => setShowSettings(v => !v)} style={btnStyle(showSettings ? ACCENT : TEXT2, showSettings ? "rgba(14,165,233,0.1)" : "transparent", `1px solid ${showSettings ? "rgba(14,165,233,0.4)" : BORDER2}`)}>
          ⚙ {showSettings ? "Gizle" : "Ayarlar"}
        </button>
      </div>

      {/* STATUS BAR */}
      <div style={{ flexShrink: 0, background: SURFACE, borderRadius: 5, padding: "0.45rem 0.85rem", border: `1px solid ${isConnected ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`, display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: isConnected ? "#10b981" : "#ef4444", boxShadow: `0 0 8px ${isConnected ? "#10b981" : "#ef4444"}` }} />
        <span style={{ fontSize: "0.68rem", color: TEXT2, flex: 1 }}>{globalStatus || "—"}</span>
        {globalErrorText && <span style={{ fontSize: "0.62rem", color: "#f87171", background: "rgba(239,68,68,0.08)", padding: "0.15rem 0.4rem", borderRadius: 3 }}>⚠ {globalErrorText}</span>}
        {robotPose && <span style={{ fontSize: "0.62rem", color: "#facc15", fontWeight: 600, marginLeft: "auto" }}>⬡ x:{robotPose.position.x.toFixed(3)} &nbsp; y:{robotPose.position.y.toFixed(3)}</span>}
        {!isConnected && <button onClick={reconnect} style={btnStyle(ACCENT, "rgba(14,165,233,0.12)", `1px solid ${ACCENT}`)}>⚡ Bağlan</button>}
        {isConnected && <span style={{ fontSize: "0.62rem", color: "#10b981", fontWeight: 600 }}>● CONNECTED</span>}
      </div>

      {/* SETTINGS */}
      {showSettings && (
        <div style={{ flexShrink: 0, background: SURFACE, borderRadius: 6, padding: "0.85rem", border: `1px solid ${BORDER2}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: "0.65rem" }}>
          <div><div style={lblStyle}>Map Topic</div><input type="text" value={mapTopic} onChange={e => setMapTopic(e.target.value)} placeholder="/map" style={inpStyle} /></div>
          <div><div style={lblStyle}>Pose Topic</div><input type="text" value={poseTopic} onChange={e => setPoseTopic(e.target.value)} placeholder="/amcl_pose" style={inpStyle} /></div>
          <div>
            <div style={lblStyle}>Zoom — {zoomLevel.toFixed(1)}×</div>
            <input type="range" min="0.5" max="3" step="0.1" value={zoomLevel} onChange={e => setZoomLevel(Number(e.target.value))} style={{ width: "100%", accentColor: ACCENT, cursor: "pointer", marginTop: 8 }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.55rem", color: TEXT3, marginTop: 4 }}><span>0.5×</span><span>3.0×</span></div>
          </div>
        </div>
      )}

      {/* CLICKED GOAL PANEL */}
      {clickedGoal && (
        <div style={{ flexShrink: 0, background: "rgba(245,158,11,0.08)", borderRadius: 6, padding: "0.55rem 0.85rem", border: "1px solid rgba(245,158,11,0.35)", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.65rem", color: "#f59e0b", fontWeight: 700 }}>📍 x:{clickedGoal.x.toFixed(3)} &nbsp; y:{clickedGoal.y.toFixed(3)}</span>
          <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto", flexWrap: "wrap" }}>
            <button onClick={() => sendGoPose(clickedGoal.x, clickedGoal.y)} disabled={!isConnected} style={{ ...btnStyle("#fff", "#7c3aed", "none"), opacity: isConnected ? 1 : 0.4, fontSize: "0.62rem" }}>🎯 GoPose</button>
            <button onClick={() => sendPrecisionWorkAt(clickedGoal.x, clickedGoal.y, 0, false)} disabled={!isConnected} style={{ ...btnStyle("#fff", "#b45309", "none"), opacity: isConnected ? 1 : 0.4, fontSize: "0.62rem" }}>🔧 Hassas İşlem</button>
            <button onClick={() => sendPrecisionWorkAt(clickedGoal.x, clickedGoal.y, 0, true)} disabled={!isConnected} style={{ ...btnStyle("#fff", "#065f46", "none"), opacity: isConnected ? 1 : 0.4, fontSize: "0.62rem" }}>🔧↩ Hassas + Geri Dön</button>
            <button onClick={() => setClickedGoal(null)} style={{ ...btnStyle(TEXT3, "transparent", `1px solid ${BORDER2}`), fontSize: "0.62rem" }}>✕</button>
          </div>
        </div>
      )}

      {/* MAP CANVAS */}
      <div style={{ flex: 1, background: SURFACE, borderRadius: 6, padding: "0.75rem", border: `1px solid ${BORDER2}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem", flexShrink: 0, flexWrap: "wrap", gap: "0.3rem" }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: TEXT, letterSpacing: "0.1em" }}>MAP VIEW</div>
          {mapData && (
            <div style={{ fontSize: "0.58rem", color: TEXT2 }}>
              {mapData.info.width}×{mapData.info.height}px &nbsp;·&nbsp; {mapData.info.resolution.toFixed(3)} m/px &nbsp;·&nbsp;
              <span style={{ color: robotPose ? "#10b981" : TEXT3 }}>{robotPose ? "● ROBOT TRACKED" : "○ NO POSE"}</span>
            </div>
          )}
        </div>

        {mapData ? (
          <div ref={viewportRef} style={{ flex: 1, overflow: "hidden", borderRadius: 5, border: `1px solid ${BORDER2}`, background: "#020609", position: "relative", minHeight: 0, boxShadow: "inset 0 0 40px rgba(0,0,0,0.7)", cursor: "crosshair" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} onClick={handleCanvasClick} onContextMenu={handleCanvasClick} />
            {!clickedGoal && (
              <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "rgba(4,9,15,0.8)", border: `1px solid ${BORDER2}`, borderRadius: 4, padding: "0.3rem 0.7rem", fontSize: "0.55rem", color: TEXT3, pointerEvents: "none" }}>
                Sağ tık → komut menüsü &nbsp;|&nbsp; Sol tık → koordinat seç
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem", minHeight: 200 }}>
            <div style={{ fontSize: "2.5rem", opacity: 0.15 }}>🗺️</div>
            <div style={{ fontSize: "0.72rem", color: TEXT3 }}>{isConnected ? "Harita bekleniyor..." : "Bağlantı bekleniyor"}</div>
            <div style={{ fontSize: "0.6rem", color: BORDER2 }}>{mapTopic}</div>
          </div>
        )}
      </div>

      {/* LEGEND */}
      <div style={{ flexShrink: 0, background: SURFACE, borderRadius: 5, padding: "0.5rem 0.85rem", border: `1px solid ${BORDER2}`, display: "flex", gap: "1.2rem", justifyContent: "center", flexWrap: "wrap" }}>
        {[
          { color: "#cdcdcd", label: "FREE SPACE" },
          { color: "#000000", label: "OBSTACLE"   },
          { color: "#808080", label: "UNKNOWN"     },
          { color: ACCENT,    label: "ROBOT",   round: true },
          { color: "#f59e0b", label: "HEDEF",   round: true },
        ].map(({ color, label, round }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.6rem", color: TEXT2 }}>
            <div style={{ width: 10, height: 10, background: color, border: `1px solid ${BORDER2}`, borderRadius: round ? "50%" : 2, boxShadow: label === "ROBOT" ? `0 0 5px ${ACCENT}` : label === "HEDEF" ? "0 0 5px #f59e0b" : "none" }} />
            {label}
          </div>
        ))}
      </div>

      {/* HUMAN DETECTION ALERT */}
      {alert && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.75)", zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: MONO,
        }}>
          <div style={{
            background: "#07111d", border: "2px solid #ef4444",
            borderRadius: 10, padding: "1.5rem", maxWidth: 420, width: "90%",
            boxShadow: "0 0 40px rgba(239,68,68,0.4)",
          }}>
            {/* Başlık */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
              <div style={{ fontSize: "1.5rem" }}>🚨</div>
              <div>
                <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#ef4444", letterSpacing: "0.1em" }}>İNSAN TESPİT EDİLDİ</div>
                <div style={{ fontSize: "0.55rem", color: "#4a7a96", marginTop: 2 }}>
                  Güven: {alert.score ? (alert.score * 100).toFixed(1) + "%" : "—"}
                  {alert.robot_pose && ` · Konum: (${alert.robot_pose.x.toFixed(2)}, ${alert.robot_pose.y.toFixed(2)})`}
                </div>
              </div>
            </div>

            {/* Fotoğraf */}
            {alert.image_b64 && (
              <div style={{ marginBottom: "1rem", borderRadius: 6, overflow: "hidden", border: "1px solid #162d46" }}>
                <img
                  src={`data:image/${alert.image_format || "jpeg"};base64,${alert.image_b64}`}
                  alt="Tespit"
                  style={{ width: "100%", display: "block", maxHeight: 220, objectFit: "cover" }}
                />
              </div>
            )}

            {/* Açıklama */}
            <div style={{ fontSize: "0.65rem", color: "#4a7a96", marginBottom: "1rem", lineHeight: 1.6 }}>
              Operatör kararı bekleniyor. Robot bu noktada bekliyor.
            </div>

            {/* Butonlar */}
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button
                onClick={() => sendOperatorCmd("continue")}
                style={{ ...btnStyle("#fff", "#065f46", "1px solid #10b981"), flex: 1, fontSize: "0.75rem", padding: "0.65rem" }}>
                ✅ Devam Et
              </button>
              <button
                onClick={() => sendOperatorCmd("return_home")}
                style={{ ...btnStyle("#fff", "#7c2d12", "1px solid #f59e0b"), flex: 1, fontSize: "0.75rem", padding: "0.65rem" }}>
                ↩ Geri Dön
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FEEDBACK TOAST */}
      {feedback && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#07111d", border: `1px solid ${feedback.color}`, borderRadius: 6, padding: "0.5rem 1.2rem", fontSize: "0.7rem", color: feedback.color, fontWeight: 700, fontFamily: MONO, zIndex: 9999, pointerEvents: "none", boxShadow: `0 0 20px ${feedback.color}44` }}>
          {feedback.msg}
        </div>
      )}

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(ctxMenu.screenX, window.innerWidth - 230), top: Math.min(ctxMenu.screenY, window.innerHeight - 200), background: "#07111d", border: `1px solid ${BORDER2}`, borderRadius: 7, padding: "0.4rem 0", zIndex: 9999, minWidth: 220, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", fontFamily: MONO }}>
          <div style={{ padding: "0.3rem 0.85rem 0.5rem", fontSize: "0.55rem", color: TEXT3, borderBottom: `1px solid ${BORDER}`, marginBottom: "0.3rem" }}>
            x:{ctxMenu.worldX.toFixed(3)} &nbsp; y:{ctxMenu.worldY.toFixed(3)}
          </div>
          <CtxItem icon="🎯" label="Hedefe Git (GoPose)" color="#a78bfa" disabled={!isConnected}
            onClick={() => { sendGoPose(ctxMenu.worldX, ctxMenu.worldY); setClickedGoal({ x: ctxMenu.worldX, y: ctxMenu.worldY }); closeCtxMenu(); }} />
          <div style={{ height: 1, background: BORDER, margin: "0.3rem 0" }} />
          <CtxItem icon="🔧" label="Hassas İşlem Yap" sublabel="Dur · İşle · Devam" color="#f59e0b" disabled={!isConnected}
            onClick={() => { sendPrecisionWorkAt(ctxMenu.worldX, ctxMenu.worldY, 0, false); setClickedGoal({ x: ctxMenu.worldX, y: ctxMenu.worldY }); closeCtxMenu(); }} />
          <CtxItem icon="🔧↩" label="Hassas İşlem + Geri Dön" sublabel="İş bitince başlangıca dön" color="#10b981" disabled={!isConnected}
            onClick={() => { sendPrecisionWorkAt(ctxMenu.worldX, ctxMenu.worldY, 0, true); setClickedGoal({ x: ctxMenu.worldX, y: ctxMenu.worldY }); closeCtxMenu(); }} />
          <div style={{ height: 1, background: BORDER, margin: "0.3rem 0" }} />
          <CtxItem icon="⏹" label="Aktif Görevi Durdur" color="#f87171" disabled={!isConnected}
            onClick={() => { sendRunCmd("stop"); closeCtxMenu(); }} />
          <CtxItem icon="✕" label="Kapat" color={TEXT3} onClick={closeCtxMenu} />
        </div>
      )}

    </div>
  );
}
