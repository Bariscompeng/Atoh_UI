import React, { useEffect, useRef, useState, useCallback } from "react";
import * as ROSLIB from "roslib";

function guessWsUrl() {
  const host = window.location.hostname || "localhost";
  return `ws://${host}:9090`;
}

// Terminal satır tipleri
const LINE_TYPE = {
  CMD: "cmd",
  OUTPUT: "output",
  ERROR: "error",
  INFO: "info",
  SEPARATOR: "separator",
};

const LINE_COLORS = {
  [LINE_TYPE.CMD]: "#22d3ee",
  [LINE_TYPE.OUTPUT]: "#e2e8f0",
  [LINE_TYPE.ERROR]: "#f87171",
  [LINE_TYPE.INFO]: "#fbbf24",
  [LINE_TYPE.SEPARATOR]: "#475569",
};

// Kısayol komut grupları
const SHORTCUT_GROUPS = [
  {
    label: "📋 Topic",
    color: "#3b82f6",
    commands: [
      { label: "topic list", cmd: "ros2 topic list", icon: "📋" },
      { label: "topic echo", cmd: "ros2 topic echo ", icon: "👂", needsArg: true, argHint: "/topic_name" },
      { label: "topic hz", cmd: "ros2 topic hz ", icon: "⏱️", needsArg: true, argHint: "/topic_name" },
      { label: "topic info", cmd: "ros2 topic info ", icon: "ℹ️", needsArg: true, argHint: "/topic_name" },
      { label: "topic type", cmd: "ros2 topic type ", icon: "🏷️", needsArg: true, argHint: "/topic_name" },
      { label: "topic bw", cmd: "ros2 topic bw ", icon: "📊", needsArg: true, argHint: "/topic_name" },
    ],
  },
  {
    label: "🖥️ Node",
    color: "#10b981",
    commands: [
      { label: "node list", cmd: "ros2 node list", icon: "🖥️" },
      { label: "node info", cmd: "ros2 node info ", icon: "ℹ️", needsArg: true, argHint: "/node_name" },
    ],
  },
  {
    label: "🔧 Service",
    color: "#f59e0b",
    commands: [
      { label: "service list", cmd: "ros2 service list", icon: "🔧" },
      { label: "service type", cmd: "ros2 service type ", icon: "🏷️", needsArg: true, argHint: "/service_name" },
    ],
  },
  {
    label: "⚙️ Param",
    color: "#8b5cf6",
    commands: [
      { label: "param list", cmd: "ros2 param list", icon: "⚙️" },
      { label: "param get", cmd: "ros2 param get ", icon: "📥", needsArg: true, argHint: "/node param_name" },
    ],
  },
{
    label: "🗺️ Sık Kullanılanlar",
    color: "#ec4899",
    commands: [
      { label: "echo /scan", cmd: "ros2 topic echo /scan", icon: "📡" },
      { label: "echo /odom", cmd: "ros2 topic echo /odom", icon: "📍" },
      { label: "echo /imu", cmd: "ros2 topic echo /imu", icon: "🧭" },
      { label: "hz /scan", cmd: "ros2 topic hz /scan", icon: "⏱️" },
      { label: "hz /odom", cmd: "ros2 topic hz /odom", icon: "⏱️" },
      { label: "hz /imu", cmd: "ros2 topic hz /imu", icon: "⏱️" },
      { label: "tf tree", cmd: "ros2 run tf2_tools view_frames", icon: "🌳" },
    ],
  },
];

export default function TerminalPage() {
  const [wsUrl] = useState(guessWsUrl);
  const [ros, setRos] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState("Bağlı değil");

  // Terminal state
  const [lines, setLines] = useState([
    { type: LINE_TYPE.INFO, text: "🤖 ROS 2 Web Terminal v1.0" },
    { type: LINE_TYPE.INFO, text: "ROSBridge üzerinden komut çalıştırma arayüzü" },
    { type: LINE_TYPE.INFO, text: 'Kısayol butonlarını kullanın veya komut yazın. "help" yazarak komut listesini görün.' },
    { type: LINE_TYPE.SEPARATOR, text: "" },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [activeEcho, setActiveEcho] = useState(null); // Aktif echo subscription
  const [activeHz, setActiveHz] = useState(null); // Aktif hz ölçümü
  const [topicList, setTopicList] = useState([]); // Otomatik tamamlama için
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [echoCount, setEchoCount] = useState(0);
  const [maxEchoMessages, setMaxEchoMessages] = useState(10);

  const terminalRef = useRef(null);
  const inputRef = useRef(null);
  const activeSubRef = useRef(null);
  const hzTimerRef = useRef(null);
  const hzCountRef = useRef({ count: 0, startTime: 0 });

  // Otomatik scroll
  const scrollToBottom = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  // Satır ekleme
  const addLine = useCallback((type, text) => {
    setLines((prev) => [...prev, { type, text, ts: Date.now() }]);
  }, []);

  const addLines = useCallback((type, texts) => {
    setLines((prev) => [
      ...prev,
      ...texts.map((t) => ({ type, text: t, ts: Date.now() })),
    ]);
  }, []);

  // ROS bağlantısı
  useEffect(() => {
    const r = new ROSLIB.Ros({ url: wsUrl });

    r.on("connection", () => {
      setRos(r);
      setIsConnected(true);
      setStatusText("ROSBridge bağlı");
      addLine(LINE_TYPE.INFO, "✅ ROSBridge bağlantısı kuruldu: " + wsUrl);
    });

    r.on("error", () => {
      setIsConnected(false);
      setStatusText("Bağlantı hatası");
    });

    r.on("close", () => {
      setIsConnected(false);
      setStatusText("Bağlı değil");
      addLine(LINE_TYPE.ERROR, "❌ ROSBridge bağlantısı koptu");
    });

    return () => {
      try { r.close(); } catch {}
    };
  }, [wsUrl, addLine]);

  // Aktif subscription'ı durdur
  const stopActiveSubscription = useCallback(() => {
    if (activeSubRef.current) {
      try { activeSubRef.current.unsubscribe(); } catch {}
      activeSubRef.current = null;
    }
    if (hzTimerRef.current) {
      clearInterval(hzTimerRef.current);
      hzTimerRef.current = null;
    }
    setActiveEcho(null);
    setActiveHz(null);
    setEchoCount(0);
  }, []);

  // Topic listesi al
  const fetchTopicList = useCallback(() => {
    if (!ros || !isConnected) return;

    ros.getTopics(
      (result) => {
        const topics = result.topics || [];
        setTopicList(topics);
      },
      (err) => {
        console.error("Topic list error:", err);
      }
    );
  }, [ros, isConnected]);

  useEffect(() => {
    if (isConnected) {
      fetchTopicList();
      const interval = setInterval(fetchTopicList, 10000);
      return () => clearInterval(interval);
    }
  }, [isConnected, fetchTopicList]);

  // ========== KOMUT ÇALIŞTIRMA ==========

  const executeCommand = useCallback(
    (cmdStr) => {
      if (!cmdStr.trim()) return;

      const cmd = cmdStr.trim();
      addLine(LINE_TYPE.CMD, `$ ${cmd}`);
      setCommandHistory((prev) => [...prev.filter((c) => c !== cmd), cmd]);
      setHistoryIndex(-1);

      // Önce aktif subscription'ı durdur
      stopActiveSubscription();

      if (!ros || !isConnected) {
        addLine(LINE_TYPE.ERROR, "❌ ROSBridge bağlı değil. Önce bağlantı kurun.");
        return;
      }

      // ---- HELP ----
      if (cmd === "help") {
        addLines(LINE_TYPE.INFO, [
          "━━━━ Kullanılabilir Komutlar ━━━━",
          "ros2 topic list          → Aktif topic listesi",
          "ros2 topic echo <topic>  → Topic mesajlarını dinle",
          "ros2 topic hz <topic>    → Topic frekansını ölç",
          "ros2 topic info <topic>  → Topic bilgisi",
          "ros2 topic type <topic>  → Topic mesaj tipi",
          "ros2 node list           → Aktif node listesi",
          "ros2 node info <node>    → Node bilgisi",
          "ros2 service list        → Servis listesi",
          "ros2 service type <srv>  → Servis tipi",
          "ros2 param list          → Parametre listesi",
          "clear                    → Terminali temizle",
          "stop                     → Aktif echo/hz durdur",
          "help                     → Bu yardım mesajı",
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ]);
        return;
      }

      // ---- CLEAR ----
      if (cmd === "clear") {
        setLines([]);
        return;
      }

      // ---- STOP ----
      if (cmd === "stop") {
        stopActiveSubscription();
        addLine(LINE_TYPE.INFO, "⏹️ Aktif dinleme durduruldu.");
        return;
      }

      // ---- TOPIC LIST ----
      if (cmd === "ros2 topic list") {
        setIsRunning(true);
        ros.getTopics(
          (result) => {
            const topics = result.topics || [];
            const types = result.types || [];
            if (topics.length === 0) {
              addLine(LINE_TYPE.OUTPUT, "(hiç topic bulunamadı)");
            } else {
              addLine(LINE_TYPE.INFO, `📋 ${topics.length} topic bulundu:`);
              topics.forEach((t, i) => {
                const type = types[i] || "?";
                addLine(LINE_TYPE.OUTPUT, `  ${t}  [${type}]`);
              });
            }
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- TOPIC ECHO ----
      const echoMatch = cmd.match(/^ros2 topic echo\s+(\S+)(?:\s+--once)?$/);
      if (echoMatch) {
        const topicName = echoMatch[0].includes("--once") ? echoMatch[1] : echoMatch[1];
        const once = cmd.includes("--once");

        setIsRunning(true);
        setActiveEcho(topicName);
        setEchoCount(0);

        addLine(LINE_TYPE.INFO, `👂 ${topicName} dinleniyor${once ? " (tek mesaj)" : ` (max ${maxEchoMessages} mesaj)`}...`);
        addLine(LINE_TYPE.INFO, '   "stop" yazarak veya 🛑 butonuyla durdurun.');

        // Önce topic tipini al
        ros.getTopicType(
          topicName,
          (type) => {
            if (!type) {
              addLine(LINE_TYPE.ERROR, `Topic tipi bulunamadı: ${topicName}`);
              setIsRunning(false);
              setActiveEcho(null);
              return;
            }

            const sub = new ROSLIB.Topic({
              ros,
              name: topicName,
              messageType: type,
              queue_length: 1,
              throttle_rate: 200,
            });

            let count = 0;
            sub.subscribe((msg) => {
              count++;
              const json = JSON.stringify(msg, null, 2);
              const truncated = json.length > 2000 ? json.substring(0, 2000) + "\n... (kırpıldı)" : json;
              addLine(LINE_TYPE.OUTPUT, `--- #${count} ---`);
              truncated.split("\n").forEach((line) => {
                addLine(LINE_TYPE.OUTPUT, line);
              });
              setEchoCount(count);

              if (once || count >= maxEchoMessages) {
                try { sub.unsubscribe(); } catch {}
                activeSubRef.current = null;
                setActiveEcho(null);
                setIsRunning(false);
                addLine(LINE_TYPE.INFO, `⏹️ Echo durduruldu (${count} mesaj alındı).`);
              }
            });

            activeSubRef.current = sub;
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Topic tipi alınamadı: ${err}`);
            setIsRunning(false);
            setActiveEcho(null);
          }
        );
        return;
      }

      // ---- TOPIC HZ ----
      const hzMatch = cmd.match(/^ros2 topic (?:hz|bw)\s+(\S+)$/);
      if (hzMatch) {
        const topicName = hzMatch[1];
        const isBw = cmd.includes(" bw ");

        setIsRunning(true);
        setActiveHz(topicName);
        addLine(LINE_TYPE.INFO, `⏱️ ${topicName} ${isBw ? "bandwidth" : "frekans"} ölçülüyor...`);
        addLine(LINE_TYPE.INFO, '   "stop" yazarak durdurun.');

        ros.getTopicType(
          topicName,
          (type) => {
            if (!type) {
              addLine(LINE_TYPE.ERROR, `Topic tipi bulunamadı: ${topicName}`);
              setIsRunning(false);
              setActiveHz(null);
              return;
            }

            hzCountRef.current = { count: 0, startTime: Date.now(), sizes: [] };

            const sub = new ROSLIB.Topic({
              ros,
              name: topicName,
              messageType: type,
              queue_length: 1,
            });

            sub.subscribe((msg) => {
              hzCountRef.current.count++;
              if (isBw) {
                const size = JSON.stringify(msg).length;
                hzCountRef.current.sizes.push(size);
              }
            });

            activeSubRef.current = sub;

            // Her 2 saniyede bir Hz raporla
            hzTimerRef.current = setInterval(() => {
              const elapsed = (Date.now() - hzCountRef.current.startTime) / 1000;
              const count = hzCountRef.current.count;
              const hz = elapsed > 0 ? (count / elapsed).toFixed(2) : "0.00";

              if (isBw) {
                const totalBytes = hzCountRef.current.sizes.reduce((a, b) => a + b, 0);
                const avgSize = count > 0 ? (totalBytes / count).toFixed(0) : "0";
                addLine(LINE_TYPE.OUTPUT, `  avg bw: ${(totalBytes / elapsed / 1024).toFixed(2)} KB/s | avg msg: ${avgSize} bytes | ${hz} Hz (${count} msgs / ${elapsed.toFixed(1)}s)`);
              } else {
                addLine(LINE_TYPE.OUTPUT, `  average rate: ${hz} Hz | ${count} messages in ${elapsed.toFixed(1)}s`);
              }
            }, 2000);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Topic tipi alınamadı: ${err}`);
            setIsRunning(false);
            setActiveHz(null);
          }
        );
        return;
      }

      // ---- TOPIC INFO ----

      const infoMatch = cmd.match(/^ros2 topic info\s+(\S+)$/);
      if (infoMatch) {
        const topicName = infoMatch[1];
        setIsRunning(true);

        ros.getTopicType(
          topicName,
          (type) => {
            if (type) {
              addLine(LINE_TYPE.INFO, `📊 Topic Bilgisi: ${topicName}`);
              addLine(LINE_TYPE.OUTPUT, `• Type: ${type}`);
              
              // Mesaj detaylarını (field isimlerini) almak için
              ros.getMessageDetails(type, (details) => {
                addLine(LINE_TYPE.OUTPUT, `• Mesaj Yapısı:`);
                // İlk seviye fieldları göster
                const fields = details[0]?.fieldnames || [];
                const fieldTypes = details[0]?.fieldtypes || [];
                fields.forEach((f, i) => {
                  addLine(LINE_TYPE.OUTPUT, `  - ${f} [${fieldTypes[i]}]`);
                });
                setIsRunning(false);
              }, (err) => {
                addLine(LINE_TYPE.OUTPUT, `• (Mesaj detayları alınamadı)`);
                setIsRunning(false);
              });
            } else {
              addLine(LINE_TYPE.ERROR, `❌ Topic bulunamadı veya tipi alınamadı.`);
              setIsRunning(false);
            }
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- TOPIC TYPE ----
      const typeMatch = cmd.match(/^ros2 topic type\s+(\S+)$/);
      if (typeMatch) {
        const topicName = typeMatch[1];
        setIsRunning(true);

        ros.getTopicType(
          topicName,
          (type) => {
            addLine(LINE_TYPE.OUTPUT, type || "(bilinmiyor)");
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- NODE LIST ----
      if (cmd === "ros2 node list") {
        setIsRunning(true);
        ros.getNodes(
          (nodes) => {
            if (!nodes || nodes.length === 0) {
              addLine(LINE_TYPE.OUTPUT, "(hiç node bulunamadı)");
            } else {
              addLine(LINE_TYPE.INFO, `🖥️ ${nodes.length} node bulundu:`);
              nodes.forEach((n) => addLine(LINE_TYPE.OUTPUT, `  ${n}`));
            }
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- NODE INFO ----
      const nodeInfoMatch = cmd.match(/^ros2 node info\s+(\S+)$/);
      if (nodeInfoMatch) {
        const nodeName = nodeInfoMatch[1];
        setIsRunning(true);

        ros.getNodeDetails(
          nodeName,
          (details) => {
            addLine(LINE_TYPE.INFO, `🖥️ Node: ${nodeName}`);
            if (details.subscribing) {
              addLine(LINE_TYPE.OUTPUT, "  Subscribers:");
              details.subscribing.forEach((t) => addLine(LINE_TYPE.OUTPUT, `    ${t}`));
            }
            if (details.publishing) {
              addLine(LINE_TYPE.OUTPUT, "  Publishers:");
              details.publishing.forEach((t) => addLine(LINE_TYPE.OUTPUT, `    ${t}`));
            }
            if (details.services) {
              addLine(LINE_TYPE.OUTPUT, "  Services:");
              details.services.forEach((s) => addLine(LINE_TYPE.OUTPUT, `    ${s}`));
            }
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- SERVICE LIST ----
      if (cmd === "ros2 service list") {
        setIsRunning(true);
        ros.getServices(
          (services) => {
            if (!services || services.length === 0) {
              addLine(LINE_TYPE.OUTPUT, "(hiç servis bulunamadı)");
            } else {
              addLine(LINE_TYPE.INFO, `🔧 ${services.length} servis bulundu:`);
              services.forEach((s) => addLine(LINE_TYPE.OUTPUT, `  ${s}`));
            }
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- SERVICE TYPE ----
      const srvTypeMatch = cmd.match(/^ros2 service type\s+(\S+)$/);
      if (srvTypeMatch) {
        const srvName = srvTypeMatch[1];
        setIsRunning(true);

        ros.getServiceType(
          srvName,
          (type) => {
            addLine(LINE_TYPE.OUTPUT, type || "(bilinmiyor)");
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- PARAM LIST ----
      if (cmd === "ros2 param list" || cmd.match(/^ros2 param list\s*$/)) {
        setIsRunning(true);
        ros.getParams(
          (params) => {
            if (!params || params.length === 0) {
              addLine(LINE_TYPE.OUTPUT, "(hiç parametre bulunamadı)");
            } else {
              addLine(LINE_TYPE.INFO, `⚙️ ${params.length} parametre bulundu:`);
              params.forEach((p) => addLine(LINE_TYPE.OUTPUT, `  ${p}`));
            }
            setIsRunning(false);
          },
          (err) => {
            addLine(LINE_TYPE.ERROR, `Hata: ${err}`);
            setIsRunning(false);
          }
        );
        return;
      }

      // ---- PARAM GET ----
      const paramGetMatch = cmd.match(/^ros2 param get\s+(\S+)\s+(\S+)$/);
      if (paramGetMatch) {
        const nodeName = paramGetMatch[1];
        const paramName = paramGetMatch[2];
        setIsRunning(true);

        const param = new ROSLIB.Param({
          ros,
          name: `${nodeName}/${paramName}`,
        });

        param.get((value) => {
          addLine(LINE_TYPE.OUTPUT, `${paramName}: ${JSON.stringify(value)}`);
          setIsRunning(false);
        });
        return;
      }

      // ---- Bilinmeyen komut ----
      addLine(LINE_TYPE.ERROR, `❌ Bilinmeyen komut: ${cmd}`);
      addLine(LINE_TYPE.INFO, '   "help" yazarak kullanılabilir komutları görün.');
    },
    [ros, isConnected, addLine, addLines, stopActiveSubscription, maxEchoMessages]
  );

  // Kısayol tıklama
  const onShortcutClick = (shortcut) => {
    if (shortcut.needsArg) {
      // Argüman gerektiriyorsa topic picker aç veya input'a yaz
      setInputValue(shortcut.cmd);
      setPendingCommand(shortcut);
      setShowTopicPicker(true);
      fetchTopicList();
      inputRef.current?.focus();
    } else {
      executeCommand(shortcut.cmd);
    }
  };

  // Topic seçildiğinde
  const onTopicSelect = (topic) => {
    const cmd = (pendingCommand?.cmd || inputValue) + topic;
    setInputValue("");
    setShowTopicPicker(false);
    setPendingCommand(null);
    executeCommand(cmd);
  };

  // Input submit
  const onSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setShowTopicPicker(false);
    setPendingCommand(null);
    executeCommand(inputValue);
    setInputValue("");
  };

  // Klavye navigasyonu
  const onKeyDown = (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const newIdx = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(newIdx);
      setInputValue(commandHistory[commandHistory.length - 1 - newIdx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setInputValue("");
      } else {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setInputValue(commandHistory[commandHistory.length - 1 - newIdx] || "");
      }
    } else if (e.key === "Escape") {
      setShowTopicPicker(false);
      setPendingCommand(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Basit otomatik tamamlama
      const val = inputValue.trim();
      const parts = val.split(/\s+/);
      const lastPart = parts[parts.length - 1];
      if (lastPart.startsWith("/")) {
        const matches = topicList.filter((t) => t.startsWith(lastPart));
        if (matches.length === 1) {
          parts[parts.length - 1] = matches[0];
          setInputValue(parts.join(" "));
        } else if (matches.length > 1) {
          addLine(LINE_TYPE.INFO, matches.join("  "));
        }
      }
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      stopActiveSubscription();
    };
  }, [stopActiveSubscription]);

  return (
    <div
      style={{
        minHeight: "calc(100vh - 56px)",
        width: "100vw",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        color: "white",
        padding: "0.5rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          maxWidth: "1600px",
          margin: "0 auto",
          width: "100%",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          minHeight: 0,
        }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>💻</span>
              <h1 style={{ fontSize: "1.125rem", fontWeight: "bold", margin: 0 }}>ROS 2 TERMİNAL</h1>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: isConnected ? "#22c55e" : "#f87171" }}>
                {isConnected ? "🟢" : "🔴"} {statusText}
              </span>
              {(activeEcho || activeHz) && (
                <button
                  onClick={() => {
                    stopActiveSubscription();
                    addLine(LINE_TYPE.INFO, "⏹️ Dinleme durduruldu.");
                    setIsRunning(false);
                  }}
                  style={{
                    padding: "0.375rem 0.75rem",
                    background: "#dc2626",
                    border: "none",
                    borderRadius: "0.375rem",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    fontWeight: "700",
                    animation: "pulse 1.5s infinite",
                  }}
                >
                  🛑 DURDUR {activeEcho ? `(echo ${echoCount})` : "(hz)"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: window.innerWidth < 900 ? "1fr" : "280px 1fr",
            gap: "0.5rem",
            minHeight: 0,
          }}
        >
          {/* ====== SOL PANEL: KISAYOLLAR ====== */}
          <div
            style={{
              background: "#1e293b",
              borderRadius: "0.5rem",
              border: "1px solid #334155",
              overflow: "auto",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: "700", color: "#cbd5e1" }}>
              ⚡ Kısayollar
            </div>

            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.label}>
                <div
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: "700",
                    color: group.color,
                    marginBottom: "0.375rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {group.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {group.commands.map((sc) => (
                    <button
                      key={sc.cmd}
                      onClick={() => onShortcutClick(sc)}
                      disabled={!isConnected}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.5rem 0.625rem",
                        background: "#0f172a",
                        border: `1px solid ${isConnected ? "#334155" : "#1e293b"}`,
                        borderRadius: "0.375rem",
                        color: isConnected ? "#e2e8f0" : "#475569",
                        cursor: isConnected ? "pointer" : "not-allowed",
                        fontSize: "0.75rem",
                        fontWeight: "500",
                        textAlign: "left",
                        transition: "all 0.15s",
                        opacity: isConnected ? 1 : 0.4,
                      }}
                      onMouseEnter={(e) => {
                        if (isConnected) {
                          e.target.style.background = "#334155";
                          e.target.style.borderColor = group.color;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = "#0f172a";
                        e.target.style.borderColor = "#334155";
                      }}
                    >
                      <span style={{ fontSize: "0.85rem", flexShrink: 0 }}>{sc.icon}</span>
                      <span style={{ flex: 1 }}>{sc.label}</span>
                      {sc.needsArg && (
                        <span style={{ fontSize: "0.6rem", color: "#64748b" }}>▸</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Echo ayarları */}
            <div style={{ borderTop: "1px solid #334155", paddingTop: "0.5rem" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginBottom: "0.375rem" }}>
                Echo max mesaj:
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {[5, 10, 25, 50].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMaxEchoMessages(n)}
                    style={{
                      flex: 1,
                      padding: "0.375rem",
                      background: maxEchoMessages === n ? "#2563eb" : "#0f172a",
                      border: maxEchoMessages === n ? "1px solid #60a5fa" : "1px solid #334155",
                      borderRadius: "0.25rem",
                      color: "white",
                      fontSize: "0.65rem",
                      cursor: "pointer",
                      fontWeight: maxEchoMessages === n ? "700" : "400",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Temizle butonu */}
            <button
              onClick={() => setLines([])}
              style={{
                padding: "0.5rem",
                background: "#334155",
                border: "none",
                borderRadius: "0.375rem",
                color: "#cbd5e1",
                fontSize: "0.75rem",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              🗑️ Terminali Temizle
            </button>
          </div>

          {/* ====== SAĞ PANEL: TERMİNAL ====== */}
          <div
            style={{
              background: "#0a0f1a",
              borderRadius: "0.5rem",
              border: "1px solid #334155",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Terminal Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                background: "#1e293b",
                borderBottom: "1px solid #334155",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
              </div>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "monospace" }}>
                ros2-terminal@{wsUrl.replace("ws://", "").replace(":9090", "")}
              </span>
              <span style={{ flex: 1 }} />
              {isRunning && (
                <span style={{ fontSize: "0.7rem", color: "#fbbf24" }}>
                  ⏳ çalışıyor...
                </span>
              )}
              <span style={{ fontSize: "0.65rem", color: "#64748b" }}>
                {lines.length} satır
              </span>
            </div>

            {/* Terminal Output */}
            <div
              ref={terminalRef}
              onClick={() => inputRef.current?.focus()}
              style={{
                flex: 1,
                overflow: "auto",
                padding: "0.75rem",
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: "0.8rem",
                lineHeight: "1.5",
                cursor: "text",
                minHeight: 0,
              }}
            >
              {lines.map((line, i) => {
                if (line.type === LINE_TYPE.SEPARATOR) {
                  return (
                    <div
                      key={i}
                      style={{
                        borderBottom: "1px solid #334155",
                        margin: "0.5rem 0",
                      }}
                    />
                  );
                }
                return (
                  <div
                    key={i}
                    style={{
                      color: LINE_COLORS[line.type] || "#e2e8f0",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      padding: "0.05rem 0",
                      fontWeight: line.type === LINE_TYPE.CMD ? "700" : "400",
                    }}
                  >
                    {line.text}
                  </div>
                );
              })}
            </div>

            {/* Topic Picker (eğer açıksa) */}
            {showTopicPicker && topicList.length > 0 && (
              <div
                style={{
                  maxHeight: "200px",
                  overflow: "auto",
                  background: "#1e293b",
                  borderTop: "1px solid #334155",
                  padding: "0.5rem",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginBottom: "0.375rem" }}>
                  📋 Topic seçin veya yazın:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {topicList.map((t) => (
                    <button
                      key={t}
                      onClick={() => onTopicSelect(t)}
                      style={{
                        padding: "0.25rem 0.5rem",
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "0.25rem",
                        color: "#60a5fa",
                        fontSize: "0.7rem",
                        cursor: "pointer",
                        fontFamily: "monospace",
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.background = "#334155";
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = "#0f172a";
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <form
              onSubmit={onSubmit}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                background: "#1e293b",
                borderTop: "1px solid #334155",
                flexShrink: 0,
              }}
            >
              <span style={{ color: "#22d3ee", fontFamily: "monospace", fontWeight: "700", fontSize: "0.85rem" }}>
                $
              </span>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={pendingCommand ? `${pendingCommand.cmd}${pendingCommand.argHint || ""}` : "ros2 topic list ..."}
                autoFocus
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#e2e8f0",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: "0.85rem",
                  caretColor: "#22d3ee",
                }}
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                style={{
                  padding: "0.375rem 0.75rem",
                  background: inputValue.trim() ? "#2563eb" : "#334155",
                  border: "none",
                  borderRadius: "0.25rem",
                  color: "white",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  cursor: inputValue.trim() ? "pointer" : "default",
                }}
              >
                ⏎
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            fontSize: "0.6rem",
            color: "#475569",
            flexShrink: 0,
            padding: "0.25rem 0",
          }}
        >
          Tab: otomatik tamamla | ↑↓: komut geçmişi | Esc: topic picker kapat | ROSBridge WebSocket
        </div>
      </div>

      {/* Pulse animation for stop button */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
