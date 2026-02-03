import React, { useEffect, useMemo, useRef, useState } from "react";
import { useROS } from "../context/ROSContext";

// ? ROSLIB window'dan al
const ROSLIB = window.ROSLIB;

const LS_KEY = "human_snapshots_settings_v1";
const LS_PID_KEY = "human_follow_pid_settings_v1";

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
    const nums = keys
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (nums.length > 0) {
      const u8 = new Uint8Array(nums.length);
      for (let i = 0; i < nums.length; i++) u8[i] = data[String(nums[i])] ?? 0;
      return { b64: uint8ToBase64(u8), bytes: u8.length };
    }
  }
  return { b64: null, bytes: 0 };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

function loadPIDSettings() {
  try {
    const raw = localStorage.getItem(LS_PID_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePIDSettings(s) {
  try {
    localStorage.setItem(LS_PID_KEY, JSON.stringify(s));
  } catch {}
}

export default function HumanSnapshots() {
  const { ros, isConnected, status: globalStatus, errorText: globalErrorText } = useROS();

  const defaults = useMemo(
    () => ({
      imageTopic: "/human_debug_snapshot/jpeg",
      messageType: "sensor_msgs/CompressedImage",
      throttleMs: 50,
      fitMode: "contain",
      showSettings: false,
    }),
    []
  );

  const pidDefaults = useMemo(
    () => ({
      kp_yaw: 1.2,
      deadband_x: 0.03,
      max_angular_z: 1.0,
      v_max: 0.35,
      a_go: 0.03,
      a_stop: 0.12,
      min_conf: 0.35,
      target_timeout_sec: 0.35,
      ex_lowpass_alpha: 1.0,
      invert_ex: false,
      ex_offset: 0.0,
    }),
    []
  );

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

  const subRef = useRef(null);
  const fpsRef = useRef({ t0: performance.now(), n: 0, fps: 0 });
  const [fps, setFps] = useState(0);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    savePIDSettings(pidSettings);
  }, [pidSettings]);

  useEffect(() => {
    if (!ros || !isConnected) {
      console.log("[HumanSnapshots] ROS bağlı değil");
      return;
    }

    console.log("[HumanSnapshots] ROS bağlı, subscribe:", settings.imageTopic);

    try {
      if (subRef.current) subRef.current.unsubscribe();
    } catch {}

    setImgSrc(null);
    setFrames(0);
    setLastBytes(0);
    setFps(0);
    fpsRef.current = { t0: performance.now(), n: 0, fps: 0 };

    const sub = new ROSLIB.Topic({
      ros,
      name: settings.imageTopic,
      messageType: settings.messageType,
      queue_length: 1,
      throttle_rate: Math.max(0, Number(settings.throttleMs) || 0),
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
      if (dt >= 1000) {
        st.fps = (st.n * 1000) / dt;
        st.t0 = now;
        st.n = 0;
        setFps(st.fps);
      }
    });

    return () => {
      console.log("[HumanSnapshots] Cleanup");
      try {
        sub.unsubscribe();
      } catch {}
      subRef.current = null;
    };
  }, [ros, isConnected, settings.imageTopic, settings.messageType, settings.throttleMs]);

  const toggleSettings = () =>
    setSettings((s) => ({ ...s, showSettings: !s.showSettings }));

  const onReset = () => setSettings(defaults);

  const onResetPID = () => setPidSettings(pidDefaults);

  const toggleHumanFollow = () => {
    console.log("[Button] Tıklandı. ROSLIB:", ROSLIB, "ROS:", ros);

    if (!ROSLIB) {
      setLocalError("⚠ ROSLIB yüklenmedi!");
      return;
    }

    if (!ros) {
      setLocalError("⚠ ROS bağlantısı yok!");
      return;
    }

    if (!isConnected) {
      setLocalError("⚠ ROSBridge bağlı değil!");
      return;
    }

    setPublishing(true);
    setLocalError("");

    try {
      const newState = !humanFollowEnabled;
      console.log(`[Button] Publishing /human_follow/enable = ${newState}`);

      const enableTopic = new ROSLIB.Topic({
        ros,
        name: "/human_follow/enable",
        messageType: "std_msgs/Bool",
      });

      const msg = new ROSLIB.Message({ data: newState });
      enableTopic.publish(msg);

      console.log(`[Button] ✓ Gönderildi!`);
      setHumanFollowEnabled(newState);
      setLocalError(newState ? "✓ Human Follow ON" : "✓ Human Follow OFF");
      setTimeout(() => setLocalError(""), 2000);
    } catch (e) {
      console.error("[Button] ✗ Hata:", e);
      setLocalError(`⚠ Hata: ${e.message}`);
    } finally {
      setPublishing(false);
    }
  };

  const onApplyPIDTuning = () => {
    if (!ros || !isConnected) {
      setTuningStatus("⚠ ROS bağlantısı yok!");
      return;
    }

    // ✅ Frontend validation: a_go < a_stop
    if (pidSettings.a_go >= pidSettings.a_stop) {
      setTuningStatus(
        `✗ Hata: A_go (${pidSettings.a_go.toFixed(3)}) < A_stop (${pidSettings.a_stop.toFixed(3)}) olmalı!`
      );
      setTimeout(() => setTuningStatus(""), 3000);
      return;
    }

    setTuningLoading(true);
    setTuningStatus("⏳ PID ayarları gönderiliyor...");

    try {
      const client = new ROSLIB.Service({
        ros,
        name: "/human_follow/tune",
        serviceType: "atoh2_human_msgs/TunePid",
      });

      const request = new ROSLIB.ServiceRequest({
        kp_yaw: parseFloat(pidSettings.kp_yaw),
        deadband_x: parseFloat(pidSettings.deadband_x),
        max_angular_z: parseFloat(pidSettings.max_angular_z),
        v_max: parseFloat(pidSettings.v_max),
        a_go: parseFloat(pidSettings.a_go),
        a_stop: parseFloat(pidSettings.a_stop),
        min_conf: parseFloat(pidSettings.min_conf),
        target_timeout_sec: parseFloat(pidSettings.target_timeout_sec),
        ex_lowpass_alpha: parseFloat(pidSettings.ex_lowpass_alpha),
        invert_ex: Boolean(pidSettings.invert_ex),
        ex_offset: parseFloat(pidSettings.ex_offset),
      });

      // ✅ Service timeout ekle (5 saniye)
      const timeoutId = setTimeout(() => {
        setTuningStatus("✗ Hata: Service timeout (5s). Node çalışıyor mu?");
        setTuningLoading(false);
        setTimeout(() => setTuningStatus(""), 3000);
      }, 5000);

      client.callService(request, (response) => {
        clearTimeout(timeoutId); // Timeout'ı cancel et

        if (response.success) {
          setTuningStatus(`✓ Başarılı! ${response.message}`);
          console.log("[PID] Tuning başarılı:", response.message);
        } else {
          setTuningStatus(`✗ Hata: ${response.message}`);
          console.error("[PID] Tuning hatası:", response.message);
        }
        setTuningLoading(false);
        setTimeout(() => setTuningStatus(""), 3000);
      });
    } catch (e) {
      console.error("[PID] Service call hata:", e);
      setTuningStatus(`✗ Hata: ${e.message}`);
      setTuningLoading(false);
      setTimeout(() => setTuningStatus(""), 3000);
    }
  };

  const displayError = localError || globalErrorText;

  const PIDSlider = ({ label, value, onChange, min, max, step, unit = "" }) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <label style={{ fontSize: "0.75rem", fontWeight: "500", color: "#cbd5e1" }}>
          {label}
        </label>
        <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "#10b981" }}>
          {parseFloat(value).toFixed(3)} {unit}
        </span>
      </div>
      <input
        type="range"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        style={{
          width: "100%",
          height: "6px",
          borderRadius: "3px",
          background: "#334155",
          outline: "none",
          WebkitAppearance: "none",
          appearance: "none",
          cursor: "pointer",
        }}
        onMouseUp={() => console.log(`[Slider] ${label} = ${value}`)}
      />
    </div>
  );

  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        width: "100vw",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        color: "white",
        padding: "0.75rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, paddingRight: "0.25rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>📷</span>
              <h1 style={{ fontSize: "1.125rem", fontWeight: "bold", margin: 0 }}>
                YOLO SNAPSHOT
              </h1>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={toggleHumanFollow}
                disabled={publishing || !isConnected}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "0.5rem",
                  background: humanFollowEnabled ? "#10b981" : "#ef4444",
                  border: "2px solid " + (humanFollowEnabled ? "#059669" : "#991b1b"),
                  color: "white",
                  cursor: publishing || !isConnected ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: "600",
                  opacity: publishing || !isConnected ? 0.5 : 1,
                  transition: "all 0.3s",
                  boxShadow: humanFollowEnabled
                    ? "0 0 10px rgba(16, 185, 129, 0.5)"
                    : "0 0 10px rgba(239, 68, 68, 0.5)",
                }}
              >
                {publishing
                  ? "🔄 Gönderiliyor..."
                  : humanFollowEnabled
                  ? "✓ Human Follow ON"
                  : "✗ Human Follow OFF"}
              </button>

              <button
                onClick={toggleSettings}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  background: "#334155",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                ⚙️ {settings.showSettings ? "Gizle" : "Ayarlar"}
              </button>
            </div>
          </div>

          {/* Status Bar */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              padding: "0.5rem 0.75rem",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.75rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.95rem" }}>
                  {isConnected ? "🟢" : "🔴"}
                </span>
                <div>
                  <div style={{ fontWeight: "600", fontSize: "0.8rem" }}>
                    {globalStatus}
                  </div>
                  {displayError && (
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: displayError.includes("✓") ? "#10b981" : "#f87171",
                        marginTop: "0.1rem",
                      }}
                    >
                      {displayError}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1.5rem",
                  fontSize: "0.7rem",
                  color: "#cbd5e1",
                  flexWrap: "wrap",
                }}
              >
                <div>📊 Kare: <b>{frames}</b></div>
                <div>⚡ FPS: <b>{fps.toFixed(1)}</b></div>
                <div>📦 Bayt: <b>{lastBytes}</b></div>
              </div>
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {settings.showSettings && (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              marginBottom: "0.5rem",
              border: "1px solid #334155",
              flexShrink: 0,
              maxHeight: "50vh",
              overflowY: "auto",
            }}
          >
            {/* Image Settings Tab */}
            <div style={{ marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "0.95rem", fontWeight: "bold", marginBottom: "0.5rem", marginTop: 0 }}>
                📷 Görüntü Ayarları
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", fontWeight: "500", marginBottom: "0.25rem", color: "#cbd5e1" }}>
                    Görüntü Topic
                  </label>
                  <input
                    value={settings.imageTopic}
                    onChange={(e) => setSettings((s) => ({ ...s, imageTopic: e.target.value }))}
                    style={{
                      width: "100%",
                      padding: "0.4rem",
                      background: "#334155",
                      border: "1px solid #475569",
                      borderRadius: "0.375rem",
                      color: "white",
                      fontSize: "0.8rem",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", fontWeight: "500", marginBottom: "0.25rem", color: "#cbd5e1" }}>
                    Message Type
                  </label>
                  <input
                    value={settings.messageType}
                    onChange={(e) => setSettings((s) => ({ ...s, messageType: e.target.value }))}
                    style={{
                      width: "100%",
                      padding: "0.4rem",
                      background: "#334155",
                      border: "1px solid #475569",
                      borderRadius: "0.375rem",
                      color: "white",
                      fontSize: "0.8rem",
                    }}
                  />
                </div>
              </div>

              <button
                onClick={onReset}
                style={{
                  padding: "0.4rem 0.6rem",
                  borderRadius: "0.375rem",
                  background: "#475569",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "0.7rem",
                }}
              >
                🔄 Varsayılanlara Dön
              </button>
            </div>

            {/* PID Tuning Panel */}
            <div style={{ borderTop: "1px solid #334155", paddingTop: "0.75rem" }}>
              <h2 style={{ fontSize: "0.95rem", fontWeight: "bold", marginBottom: "0.75rem", marginTop: 0 }}>
                ⚙️ PID Tuning
              </h2>

              {/* YAW Control */}
              <div style={{ marginBottom: "1rem", padding: "0.5rem", background: "#0f172a", borderRadius: "0.375rem", border: "1px solid #334155" }}>
                <h3 style={{ fontSize: "0.8rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem", color: "#60a5fa" }}>
                  🔄 Yaw (Dönme) Kontrolü
                </h3>
                <PIDSlider
                  label="KP (Yaw Kazanç)"
                  value={pidSettings.kp_yaw}
                  onChange={(e) => setPidSettings((s) => ({ ...s, kp_yaw: parseFloat(e.target.value) }))}
                  min="0"
                  max="10"
                  step="0.1"
                />
                <PIDSlider
                  label="Deadband X (Cölü Bölge)"
                  value={pidSettings.deadband_x}
                  onChange={(e) => setPidSettings((s) => ({ ...s, deadband_x: parseFloat(e.target.value) }))}
                  min="0"
                  max="0.5"
                  step="0.01"
                />
                <PIDSlider
                  label="Max Angular Z (Max Dönme Hızı)"
                  value={pidSettings.max_angular_z}
                  onChange={(e) => setPidSettings((s) => ({ ...s, max_angular_z: parseFloat(e.target.value) }))}
                  min="0"
                  max="5"
                  step="0.1"
                />
              </div>

              {/* Forward Control */}
              <div style={{ marginBottom: "1rem", padding: "0.5rem", background: "#0f172a", borderRadius: "0.375rem", border: "1px solid #334155" }}>
                <h3 style={{ fontSize: "0.8rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem", color: "#34d399" }}>
                  ➡️ İleri Kontrolü
                </h3>
                <PIDSlider
                  label="V Max (Max İleri Hız)"
                  value={pidSettings.v_max}
                  onChange={(e) => setPidSettings((s) => ({ ...s, v_max: parseFloat(e.target.value) }))}
                  min="0"
                  max="2"
                  step="0.05"
                />
                <PIDSlider
                  label="A Go (Başlama Alanı)"
                  value={pidSettings.a_go}
                  onChange={(e) => setPidSettings((s) => ({ ...s, a_go: parseFloat(e.target.value) }))}
                  min="0"
                  max="1"
                  step="0.01"
                />
                <PIDSlider
                  label="A Stop (Durdurma Alanı)"
                  value={pidSettings.a_stop}
                  onChange={(e) => setPidSettings((s) => ({ ...s, a_stop: parseFloat(e.target.value) }))}
                  min="0"
                  max="1"
                  step="0.01"
                />
              </div>

              {/* Detection & Filtering */}
              <div style={{ marginBottom: "1rem", padding: "0.5rem", background: "#0f172a", borderRadius: "0.375rem", border: "1px solid #334155" }}>
                <h3 style={{ fontSize: "0.8rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem", color: "#fbbf24" }}>
                  🔍 Algılama & Filtreleme
                </h3>
                <PIDSlider
                  label="Min Confidence (Min Güven)"
                  value={pidSettings.min_conf}
                  onChange={(e) => setPidSettings((s) => ({ ...s, min_conf: parseFloat(e.target.value) }))}
                  min="0"
                  max="1"
                  step="0.05"
                />
                <PIDSlider
                  label="Target Timeout (Hedef Zaman Aşımı)"
                  value={pidSettings.target_timeout_sec}
                  onChange={(e) => setPidSettings((s) => ({ ...s, target_timeout_sec: parseFloat(e.target.value) }))}
                  min="0.05"
                  max="5"
                  step="0.05"
                />
                <PIDSlider
                  label="Lowpass Alpha (Filtreleme)"
                  value={pidSettings.ex_lowpass_alpha}
                  onChange={(e) => setPidSettings((s) => ({ ...s, ex_lowpass_alpha: parseFloat(e.target.value) }))}
                  min="0"
                  max="1"
                  step="0.05"
                />
              </div>

              {/* Calibration */}
              <div style={{ marginBottom: "1rem", padding: "0.5rem", background: "#0f172a", borderRadius: "0.375rem", border: "1px solid #334155" }}>
                <h3 style={{ fontSize: "0.8rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem", color: "#f87171" }}>
                  🔧 Kalibrasyonu
                </h3>
                <PIDSlider
                  label="EX Offset (Sapması)"
                  value={pidSettings.ex_offset}
                  onChange={(e) => setPidSettings((s) => ({ ...s, ex_offset: parseFloat(e.target.value) }))}
                  min="-1"
                  max="1"
                  step="0.05"
                />
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={pidSettings.invert_ex}
                    onChange={(e) => setPidSettings((s) => ({ ...s, invert_ex: e.target.checked }))}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                  <label style={{ fontSize: "0.75rem", fontWeight: "500", color: "#cbd5e1", cursor: "pointer" }}>
                    EX'i Ters Çevir
                  </label>
                </div>
              </div>

              {/* Tuning Status */}
              {tuningStatus && (
                <div
                  style={{
                    padding: "0.5rem",
                    background: tuningStatus.includes("✓") ? "#064e3b" : "#7c2d12",
                    border: `1px solid ${tuningStatus.includes("✓") ? "#10b981" : "#f97316"}`,
                    borderRadius: "0.375rem",
                    marginBottom: "0.75rem",
                    fontSize: "0.75rem",
                    color: tuningStatus.includes("✓") ? "#10b981" : "#fd7e14",
                  }}
                >
                  {tuningStatus}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={onApplyPIDTuning}
                  disabled={tuningLoading || !isConnected}
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    background: isConnected ? "#3b82f6" : "#64748b",
                    border: "none",
                    color: "white",
                    cursor: isConnected && !tuningLoading ? "pointer" : "not-allowed",
                    fontSize: "0.75rem",
                    fontWeight: "600",
                    opacity: tuningLoading || !isConnected ? 0.5 : 1,
                    transition: "all 0.2s",
                    boxShadow: isConnected ? "0 0 8px rgba(59, 130, 246, 0.3)" : "none",
                  }}
                >
                  {tuningLoading ? "⏳ Uygulanıyor..." : "✓ Uygula"}
                </button>

                <button
                  onClick={onResetPID}
                  disabled={tuningLoading}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    background: "#475569",
                    border: "none",
                    color: "white",
                    cursor: tuningLoading ? "not-allowed" : "pointer",
                    fontSize: "0.75rem",
                    fontWeight: "600",
                    opacity: tuningLoading ? 0.5 : 1,
                  }}
                >
                  🔄 Sıfırla
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Image Viewer */}
        <div
          style={{
            flex: 1,
            background: "#1e293b",
            borderRadius: "0.5rem",
            border: "1px solid #334155",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {imgSrc ? (
            <div
              style={{
                flex: 1,
                overflow: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#0f172a",
              }}
            >
              <img
                src={imgSrc}
                alt="human_debug"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: settings.fitMode,
                  display: "block",
                }}
              />
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                padding: "2rem",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📷</div>
              <div style={{ fontSize: "1rem", fontWeight: "600" }}>Görüntü Bekleniyor</div>
            </div>
          )}

          {imgSrc && (
            <div
              style={{
                background: "#0f172a",
                borderTop: "1px solid #334155",
                padding: "0.5rem 0.75rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "0.75rem",
                color: "#cbd5e1",
              }}
            >
              <div>📊 Kare: {frames} | ⚡ FPS: {fps.toFixed(1)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
