import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as ROSLIB from "roslib";

function guessWsUrl() {
  const host = window.location.hostname || "localhost";
  return `ws://${host}:9090`;
}

const LINE_TYPE = {
  CMD: "cmd",
  OUTPUT: "output",
  ERROR: "error",
  INFO: "info",
  SEPARATOR: "separator",
};

const LINE_COLORS = {
  [LINE_TYPE.CMD]: "#22d3ee",
  [LINE_TYPE.OUTPUT]: "#cbd5e1",
  [LINE_TYPE.ERROR]: "#f87171",
  [LINE_TYPE.INFO]: "#fbbf24",
  [LINE_TYPE.SEPARATOR]: "#1e3a5f",
};

const SHORTCUT_GROUPS = [
  {
    label: "Topic",
    color: "#3b82f6",
    icon: "📡",
    commands: [
      { label: "topic list", cmd: "ros2 topic list", icon: "📋" },
      { label: "topic echo", cmd: "ros2 topic echo ", icon: "📻", needsArg: true, argHint: "/topic_name" },
      { label: "topic hz", cmd: "ros2 topic hz ", icon: "📊", needsArg: true, argHint: "/topic_name" },
      { label: "topic info", cmd: "ros2 topic info ", icon: "ℹ️", needsArg: true, argHint: "/topic_name" },
      { label: "topic type", cmd: "ros2 topic type ", icon: "🏷", needsArg: true, argHint: "/topic_name" },
      { label: "topic bw", cmd: "ros2 topic bw ", icon: "📶", needsArg: true, argHint: "/topic_name" },
    ],
  },
  {
    label: "Node",
    color: "#10b981",
    icon: "🔷",
    commands: [
      { label: "node list", cmd: "ros2 node list", icon: "🔷" },
      { label: "node info", cmd: "ros2 node info ", icon: "🔍", needsArg: true, argHint: "/node_name" },
    ],
  },
  {
    label: "Service",
    color: "#f59e0b",
    icon: "⚡",
    commands: [
      { label: "service list", cmd: "ros2 service list", icon: "⚡" },
      { label: "service type", cmd: "ros2 service type ", icon: "🏷", needsArg: true, argHint: "/service_name" },
    ],
  },
  {
    label: "Param",
    color: "#8b5cf6",
    icon: "🔧",
    commands: [
      { label: "param list", cmd: "ros2 param list", icon: "🔧" },
      { label: "param get", cmd: "ros2 param get ", icon: "📥", needsArg: true, argHint: "/node param_name" },
    ],
  },
  {
    label: "Sık Kullanılanlar",
    color: "#ec4899",
    icon: "⭐",
    commands: [
      { label: "echo /scan", cmd: "ros2 topic echo /scan", icon: "📡" },
      { label: "echo /odom", cmd: "ros2 topic echo /odom", icon: "🧭" },
      { label: "echo /imu", cmd: "ros2 topic echo /imu", icon: "📐" },
      { label: "hz /scan", cmd: "ros2 topic hz /scan", icon: "📊" },
      { label: "hz /odom", cmd: "ros2 topic hz /odom", icon: "📊" },
      { label: "hz /cmd_vel", cmd: "ros2 topic hz /cmd_vel", icon: "📊" },
    ],
  },
];

export default function TerminalPage() {
  const [wsUrl] = useState(guessWsUrl);
  const [ros, setRos] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState("Bağlı değil");

  const [lines, setLines] = useState([
    { type: LINE_TYPE.INFO, text: "╔══════════════════════════════════════╗" },
    { type: LINE_TYPE.INFO, text: "║      ROS 2 Web Terminal  v2.0        ║" },
    { type: LINE_TYPE.INFO, text: "╚══════════════════════════════════════╝" },
    { type: LINE_TYPE.INFO, text: "  Tab: tamamla  •  ↑↓: geçmiş  •  Ctrl+C: durdur" },
    { type: LINE_TYPE.SEPARATOR, text: "" },
  ]);

  const [inputValue, setInputValue] = useState("");
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [activeEcho, setActiveEcho] = useState(null);
  const [activeHz, setActiveHz] = useState(null);
  const [topicList, setTopicList] = useState([]);
  const [nodeList, setNodeList] = useState([]);
  const [serviceList, setServiceList] = useState([]);
  const [echoCount, setEchoCount] = useState(0);
  const [maxEchoMessages, setMaxEchoMessages] = useState(10);

  // Autocomplete state
  const [acSuggestions, setAcSuggestions] = useState([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acVisible, setAcVisible] = useState(false);

  // Shortcut panel collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const terminalRef = useRef(null);
  const inputRef = useRef(null);
  const activeSubRef = useRef(null);
  const hzTimerRef = useRef(null);
  const hzCountRef = useRef({ count: 0, startTime: 0, sizes: [] });
  const echoCountRef = useRef(0);

  // ── Terminal output append ─────────────────────────────────────────────────
  const addLine = useCallback((type, text) => {
    setLines((prev) => {
      const next = [...prev, { type, text, id: Date.now() + Math.random() }];
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
  }, []);

  const addLines = useCallback((type, texts) => {
    setLines((prev) => {
      const entries = texts.map((t) => ({ type, text: t, id: Date.now() + Math.random() }));
      const next = [...prev, ...entries];
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
  }, []);

  // Auto-scroll: sadece terminal içeriği, container değil
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    // Kullanıcı yukarı scroll etmişse otomatik kaydırma
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // ── ROS connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const r = new ROSLIB.Ros({ url: wsUrl });
    r.on("connection", () => {
      setRos(r); setIsConnected(true);
      setStatusText("Bağlı");
      addLine(LINE_TYPE.INFO, `✓ ROSBridge bağlandı → ${wsUrl}`);
    });
    r.on("error", () => { setIsConnected(false); setStatusText("Bağlantı hatası"); });
    r.on("close", () => {
      setIsConnected(false); setStatusText("Bağlı değil");
      addLine(LINE_TYPE.ERROR, "✗ ROSBridge bağlantısı koptu");
    });
    return () => { try { r.close(); } catch {} };
  }, [wsUrl, addLine]);

  // ── Fetch topic/node/service lists ────────────────────────────────────────
  const refreshLists = useCallback(() => {
    if (!ros || !isConnected) return;
    ros.getTopics((r) => setTopicList(r.topics || []), () => {});
    ros.getNodes((n) => setNodeList(n || []), () => {});
    ros.getServices((s) => setServiceList(s || []), () => {});
  }, [ros, isConnected]);

  useEffect(() => {
    if (isConnected) {
      refreshLists();
      const id = setInterval(refreshLists, 15000);
      return () => clearInterval(id);
    }
  }, [isConnected, refreshLists]);

  // ── Stop active subscription ───────────────────────────────────────────────
  const stopActive = useCallback((silent = false) => {
    if (activeSubRef.current) {
      try { activeSubRef.current.unsubscribe(); } catch {}
      activeSubRef.current = null;
    }
    if (hzTimerRef.current) { clearInterval(hzTimerRef.current); hzTimerRef.current = null; }
    if (!silent) {
      if (activeEcho || activeHz) {
        addLine(LINE_TYPE.INFO, `^C  — durduruldu (${echoCountRef.current} mesaj)`);
      }
    }
    setActiveEcho(null); setActiveHz(null);
    setIsRunning(false); setEchoCount(0);
    echoCountRef.current = 0;
  }, [activeEcho, activeHz, addLine]);

  // ── Autocomplete logic ─────────────────────────────────────────────────────
  const computeSuggestions = useCallback((val) => {
    if (!val) return [];
    const parts = val.split(/\s+/);
    const last = parts[parts.length - 1];

    // Complete topic/node/service names
    if (last.startsWith("/")) {
      const pool = [...topicList, ...nodeList, ...serviceList];
      return pool.filter((x) => x.startsWith(last) && x !== last).slice(0, 12);
    }

    // Complete ros2 subcommands
    const ROS2_CMDS = [
      "ros2 topic list", "ros2 topic echo ", "ros2 topic hz ",
      "ros2 topic bw ", "ros2 topic info ", "ros2 topic type ",
      "ros2 node list", "ros2 node info ",
      "ros2 service list", "ros2 service type ",
      "ros2 param list", "ros2 param get ",
    ];
    if (val.startsWith("ros2") || val === "r") {
      return ROS2_CMDS.filter((c) => c.startsWith(val) && c !== val).slice(0, 10);
    }

    // Shell built-ins
    const builtins = ["clear", "help", "stop", "history"];
    return builtins.filter((b) => b.startsWith(val) && b !== val);
  }, [topicList, nodeList, serviceList]);

  // ── Main command executor ──────────────────────────────────────────────────
  const executeCommand = useCallback((cmdStr) => {
    const cmd = cmdStr.trim();
    if (!cmd) return;

    setAcVisible(false);
    addLine(LINE_TYPE.CMD, `$ ${cmd}`);
    setCommandHistory((prev) => { const f = prev.filter((c) => c !== cmd); return [...f, cmd]; });
    setHistoryIndex(-1);
    stopActive(true);

    if (!ros || !isConnected) {
      addLine(LINE_TYPE.ERROR, "✗ ROSBridge bağlı değil.");
      return;
    }

    // ── HELP ──
    if (cmd === "help") {
      addLines(LINE_TYPE.INFO, [
        "┌──────────────────────────────────────────┐",
        "│           Kullanılabilir Komutlar         │",
        "├──────────────────────────────────────────┤",
        "│ ros2 topic list                           │",
        "│ ros2 topic echo <topic> [--once]          │",
        "│ ros2 topic hz   <topic>                   │",
        "│ ros2 topic bw   <topic>                   │",
        "│ ros2 topic info <topic>                   │",
        "│ ros2 topic type <topic>                   │",
        "│ ros2 node list                            │",
        "│ ros2 node info  <node>                    │",
        "│ ros2 service list                         │",
        "│ ros2 service type <service>               │",
        "│ ros2 param list                           │",
        "│ ros2 param get  <node> <param>            │",
        "│ clear  •  stop  •  history  •  help       │",
        "│ Ctrl+C: aktif komutu durdur               │",
        "│ Tab:    otomatik tamamlama                 │",
        "│ ↑↓:     komut geçmişi                     │",
        "└──────────────────────────────────────────┘",
      ]);
      return;
    }

    // ── CLEAR ──
    if (cmd === "clear") { setLines([]); return; }

    // ── STOP ──
    if (cmd === "stop") { stopActive(); return; }

    // ── HISTORY ──
    if (cmd === "history") {
      commandHistory.forEach((c, i) => addLine(LINE_TYPE.OUTPUT, `  ${String(i + 1).padStart(3)}  ${c}`));
      return;
    }

    // ── TOPIC LIST ──
    if (cmd === "ros2 topic list") {
      setIsRunning(true);
      ros.getTopics((result) => {
        const topics = result.topics || [];
        const types = result.types || [];
        addLine(LINE_TYPE.INFO, `${topics.length} topic:`);
        topics.forEach((t, i) => addLine(LINE_TYPE.OUTPUT, `  ${t.padEnd(52)} ${types[i] || ""}`));
        setIsRunning(false);
        setTopicList(topics);
      }, (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── TOPIC ECHO ──
    const echoMatch = cmd.match(/^ros2 topic echo\s+(\S+)(.*)?$/);
    if (echoMatch) {
      const topicName = echoMatch[1];
      const once = cmd.includes("--once");
      setIsRunning(true); setActiveEcho(topicName); setEchoCount(0); echoCountRef.current = 0;
      addLine(LINE_TYPE.INFO, `▶ ${topicName} dinleniyor${once ? " (--once)" : ` (max ${maxEchoMessages})`}…`);

      ros.getTopicType(topicName, (type) => {
        if (!type) { addLine(LINE_TYPE.ERROR, `Topic tipi bulunamadı: ${topicName}`); setIsRunning(false); setActiveEcho(null); return; }
        const sub = new ROSLIB.Topic({ ros, name: topicName, messageType: type, queue_length: 1, throttle_rate: 100 });
        activeSubRef.current = sub;
        sub.subscribe((msg) => {
          echoCountRef.current += 1;
          const n = echoCountRef.current;
          setEchoCount(n);
          const json = JSON.stringify(msg, null, 2);
          const trunc = json.length > 3000 ? json.slice(0, 3000) + "\n…(kırpıldı)" : json;
          addLine(LINE_TYPE.INFO, `─── #${n} ${topicName} ───`);
          trunc.split("\n").forEach((l) => addLine(LINE_TYPE.OUTPUT, l));
          if (once || n >= maxEchoMessages) {
            try { sub.unsubscribe(); } catch {}
            activeSubRef.current = null;
            setActiveEcho(null); setIsRunning(false);
            addLine(LINE_TYPE.INFO, `⏹ Echo tamamlandı (${n} mesaj).`);
          }
        });
      }, (err) => { addLine(LINE_TYPE.ERROR, `Topic tipi alınamadı: ${err}`); setIsRunning(false); setActiveEcho(null); });
      return;
    }

    // ── TOPIC HZ / BW ──
    const hzMatch = cmd.match(/^ros2 topic (hz|bw)\s+(\S+)$/);
    if (hzMatch) {
      const isBw = hzMatch[1] === "bw";
      const topicName = hzMatch[2];
      setIsRunning(true); setActiveHz(topicName);
      addLine(LINE_TYPE.INFO, `▶ ${topicName} ${isBw ? "bandwidth" : "Hz"} ölçülüyor… (Ctrl+C ile durdur)`);

      ros.getTopicType(topicName, (type) => {
        if (!type) { addLine(LINE_TYPE.ERROR, `Topic tipi bulunamadı: ${topicName}`); setIsRunning(false); setActiveHz(null); return; }
        hzCountRef.current = { count: 0, startTime: Date.now(), sizes: [] };
        const sub = new ROSLIB.Topic({ ros, name: topicName, messageType: type, queue_length: 1 });
        activeSubRef.current = sub;
        sub.subscribe((msg) => {
          hzCountRef.current.count++;
          if (isBw) hzCountRef.current.sizes.push(JSON.stringify(msg).length);
        });
        hzTimerRef.current = setInterval(() => {
          const el = (Date.now() - hzCountRef.current.startTime) / 1000;
          const cnt = hzCountRef.current.count;
          const hz = el > 0 ? (cnt / el).toFixed(3) : "0.000";
          if (isBw) {
            const total = hzCountRef.current.sizes.reduce((a, b) => a + b, 0);
            const avg = cnt > 0 ? (total / cnt).toFixed(0) : "0";
            addLine(LINE_TYPE.OUTPUT, `  bw: ${(total / el / 1024).toFixed(3)} KB/s  avg: ${avg}B  rate: ${hz} Hz  (${cnt}/${el.toFixed(1)}s)`);
          } else {
            addLine(LINE_TYPE.OUTPUT, `  avg rate: ${hz} Hz   ${cnt} msgs / ${el.toFixed(1)}s`);
          }
        }, 2000);
      }, (err) => { addLine(LINE_TYPE.ERROR, `Topic tipi alınamadı: ${err}`); setIsRunning(false); setActiveHz(null); });
      return;
    }

    // ── TOPIC INFO ──
    const infoMatch = cmd.match(/^ros2 topic info\s+(\S+)$/);
    if (infoMatch) {
      const topicName = infoMatch[1];
      setIsRunning(true);
      ros.getTopicType(topicName, (type) => {
        if (!type) { addLine(LINE_TYPE.ERROR, `Topic bulunamadı: ${topicName}`); setIsRunning(false); return; }
        addLine(LINE_TYPE.INFO, `ℹ Topic: ${topicName}`);
        addLine(LINE_TYPE.OUTPUT, `  Type: ${type}`);
        ros.getMessageDetails(type, (details) => {
          const fields = details[0]?.fieldnames || [];
          const fieldTypes = details[0]?.fieldtypes || [];
          addLine(LINE_TYPE.OUTPUT, `  Fields:`);
          fields.forEach((f, i) => addLine(LINE_TYPE.OUTPUT, `    ${f}  [${fieldTypes[i]}]`));
          setIsRunning(false);
        }, () => { setIsRunning(false); });
      }, (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── TOPIC TYPE ──
    const typeMatch = cmd.match(/^ros2 topic type\s+(\S+)$/);
    if (typeMatch) {
      setIsRunning(true);
      ros.getTopicType(typeMatch[1], (t) => { addLine(LINE_TYPE.OUTPUT, t || "(bilinmiyor)"); setIsRunning(false); },
        (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── NODE LIST ──
    if (cmd === "ros2 node list") {
      setIsRunning(true);
      ros.getNodes((nodes) => {
        addLine(LINE_TYPE.INFO, `${(nodes || []).length} node:`);
        (nodes || []).forEach((n) => addLine(LINE_TYPE.OUTPUT, `  ${n}`));
        setIsRunning(false); setNodeList(nodes || []);
      }, (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── NODE INFO ──
    const nodeInfoMatch = cmd.match(/^ros2 node info\s+(\S+)$/);
    if (nodeInfoMatch) {
      setIsRunning(true);
      ros.getNodeDetails(nodeInfoMatch[1], (d) => {
        addLine(LINE_TYPE.INFO, `Node: ${nodeInfoMatch[1]}`);
        if (d.subscribing?.length) { addLine(LINE_TYPE.OUTPUT, "  Subscribes:"); d.subscribing.forEach((t) => addLine(LINE_TYPE.OUTPUT, `    ${t}`)); }
        if (d.publishing?.length) { addLine(LINE_TYPE.OUTPUT, "  Publishes:"); d.publishing.forEach((t) => addLine(LINE_TYPE.OUTPUT, `    ${t}`)); }
        if (d.services?.length) { addLine(LINE_TYPE.OUTPUT, "  Services:"); d.services.forEach((s) => addLine(LINE_TYPE.OUTPUT, `    ${s}`)); }
        setIsRunning(false);
      }, (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── SERVICE LIST ──
    if (cmd === "ros2 service list") {
      setIsRunning(true);
      ros.getServices((svcs) => {
        addLine(LINE_TYPE.INFO, `${(svcs || []).length} service:`);
        (svcs || []).forEach((s) => addLine(LINE_TYPE.OUTPUT, `  ${s}`));
        setIsRunning(false); setServiceList(svcs || []);
      }, (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── SERVICE TYPE ──
    const srvTypeMatch = cmd.match(/^ros2 service type\s+(\S+)$/);
    if (srvTypeMatch) {
      setIsRunning(true);
      ros.getServiceType(srvTypeMatch[1], (t) => { addLine(LINE_TYPE.OUTPUT, t || "(bilinmiyor)"); setIsRunning(false); },
        (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── PARAM LIST ──
    if (cmd === "ros2 param list") {
      setIsRunning(true);
      ros.getParams((params) => {
        addLine(LINE_TYPE.INFO, `${(params || []).length} parametre:`);
        (params || []).forEach((p) => addLine(LINE_TYPE.OUTPUT, `  ${p}`));
        setIsRunning(false);
      }, (err) => { addLine(LINE_TYPE.ERROR, `Hata: ${err}`); setIsRunning(false); });
      return;
    }

    // ── PARAM GET ──
    const paramGetMatch = cmd.match(/^ros2 param get\s+(\S+)\s+(\S+)$/);
    if (paramGetMatch) {
      setIsRunning(true);
      const param = new ROSLIB.Param({ ros, name: `${paramGetMatch[1]}/${paramGetMatch[2]}` });
      param.get((val) => { addLine(LINE_TYPE.OUTPUT, `${paramGetMatch[2]}: ${JSON.stringify(val)}`); setIsRunning(false); });
      return;
    }

    // ── Unknown ──
    addLine(LINE_TYPE.ERROR, `✗ Bilinmeyen komut: '${cmd}'`);
    addLine(LINE_TYPE.INFO, `  'help' yazarak komut listesini görün.`);
  }, [ros, isConnected, addLine, addLines, stopActive, maxEchoMessages, commandHistory]);

  // ── Input key handler ──────────────────────────────────────────────────────
  const onKeyDown = useCallback((e) => {
    // Ctrl+C
    if (e.ctrlKey && e.key === "c") {
      e.preventDefault();
      if (activeEcho || activeHz || isRunning) {
        stopActive();
      } else {
        setInputValue(""); setAcVisible(false);
        addLine(LINE_TYPE.CMD, `$ ${inputValue}`);
        addLine(LINE_TYPE.INFO, "^C");
      }
      return;
    }

    // Tab – autocomplete
    if (e.key === "Tab") {
      e.preventDefault();
      const sugg = computeSuggestions(inputValue);
      if (sugg.length === 0) return;
      if (sugg.length === 1) {
        // Single match → complete directly
        setInputValue(sugg[0]);
        setAcVisible(false);
      } else {
        // Multiple → show suggestions, cycle with repeated Tab
        if (!acVisible) {
          setAcSuggestions(sugg); setAcIndex(0); setAcVisible(true);
        } else {
          const next = (acIndex + 1) % acSuggestions.length;
          setAcIndex(next);
          setInputValue(acSuggestions[next]);
        }
      }
      return;
    }

    // Escape
    if (e.key === "Escape") { setAcVisible(false); return; }

    // Arrow Up
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setAcVisible(false);
      if (commandHistory.length === 0) return;
      const newIdx = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(newIdx);
      setInputValue(commandHistory[commandHistory.length - 1 - newIdx] || "");
      return;
    }

    // Arrow Down
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAcVisible(false);
      if (historyIndex <= 0) { setHistoryIndex(-1); setInputValue(""); }
      else { const ni = historyIndex - 1; setHistoryIndex(ni); setInputValue(commandHistory[commandHistory.length - 1 - ni] || ""); }
      return;
    }

    // Any other key – hide autocomplete if input changed
    setAcVisible(false);
  }, [activeEcho, activeHz, isRunning, stopActive, inputValue, acVisible, acSuggestions, acIndex, computeSuggestions, commandHistory, historyIndex, addLine]);

  const onInputChange = (e) => {
    setInputValue(e.target.value);
    setAcVisible(false);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    executeCommand(inputValue);
    setInputValue("");
    setAcVisible(false);
  };

  // Cleanup
  useEffect(() => () => stopActive(true), []);

  // ── Shortcut click ─────────────────────────────────────────────────────────
  const onShortcutClick = (sc) => {
    if (sc.needsArg) {
      setInputValue(sc.cmd);
      inputRef.current?.focus();
    } else {
      executeCommand(sc.cmd);
      inputRef.current?.focus();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: "calc(100vh - 56px)", width: "100vw",
      background: "#070d1a",
      color: "white", padding: "0.6rem",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      overflow: "hidden", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: "0.5rem",
    }}>

      {/* ── HEADER ── */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #0ea5e9, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", boxShadow: "0 0 12px #0ea5e966" }}>
            ⌨
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: "800", letterSpacing: "0.1em", color: "#f1f5f9" }}>ROS 2 TERMİNAL</div>
            <div style={{ fontSize: "0.6rem", color: "#475569", letterSpacing: "0.06em" }}>ROSBRIDGE WEBSOCKET INTERFACE</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "#0f1e35", borderRadius: "0.5rem", padding: "0.35rem 0.75rem", border: "1px solid #1e3a5f" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isConnected ? "#10b981" : "#ef4444", boxShadow: isConnected ? "0 0 8px #10b981" : "0 0 8px #ef4444" }} />
            <span style={{ fontSize: "0.68rem", fontWeight: "600", color: isConnected ? "#10b981" : "#ef4444" }}>{statusText}</span>
          </div>
          <span style={{ fontSize: "0.65rem", color: "#334155", borderLeft: "1px solid #1e3a5f", paddingLeft: "0.75rem", fontFamily: "monospace" }}>{wsUrl}</span>
          {(activeEcho || activeHz) && (
            <span style={{ fontSize: "0.65rem", color: "#fbbf24", borderLeft: "1px solid #1e3a5f", paddingLeft: "0.75rem" }}>
              ● {activeEcho ? `echo ${echoCount}` : `hz ${activeHz}`}
            </span>
          )}
        </div>

        {(activeEcho || activeHz || isRunning) && (
          <button
            onClick={() => stopActive()}
            style={{ padding: "0.4rem 0.75rem", background: "linear-gradient(135deg, #991b1b, #dc2626)", border: "none", borderRadius: "0.5rem", color: "white", cursor: "pointer", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.04em", boxShadow: "0 0 10px #dc262644" }}
          >
            ⏹ CTRL+C DURDUR
          </button>
        )}
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, display: "flex", gap: "0.6rem", minHeight: 0, overflow: "hidden" }}>

        {/* LEFT: Shortcuts */}
        <div style={{
          width: "230px", flexShrink: 0, background: "#0a1628",
          borderRadius: "0.5rem", border: "1px solid #1e293b",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Panel header */}
          <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid #1e293b", background: "#0f1e35", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <span style={{ fontSize: "0.65rem", fontWeight: "800", color: "#64748b", letterSpacing: "0.08em" }}>KISAYOLLAR</span>
            <span style={{ fontSize: "0.6rem", color: "#334155" }}>{topicList.length} topic</span>
          </div>

          {/* Scrollable shortcuts */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
            {SHORTCUT_GROUPS.map((group) => {
              const collapsed = collapsedGroups[group.label];
              return (
                <div key={group.label} style={{ marginBottom: "0.5rem" }}>
                  <button
                    onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.label]: !prev[group.label] }))}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0", marginBottom: "0.25rem" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: group.color, boxShadow: `0 0 4px ${group.color}` }} />
                      <span style={{ fontSize: "0.62rem", fontWeight: "800", color: group.color, letterSpacing: "0.06em", textTransform: "uppercase" }}>{group.label}</span>
                    </div>
                    <span style={{ fontSize: "0.6rem", color: "#334155", transition: "transform 0.2s", display: "inline-block", transform: collapsed ? "rotate(-90deg)" : "rotate(0)" }}>▾</span>
                  </button>
                  {!collapsed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      {group.commands.map((sc) => (
                        <button
                          key={sc.cmd}
                          onClick={() => onShortcutClick(sc)}
                          disabled={!isConnected}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.4rem",
                            padding: "0.35rem 0.5rem",
                            background: "#0a1628", border: `1px solid #0f1e35`,
                            borderRadius: "0.3rem", color: isConnected ? "#94a3b8" : "#334155",
                            cursor: isConnected ? "pointer" : "not-allowed",
                            fontSize: "0.68rem", fontWeight: "500", textAlign: "left",
                            transition: "all 0.12s", opacity: isConnected ? 1 : 0.4,
                          }}
                          onMouseEnter={(e) => { if (isConnected) { e.currentTarget.style.background = "#0f1e35"; e.currentTarget.style.borderColor = group.color + "66"; e.currentTarget.style.color = "#e2e8f0"; } }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#0a1628"; e.currentTarget.style.borderColor = "#0f1e35"; e.currentTarget.style.color = isConnected ? "#94a3b8" : "#334155"; }}
                        >
                          <span style={{ fontSize: "0.75rem", flexShrink: 0 }}>{sc.icon}</span>
                          <span style={{ flex: 1, fontFamily: "'Courier New', monospace", fontSize: "0.65rem" }}>{sc.label}</span>
                          {sc.needsArg && <span style={{ fontSize: "0.55rem", color: "#334155" }}>✎</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Echo max messages */}
            <div style={{ borderTop: "1px solid #0f1e35", paddingTop: "0.5rem", marginTop: "0.25rem" }}>
              <div style={{ fontSize: "0.6rem", color: "#334155", marginBottom: "0.3rem", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "700" }}>Echo limit</div>
              <div style={{ display: "flex", gap: "0.2rem" }}>
                {[5, 10, 25, 50].map((n) => (
                  <button key={n} onClick={() => setMaxEchoMessages(n)} style={{
                    flex: 1, padding: "0.3rem", background: maxEchoMessages === n ? "#1d4ed8" : "#0a1628",
                    border: `1px solid ${maxEchoMessages === n ? "#3b82f6" : "#0f1e35"}`,
                    borderRadius: "0.25rem", color: maxEchoMessages === n ? "white" : "#475569",
                    fontSize: "0.62rem", cursor: "pointer", fontWeight: maxEchoMessages === n ? "700" : "400",
                    transition: "all 0.12s",
                  }}>{n}</button>
                ))}
              </div>
            </div>

            {/* Clear button */}
            <button
              onClick={() => setLines([])}
              style={{ marginTop: "0.4rem", width: "100%", padding: "0.35rem", background: "#0a1628", border: "1px solid #0f1e35", borderRadius: "0.3rem", color: "#475569", fontSize: "0.65rem", cursor: "pointer", fontWeight: "600", transition: "all 0.12s" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef444466"; e.currentTarget.style.color = "#f87171"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#0f1e35"; e.currentTarget.style.color = "#475569"; }}
            >
              🗑 Terminali Temizle
            </button>
          </div>
        </div>

        {/* RIGHT: Terminal */}
        <div style={{
          flex: 1, background: "#050c1a",
          borderRadius: "0.5rem", border: "1px solid #0f1e35",
          display: "flex", flexDirection: "column",
          minWidth: 0, overflow: "hidden",
        }}>
          {/* Terminal title bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.75rem", background: "#0a1628", borderBottom: "1px solid #0f1e35", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: "0.3rem" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }} />
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b" }} />
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#22c55e" }} />
            </div>
            <span style={{ fontSize: "0.68rem", color: "#334155", fontFamily: "monospace", flex: 1 }}>
              ros2@{wsUrl.replace("ws://", "").replace(":9090", "")} — bash
            </span>
            {isRunning && (
              <span style={{ fontSize: "0.65rem", color: "#fbbf24" }}>● çalışıyor</span>
            )}
            <span style={{ fontSize: "0.6rem", color: "#1e3a5f" }}>{lines.length} satır</span>
          </div>

          {/* Output area — THIS scrolls, not the page */}
          <div
            ref={terminalRef}
            onClick={() => inputRef.current?.focus()}
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              padding: "0.6rem 0.75rem",
              fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              fontSize: "0.78rem",
              lineHeight: "1.55",
              cursor: "text",
              minHeight: 0,
              // Scrollbar styling
              scrollbarWidth: "thin",
              scrollbarColor: "#1e3a5f #050c1a",
            }}
          >
            {lines.map((line, i) => {
              if (line.type === LINE_TYPE.SEPARATOR) {
                return <div key={i} style={{ borderBottom: "1px solid #0f1e35", margin: "0.4rem 0" }} />;
              }
              return (
                <div key={line.id ?? i} style={{
                  color: LINE_COLORS[line.type] || "#cbd5e1",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                  fontWeight: line.type === LINE_TYPE.CMD ? "700" : "400",
                  opacity: line.type === LINE_TYPE.OUTPUT ? 0.85 : 1,
                }}>
                  {line.text}
                </div>
              );
            })}
          </div>

          {/* Autocomplete dropdown */}
          {acVisible && acSuggestions.length > 0 && (
            <div style={{ background: "#0a1628", borderTop: "1px solid #0f1e35", padding: "0.35rem 0.75rem", flexShrink: 0, display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {acSuggestions.map((s, i) => (
                <button
                  key={s}
                  onMouseDown={(e) => { e.preventDefault(); setInputValue(s); setAcVisible(false); inputRef.current?.focus(); }}
                  style={{
                    padding: "0.2rem 0.45rem", borderRadius: "0.25rem",
                    background: i === acIndex ? "#1d4ed8" : "#0f1e35",
                    border: `1px solid ${i === acIndex ? "#3b82f6" : "#1e3a5f"}`,
                    color: i === acIndex ? "white" : "#60a5fa",
                    fontSize: "0.65rem", cursor: "pointer",
                    fontFamily: "'Courier New', monospace", fontWeight: i === acIndex ? "700" : "400",
                  }}
                >{s}</button>
              ))}
              <span style={{ fontSize: "0.58rem", color: "#1e3a5f", alignSelf: "center", marginLeft: "0.25rem" }}>Tab: seç • Esc: kapat</span>
            </div>
          )}

          {/* Input row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.75rem", background: "#0a1628", borderTop: "1px solid #0f1e35", flexShrink: 0 }}>
            <span style={{ color: isConnected ? "#22d3ee" : "#475569", fontFamily: "monospace", fontWeight: "700", fontSize: "0.85rem", flexShrink: 0 }}>$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              onKeyPress={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(e); } }}
              placeholder={isConnected ? "komut girin... (Tab: tamamla, ↑↓: geçmiş, Ctrl+C: durdur)" : "ROSBridge bağlanıyor..."}
              autoFocus
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#e2e8f0",
                fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                fontSize: "0.8rem", caretColor: "#22d3ee",
              }}
            />
            <button
              onClick={onSubmit}
              disabled={!inputValue.trim()}
              style={{
                padding: "0.3rem 0.6rem", borderRadius: "0.3rem",
                background: inputValue.trim() ? "#1d4ed8" : "#0a1628",
                border: `1px solid ${inputValue.trim() ? "#3b82f6" : "#0f1e35"}`,
                color: inputValue.trim() ? "white" : "#334155",
                fontSize: "0.72rem", fontWeight: "700",
                cursor: inputValue.trim() ? "pointer" : "default", transition: "all 0.15s",
              }}
            >↵</button>
          </div>
        </div>
      </div>
    </div>
  );
}
