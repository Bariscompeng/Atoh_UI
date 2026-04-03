import React, { useEffect, useRef, useState } from "react";
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

export default function MapPage() {
  const { ros, isConnected, status: globalStatus, errorText: globalErrorText, reconnect } = useROS();

  const [mapTopic,     setMapTopic]     = useState("/map");
  const [poseTopic,    setPoseTopic]    = useState("/amcl_pose");
  const [mapData,      setMapData]      = useState(null);
  const [robotPose,    setRobotPose]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [zoomLevel,    setZoomLevel]    = useState(1);

  const canvasRef   = useRef(null);
  const viewportRef = useRef(null);
  const mapSubRef   = useRef(null);
  const poseSubRef  = useRef(null);

  useEffect(() => {
    if (!ros || !isConnected) { setMapData(null); setRobotPose(null); return; }

    const mapSub = new ROSLIB.Topic({
      ros, name: mapTopic, messageType: "nav_msgs/OccupancyGrid",
      queue_length: 1, throttle_rate: 200,
    });
    mapSub.subscribe(msg => setMapData(msg));
    mapSubRef.current = mapSub;

    const poseSub = new ROSLIB.Topic({
      ros, name: poseTopic, messageType: "geometry_msgs/PoseWithCovarianceStamped",
      queue_length: 1, throttle_rate: 100,
    });
    poseSub.subscribe(msg => { if (msg?.pose?.pose) setRobotPose(msg.pose.pose); });
    poseSubRef.current = poseSub;

    return () => {
      try { mapSub.unsubscribe(); }  catch {}
      try { poseSub.unsubscribe(); } catch {}
    };
  }, [ros, isConnected, mapTopic, poseTopic]);

  useEffect(() => {
    if (!mapData || !canvasRef.current || !viewportRef.current) return;

    const canvas  = canvasRef.current;
    const ctx     = canvas.getContext("2d");
    const dpr     = window.devicePixelRatio || 1;
    const vw      = viewportRef.current.clientWidth;
    const vh      = viewportRef.current.clientHeight;

    canvas.width  = Math.max(1, Math.floor(vw * dpr));
    canvas.height = Math.max(1, Math.floor(vh * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = false;

    const { width: mw, height: mh, resolution, origin } = mapData.info;
    const data    = mapData.data;
    const scale   = Math.min(vw / mw, vh / mh) * zoomLevel;
    const offsetX = (vw - mw * scale) / 2;
    const offsetY = (vh - mh * scale) / 2;

    const tmp    = document.createElement("canvas");
    tmp.width    = mw; tmp.height = mh;
    const tmpCtx = tmp.getContext("2d");
    const img    = tmpCtx.createImageData(mw, mh);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      // RViz standard: free=white(205), obstacle=black(0), unknown=gray(128)
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

    if (robotPose) {
      const px  = (robotPose.position.x - origin.position.x) / resolution;
      const py  = mh - (robotPose.position.y - origin.position.y) / resolution;
      const cx  = offsetX + px * scale;
      const cy  = offsetY + py * scale;
      const q   = robotPose.orientation;
      const yaw = Math.atan2(2*(q.w*q.z + q.x*q.y), 1 - 2*(q.y*q.y + q.z*q.z));

      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 22);
      grad.addColorStop(0, "rgba(14,165,233,0.4)");
      grad.addColorStop(1, "rgba(14,165,233,0)");
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI*2);
      ctx.fillStyle = grad; ctx.fill();

      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI*2);
      ctx.fillStyle = ACCENT;
      ctx.shadowColor = ACCENT; ctx.shadowBlur = 10;
      ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-yaw);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, 0);
      ctx.strokeStyle = "#facc15";
      ctx.shadowColor = "#facc15"; ctx.shadowBlur = 6;
      ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
      ctx.restore();
    }
  }, [mapData, robotPose, zoomLevel]);

  return (
    <div style={{
      height: "calc(100vh - 56px)",
      background: BG,
      backgroundImage: "radial-gradient(rgba(14,165,233,0.06) 1px, transparent 1px)",
      backgroundSize: "24px 24px",
      color: TEXT, padding: "0.65rem",
      fontFamily: MONO, overflow: "auto",
      display: "flex", flexDirection: "column", gap: "0.5rem",
      boxSizing: "border-box",
    }}>

      {/* HEADER */}
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <div style={{
            width: 32, height: 32, background: "rgba(14,165,233,0.1)",
            border: `1px solid rgba(14,165,233,0.35)`, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1rem", boxShadow: "0 0 12px rgba(14,165,233,0.15)",
          }}>🗺️</div>
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.14em", color: ACCENT }}>LIVE MAP</div>
            <div style={{ fontSize: "0.55rem", color: TEXT2, letterSpacing: "0.1em", marginTop: 1 }}>OCCUPANCY GRID · ROBOT POSE</div>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(v => !v)}
          style={btnStyle(showSettings ? ACCENT : TEXT2, showSettings ? "rgba(14,165,233,0.1)" : "transparent", `1px solid ${showSettings ? "rgba(14,165,233,0.4)" : BORDER2}`)}>
          ⚙ {showSettings ? "Gizle" : "Ayarlar"}
        </button>
      </div>

      {/* STATUS BAR */}
      <div style={{
        flexShrink: 0, background: SURFACE, borderRadius: 5,
        padding: "0.45rem 0.85rem",
        border: `1px solid ${isConnected ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
        display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: isConnected ? "#10b981" : "#ef4444",
          boxShadow: `0 0 8px ${isConnected ? "#10b981" : "#ef4444"}`,
        }} />
        <span style={{ fontSize: "0.68rem", color: TEXT2, flex: 1 }}>{globalStatus || "—"}</span>
        {globalErrorText && (
          <span style={{ fontSize: "0.62rem", color: "#f87171", background: "rgba(239,68,68,0.08)", padding: "0.15rem 0.4rem", borderRadius: 3 }}>
            ⚠ {globalErrorText}
          </span>
        )}
        {robotPose && (
          <span style={{ fontSize: "0.62rem", color: "#facc15", fontWeight: 600, marginLeft: "auto" }}>
            ⬡ x:{robotPose.position.x.toFixed(3)} &nbsp; y:{robotPose.position.y.toFixed(3)}
          </span>
        )}
        {!isConnected && (
          <button onClick={reconnect} style={btnStyle(ACCENT, "rgba(14,165,233,0.12)", `1px solid ${ACCENT}`)}>
            ⚡ Bağlan
          </button>
        )}
        {isConnected && (
          <span style={{ fontSize: "0.62rem", color: "#10b981", fontWeight: 600 }}>● CONNECTED</span>
        )}
      </div>

      {/* SETTINGS */}
      {showSettings && (
        <div style={{
          flexShrink: 0, background: SURFACE, borderRadius: 6, padding: "0.85rem",
          border: `1px solid ${BORDER2}`,
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: "0.65rem",
        }}>
          <div>
            <div style={lblStyle}>Map Topic</div>
            <input type="text" value={mapTopic} onChange={e => setMapTopic(e.target.value)} placeholder="/map" style={inpStyle} />
          </div>
          <div>
            <div style={lblStyle}>Pose Topic</div>
            <input type="text" value={poseTopic} onChange={e => setPoseTopic(e.target.value)} placeholder="/amcl_pose" style={inpStyle} />
          </div>
          <div>
            <div style={lblStyle}>Zoom — {zoomLevel.toFixed(1)}×</div>
            <input type="range" min="0.5" max="3" step="0.1" value={zoomLevel}
              onChange={e => setZoomLevel(Number(e.target.value))}
              style={{ width: "100%", accentColor: ACCENT, cursor: "pointer", marginTop: 8 }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.55rem", color: TEXT3, marginTop: 4 }}>
              <span>0.5×</span><span>3.0×</span>
            </div>
          </div>
        </div>
      )}

      {/* MAP CANVAS */}
      <div style={{
        flex: 1, background: SURFACE, borderRadius: 6, padding: "0.75rem",
        border: `1px solid ${BORDER2}`, display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem", flexShrink: 0, flexWrap: "wrap", gap: "0.3rem" }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: TEXT, letterSpacing: "0.1em" }}>MAP VIEW</div>
          {mapData && (
            <div style={{ fontSize: "0.58rem", color: TEXT2 }}>
              {mapData.info.width}×{mapData.info.height}px &nbsp;·&nbsp; {mapData.info.resolution.toFixed(3)} m/px &nbsp;·&nbsp;
              <span style={{ color: robotPose ? "#10b981" : TEXT3 }}>
                {robotPose ? "● ROBOT TRACKED" : "○ NO POSE"}
              </span>
            </div>
          )}
        </div>

        {mapData ? (
          <div ref={viewportRef} style={{
            flex: 1, overflow: "hidden", borderRadius: 5,
            border: `1px solid ${BORDER2}`, background: "#020609",
            position: "relative", minHeight: 0,
            boxShadow: "inset 0 0 40px rgba(0,0,0,0.7)",
          }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
          </div>
        ) : (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: "0.75rem", minHeight: 200,
          }}>
            <div style={{ fontSize: "2.5rem", opacity: 0.15 }}>🗺️</div>
            <div style={{ fontSize: "0.72rem", color: TEXT3 }}>
              {isConnected ? "Harita bekleniyor..." : "Bağlantı bekleniyor"}
            </div>
            <div style={{ fontSize: "0.6rem", color: BORDER2 }}>{mapTopic}</div>
          </div>
        )}
      </div>

      {/* LEGEND */}
      <div style={{
        flexShrink: 0, background: SURFACE, borderRadius: 5,
        padding: "0.5rem 0.85rem", border: `1px solid ${BORDER2}`,
        display: "flex", gap: "1.2rem", justifyContent: "center", flexWrap: "wrap",
      }}>
        {[
          { color: "#cdcdcd", label: "FREE SPACE" },
          { color: "#000000", label: "OBSTACLE"   },
          { color: "#808080", label: "UNKNOWN"     },
          { color: ACCENT,    label: "ROBOT", round: true },
        ].map(({ color, label, round }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.6rem", color: TEXT2 }}>
            <div style={{
              width: 10, height: 10, background: color,
              border: `1px solid ${BORDER2}`, borderRadius: round ? "50%" : 2,
              boxShadow: label === "ROBOT" ? `0 0 5px ${ACCENT}` : "none",
            }} />
            {label}
          </div>
        ))}
      </div>

    </div>
  );
}
