import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

import * as ROSLIB from "roslib";

const ROSContext = createContext(null);

const DEFAULT_URL = `ws://${window.location.hostname || "localhost"}:9090`;

function loadUrl() {
  return DEFAULT_URL;
}

function saveUrl(url) {
  try { localStorage.setItem("rosbridge_url_v1", url); } catch {}
}

export function ROSProvider({ children }) {
  const [rosbridgeUrl, setRosbridgeUrl] = useState(loadUrl);
  const [status, setStatus] = useState("Bağlanmadı");
  const [errorText, setErrorText] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  const rosRef = useRef(null);
  const [rosInstance, setRosInstance] = useState(null);

  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);

  // ══════════════════════════════════════════════════════════════════════════
  // OPERASYON MODU — tüm sayfalar bunu paylaşır
  // ══════════════════════════════════════════════════════════════════════════
  const [operationMode, setOperationModeState] = useState("manual");
  const modSubRef = useRef(null);

  // /mod subscribe — dışarıdan gelen mod değişikliklerini yakala
  useEffect(() => {
    const ros = rosRef.current;
    if (!ros || !isConnected) return;

    if (modSubRef.current) {
      try { modSubRef.current.unsubscribe(); } catch {}
    }

    const topic = new ROSLIB.Topic({
      ros,
      name: "/mod",
      messageType: "std_msgs/msg/String",
      throttle_rate: 200,
      queue_length: 1,
    });

    topic.subscribe((msg) => {
      const val = (msg.data || "").toLowerCase().trim();
      if (["manual", "autonomous", "task"].includes(val)) {
        setOperationModeState(val);
      }
    });

    modSubRef.current = topic;
    return () => { try { topic.unsubscribe(); } catch {} };
  }, [rosInstance, isConnected]);

  // Mod değiştir + /mod publish + geçiş aksiyonları
  const setOperationMode = useCallback((newMode) => {
    const ros = rosRef.current;
    if (!ros || !isConnected) {
      setOperationModeState(newMode);
      return;
    }

    const prevMode = operationMode;
    setOperationModeState(newMode);

    // 1) /mod publish
    try {
      const modTopic = new ROSLIB.Topic({
        ros, name: "/mod",
        messageType: "std_msgs/msg/String",
        queue_size: 1,
      });
      modTopic.publish({ data: newMode });
      setTimeout(() => { try { modTopic.unadvertise(); } catch {} }, 500);
    } catch {}

    // 2) Otonom/Task → Manuel geçişi: Nav2 goal iptal et
    //    Nav2 /cmd_vel yayınını kesmesi için aktif navigasyonu durdurmalıyız
    if (newMode === "manual" && (prevMode === "autonomous" || prevMode === "task")) {
      cancelNav2Goal(ros);
    }

    console.log(`[ROSContext] Mode: ${prevMode} → ${newMode}`);
  }, [rosInstance, isConnected, operationMode]);

  // Nav2 goal iptal — navigate_to_pose action cancel
  const cancelNav2Goal = useCallback((ros) => {
    if (!ros) return;
    try {
      // Nav2 FollowPath cancel
      const cancelTopic = new ROSLIB.Topic({
        ros,
        name: "/navigate_to_pose/_action/cancel",
        messageType: "action_msgs/msg/GoalID",
        queue_size: 1,
      });
      // Boş GoalID = tüm aktif goal'ları iptal et
      cancelTopic.publish({});
      setTimeout(() => { try { cancelTopic.unadvertise(); } catch {} }, 500);
      console.log("[ROSContext] Nav2 goal cancel sent");
    } catch (e) {
      console.warn("[ROSContext] Nav2 cancel error:", e);
    }

    // Ek güvenlik: /cmd_vel'e bir kez sıfır twist gönder
    // Bu sayede mux'taki son Nav2 mesajı sıfırlanır
    try {
      const cmdTopic = new ROSLIB.Topic({
        ros,
        name: "/cmd_vel",
        messageType: "geometry_msgs/msg/Twist",
        queue_size: 1,
      });
      cmdTopic.publish({
        linear: { x: 0, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0 },
      });
      setTimeout(() => { try { cmdTopic.unadvertise(); } catch {} }, 500);
    } catch {}
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // BAĞLANTI YÖNETİMİ (mevcut kod — değişiklik yok)
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => { saveUrl(rosbridgeUrl); }, [rosbridgeUrl]);

  const connect = useCallback((url) => {
    if (connectingRef.current) return;

    if (rosRef.current) {
      try { rosRef.current.removeAllListeners(); rosRef.current.close(); } catch {}
      rosRef.current = null;
      setRosInstance((prev) => prev ? null : prev);
      setIsConnected((prev) => prev ? false : prev);
    }

    connectingRef.current = true;
    setStatus((prev) => prev === "Bağlanıyor..." ? prev : "Bağlanıyor...");
    setErrorText((prev) => prev ? "" : prev);

    const ros = new ROSLIB.Ros({ url });

    ros.on("connection", () => {
      if (!mountedRef.current) return;
      console.log("[ROSContext] ✅ Bağlandı!");
      connectingRef.current = false;
      rosRef.current = ros;
      setRosInstance(ros);
      setIsConnected(true);
      setStatus("Bağlandı");
      setErrorText("");
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    });

    ros.on("close", () => {
      if (!mountedRef.current) return;
      connectingRef.current = false;
      rosRef.current = null;
      setRosInstance((prev) => prev ? null : prev);
      setIsConnected((prev) => {
        if (prev) { console.log("[ROSContext] 🔌 Bağlantı koptu"); setStatus("Bağlantı koptu"); }
        return false;
      });
      if (!reconnectTimer.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          if (mountedRef.current) connect(url);
        }, 5000);
      }
    });

    ros.on("error", (e) => {
      if (!mountedRef.current) return;
      const msg = e?.message || (e?.type === "error" ? "ROSBridge bağlantısı kurulamadı" : String(e));
      setStatus((prev) => prev === "Bağlantı hatası" ? prev : "Bağlantı hatası");
      setErrorText((prev) => prev === msg ? prev : msg);
    });

    rosRef.current = ros;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect(rosbridgeUrl);
    return () => {
      mountedRef.current = false;
      connectingRef.current = false;
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    };
  }, [rosbridgeUrl, connect]);

  useEffect(() => {
    return () => {
      console.log("[ROSContext] Provider unmount");
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (rosRef.current) {
        try { rosRef.current.removeAllListeners(); rosRef.current.close(); } catch {}
      }
    };
  }, []);

  const reconnect = useCallback(() => {
    console.log("[ROSContext] Manuel reconnect");
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (rosRef.current) {
      try { rosRef.current.removeAllListeners(); rosRef.current.close(); } catch {}
      rosRef.current = null;
      setRosInstance(null);
      setIsConnected(false);
    }
    connectingRef.current = false;
    setTimeout(() => connect(rosbridgeUrl), 300);
  }, [rosbridgeUrl, connect]);

  const value = {
    ros: rosInstance,
    isConnected,
    status,
    errorText,
    rosbridgeUrl,
    setRosbridgeUrl,
    reconnect,
    // ── YENİ: Mod sistemi ──
    operationMode,
    setOperationMode,
  };

  return <ROSContext.Provider value={value}>{children}</ROSContext.Provider>;
}

export function useROS() {
  const ctx = useContext(ROSContext);
  if (!ctx) throw new Error("useROS must be used within ROSProvider");
  return ctx;
}
