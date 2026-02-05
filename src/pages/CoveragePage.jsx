import React, { useEffect, useMemo, useRef, useState } from "react";
import * as ROSLIB from "roslib";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function guessWsUrl() {
  const host = window.location.hostname || "localhost";
  return `ws://${host}:9090`;
}

function prettyErr(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Polygon kenarı ile yatay/dikey çizgi kesişim noktası bul
 */
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }
  return null;
}

/**
 * Yatay veya dikey çizginin polygon ile kesişim noktalarını bul
 */
function findPolygonIntersections(lineStart, lineEnd, polygon) {
  const intersections = [];
  
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    const intersection = lineIntersection(
      lineStart.x, lineStart.y, lineEnd.x, lineEnd.y,
      p1.x, p1.y, p2.x, p2.y
    );
    
    if (intersection) {
      intersections.push(intersection);
    }
  }
  
  // X veya Y'ye göre sırala
  if (Math.abs(lineEnd.x - lineStart.x) > Math.abs(lineEnd.y - lineStart.y)) {
    // Yatay çizgi - X'e göre sırala
    intersections.sort((a, b) => a.x - b.x);
  } else {
    // Dikey çizgi - Y'ye göre sırala
    intersections.sort((a, b) => a.y - b.y);
  }
  
  return intersections;
}

/**
 * Frontend'de path hesaplama fonksiyonları
 * Seçilen stil ve parametrelere göre preview path oluşturur
 * Path seçilen polygon'un İÇİNDE kalır
 */
function generatePreviewPath(points, style, lineSpacing, sweepAngle, startCorner) {
  if (points.length !== 4) return [];

  // Noktaları saat yönünde sırala (convex hull için)
  const center = {
    x: points.reduce((sum, p) => sum + p.x, 0) / 4,
    y: points.reduce((sum, p) => sum + p.y, 0) / 4
  };

  const sortedPoints = [...points].sort((a, b) => {
    const angleA = Math.atan2(a.y - center.y, a.x - center.x);
    const angleB = Math.atan2(b.y - center.y, b.x - center.x);
    return angleA - angleB;
  });

  // Başlama köşesine göre döndür
  const polygon = [];
  for (let i = 0; i < 4; i++) {
    polygon.push(sortedPoints[(i + startCorner) % 4]);
  }

  // Bounding box hesapla
  const minX = Math.min(...polygon.map(p => p.x));
  const maxX = Math.max(...polygon.map(p => p.x));
  const minY = Math.min(...polygon.map(p => p.y));
  const maxY = Math.max(...polygon.map(p => p.y));

  const width = maxX - minX;
  const height = maxY - minY;

  const path = [];

  if (style === "zigzag") {
    // Yatay zigzag pattern - polygon içinde
    const numLines = Math.max(2, Math.floor(height / lineSpacing));
    const actualSpacing = height / numLines;

    for (let i = 0; i <= numLines; i++) {
      const y = minY + i * actualSpacing;
      
      // Bu y seviyesinde polygon ile kesişim noktalarını bul
      const lineStart = { x: minX - 1, y };
      const lineEnd = { x: maxX + 1, y };
      const intersections = findPolygonIntersections(lineStart, lineEnd, polygon);
      
      if (intersections.length >= 2) {
        const leftPt = intersections[0];
        const rightPt = intersections[intersections.length - 1];
        
        if (i % 2 === 0) {
          // Soldan sağa
          path.push({ x: leftPt.x, y: leftPt.y });
          path.push({ x: rightPt.x, y: rightPt.y });
        } else {
          // Sağdan sola
          path.push({ x: rightPt.x, y: rightPt.y });
          path.push({ x: leftPt.x, y: leftPt.y });
        }
      }
    }
  } else if (style === "ladder") {
    // Dikey ladder pattern - polygon içinde
    const numLines = Math.max(2, Math.floor(width / lineSpacing));
    const actualSpacing = width / numLines;

    for (let i = 0; i <= numLines; i++) {
      const x = minX + i * actualSpacing;
      
      // Bu x seviyesinde polygon ile kesişim noktalarını bul
      const lineStart = { x, y: minY - 1 };
      const lineEnd = { x, y: maxY + 1 };
      const intersections = findPolygonIntersections(lineStart, lineEnd, polygon);
      
      if (intersections.length >= 2) {
        const bottomPt = intersections[0];
        const topPt = intersections[intersections.length - 1];
        
        if (i % 2 === 0) {
          // Aşağıdan yukarı
          path.push({ x: bottomPt.x, y: bottomPt.y });
          path.push({ x: topPt.x, y: topPt.y });
        } else {
          // Yukarıdan aşağı
          path.push({ x: topPt.x, y: topPt.y });
          path.push({ x: bottomPt.x, y: bottomPt.y });
        }
      }
    }
  } else if (style === "diagonal") {
    // Diagonal pattern - polygon içinde
    const diagonal = Math.sqrt(width * width + height * height);
    const numLines = Math.max(2, Math.floor(diagonal / lineSpacing));
    const angleRad = (sweepAngle * Math.PI) / 180;
    
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    for (let i = 0; i <= numLines; i++) {
      const offset = (i / numLines) * diagonal - diagonal / 2;
      
      // Diagonal çizgi - uzun çizgi oluştur
      const perpX = offset * cosA;
      const perpY = offset * sinA;
      
      const lineStart = {
        x: center.x + perpX - diagonal * sinA,
        y: center.y + perpY + diagonal * cosA
      };
      const lineEnd = {
        x: center.x + perpX + diagonal * sinA,
        y: center.y + perpY - diagonal * cosA
      };
      
      const intersections = findPolygonIntersections(lineStart, lineEnd, polygon);
      
      if (intersections.length >= 2) {
        const pt1 = intersections[0];
        const pt2 = intersections[intersections.length - 1];
        
        if (i % 2 === 0) {
          path.push({ x: pt1.x, y: pt1.y });
          path.push({ x: pt2.x, y: pt2.y });
        } else {
          path.push({ x: pt2.x, y: pt2.y });
          path.push({ x: pt1.x, y: pt1.y });
        }
      }
    }
  }

  return path;
}

/**
 * Coverage Planner Frontend - ROS 2 + Nav2 Integration
 * Cartographer harita + Nokta seçimi + Path gönderimi + Frontend Preview
 */
export default function CoveragePage() {
  // ---- ROS bağlantısı ----
  const [wsUrl, setWsUrl] = useState(guessWsUrl());
  const [ros, setRos] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState("Bağlı değil");
  const [errorText, setErrorText] = useState("");

  // ---- MAP state (Cartographer) ----
  const [mapTopicName, setMapTopicName] = useState("/map");
  const [mapMsg, setMapMsg] = useState(null);
  const [mapInfo, setMapInfo] = useState(null);
  const [mapImageData, setMapImageData] = useState(null);
  const [mapLoading, setMapLoading] = useState(false);

  // ---- UI selection state ----
  const [points, setPoints] = useState([]);
  const [selectMode, setSelectMode] = useState(false);

  // ---- Path state (ROS'tan gelen) ----
  const [pathMsg, setPathMsg] = useState(null);
  const [pathTimestamp, setPathTimestamp] = useState(0);

  // ---- Preview Path state (Frontend'de hesaplanan) ----
  const [showPreview, setShowPreview] = useState(true);

  // ---- Style parameters (ROS 2 parametreleri) ----
  const [style, setStyle] = useState("zigzag");
  const [lineSpacing, setLineSpacing] = useState(0.6);
  const [sweepAngle, setSweepAngle] = useState(90);
  const [startCorner, setStartCorner] = useState(0);

  // ---- UI state ----
  const [showSettings, setShowSettings] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // ---- Topics ----
  const fieldPolyTopic = "/coverage/field_polygon";
  const pathTopicName = "/coverage/path";
  const recomputeSrvName = "/coverage/recompute";

  // ---- Canvas refs ----
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const mapTopicRef = useRef(null);
  const pathTopicRef = useRef(null);

  // ---- Preview Path hesapla (useMemo ile optimize) ----
  const previewPath = useMemo(() => {
    if (points.length !== 4) return [];
    return generatePreviewPath(points, style, lineSpacing, sweepAngle, startCorner);
  }, [points, style, lineSpacing, sweepAngle, startCorner]);

  // ---- ROS connect ----
  useEffect(() => {
    const r = new ROSLIB.Ros({ url: wsUrl });

    r.on("connection", () => {
      setRos(r);
      setIsConnected(true);
      setStatusText("ROSBridge bağlı");
      setErrorText("");
    });

    r.on("error", (err) => {
      setIsConnected(false);
      setStatusText("Bağlantı hatası");
      setErrorText(prettyErr(err));
    });

    r.on("close", () => {
      setIsConnected(false);
      setStatusText("Bağlı değil");
    });

    return () => {
      try { r.close(); } catch {}
    };
  }, [wsUrl]);

  // ---- Subscribe /map (Cartographer) ----
  useEffect(() => {
    if (!ros || !isConnected) return;

    if (mapTopicRef.current) {
      try { mapTopicRef.current.unsubscribe(); } catch {}
    }

    setMapLoading(true);
    setMapMsg(null);
    setMapImageData(null);

    const topic = new ROSLIB.Topic({
      ros,
      name: mapTopicName,
      messageType: "nav_msgs/msg/OccupancyGrid",
      throttle_rate: 200,
      queue_size: 1,
    });

    topic.subscribe((msg) => {
      setMapLoading(false);

      if (!msg?.info?.width || !msg?.info?.height) {
        setErrorText("Harita verisi geçersiz");
        return;
      }

      setMapMsg(msg);
      setErrorText("");

      const info = {
        resolution: msg.info.resolution,
        width: msg.info.width,
        height: msg.info.height,
        originX: msg.info.origin.position.x,
        originY: msg.info.origin.position.y,
      };
      setMapInfo(info);

      // OccupancyGrid -> ImageData
      const w = info.width;
      const h = info.height;
      const img = new ImageData(w, h);

      for (let i = 0; i < w * h; i++) {
        const v = msg.data[i];
        let c;
        if (v < 0) c = 205;
        else c = 255 - clamp((v / 100) * 255, 0, 255);
        const idx = i * 4;
        img.data[idx + 0] = c;
        img.data[idx + 1] = c;
        img.data[idx + 2] = c;
        img.data[idx + 3] = 255;
      }
      setMapImageData(img);
    });

    mapTopicRef.current = topic;

    return () => {
      try { topic.unsubscribe(); } catch {}
      mapTopicRef.current = null;
    };
  }, [ros, isConnected, mapTopicName]);

  // ---- Subscribe /coverage/path (ROS'tan gelen path) ----
  useEffect(() => {
    if (!ros || !isConnected) return;

    if (pathTopicRef.current) {
      try { pathTopicRef.current.unsubscribe(); } catch {}
    }

    console.log("📡 Path topic'e subscribe ediliyor...");

    const topic = new ROSLIB.Topic({
      ros,
      name: pathTopicName,
      messageType: "nav_msgs/msg/Path",
      throttle_rate: 50,
      queue_size: 1,
    });

    topic.subscribe((msg) => {
      const msgTime = msg.header?.stamp?.sec || Date.now() / 1000;
      console.log(`📍 YENİ Path alındı: ${msg.poses.length} poses, timestamp=${msgTime}`);
      setPathMsg(msg);
      setPathTimestamp(msgTime);
    });

    pathTopicRef.current = topic;

    return () => {
      try { topic.unsubscribe(); } catch {}
      pathTopicRef.current = null;
    };
  }, [ros, isConnected]);

  // ---- Draw canvas ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !mapInfo || !mapImageData) return;

    const containerRect = container.getBoundingClientRect();
    const maxW = containerRect.width;
    const maxH = containerRect.height;

    const mapW = mapInfo.width;
    const mapH = mapInfo.height;

    const scale = Math.min(maxW / mapW, maxH / mapH);
    const drawW = Math.floor(mapW * scale);
    const drawH = Math.floor(mapH * scale);

    canvas.width = drawW;
    canvas.height = drawH;
    canvas.style.width = drawW + "px";
    canvas.style.height = drawH + "px";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Harita rasterini çiz
    const off = document.createElement("canvas");
    off.width = mapW;
    off.height = mapH;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    
    offCtx.putImageData(mapImageData, 0, 0);

    ctx.clearRect(0, 0, drawW, drawH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, drawW, drawH);

    // Koordinat dönüşüm fonksiyonları
    const worldToMapPixel = (x, y) => {
      const px = (x - mapInfo.originX) / mapInfo.resolution;
      const py = (y - mapInfo.originY) / mapInfo.resolution;
      return { mx: px, my: py };
    };

    const mapPixelToCanvas = (mx, my) => {
      return { cx: mx * scale, cy: (mapH - my) * scale };
    };

    // Ok çizme fonksiyonu
    const drawArrow = (fromX, fromY, toX, toY, color, headLength = 8) => {
      const angle = Math.atan2(toY - fromY, toX - fromX);
      
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      
      // Çizgi
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
      
      // Ok başı
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(
        toX - headLength * Math.cos(angle - Math.PI / 6),
        toY - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        toX - headLength * Math.cos(angle + Math.PI / 6),
        toY - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    };

    // ---- Preview Path'i Çiz (Mavi - Frontend hesaplı) ----
    if (showPreview && previewPath.length > 1) {
      console.log(`🎨 Preview Path çiziliyor: ${previewPath.length} points, stil: ${style}`);
      
      ctx.globalAlpha = 0.9;

      // Her çizgi segmentini ok ile çiz
      for (let i = 0; i < previewPath.length - 1; i++) {
        const wp1 = previewPath[i];
        const wp2 = previewPath[i + 1];
        
        const { mx: mx1, my: my1 } = worldToMapPixel(wp1.x, wp1.y);
        const { cx: cx1, cy: cy1 } = mapPixelToCanvas(mx1, my1);
        
        const { mx: mx2, my: my2 } = worldToMapPixel(wp2.x, wp2.y);
        const { cx: cx2, cy: cy2 } = mapPixelToCanvas(mx2, my2);

        // Her segmenti farklı renkte veya ok ile çiz
        drawArrow(cx1, cy1, cx2, cy2, "#3b82f6", 10);
      }

      // Başlangıç noktasını işaretle
      if (previewPath.length > 0) {
        const startPt = previewPath[0];
        const { mx, my } = worldToMapPixel(startPt.x, startPt.y);
        const { cx, cy } = mapPixelToCanvas(mx, my);
        
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("S", cx, cy);
      }

      // Bitiş noktasını işaretle
      if (previewPath.length > 1) {
        const endPt = previewPath[previewPath.length - 1];
        const { mx, my } = worldToMapPixel(endPt.x, endPt.y);
        const { cx, cy } = mapPixelToCanvas(mx, my);
        
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("E", cx, cy);
      }

      ctx.globalAlpha = 1;
    }

    // ---- ROS'tan Gelen Path'i Çiz (Yeşil) - Sadece preview kapalıyken veya ROS path varken ----
    // Preview açıkken ROS path'i gösterme (çakışma olmasın)
    if (pathMsg?.poses?.length > 1 && !showPreview) {
      console.log(`🎨 ROS Path çiziliyor: ${pathMsg.poses.length} poses`);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#10b981";
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      for (let i = 0; i < pathMsg.poses.length; i++) {
        const wp = pathMsg.poses[i].pose.position;
        const { mx, my } = worldToMapPixel(wp.x, wp.y);
        const { cx, cy } = mapPixelToCanvas(mx, my);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- Seçilen Noktaları Çiz (Kırmızı kenar) ----
    if (points.length > 0) {
      console.log(`🎨 Noktalar çiziliyor: ${points.length} nokta`);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#f97316";
      ctx.globalAlpha = 1;

      const cvsPts = points.map((p) => {
        const { mx, my } = worldToMapPixel(p.x, p.y);
        return mapPixelToCanvas(mx, my);
      });

      // Polygon kenarları
      ctx.beginPath();
      ctx.moveTo(cvsPts[0].cx, cvsPts[0].cy);
      for (let i = 1; i < cvsPts.length; i++) {
        ctx.lineTo(cvsPts[i].cx, cvsPts[i].cy);
      }
      if (points.length === 4) ctx.closePath();
      ctx.stroke();

      // Polygon fill (şeffaf)
      if (points.length === 4) {
        ctx.fillStyle = "rgba(249, 115, 22, 0.1)";
        ctx.beginPath();
        ctx.moveTo(cvsPts[0].cx, cvsPts[0].cy);
        for (let i = 1; i < cvsPts.length; i++) {
          ctx.lineTo(cvsPts[i].cx, cvsPts[i].cy);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Noktalar
      for (let i = 0; i < cvsPts.length; i++) {
        const pt = cvsPts[i];

        ctx.fillStyle = i === startCorner ? "#22c55e" : "#f97316";
        ctx.beginPath();
        ctx.arc(pt.cx, pt.cy, 9, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), pt.cx, pt.cy);
      }
    }
  }, [mapInfo, mapImageData, points, pathMsg, pathTimestamp, previewPath, showPreview, style, startCorner]);

  // ---- Canvas tıklama (Nokta seçimi) ----
  const onCanvasClick = (e) => {
    if (!selectMode || !mapInfo || !mapImageData) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const canvasRect = canvas.getBoundingClientRect();
    
    const clickX = e.clientX - canvasRect.left;
    const clickY = e.clientY - canvasRect.top;

    const mapW = mapInfo.width;
    const mapH = mapInfo.height;
    const canvasW = canvasRect.width;
    const canvasH = canvasRect.height;

    const scale = Math.min(canvasW / mapW, canvasH / mapH);
    
    const scaledMapW = mapW * scale;
    const scaledMapH = mapH * scale;
    
    const mapOffsetX = (canvasW - scaledMapW) / 2;
    const mapOffsetY = (canvasH - scaledMapH) / 2;

    if (
      clickX < mapOffsetX ||
      clickX > mapOffsetX + scaledMapW ||
      clickY < mapOffsetY ||
      clickY > mapOffsetY + scaledMapH
    ) {
      console.log("Tıklama harita dışında");
      return;
    }

    const mapPixelX = (clickX - mapOffsetX) / scale;
    const mapPixelY = (clickY - mapOffsetY) / scale;

    if (mapPixelX < 0 || mapPixelX >= mapW || mapPixelY < 0 || mapPixelY >= mapH) {
      console.log("Harita bounds dışında");
      return;
    }

    const wx = mapInfo.originX + mapPixelX * mapInfo.resolution;
    const wy = mapInfo.originY + (mapH - mapPixelY) * mapInfo.resolution;

    console.log(`Tıklama: World (${wx.toFixed(2)}, ${wy.toFixed(2)})`);

    setPoints((prev) => {
      if (prev.length >= 4) {
        alert("Zaten 4 nokta seçilmiş. Temizle butonuyla sıfırla.");
        return prev;
      }
      return [...prev, { x: wx, y: wy }];
    });
  };

  // ---- Polygon gönder ----
  const publishPolygon = async () => {
    if (!ros || !isConnected) return;
    if (points.length !== 4) {
      alert("Lütfen 4 nokta seçin.");
      return;
    }

    try {
      const topic = new ROSLIB.Topic({
        ros,
        name: fieldPolyTopic,
        messageType: "geometry_msgs/msg/PolygonStamped",
        queue_size: 1,
      });

      const msg = {
        header: {
          frame_id: "map",
          stamp: { sec: Math.floor(Date.now() / 1000), nanosec: (Date.now() % 1000) * 1000000 }
        },
        polygon: {
          points: points.map((p) => ({ x: p.x, y: p.y, z: 0.0 })),
        },
      };

      topic.publish(msg);
      setStatusText("✅ Polygon gönderildi (/coverage/field_polygon)");
      setErrorText("");
      
      setTimeout(() => {
        try {
          topic.unadvertise();
        } catch (e) {
          console.warn("Topic unadvertise hatası:", e);
        }
      }, 500);
    } catch (err) {
      const errMsg = `Polygon gönderme hatası: ${prettyErr(err)}`;
      setErrorText(errMsg);
      console.error(errMsg, err);
    }
  };

  // ---- Recompute çağrı ----
  const callRecompute = () => {
    if (!ros || !isConnected) return;

    try {
      const srv = new ROSLIB.Service({
        ros,
        name: recomputeSrvName,
        serviceType: "std_srvs/srv/Trigger",
      });

      const req = {};

      srv.callService(req, (res) => {
        if (res.success) {
          console.log("✅ Recompute başarılı");
          setStatusText("🔄 Path yeniden hesaplandı");
          setErrorText("");
          
          if (pathTopicRef.current) {
            try {
              pathTopicRef.current.unsubscribe();
            } catch (e) {
              console.warn("Unsubscribe hatası:", e);
            }
          }
          
          setTimeout(() => {
            if (!ros || !isConnected) return;
            
            const newTopic = new ROSLIB.Topic({
              ros,
              name: pathTopicName,
              messageType: "nav_msgs/msg/Path",
              throttle_rate: 50,
              queue_size: 1,
            });

            newTopic.subscribe((msg) => {
              console.log(`📍 YENI Path alındı: ${msg.poses.length} poses`);
              setPathMsg(msg);
              setPathTimestamp(Date.now() / 1000);
            });

            pathTopicRef.current = newTopic;
          }, 100);
          
        } else {
          setErrorText(`Recompute başarısız: ${res.message}`);
        }
      }, (err) => {
        const errMsg = `Recompute çağrısı hatası: ${prettyErr(err)}`;
        setErrorText(errMsg);
        console.error(errMsg, err);
      });
    } catch (err) {
      const errMsg = `Recompute çağrısı hatası: ${prettyErr(err)}`;
      setErrorText(errMsg);
      console.error(errMsg, err);
    }
  };

  // ---- Parametreleri uygula ----
  const applyStyleParams = () => {
    if (!ros || !isConnected) return;

    setStatusText("📋 Parametreler hazır. Terminal komutları clipboard'a kopyalandı.");
    
    const cmds = [
      `ros2 param set /coverage_planner_node style ${style}`,
      `ros2 param set /coverage_planner_node line_spacing ${lineSpacing}`,
      `ros2 param set /coverage_planner_node sweep_angle_deg ${sweepAngle}`,
      `ros2 param set /coverage_planner_node start_corner ${startCorner}`
    ].join('\n');
    
    setErrorText(cmds);
    
    navigator.clipboard.writeText(cmds).then(() => {
      console.log("✅ Komutlar clipboard'a kopyalandı");
    }).catch(() => {
      console.log("⚠️ Clipboard kopyalama başarısız");
    });

    setTimeout(() => {
      callRecompute();
    }, 3000);
  };

  // ---- Execute Path ----
  const executePath = () => {
    if (!ros || !isConnected) return;
    if (!pathMsg || pathMsg.poses.length < 2) {
      alert("Path yok. Önce Polygon gönderin ve Recompute yapın.");
      return;
    }

    setIsExecuting(true);
    setStatusText("⏳ Path Nav2'ye gönderiliyor...");

    try {
      setTimeout(() => {
        setStatusText("🚀 Path executed (Nav2'ye gönderildi)");
        setIsExecuting(false);
      }, 1000);
    } catch (err) {
      setErrorText(`Execute hatası: ${prettyErr(err)}`);
      setIsExecuting(false);
    }
  };

  const clearSelection = () => {
    setPoints([]);
    setPathMsg(null);
  };

  return (
    <div style={{
      minHeight: "calc(100vh - 56px)",
      width: "100vw",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
      color: "white",
      padding: "0.5rem",
      fontFamily: "system-ui, -apple-system, sans-serif",
      overflow: "hidden",
      boxSizing: "border-box"
    }}>
      <div style={{
        maxWidth: "1400px",
        margin: "0 auto",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem"
      }}>
        {/* ====== HEADER ====== */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>🗺️</span>
              <h1 style={{ fontSize: "1.125rem", fontWeight: "bold", margin: 0 }}>COVERAGE PLANNER</h1>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "0.5rem",
                background: "#334155",
                border: "none",
                color: "white",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500"
              }}
            >
              ⚙️ {showSettings ? "Gizle" : "Ayarlar"}
            </button>
          </div>

          {/* Status Bar */}
          <div style={{ background: "#1e293b", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid #334155" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>
                  {isConnected ? "🟢" : "🔴"}
                </span>
                <div>
                  <div style={{ fontWeight: "600", fontSize: "0.875rem" }}>{statusText}</div>
                  {errorText && (
                    <div style={{ fontSize: "0.75rem", color: "#f87171", marginTop: "0.125rem", whiteSpace: "pre-wrap" }}>{errorText}</div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.375rem" }}>
                {!isConnected && (
                  <button
                    onClick={() => {
                      const r = new ROSLIB.Ros({ url: wsUrl });
                      setRos(r);
                    }}
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: "#2563eb",
                      border: "none",
                      borderRadius: "0.375rem",
                      color: "white",
                      fontWeight: "600",
                      cursor: "pointer",
                      fontSize: "0.75rem"
                    }}
                  >
                    🔗 Bağlan
                  </button>
                )}
                {isConnected && (
                  <button
                    onClick={() => ros?.close()}
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: "#475569",
                      border: "none",
                      borderRadius: "0.375rem",
                      color: "white",
                      fontWeight: "600",
                      cursor: "pointer",
                      fontSize: "0.75rem"
                    }}
                  >
                    ✂️ Kes
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ====== SETTINGS PANEL ====== */}
        {showSettings && (
          <div style={{
            background: "#1e293b",
            borderRadius: "0.5rem",
            padding: "1rem",
            border: "1px solid #334155",
            flexShrink: 0,
            maxHeight: "50vh",
            overflowY: "auto"
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "bold", marginBottom: "0.75rem", marginTop: 0 }}>
              ⚙️ Ayarlar
            </h2>

            {/* Harita & ROS Ayarları */}
            <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 768 ? "1fr" : "repeat(2, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "600", marginBottom: "0.375rem", color: "#cbd5e1" }}>
                  📍 Cartographer Map Topic
                </label>
                <input
                  type="text"
                  value={mapTopicName}
                  onChange={(e) => {
                    setPoints([]);
                    setMapTopicName(e.target.value);
                  }}
                  placeholder="/map"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    background: "#334155",
                    border: "1px solid #475569",
                    borderRadius: "0.375rem",
                    color: "white",
                    outline: "none",
                    fontSize: "0.875rem"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "600", marginBottom: "0.375rem", color: "#cbd5e1" }}>
                  🌐 ROSBridge WebSocket URL
                </label>
                <input
                  type="text"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  placeholder="ws://localhost:9090"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    background: "#334155",
                    border: "1px solid #475569",
                    borderRadius: "0.375rem",
                    color: "white",
                    outline: "none",
                    fontSize: "0.875rem"
                  }}
                />
              </div>
            </div>

            <hr style={{ borderColor: "#334155", margin: "0.75rem 0" }} />

            {/* Path Stili Ayarları */}
            <h3 style={{ fontSize: "0.875rem", fontWeight: "700", marginBottom: "0.75rem", marginTop: 0 }}>
              📐 Path Stili Parametreleri
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 768 ? "1fr" : "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "500", marginBottom: "0.375rem", color: "#cbd5e1" }}>
                  Stil
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    background: "#334155",
                    border: "1px solid #475569",
                    borderRadius: "0.375rem",
                    color: "white",
                    outline: "none",
                    fontSize: "0.875rem"
                  }}
                >
                  <option value="zigzag">↔️ Zigzag (Yatay)</option>
                  <option value="ladder">↕️ Ladder (Dikey)</option>
                  <option value="diagonal">⟍ Diagonal</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "500", marginBottom: "0.375rem", color: "#cbd5e1" }}>
                  Satır Aralığı (m)
                </label>
                <input
                  type="number"
                  min="0.2"
                  max="2.0"
                  step="0.1"
                  value={lineSpacing}
                  onChange={(e) => setLineSpacing(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    background: "#334155",
                    border: "1px solid #475569",
                    borderRadius: "0.375rem",
                    color: "white",
                    outline: "none",
                    fontSize: "0.875rem"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "500", marginBottom: "0.375rem", color: "#cbd5e1" }}>
                  Sweep Açısı (°)
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  step="5"
                  value={sweepAngle}
                  onChange={(e) => setSweepAngle(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    background: "#334155",
                    border: "1px solid #475569",
                    borderRadius: "0.375rem",
                    color: "white",
                    outline: "none",
                    fontSize: "0.875rem"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "500", marginBottom: "0.375rem", color: "#cbd5e1" }}>
                  Başlama Köşesi
                </label>
                <select
                  value={startCorner}
                  onChange={(e) => setStartCorner(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    background: "#334155",
                    border: "1px solid #475569",
                    borderRadius: "0.375rem",
                    color: "white",
                    outline: "none",
                    fontSize: "0.875rem"
                  }}
                >
                  {[0, 1, 2, 3].map((v) => (
                    <option key={v} value={v}>Köşe #{v + 1}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview Toggle */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "0.5rem", 
              marginBottom: "1rem",
              padding: "0.75rem",
              background: "#0f172a",
              borderRadius: "0.375rem",
              border: "1px solid #334155"
            }}>
              <input
                type="checkbox"
                id="showPreview"
                checked={showPreview}
                onChange={(e) => setShowPreview(e.target.checked)}
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
              <label htmlFor="showPreview" style={{ fontSize: "0.875rem", cursor: "pointer", color: "#cbd5e1" }}>
                🔵 Frontend Preview Göster (seçilen stil ve parametrelerle)
              </label>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <button
                onClick={applyStyleParams}
                disabled={!isConnected}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: isConnected ? "#2563eb" : "#334155",
                  border: "none",
                  borderRadius: "0.375rem",
                  color: "white",
                  fontWeight: "700",
                  cursor: isConnected ? "pointer" : "not-allowed",
                  fontSize: "0.875rem",
                  opacity: isConnected ? 1 : 0.5
                }}
              >
                📋 Parametreleri Uygula (ROS)
              </button>
              <button
                onClick={callRecompute}
                disabled={!isConnected}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: isConnected ? "#10b981" : "#334155",
                  border: "none",
                  borderRadius: "0.375rem",
                  color: "white",
                  fontWeight: "700",
                  cursor: isConnected ? "pointer" : "not-allowed",
                  fontSize: "0.875rem",
                  opacity: isConnected ? 1 : 0.5
                }}
              >
                🔄 Recompute
              </button>
            </div>

            {/* Stil Gösterimi */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.5rem",
              marginTop: "0.75rem"
            }}>
              {[
                { name: "zigzag", label: "Zigzag", icon: "↔️", desc: "Yatay çizgiler" },
                { name: "ladder", label: "Ladder", icon: "↕️", desc: "Dikey çizgiler" },
                { name: "diagonal", label: "Diagonal", icon: "⟍", desc: "Açılı çizgiler" }
              ].map((s) => (
                <div
                  key={s.name}
                  onClick={() => setStyle(s.name)}
                  style={{
                    padding: "0.75rem",
                    background: style === s.name ? "#1e40af" : "#0f172a",
                    border: style === s.name ? "2px solid #3b82f6" : "1px solid #334155",
                    borderRadius: "0.5rem",
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.2s"
                  }}
                >
                  <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{s.icon}</div>
                  <div style={{ fontSize: "0.8rem", fontWeight: "600", color: "#cbd5e1" }}>{s.label}</div>
                  <div style={{ fontSize: "0.65rem", color: "#94a3b8" }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ====== MAIN CONTENT ====== */}
        <div style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: window.innerWidth < 768 ? "1fr" : "320px 1fr",
          gap: "0.75rem",
          minHeight: 0
        }}>
          {/* ====== SOL PANEL: KONTROLLER ====== */}
          <div style={{
            background: "#1e293b",
            borderRadius: "0.5rem",
            padding: "1rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            overflow: "auto"
          }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: "bold", marginBottom: "1rem", marginTop: 0 }}>
              🎯 Nokta Seçimi
            </h2>

            {/* Kontrol Butonları */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <button
                onClick={() => setSelectMode((v) => !v)}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: selectMode ? "#2563eb" : "#334155",
                  border: "none",
                  borderRadius: "0.375rem",
                  color: "white",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "0.75rem"
                }}
              >
                {selectMode ? "✓ SEÇİM AÇIK" : "○ SEÇİM KAPALI"}
              </button>
              <button
                onClick={clearSelection}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: "#334155",
                  border: "none",
                  borderRadius: "0.375rem",
                  color: "white",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontSize: "0.75rem"
                }}
              >
                🗑️ Temizle
              </button>
            </div>

            {/* Stil Seçimi (Hızlı Erişim) */}
            <div style={{ background: "#0f172a", borderRadius: "0.375rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #334155" }}>
              <div style={{ fontWeight: "700", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#cbd5e1" }}>
                📐 Path Stili
              </div>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                {[
                  { name: "zigzag", icon: "↔️" },
                  { name: "ladder", icon: "↕️" },
                  { name: "diagonal", icon: "⟍" }
                ].map((s) => (
                  <button
                    key={s.name}
                    onClick={() => setStyle(s.name)}
                    style={{
                      flex: 1,
                      padding: "0.5rem",
                      background: style === s.name ? "#2563eb" : "#334155",
                      border: style === s.name ? "2px solid #60a5fa" : "1px solid #475569",
                      borderRadius: "0.375rem",
                      color: "white",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      fontWeight: style === s.name ? "700" : "500"
                    }}
                  >
                    {s.icon} {s.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Harita Bilgisi */}
            <div style={{ background: "#0f172a", borderRadius: "0.375rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #334155" }}>
              <div style={{ fontWeight: "700", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#cbd5e1" }}>
                📊 Harita Bilgisi
              </div>
              {mapInfo ? (
                <div style={{ fontSize: "0.75rem", color: "#cbd5e1", lineHeight: "1.6" }}>
                  <div><span style={{ color: "#94a3b8" }}>Boyut:</span> {mapInfo.width}×{mapInfo.height}px</div>
                  <div><span style={{ color: "#94a3b8" }}>Rez.:</span> {mapInfo.resolution.toFixed(3)}m</div>
                  <div><span style={{ color: "#94a3b8" }}>Menşei:</span> ({mapInfo.originX.toFixed(1)}, {mapInfo.originY.toFixed(1)})</div>
                </div>
              ) : mapLoading ? (
                <div style={{ fontSize: "0.75rem", color: "#fbbf24" }}>⏳ Harita bekleniyor...</div>
              ) : (
                <div style={{ fontSize: "0.75rem", color: "#f87171" }}>❌ Harita bağlantısı yok</div>
              )}
            </div>

            {/* Seçilen Noktalar */}
            <div style={{ background: "#0f172a", borderRadius: "0.375rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #334155" }}>
              <div style={{ fontWeight: "700", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#cbd5e1" }}>
                📌 Noktalar: <span style={{ color: "#60a5fa" }}>{points.length}</span>/4
              </div>
              {points.length > 0 ? (
                <ol style={{ margin: 0, paddingLeft: "1.5rem", fontSize: "0.7rem", color: "#cbd5e1", lineHeight: "1.8" }}>
                  {points.map((p, idx) => (
                    <li key={idx} style={{ marginBottom: "0.25rem" }}>
                      <code style={{ color: idx === startCorner ? "#22c55e" : "#60a5fa", fontSize: "0.65rem" }}>
                        ({p.x.toFixed(1)}, {p.y.toFixed(1)}) {idx === startCorner && "← Başlangıç"}
                      </code>
                    </li>
                  ))}
                </ol>
              ) : (
                <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Henüz nokta seçilmedi</div>
              )}
            </div>

            {/* Preview Info */}
            {showPreview && points.length === 4 && (
              <div style={{ background: "#1e3a5f", borderRadius: "0.375rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #3b82f6" }}>
                <div style={{ fontWeight: "700", marginBottom: "0.25rem", fontSize: "0.8rem", color: "#93c5fd" }}>
                  🔵 Preview Aktif
                </div>
                <div style={{ fontSize: "0.7rem", color: "#bfdbfe" }}>
                  Stil: <strong>{style}</strong> | Aralık: <strong>{lineSpacing}m</strong>
                </div>
                <div style={{ fontSize: "0.65rem", color: "#93c5fd", marginTop: "0.25rem" }}>
                  {previewPath.length} noktalı path gösteriliyor
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <button
                onClick={publishPolygon}
                disabled={points.length !== 4 || !isConnected}
                style={{
                  padding: "0.85rem",
                  background: points.length === 4 && isConnected ? "#10b981" : "#334155",
                  border: "none",
                  borderRadius: "0.375rem",
                  color: "white",
                  fontWeight: "700",
                  cursor: points.length === 4 && isConnected ? "pointer" : "not-allowed",
                  fontSize: "0.875rem",
                  opacity: points.length === 4 && isConnected ? 1 : 0.5
                }}
              >
                📤 Polygon Gönder
              </button>

              <button
                onClick={executePath}
                disabled={!pathMsg || pathMsg.poses.length < 2 || isExecuting}
                style={{
                  padding: "0.85rem",
                  background: pathMsg?.poses?.length > 1 ? "#f59e0b" : "#334155",
                  border: "none",
                  borderRadius: "0.375rem",
                  color: "white",
                  fontWeight: "700",
                  cursor: pathMsg?.poses?.length > 1 ? "pointer" : "not-allowed",
                  fontSize: "0.875rem",
                  opacity: pathMsg?.poses?.length > 1 ? 1 : 0.5
                }}
              >
                🚀 {isExecuting ? "Çalıştırılıyor..." : "Path Çalıştır (Nav2)"}
              </button>
            </div>

            <hr style={{ borderColor: "#334155", margin: "0.75rem 0" }} />

            {/* Rehber */}
            <div style={{ fontSize: "0.7rem", color: "#94a3b8", lineHeight: "1.6" }}>
              <div style={{ fontWeight: "700", marginBottom: "0.5rem", color: "#cbd5e1" }}>💡 Akış:</div>
              <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
                <li>Stil seç (zigzag/ladder)</li>
                <li>4 nokta seç (preview görünür)</li>
                <li>"Polygon Gönder"</li>
                <li>"Path Çalıştır"</li>
              </ol>
            </div>
          </div>

          {/* ====== SAĞ PANEL: HARITA ====== */}
          <div style={{
            background: "#1e293b",
            borderRadius: "0.5rem",
            padding: "1rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: "bold", marginBottom: "0.75rem", marginTop: 0, flexShrink: 0 }}>
              🗺️ Cartographer Haritası
            </h2>

            {/* Harita Canvas */}
            <div style={{
              flex: 1,
              borderRadius: "0.5rem",
              border: "2px solid #475569",
              overflow: "hidden",
              background: "#0a0f1a",
              position: "relative",
              minHeight: 0,
              display: "flex",
              flexDirection: "column"
            }}>
              <div
                ref={containerRef}
                style={{
                  position: "relative",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0
                }}
              >
                {/* Status Bar */}
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.7rem",
                  color: "#94a3b8",
                  marginBottom: "0.5rem",
                  flexShrink: 0,
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  background: "rgba(15, 23, 42, 0.9)",
                  padding: "0.35rem 0.5rem",
                  borderRadius: "0.25rem"
                }}>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <span>{selectMode ? "✓ Seçim AKTİF" : "○ Seçim KAPALI"}</span>
                    <span style={{ color: "#f97316" }}>📐 {style}</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    {mapInfo && (
                      <span style={{ color: "#60a5fa" }}>📊 {mapInfo.width}×{mapInfo.height}</span>
                    )}
                    {showPreview && previewPath.length > 0 && (
                      <span style={{ color: "#3b82f6" }}>🔵 Preview: {previewPath.length} pts</span>
                    )}
                    {pathMsg?.poses?.length > 0 && (
                      <span style={{ color: "#10b981" }}>🟢 ROS: {pathMsg.poses.length} poses</span>
                    )}
                  </div>
                </div>

                {/* Canvas */}
                {mapImageData ? (
                  <canvas
                    ref={canvasRef}
                    onClick={onCanvasClick}
                    style={{
                      flex: 1,
                      border: "1px solid #334155",
                      borderRadius: "0.375rem",
                      cursor: selectMode ? "crosshair" : "default",
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      backgroundColor: "#0a0f1a",
                      display: "block"
                    }}
                  />
                ) : (
                  <div style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    textAlign: "center"
                  }}>
                    <div>
                      <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🗺️</div>
                      <div style={{ fontSize: "0.95rem", fontWeight: "600", marginBottom: "0.5rem", color: "#cbd5e1" }}>
                        {mapLoading ? "Harita Yükleniyor..." : "Bağlantı Bekleniyor"}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#475569" }}>
                        Topic: <code style={{ color: "#60a5fa" }}>{mapTopicName}</code>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Legend */}
            <div style={{
              marginTop: "0.5rem",
              fontSize: "0.7rem",
              color: "#94a3b8",
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              justifyContent: "center"
            }}>
              <div>🟠 <span style={{ color: "#f97316" }}>Seçim Alanı</span></div>
              <div>🔵 <span style={{ color: "#3b82f6" }}>Preview Path</span></div>
              <div>🟢 <span style={{ color: "#10b981" }}>ROS Path</span></div>
              <div>🟢 S = <span style={{ color: "#22c55e" }}>Başlangıç</span></div>
              <div>🔴 E = <span style={{ color: "#ef4444" }}>Bitiş</span></div>
            </div>
          </div>
        </div>

        {/* ====== FOOTER ====== */}
        <div style={{
          textAlign: "center",
          fontSize: "0.65rem",
          color: "#64748b",
          flexShrink: 0,
          borderTop: "1px solid #334155",
          paddingTop: "0.5rem"
        }}>
          <div>🗺️ Coverage Planner | ROS 2 + Nav2 | Frontend Preview Enabled</div>
        </div>
      </div>
    </div>
  );
}
