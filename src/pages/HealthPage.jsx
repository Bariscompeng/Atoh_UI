import React, { useEffect, useMemo, useState, useCallback } from "react";
import * as ROSLIB from "roslib";

function guessWsUrl() {
  const host = window.location.hostname || "localhost";
  return `ws://${host}:9090`;
}

const LEVEL = {
  0: { label: "OK", icon: "✓", color: "#16a34a" },
  1: { label: "WARN", icon: "⚠", color: "#ea8a3a" },
  2: { label: "ERROR", icon: "✕", color: "#dc2626" },
  3: { label: "STALE", icon: "◌", color: "#64748b" },
};

function levelNum(lvl) {
  if (typeof lvl === "number") return lvl;
  if (typeof lvl === "string") {
    const n = Number(lvl);
    if (!Number.isNaN(n)) return n;
    return lvl.length ? lvl.charCodeAt(0) : 0;
  }
  return 0;
}

function pickWorstLevel(statusArr) {
  let worst = 0;
  for (const s of statusArr || []) {
    const n = levelNum(s.level);
    if (n > worst) worst = n;
  }
  return worst;
}

function stampToMs(stamp) {
  if (!stamp || typeof stamp.sec !== "number") return null;
  return stamp.sec * 1000 + Math.floor((stamp.nanosec || 0) / 1e6);
}

function formatLastUpdate(stamp) {
  const ms = stampToMs(stamp);
  if (ms == null) return { ago: "?", time: "?" };

  const now = Date.now();
  const diffSec = Math.max(0, (now - ms) / 1000);

  const ago =
    diffSec < 1 ? "şimdi" :
    diffSec < 60 ? `${diffSec.toFixed(1)} sn önce` :
    diffSec < 3600 ? `${Math.floor(diffSec / 60)} dk önce` :
    `${Math.floor(diffSec / 3600)} saat önce`;

  const time = new Date(ms).toLocaleString("tr-TR", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return { ago, time };
}

// TF Ağacı Görselleştiricisi - Doğrudan ROS TF Client kullanıyor
const TFTreeVisualizer = ({ ros, connected }) => {
  const [frames, setFrames] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchFrames = useCallback(() => {
    if (!ros || !connected) return;

    setLoading(true);
    setError("");

    try {
      // ROS TF Client'ı kullanarak frame'leri al
      const tfClient = new ROSLIB.TFClient({
        ros,
        fixedFrame: "map",
        angularThres: 0.01,
        linearThres: 0.01,
        rate: 10.0,
      });

      // Frame'leri almak için /tf_static ve /tf topic'lerine subscribe et
      const tfTopic = new ROSLIB.Topic({
        ros,
        name: "/tf",
        messageType: "tf2_msgs/TFMessage",
      });

      const tfStaticTopic = new ROSLIB.Topic({
        ros,
        name: "/tf_static",
        messageType: "tf2_msgs/TFMessage",
      });

      const allTransforms = {};

      const processTransforms = (msg) => {
        if (msg.transforms && Array.isArray(msg.transforms)) {
          msg.transforms.forEach((transform) => {
            const childFrame = transform.child_frame_id;
            const parentFrame = transform.header.frame_id;
            allTransforms[childFrame] = {
              child: childFrame,
              parent: parentFrame,
              timestamp: transform.header.stamp,
            };
          });
        }
      };

      tfTopic.subscribe((msg) => {
        processTransforms(msg);
      });

      tfStaticTopic.subscribe((msg) => {
        processTransforms(msg);
      });

      // Kısa bir gecikmeyle frame'leri işle
      setTimeout(() => {
        try {
          tfTopic.unsubscribe();
          tfStaticTopic.unsubscribe();

          const framesArray = Object.values(allTransforms);
          if (framesArray.length > 0) {
            setFrames(framesArray);
            setLoading(false);
          } else {
            setError("Frame bulunamadı. /tf veya /tf_static topic'leri aktif değildir.");
            setLoading(false);
          }
        } catch (err) {
          console.error("Frame işleme hatası:", err);
          setLoading(false);
        }
      }, 1500);

      // Timeout
      setTimeout(() => {
        if (loading) {
          setError("Frame listesi alınamadı (timeout)");
          setLoading(false);
        }
      }, 5000);
    } catch (err) {
      setError(`Hata: ${err.message}`);
      setLoading(false);
    }
  }, [ros, connected, loading]);

  useEffect(() => {
    if (connected) {
      fetchFrames();
    }
  }, [connected, fetchFrames]);

  // Ağacı oluştur
  const treeData = useMemo(() => {
    if (frames.length === 0) return { roots: [], frameMap: {} };

    const frameMap = {};
    const parentMap = {};

    frames.forEach((tf) => {
      frameMap[tf.child] = tf.parent;
      if (!parentMap[tf.parent]) {
        parentMap[tf.parent] = [];
      }
      parentMap[tf.parent].push(tf.child);
    });

    // Root frame'leri bul
    const allChildren = new Set(Object.keys(frameMap));
    const roots = Array.from(
      new Set(Object.values(frameMap).filter((p) => !allChildren.has(p)))
    );

    return { roots, frameMap, parentMap, allFrames: frames };
  }, [frames]);

  const renderFrameNode = (frame, level = 0) => {
    const children = treeData.parentMap?.[frame] || [];
    const hasChildren = children.length > 0;
    const isRequired = (
      frame === "map" || frame === "odom" || frame === "base_link"
    );

    return (
      <div key={`${frame}-${level}`} style={{ marginBottom: "0.3rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginLeft: `${level * 1.5}rem`,
            padding: "0.6rem 0.75rem",
            background:
              selectedFrame === frame
                ? "#2d3748"
                : level % 2 === 0
                  ? "#1e293b"
                  : "#334155",
            border: `2px solid ${
              selectedFrame === frame
                ? isRequired
                  ? "#ea8a3a"
                  : "#60a5fa"
                : isRequired
                  ? "#ea8a3a40"
                  : "transparent"
            }`,
            borderRadius: "0.4rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
            fontWeight: selectedFrame === frame ? "700" : "600",
            fontSize: "0.9rem",
            color: selectedFrame === frame ? "#fbbf24" : "#cbd5e1",
            userSelect: "none",
          }}
          onClick={() => setSelectedFrame(frame)}
        >
          <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            {hasChildren ? "▼" : "▶"}
          </span>
          <span style={{ flex: 1, fontFamily: "monospace" }}>{frame}</span>
          {isRequired && (
            <span
              style={{
                fontSize: "0.7rem",
                background: "#ea8a3a40",
                color: "#ea8a3a",
                padding: "0.2rem 0.4rem",
                borderRadius: "0.25rem",
                fontWeight: "600",
              }}
            >
              ⭐
            </span>
          )}
        </div>

        {hasChildren && (
          <div>
            {children.map((child) => renderFrameNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        background: "#0f172a",
        borderRadius: "0.75rem",
        border: "2px solid #334155",
        padding: "1.5rem",
        marginTop: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "1.125rem",
              fontWeight: "700",
              margin: "0 0 0.5rem 0",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "#cbd5e1",
            }}
          >
            🌳 Transform Tree
          </h2>
          <div style={{ fontSize: "0.875rem", color: "#94a3b8" }}>
            {loading
              ? "Frame'ler yükleniyor..."
              : `${frames.length} frame(s) bulundu`}
          </div>
        </div>
        <button
          onClick={fetchFrames}
          style={{
            padding: "0.5rem 1rem",
            background: "#334155",
            border: "1px solid #475569",
            borderRadius: "0.4rem",
            color: "#cbd5e1",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: "600",
            transition: "all 0.2s ease",
          }}
          onMouseOver={(e) => {
            e.target.style.background = "#475569";
          }}
          onMouseOut={(e) => {
            e.target.style.background = "#334155";
          }}
        >
          🔄 Yenile
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#7f1d1d",
            border: "1px solid #dc2626",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            color: "#fca5a5",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            color: "#64748b",
            fontSize: "0.9rem",
          }}
        >
          ⏳ Veriler yükleniyor, lütfen bekleyin...
        </div>
      )}

      {!loading && frames.length === 0 && !error && (
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            color: "#64748b",
          }}
        >
          Frame bulunamadı
        </div>
      )}

      {!loading && frames.length > 0 && (
        <div
          style={{
            maxHeight: "500px",
            overflowY: "auto",
            paddingRight: "0.5rem",
            borderRadius: "0.5rem",
            background: "#0a0f1a",
            padding: "1rem",
          }}
        >
          {treeData.roots.length > 0 ? (
            treeData.roots.map((root) => renderFrameNode(root))
          ) : (
            <div style={{ color: "#64748b" }}>Ağaç yapısı oluşturulamadı</div>
          )}
        </div>
      )}

      {selectedFrame && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "#1e293b",
            borderRadius: "0.5rem",
            border: "1px solid #334155",
            fontSize: "0.875rem",
          }}
        >
          <div style={{ color: "#94a3b8", marginBottom: "0.25rem" }}>
            📍 Seçili Frame
          </div>
          <div
            style={{
              fontWeight: "700",
              color: "#fbbf24",
              fontSize: "1rem",
              fontFamily: "monospace",
            }}
          >
            {selectedFrame}
          </div>
          {treeData.frameMap?.[selectedFrame] && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.8rem",
                color: "#94a3b8",
              }}
            >
              👨‍👧 Parent Frame:{" "}
              <span
                style={{
                  color: "#60a5fa",
                  fontFamily: "monospace",
                  fontWeight: "600",
                }}
              >
                {treeData.frameMap[selectedFrame]}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function HealthPage() {
  const wsUrl = useMemo(() => guessWsUrl(), []);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState("");
  const [diag, setDiag] = useState(null);
  const [tfLastUpdate, setTfLastUpdate] = useState(null);
  const [ros, setRos] = useState(null);

  useEffect(() => {
    const rosInstance = new ROSLIB.Ros({ url: wsUrl });

    rosInstance.on("connection", () => {
      setConnected(true);
      setErr("");
      setRos(rosInstance);
    });
    rosInstance.on("close", () => {
      setConnected(false);
      setRos(null);
    });
    rosInstance.on("error", (e) => setErr(e?.message || String(e)));

    // Diagnostics
    const topic = new ROSLIB.Topic({
      ros: rosInstance,
      name: "/system/diagnostics",
      messageType: "diagnostic_msgs/msg/DiagnosticArray",
      queue_length: 1,
    });

    topic.subscribe((msg) => {
      setDiag(msg);
      if (msg?.header?.stamp) {
        setTfLastUpdate(msg.header.stamp);
      }
    });

    return () => {
      try { topic.unsubscribe(); } catch {}
      try { rosInstance.close(); } catch {}
    };
  }, [wsUrl]);

  const statuses = diag?.status || [];
  const summary = statuses.find((s) => s.name === "system/summary") || null;
  const topicStatuses = statuses.filter((s) => s.name?.startsWith("topic/"));

  const worst = pickWorstLevel(statuses);
  const worstLevel = LEVEL[worst] || LEVEL[0];

  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        width: "100vw",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        color: "white",
        padding: "0.75rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "auto",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1400px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>⚙</span>
              <h1 style={{ fontSize: "1.125rem", fontWeight: "bold", margin: 0 }}>
                SİSTEM SAĞLIĞI
              </h1>
            </div>
          </div>

          {/* Status Bar */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>
                  {connected ? "●" : "○"}
                </span>
                <div>
                  <div style={{ fontWeight: "600", fontSize: "0.875rem" }}>
                    {connected ? "Bağlandı" : "Bağlı Değil"}
                  </div>
                  {err && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#f87171",
                        marginTop: "0.125rem",
                      }}
                    >
                      {err}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1.5rem",
                  fontSize: "0.75rem",
                  color: "#cbd5e1",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  📊 Durum: <b style={{ color: worstLevel.color }}>{worstLevel.label}</b>
                </div>
                <div>
                  📌 Topic'ler: <b>{topicStatuses.length}</b>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Overall Status Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "0.75rem",
            flexShrink: 0,
          }}
        >
          {/* ROSBridge Card */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              padding: "1rem",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#cbd5e1", fontWeight: "500" }}>
                📡 ROSBridge
              </div>
              <span style={{ fontSize: "1rem" }}>
                {connected ? "✓" : "✕"}
              </span>
            </div>
            <div style={{ fontWeight: "700", fontSize: "1rem", marginBottom: "0.5rem" }}>
              {connected ? "BAĞLI" : "BAĞLI DEĞİL"}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
              <code style={{ color: "#60a5fa" }}>{wsUrl}</code>
            </div>
          </div>

          {/* Overall Status Card */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              padding: "1rem",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#cbd5e1", fontWeight: "500" }}>
                📊 Genel Durum
              </div>
              <span style={{ fontSize: "1.2rem" }}>{worstLevel.icon}</span>
            </div>
            <div
              style={{
                fontWeight: "800",
                fontSize: "1.25rem",
                color: worstLevel.color,
                marginBottom: "0.5rem",
              }}
            >
              {worstLevel.label}
            </div>
            {summary?.message ? (
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                {summary.message}
              </div>
            ) : (
              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                Veri bekleniyor...
              </div>
            )}
          </div>

          {/* Last Update Card */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              padding: "1rem",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#cbd5e1", fontWeight: "500" }}>
                🕐 Son Güncelleme
              </div>
              <span style={{ fontSize: "1rem" }}>⏱</span>
            </div>
            <div style={{ fontWeight: "700", fontSize: "0.9rem", marginBottom: "0.25rem" }}>
              {tfLastUpdate ? formatLastUpdate(tfLastUpdate).ago : "?"}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
              /system/diagnostics
            </div>
          </div>
        </div>

        {/* TF Tree Visualizer */}
        {connected && ros && <TFTreeVisualizer ros={ros} connected={connected} />}

        {/* Topics Section */}
        {topicStatuses.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div
              style={{
                fontSize: "0.95rem",
                fontWeight: "700",
                marginBottom: "0.75rem",
                color: "#cbd5e1",
              }}
            >
              📌 Topic'ler ({topicStatuses.length})
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {topicStatuses.map((s) => {
                const levelInfo = LEVEL[levelNum(s.level)] || LEVEL[0];
                return (
                  <div
                    key={s.name}
                    style={{
                      background: "#1e293b",
                      borderRadius: "0.5rem",
                      border: `1px solid ${levelInfo.color}`,
                      overflow: "hidden",
                    }}
                  >
                    {/* Header */}
                    <div
                      style={{
                        background: `${levelInfo.color}20`,
                        padding: "0.75rem",
                        borderBottom: `1px solid ${levelInfo.color}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: "700", fontSize: "0.9rem" }}>
                          {s.name.replace("topic/", "")}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          fontWeight: "700",
                          fontSize: "0.8rem",
                          color: levelInfo.color,
                        }}
                      >
                        <span>{levelInfo.icon}</span>
                        {levelInfo.label}
                      </div>
                    </div>

                    {/* Content */}
                    <div style={{ padding: "0.75rem" }}>
                      {s.message && (
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#cbd5e1",
                            marginBottom: "0.75rem",
                            borderLeft: `3px solid ${levelInfo.color}`,
                            paddingLeft: "0.5rem",
                          }}
                        >
                          {s.message}
                        </div>
                      )}

                      {Array.isArray(s.values) && s.values.length > 0 && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "0.5rem",
                          }}
                        >
                          {s.values
                            .filter((kv) => kv?.key && kv?.value !== "")
                            .slice(0, 6)
                            .map((kv) => (
                              <div
                                key={kv.key}
                                style={{
                                  background: "#0f172a",
                                  border: "1px solid #334155",
                                  borderRadius: "0.375rem",
                                  padding: "0.5rem",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.7rem",
                                    color: "#94a3b8",
                                    marginBottom: "0.25rem",
                                    fontWeight: "500",
                                  }}
                                >
                                  {kv.key}
                                </div>
                                <div
                                  style={{
                                    fontSize: "0.8rem",
                                    fontWeight: "700",
                                    color: "#cbd5e1",
                                    wordBreak: "break-all",
                                  }}
                                >
                                  {kv.value}
                                </div>
                              </div>
                            ))}
                        </div>
                      )}

                      {Array.isArray(s.values) && s.values.length > 6 && (
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#64748b",
                            marginTop: "0.5rem",
                            fontStyle: "italic",
                          }}
                        >
                          +{s.values.length - 6} daha fazla değer...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            fontSize: "0.625rem",
            color: "#64748b",
            flexShrink: 0,
            paddingTop: "0.5rem",
            paddingBottom: "0.5rem",
          }}
        >
          <div>Sistem teşhis ve sağlık durumu izlemesi • ROS Diagnostics</div>
          <div style={{ marginTop: "0.08rem" }}>
            Topic:{" "}
            <code style={{ color: "#60a5fa" }}>
              /system/diagnostics
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
