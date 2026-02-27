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

// --- Varsayılan IP ayarı (localStorage'dan okunur) ---
const LS_URL_KEY = "rosbridge_url_v1";
const DEFAULT_URL = `ws://${window.location.hostname || "localhost"}:9090`;

function loadUrl() {
  // Her zaman tarayıcının hostname'ini kullan — farklı ağlarda sorun çıkmasın
  return DEFAULT_URL;
}

function saveUrl(url) {
  try {
    localStorage.setItem(LS_URL_KEY, url);
  } catch {}
}

export function ROSProvider({ children }) {
  const [rosbridgeUrl, setRosbridgeUrl] = useState(loadUrl);
  const [status, setStatus] = useState("Bağlanmadı");
  const [errorText, setErrorText] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  // ros nesnesini hem ref hem state'te tutuyoruz:
  //   ref  → callback'ler içinde güncel değere erişmek için
  //   state → değiştiğinde tüm consumer'ları re-render etmek için
  const rosRef = useRef(null);
  const [rosInstance, setRosInstance] = useState(null);

  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);

  // URL değişince localStorage'a yaz
  useEffect(() => {
    saveUrl(rosbridgeUrl);
  }, [rosbridgeUrl]);

  // --- Bağlantı kur ---
  const connect = useCallback(
    (url) => {
      // Zaten bağlanıyorsak tekrar deneme
      if (connectingRef.current) return;

      // ROSLIB npm'den import edildi, her zaman mevcut

      // Eski bağlantıyı temiz kapat
      if (rosRef.current) {
        try {
          rosRef.current.removeAllListeners();
          rosRef.current.close();
        } catch {}
        rosRef.current = null;
        // State sadece gerekliyse güncelle (gereksiz re-render önle)
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

        // Reconnect timer varsa iptal et
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      });

      ros.on("close", () => {
        if (!mountedRef.current) return;
        connectingRef.current = false;
        rosRef.current = null;
        setRosInstance((prev) => prev ? null : prev);
        setIsConnected((prev) => {
          if (prev) {
            console.log("[ROSContext] 🔌 Bağlantı koptu");
            setStatus("Bağlantı koptu");
          }
          return false;
        });

        // Otomatik reconnect (5 saniye sonra)
        if (!reconnectTimer.current) {
          reconnectTimer.current = setTimeout(() => {
            reconnectTimer.current = null;
            if (mountedRef.current) {
              connect(url);
            }
          }, 5000);
        }
      });

      ros.on("error", (e) => {
        if (!mountedRef.current) return;
        // error event'i close'dan ÖNCE gelir — connectingRef'i burada sıfırlama
        // close handler zaten sıfırlayacak ve reconnect planlayacak
        const msg = e?.message || (e?.type === "error" ? "ROSBridge bağlantısı kurulamadı" : String(e));
        setStatus((prev) => prev === "Bağlantı hatası" ? prev : "Bağlantı hatası");
        setErrorText((prev) => prev === msg ? prev : msg);
      });

      // ❗ rosRef'i tut ama state'i GÜNCELLEME — sadece "connection" event'inde güncelle
      rosRef.current = ros;
    },
    [] // connect fonksiyonu sabit, url parametre olarak alıyor
  );

  // --- URL değişince bağlan ---
  useEffect(() => {
    mountedRef.current = true;

    connect(rosbridgeUrl);

    return () => {
      // StrictMode cleanup: sadece timer'ı temizle, bağlantıyı KAPATMA
      // Gerçek unmount'ta (provider kaldırılınca) bağlantı kapanır
      mountedRef.current = false;
      connectingRef.current = false;

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };
  }, [rosbridgeUrl, connect]);

  // --- Tam unmount'ta bağlantıyı kapat ---
  useEffect(() => {
    return () => {
      console.log("[ROSContext] Provider unmount — bağlantı kapatılıyor");
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (rosRef.current) {
        try {
          rosRef.current.removeAllListeners();
          rosRef.current.close();
        } catch {}
      }
    };
  }, []);

  // --- Manuel yeniden bağlan butonu için ---
  const reconnect = useCallback(() => {
    console.log("[ROSContext] Manuel reconnect tetiklendi");
    // Her şeyi sıfırla
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    // Eski bağlantıyı zorla kapat
    if (rosRef.current) {
      try {
        rosRef.current.removeAllListeners();
        rosRef.current.close();
      } catch {}
      rosRef.current = null;
      setRosInstance(null);
      setIsConnected(false);
    }
    connectingRef.current = false;
    // Kısa gecikmeyle yeniden bağlan
    setTimeout(() => connect(rosbridgeUrl), 300);
  }, [rosbridgeUrl, connect]);

  const value = {
    ros: rosInstance,      // state tabanlı → değişince re-render olur
    isConnected,
    status,
    errorText,
    rosbridgeUrl,
    setRosbridgeUrl,       // IP değiştirmek için
    reconnect,             // manuel yeniden bağlan
  };

  return <ROSContext.Provider value={value}>{children}</ROSContext.Provider>;
}

export function useROS() {
  const ctx = useContext(ROSContext);
  if (!ctx) throw new Error("useROS must be used within ROSProvider");
  return ctx;
}
