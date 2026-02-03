import React, { createContext, useContext, useEffect, useRef, useState } from "react";

// ? ROSLIB do?ru ?ekilde import
const ROSLIB = window.ROSLIB;

const ROSContext = createContext(null);

export function ROSProvider({ children }) {
  const [status, setStatus] = useState("Ba?lanmad?");
  const [errorText, setErrorText] = useState("");
  const [rosbridgeUrl, setRosbridgeUrl] = useState("ws://192.168.1.117:9090");
  
  const rosRef = useRef(null);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    // ROSLIB yüklü mü kontrol et
    if (!window.ROSLIB) {
      console.error("[ROSContext] ? ROSLIB yüklenmedi! index.html'de <script> tag'?n? kontrol et");
      setStatus("ROSLIB yüklemesi hatas?");
      setErrorText("ROSLIB kütüphanesi bulunamad?");
      return;
    }

    console.log("[ROSContext] ROSLIB yüklü:", window.ROSLIB);

    if (rosRef.current?.isConnected && !isConnectingRef.current) {
      return;
    }

    if (isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;
    setStatus("Ba?lan?yor...");
    setErrorText("");

    console.log("[ROSContext] Ba?lan?yor:", rosbridgeUrl);

    try {
      const ros = new ROSLIB.Ros({ url: rosbridgeUrl });
      rosRef.current = ros;

      ros.on("connection", () => {
        console.log("[ROSContext] ? Ba?land?!");
        setStatus("Ba?land?");
        setErrorText("");
        isConnectingRef.current = false;
      });

      ros.on("close", () => {
        console.log("[ROSContext] ?? Ba?lant? koptu");
        setStatus("Ba?lant? koptu");
        isConnectingRef.current = false;
        setTimeout(() => {
          if (!rosRef.current?.isConnected) {
            isConnectingRef.current = false;
          }
        }, 3000);
      });

      ros.on("error", (e) => {
        console.error("[ROSContext] ? Hata:", e);
        setStatus("Ba?lant? hatas?");
        setErrorText(e?.message || String(e));
        isConnectingRef.current = false;
      });

    } catch (err) {
      console.error("[ROSContext] Catch hatas?:", err);
      setStatus("Ba?lant? hatas?");
      setErrorText(err.message);
      isConnectingRef.current = false;
    }

    return () => {
      console.log("[ROSContext] Cleanup - ba?lant? aç?k kalacak");
    };
  }, [rosbridgeUrl]);

  const value = {
    ros: rosRef.current,
    isConnected: rosRef.current?.isConnected ?? false,
    status,
    errorText,
    setRosbridgeUrl,
    rosbridgeUrl,
  };

  return (
    <ROSContext.Provider value={value}>
      {children}
    </ROSContext.Provider>
  );
}

export function useROS() {
  const context = useContext(ROSContext);
  if (!context) {
    throw new Error("useROS must be used within ROSProvider");
  }
  return context;
}
