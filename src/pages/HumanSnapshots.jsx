import React, { useEffect, useMemo, useRef, useState } from "react";
import { useROS } from "../context/ROSContext";

const ROSLIB = window.ROSLIB;
const LS_KEY = "human_snapshots_settings_v1";
const LS_PID_KEY = "human_follow_pid_settings_v1";

// Yardımcı Fonksiyonlar
function uint8ToBase64(u8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeCompressedData(data) {
  if (typeof data === "string") return { b64: data, bytes: Math.floor((data.length * 3) / 4) };
  if (data instanceof Uint8Array || Array.isArray(data)) {
    const u8 = new Uint8Array(data);
    return { b64: uint8ToBase64(u8), bytes: u8.length };
  }
  return { b64: null, bytes: 0 };
}

export default function HumanSnapshots() {
  const { ros, isConnected, status: globalStatus, errorText: globalErrorText } = useROS();

  // --- Varsayılan Ayarlar ---
  const defaults = useMemo(() => ({
    imageTopic: "/human_debug_snapshot/jpeg",
    messageType: "sensor_msgs/CompressedImage",
    throttleMs: 50,
    fitMode: "contain",
    showSettings: false,
    showLogs: true,
  }), []);

  const pidDefaults = useMemo(() => ({
    kp_yaw: 0.9,
    deadband_x: 0.05,
    max_angular_z: 1.0,
    v_max: 0.40,
    a_go: 0.05,
    a_stop: 0.25,
    min_conf: 0.35,
    target_timeout_sec: 0.8,
    ex_lowpass_alpha: 0.8,
    invert_ex: false,
    ex_offset: 0.0,
  }), []);

  // --- State Yönetimi ---
  const [settings, setSettings] = useState(() => ({ ...defaults, ...(JSON.parse(localStorage.getItem(LS_KEY)) || {}) }));
  const [pidSettings, setPidSettings] = useState(() => ({ ...pidDefaults, ...(JSON.parse(localStorage.getItem(LS_PID_KEY)) || {}) }));
  const [imgSrc, setImgSrc] = useState(null);
  const [fps, setFps] = useState(0);
  const [logs, setLogs] = useState([]);
  const [humanFollowEnabled, setHumanFollowEnabled] = useState(false);
  const [tuningStatus, setTuningStatus] = useState("");
  const [tuningLoading, setTuningLoading] = useState(false);

  const subRef = useRef(null);
  const logContainerRef = useRef(null);
  const fpsRef = useRef({ t0: performance.now(), n: 0 });

  // --- LocalStorage Kayıt ---
  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(LS_PID_KEY, JSON.stringify(pidSettings)); }, [pidSettings]);

  // --- Auto Scroll Logs ---
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // --- ROS Abonelikleri (Görüntü ve Loglar) ---
  useEffect(() => {
    if (!ros || !isConnected) return;

    // 1. Görüntü Aboneliği
    const imgSub = new ROSLIB.Topic({
      ros,
      name: settings.imageTopic,
      messageType: settings.messageType,
      queue_length: 1,
      throttle_rate: settings.throttleMs
    });
    imgSub.subscribe((msg) => {
      const { b64 } = decodeCompressedData(msg.data);
      if (b64) setImgSrc(`data:image/jpeg;base64,${b64}`);
      
      const now = performance.now();
      fpsRef.current.n++;
      if (now - fpsRef.current.t0 >= 1000) {
        setFps((fpsRef.current.n * 1000) / (now - fpsRef.current.t0));
        fpsRef.current = { t0: now, n: 0 };
      }
    });

    // 2. Hedef Verisi ve Hız Logları
    const targetSub = new ROSLIB.Topic({ ros, name: "/humans/target", messageType: "geometry_msgs/PointStamped" });
    const velSub = new ROSLIB.Topic({ ros, name: "/cmd_vel_human_follow", messageType: "geometry_msgs/Twist" });

    const addLog = (text, type = "info") => {
      const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLogs(prev => [...prev.slice(-29), { id: Date.now(), time, text, type }]);
    };

    targetSub.subscribe((msg) => {
      addLog(`🎯 Area: ${msg.point.y.toFixed(3)} | Conf: ${msg.point.z.toFixed(2)}`, "target");
    });

    velSub.subscribe((msg) => {
      if (msg.linear.x > 0 || msg.angular.z !== 0) {
        addLog(`🚀 Hız -> Vx: ${msg.linear.x.toFixed(2)} | Wz: ${msg.angular.z.toFixed(2)}`, "vel");
      }
    });

    return () => {
      imgSub.unsubscribe();
      targetSub.unsubscribe();
      velSub.unsubscribe();
    };
  }, [ros, isConnected, settings.imageTopic, settings.throttleMs]);

  // --- Servis Çağrısı (Tuning) ---
  const onApplyPIDTuning = () => {
    if (!ros || !isConnected) return;
    setTuningLoading(true);
    setTuningStatus("⏳ Gönderiliyor...");

    const client = new ROSLIB.Service({ ros, name: "/human_follow/tune", serviceType: "atoh2_human_msgs/TunePid" });
    const request = new ROSLIB.ServiceRequest({ ...pidSettings });

    client.callService(request, (res) => {
      setTuningStatus(res.success ? `✓ ${res.message}` : `✗ Hata: ${res.message}`);
      setTuningLoading(false);
      setTimeout(() => setTuningStatus(""), 3000);
    });
  };

  const toggleHumanFollow = () => {
    const enableTopic = new ROSLIB.Topic({ ros, name: "/human_follow/enable", messageType: "std_msgs/Bool" });
    const newState = !humanFollowEnabled;
    enableTopic.publish(new ROSLIB.Message({ data: newState }));
    setHumanFollowEnabled(newState);
  };

  const PIDSlider = ({ label, value, onChange, min, max, step }) => (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#cbd5e1" }}>
        <span>{label}</span>
        <span style={{ color: "#10b981", fontWeight: "bold" }}>{parseFloat(value).toFixed(2)}</span>
      </div>
      <input type="range" value={value} onChange={e => onChange(parseFloat(e.target.value))} min={min} max={max} step={step} style={{ width: "100%", cursor: "pointer" }} />
    </div>
  );

  return (
    <div style={{ height: "calc(100vh - 60px)", display: "flex", flexDirection: "column", padding: "10px", background: "#0f172a", color: "white", gap: "10px" }}>
      
      {/* Üst Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1e293b", padding: "10px", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1.2rem" }}>👤</span>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>HUMAN CONTROLLER</h2>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={toggleHumanFollow} style={{ background: humanFollowEnabled ? "#10b981" : "#ef4444", color: "white", border: "none", padding: "8px 15px", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}>
            {humanFollowEnabled ? "TAKİP: AÇIK" : "TAKİP: KAPALI"}
          </button>
          <button onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))} style={{ background: "#334155", border: "none", color: "white", padding: "8px", borderRadius: "5px", cursor: "pointer" }}>
            {settings.showSettings ? "Ayarları Gizle" : "⚙️ Ayarlar"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, gap: "10px", minHeight: 0 }}>
        
        {/* SOL: Ayarlar Paneli (Şartlı) */}
        {settings.showSettings && (
          <div style={{ width: "280px", background: "#1e293b", padding: "15px", borderRadius: "8px", overflowY: "auto", fontSize: "0.8rem" }}>
            <h3 style={{ marginTop: 0, color: "#60a5fa", fontSize: "0.9rem" }}>PID Parametreleri</h3>
            <PIDSlider label="V Max (Hız)" value={pidSettings.v_max} onChange={v => setPidSettings(p => ({ ...p, v_max: v }))} min={0} max={2} step={0.05} />
            <PIDSlider label="KP Yaw (Dönüş)" value={pidSettings.kp_yaw} onChange={v => setPidSettings(p => ({ ...p, kp_yaw: v }))} min={0} max={5} step={0.1} />
            <PIDSlider label="A Go (Uzaklık)" value={pidSettings.a_go} onChange={v => setPidSettings(p => ({ ...p, a_go: v }))} min={0} max={0.5} step={0.01} />
            <PIDSlider label="A Stop (Durma)" value={pidSettings.a_stop} onChange={v => setPidSettings(p => ({ ...p, a_stop: v }))} min={0} max={0.8} step={0.01} />
            <PIDSlider label="Min Confidence" value={pidSettings.min_conf} onChange={v => setPidSettings(p => ({ ...p, min_conf: v }))} min={0} max={1} step={0.05} />
            <PIDSlider label="Timeout (sn)" value={pidSettings.target_timeout_sec} onChange={v => setPidSettings(p => ({ ...p, target_timeout_sec: v }))} min={0.1} max={3} step={0.1} />
            
            <button onClick={onApplyPIDTuning} disabled={tuningLoading} style={{ width: "100%", padding: "10px", marginTop: "10px", background: "#3b82f6", border: "none", color: "white", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}>
              {tuningLoading ? "..." : "UYGULA"}
            </button>
            {tuningStatus && <div style={{ marginTop: "10px", color: tuningStatus.includes("✓") ? "#10b981" : "#f87171", fontSize: "0.7rem", textAlign: "center" }}>{tuningStatus}</div>}
          </div>
        )}

        {/* ORTA: Görüntü */}
        <div style={{ flex: 2, background: "#000", borderRadius: "8px", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {imgSrc ? <img src={imgSrc} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} alt="ROS Stream" /> : "Görüntü Bekleniyor..."}
          <div style={{ position: "absolute", bottom: "10px", left: "10px", background: "rgba(0,0,0,0.5)", padding: "2px 8px", borderRadius: "4px", fontSize: "0.7rem" }}>
            FPS: {fps.toFixed(1)}
          </div>
        </div>

        {/* SAĞ: Canlı Log Paneli */}
        <div style={{ width: "300px", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px", background: "#1e293b", fontSize: "0.8rem", fontWeight: "bold", borderBottom: "1px solid #334155" }}>📜 CANLI LOGLAR</div>
          <div ref={logContainerRef} style={{ flex: 1, padding: "10px", overflowY: "auto", fontFamily: "monospace", fontSize: "0.7rem" }}>
            {logs.map(log => (
              <div key={log.id} style={{ marginBottom: "4px", color: log.type === "vel" ? "#fbbf24" : "#10b981" }}>
                <span style={{ color: "#64748b" }}>[{log.time}]</span> {log.text}
              </div>
            ))}
            {logs.length === 0 && <div style={{ color: "#475569", textAlign: "center" }}>Veri bekleniyor...</div>}
          </div>
        </div>

      </div>
    </div>
  );
}
