import React, { useEffect, useRef, useState } from "react";

function guessWsUrl() {
  const host = window.location.hostname || "localhost";
  return `ws://${host}:9090`;
}

export default function MapPage() {
  const [wsUrl, setWsUrl] = useState(guessWsUrl());
  const [isConnected, setIsConnected] = useState(false);
  const [mapTopic, setMapTopic] = useState("/map");
  const [poseTopic, setPoseTopic] = useState("/amcl_pose");
  const [mapData, setMapData] = useState(null);
  const [robotPose, setRobotPose] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [statusText, setStatusText] = useState("Bağlantı yok");

  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);

  const mapSubIdRef = useRef(null);
  const poseSubIdRef = useRef(null);

  const sendMessage = (msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const subscribe = (topic, messageType) => {
    const subId = `sub_${topic}_${Date.now()}`;
    sendMessage({
      op: "subscribe",
      id: subId,
      topic: topic,
      type: messageType
    });
    return subId;
  };

  const unsubscribe = (subId) => {
    if (subId) {
      sendMessage({
        op: "unsubscribe",
        id: subId
      });
    }
  };

  const connect = () => {
    disconnect();
    setStatusText("Bağlanıyor...");
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setStatusText("Bağlantı sağlandı");
      
      // Subscribe to map
      mapSubIdRef.current = subscribe(mapTopic, "nav_msgs/OccupancyGrid");
      
      // Subscribe to pose
      poseSubIdRef.current = subscribe(poseTopic, "geometry_msgs/PoseWithCovarianceStamped");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.op === "publish") {
          // Map data
          if (data.topic === mapTopic) {
            setMapData(data.msg);
          }
          // Pose data
          else if (data.topic === poseTopic) {
            setRobotPose(data.msg.pose.pose);
          }
        }
      } catch (e) {
        console.error("Message parse error:", e);
      }
    };

    ws.onerror = () => {
      setIsConnected(false);
      setStatusText("Bağlantı hatası");
    };

    ws.onclose = () => {
      setIsConnected(false);
      setStatusText("Bağlantı kapandı");
    };
  };

  const disconnect = () => {
    if (mapSubIdRef.current) {
      unsubscribe(mapSubIdRef.current);
      mapSubIdRef.current = null;
    }
    if (poseSubIdRef.current) {
      unsubscribe(poseSubIdRef.current);
      poseSubIdRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setStatusText("Bağlantı yok");
  };

  useEffect(() => {
    if (!mapData || !viewportRef.current) return;

    const recompute = () => {
      const vw = viewportRef.current.clientWidth;
      const vh = viewportRef.current.clientHeight;
      const mw = mapData.info.width;
      const mh = mapData.info.height;

      if (mw <= 0 || mh <= 0) return;
      const s = Math.min(vw / mw, vh / mh);
      setFitScale(s);
    };

    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [mapData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, []);

  // Haritayı ve robotu çiz
  useEffect(() => {
    if (!mapData || !canvasRef.current || !viewportRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const dpr = window.devicePixelRatio || 1;

    const vw = viewportRef.current.clientWidth;   // viewport width (CSS px)
    const vh = viewportRef.current.clientHeight;  // viewport height (CSS px)

    // canvas gerçek piksel boyutu (retina için dpr ile)
    canvas.width  = Math.max(1, Math.floor(vw * dpr));
    canvas.height = Math.max(1, Math.floor(vh * dpr));

    // çizimde dpr düzelt
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = false;

    const mw = mapData.info.width;
    const mh = mapData.info.height;
    const resolution = mapData.info.resolution;
    const origin = mapData.info.origin;
    const data = mapData.data;

    // map'i viewport'a sığdır (zoomLevel ekstra çarpan)
    const baseScale = Math.min(vw / mw, vh / mh);
    const scale = baseScale * zoomLevel;

    // ortalamak için offset
    const drawW = mw * scale;
    const drawH = mh * scale;
    const offsetX = (vw - drawW) / 2;
    const offsetY = (vh - drawH) / 2;

    // occupancy -> image (1 kez render)
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = mw;
    tempCanvas.height = mh;
    const tempCtx = tempCanvas.getContext("2d");
    const imageData = tempCtx.createImageData(mw, mh);

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const c = v === -1 ? 128 : (v === 0 ? 255 : 0);
      const idx = i * 4;
      imageData.data[idx] = c;
      imageData.data[idx + 1] = c;
      imageData.data[idx + 2] = c;
      imageData.data[idx + 3] = 255;
    }
    tempCtx.putImageData(imageData, 0, 0);

    // map çiz: transform = scale + offset
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();

    // robot çiz (map koordinat -> canvas koordinat)
    if (robotPose) {
      const px = (robotPose.position.x - origin.position.x) / resolution;
      const py = mh - (robotPose.position.y - origin.position.y) / resolution;

      const cx = offsetX + px * scale;
      const cy = offsetY + py * scale;

      const q = robotPose.orientation;
      const yaw = Math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z)
      );

      ctx.save();
      ctx.translate(cx, cy);

      // gövde
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 2;
      ctx.stroke();

      // yön oku
      ctx.rotate(-yaw);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(20, 0);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.restore();
    }
  }, [mapData, robotPose, zoomLevel]);

  return (
    <div style={{ 
      height: 'calc(100vh - 56px)', 
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', 
      color: 'white',
      padding: '1rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🗺️</span>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>Live Map & Robot Position</h1>
          </div>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{ 
              padding: '0.5rem 0.75rem', 
              borderRadius: '0.5rem', 
              background: '#334155', 
              border: 'none', 
              color: 'white', 
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            ⚙️ {showSettings ? 'Gizle' : 'Ayarlar'}
          </button>
        </div>

        {/* Status Bar */}
        <div style={{ 
          background: '#1e293b', 
          borderRadius: '0.5rem', 
          padding: '0.75rem', 
          marginBottom: '1rem', 
          border: '1px solid #334155' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>{isConnected ? '🟢' : '🔴'}</span>
              <div>
                <div style={{ fontWeight: '600', fontSize: '0.875rem' }}>
                  {statusText}
                </div>
                {robotPose && (
                  <div style={{ fontSize: '0.625rem', color: '#94a3b8', marginTop: '0.125rem' }}>
                    Robot: ({robotPose.position.x.toFixed(2)}, {robotPose.position.y.toFixed(2)})
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!isConnected ? (
                <button 
                  onClick={connect} 
                  style={{ 
                    padding: '0.5rem 1rem', 
                    background: '#2563eb', 
                    border: 'none', 
                    borderRadius: '0.5rem', 
                    color: 'white', 
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: '600'
                  }}
                >
                  🔗 Bağlan
                </button>
              ) : (
                <button 
                  onClick={disconnect} 
                  style={{ 
                    padding: '0.5rem 1rem', 
                    background: '#475569', 
                    border: 'none', 
                    borderRadius: '0.5rem', 
                    color: 'white', 
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: '600'
                  }}
                >
                  ❌ Kes
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Settings */}
        {showSettings && (
          <div style={{ 
            background: '#1e293b', 
            borderRadius: '0.5rem', 
            padding: '1rem', 
            marginBottom: '1rem', 
            border: '1px solid #334155' 
          }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: 0, marginBottom: '0.75rem' }}>
              ⚙️ Ayarlar
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#cbd5e1' }}>
                  ROSBridge WebSocket URL
                </label>
                <input
                  type="text"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  placeholder="ws://<robot_ip>:9090"
                  style={{ 
                    width: '100%', 
                    padding: '0.5rem', 
                    background: '#334155', 
                    border: '1px solid #475569', 
                    borderRadius: '0.375rem', 
                    color: 'white', 
                    outline: 'none',
                    fontSize: '0.875rem'
                  }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#cbd5e1' }}>
                  Map Topic
                </label>
                <input
                  type="text"
                  value={mapTopic}
                  onChange={(e) => setMapTopic(e.target.value)}
                  placeholder="/map"
                  style={{ 
                    width: '100%', 
                    padding: '0.5rem', 
                    background: '#334155', 
                    border: '1px solid #475569', 
                    borderRadius: '0.375rem', 
                    color: 'white', 
                    outline: 'none',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#cbd5e1' }}>
                  Pose Topic
                </label>
                <input
                  type="text"
                  value={poseTopic}
                  onChange={(e) => setPoseTopic(e.target.value)}
                  placeholder="/amcl_pose"
                  style={{ 
                    width: '100%', 
                    padding: '0.5rem', 
                    background: '#334155', 
                    border: '1px solid #475569', 
                    borderRadius: '0.375rem', 
                    color: 'white', 
                    outline: 'none',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#cbd5e1' }}>
                  Zoom: {zoomLevel.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={zoomLevel}
                  onChange={(e) => setZoomLevel(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* ROSBridge Protocol Info */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#0f172a', borderRadius: '0.375rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
                <div style={{ fontWeight: '600', marginBottom: '0.375rem' }}>ℹ️ ROSBridge Protokol Bilgisi</div>
                <div style={{ fontSize: '0.625rem', color: '#94a3b8', lineHeight: 1.5 }}>
                  ℹ️ Bu sayfa doğrudan WebSocket üzerinden ROSBridge protokolü kullanır<br/>
                  ℹ️ Mesaj formatı: <code style={{ color: '#60a5fa' }}>&#123;"op": "subscribe", "topic": "/map"&#125;</code><br/>
                  ℹ️ Robot üzerinde rosbridge_server çalışıyor olmalı
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Map Canvas */}
        <div style={{ 
          background: '#1e293b', 
          borderRadius: '0.5rem', 
          padding: '1rem', 
          border: '1px solid #334155',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}>
          {mapData ? (
            <div style={{ textAlign: "center", flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div
                ref={viewportRef}
                style={{
                  flex: 1,
                  overflow: "hidden",
                  borderRadius: "0.5rem",
                  border: "2px solid #475569",
                  background: "#000",
                  position: "relative",
                  minHeight: 0
                }}
              >
                <canvas
                  ref={canvasRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                  }}
                />
              </div>

              <div
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  display: "flex",
                  justifyContent: "center",
                  gap: "1.5rem",
                  flexWrap: "wrap",
                }}
              >
                <div>🌍 {mapData.info.width}×{mapData.info.height}px</div>
                <div>🔍 {mapData.info.resolution.toFixed(3)}m/px</div>
                <div>🤖 Robot {robotPose ? "Active" : "Inactive"}</div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🗺️</div>
              <div style={{ fontSize: "1rem", fontWeight: "500" }}>
                {isConnected ? "Harita bekleniyor..." : "Bağlantı kurun"}
              </div>
              <div style={{ fontSize: "0.75rem", marginTop: "0.5rem", color: "#475569" }}>
                Topic: {mapTopic}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{ 
          marginTop: '1rem', 
          background: '#1e293b', 
          borderRadius: '0.5rem', 
          padding: '0.75rem', 
          border: '1px solid #334155' 
        }}>
          <div style={{ 
            display: 'flex', 
            gap: '1.5rem', 
            justifyContent: 'center', 
            flexWrap: 'wrap',
            fontSize: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 16, height: 16, background: '#fff', border: '1px solid #475569' }}></div>
              Boş Alan
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 16, height: 16, background: '#000', border: '1px solid #475569' }}></div>
              Engel
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 16, height: 16, background: '#808080', border: '1px solid #475569' }}></div>
              Bilinmeyen
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#3b82f6', border: '1px solid #1d4ed8' }}></div>
              Robot
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

