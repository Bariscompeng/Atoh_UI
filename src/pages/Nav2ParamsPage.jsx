import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ROSLIB from "roslib";
import { useROS } from "../context/ROSContext";

const BG      = "#04090f";
const SURFACE = "#07111d";
const BORDER  = "#0f2236";
const BORDER2 = "#162d46";
const TEXT    = "#c8dde8";
const TEXT2   = "#4a7a96";
const TEXT3   = "#1e3a52";
const ACCENT  = "#0ea5e9";
const MONO    = "'JetBrains Mono','Fira Code',monospace";

const TYPE_COLOR = {
  double:   "#38bdf8",
  int:      "#a78bfa",
  bool:     "#34d399",
  string:   "#fbbf24",
  "double[]": "#7dd3fc",
  "int[]":    "#c4b5fd",
  "bool[]":   "#6ee7b7",
  "string[]": "#fcd34d",
  list:     TEXT3,
  unknown:  TEXT3,
};

const btnStyle = (active, disabled, color) => ({
  padding: "0.38rem 0.65rem",
  background: active ? `${color || ACCENT}22` : "transparent",
  border: `1px solid ${active ? (color || ACCENT) : BORDER2}`,
  borderRadius: 5,
  color: active ? (color || ACCENT) : TEXT2,
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 700, fontSize: "0.62rem", fontFamily: MONO,
  opacity: disabled ? 0.45 : 1,
  whiteSpace: "nowrap",
  transition: "all 0.15s",
});

const inp = (editable) => ({
  width: "100%", padding: "0.32rem 0.45rem",
  background: editable ? "#03070e" : "transparent",
  border: `1px solid ${editable ? BORDER : "transparent"}`,
  borderRadius: 4, color: editable ? TEXT : TEXT2,
  fontSize: "0.67rem", outline: "none",
  fontFamily: MONO, boxSizing: "border-box",
  cursor: editable ? "text" : "default",
});

const lbl = {
  fontSize: "0.52rem", color: TEXT3,
  letterSpacing: "0.1em", textTransform: "uppercase",
};

// ── YAML üretme yardımcıları ──────────────────────────────────────────────────

// Dot-notation flat params → iç içe ağaç (leaf node'lar {__leaf, value, type} taşır)
function unflattenToTree(flatParams) {
  const tree = {};
  for (const [key, paramData] of Object.entries(flatParams)) {
    const parts  = key.split(".");
    let   cursor = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]] || cursor[parts[i]].__leaf) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = { __leaf: true, value: paramData.value, type: paramData.type };
  }
  return tree;
}

// Değeri YAML formatına çevir
function toYamlValue(value, type) {
  if (value === null || value === undefined) return "null";
  if (type === "bool")   return value ? "True" : "False";
  if (type === "int")    return String(Math.round(Number(value)));
  if (type === "double") {
    const n = Number(value);
    return Number.isInteger(n) ? n.toFixed(1) : String(n);
  }
  if (type === "string") {
    const s = String(value);
    // Özel karakter içeriyorsa tırnaklı yaz
    if (/[:#\[\]{},\n]/.test(s) || s.trim() !== s || s === "" || s === "true" || s === "false") {
      return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return s;
  }
  if (type === "double[]" && Array.isArray(value)) {
    return `[${value.map(v => { const n = Number(v); return Number.isInteger(n) ? n.toFixed(1) : String(n); }).join(", ")}]`;
  }
  if ((type === "int[]" || type === "bool[]") && Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  if (type === "string[]" && Array.isArray(value)) return null; // çok satırlı — özel işlem
  return String(value);
}

// Ağacı YAML satırlarına çevir
function renderTree(tree, indent) {
  const lines = [];
  for (const [key, node] of Object.entries(tree)) {
    if (node && node.__leaf) {
      const { value, type } = node;
      if (type === "string[]" && Array.isArray(value)) {
        lines.push(`${indent}${key}:`);
        value.forEach(item => lines.push(`${indent}  - ${item}`));
      } else {
        const yaml = toYamlValue(value, type);
        lines.push(`${indent}${key}: ${yaml ?? String(value)}`);
      }
    } else if (node && typeof node === "object") {
      lines.push(`${indent}${key}:`);
      lines.push(renderTree(node, indent + "  "));
    }
  }
  return lines.join("\n");
}

// /controller_server        → ["controller_server"]
// /local_costmap/local_costmap → ["local_costmap", "local_costmap"]
function nodeNameToParts(nodeName) {
  return nodeName.replace(/^\//, "").split("/").filter(Boolean);
}

// Parametreleri nav2_params.yaml formatında YAML dosyası olarak indir
function downloadParamsAsYaml(stateData, comment) {
  if (!stateData) return;
  const now   = new Date().toLocaleString("tr-TR");
  const lines = [];

  // Yorum başlığı
  lines.push("# =============================================================");
  lines.push("# Nav2 Parametre Dosyası");
  lines.push(`# Tarih   : ${now}`);
  lines.push(`# Kaynak  : ${stateData.yaml_path || "—"}`);
  if (comment && comment.trim()) {
    lines.push(`# Not     : ${comment.trim()}`);
  }
  lines.push("# =============================================================");
  lines.push("");

  // Her node'u YAML yapısına çevir
  const nodes = stateData.nodes || {};
  for (const [nodeName, flatParams] of Object.entries(nodes)) {
    const parts  = nodeNameToParts(nodeName);
    const tree   = unflattenToTree(flatParams);
    const inner  = renderTree(tree, "    ");    // ros__parameters içi (4 boşluk)

    // Yapıyı dışarıdan içeri doğru sar
    // Önce ros__parameters bloğu
    let block = `  ros__parameters:\n${inner}`;
    // Sonra node path parçaları
    for (let i = parts.length - 1; i >= 0; i--) {
      const pad = "  ".repeat(i);
      block = `${pad}${parts[i]}:\n${block.split("\n").map(l => "  " + l).join("\n")}`;
    }
    // En dıştaki node zaten pad=0 olduğu için tekrar indent'i kaldır
    // Aslında yukarıdaki döngü hatalı üretebilir. Daha temiz yaklaşım:
    lines.push(buildNodeYaml(parts, tree));
    lines.push("");
  }

  const content = lines.join("\n");
  const blob    = new Blob([content], { type: "text/yaml;charset=utf-8" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `nav2_params_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
}

// Node YAML bloğunu üret:
// parts = ["controller_server"] veya ["local_costmap", "local_costmap"]
function buildNodeYaml(parts, paramsTree) {
  const innerYaml = renderTree(paramsTree, "    ".repeat(parts.length) + "    ");
  const rosBlock  = `${"  ".repeat(parts.length)}ros__parameters:\n${innerYaml}`;

  let result = rosBlock;
  for (let i = parts.length - 1; i >= 0; i--) {
    const ind  = "  ".repeat(i);
    const body = result.split("\n").map(l => "  " + l).join("\n");
    result     = `${ind}${parts[i]}:\n${body}`;
  }
  return result;
}

// Değeri gösterim için stringe çevir
function displayValue(value, type) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (type === "bool") return value ? "true" : "false";
  return String(value);
}

// Node adını kısa etikete çevir
function shortNodeLabel(nodeName) {
  return nodeName.replace(/^\//, "").replace(/\//g, " / ");
}

export default function Nav2ParamsPage() {
  const { ros, isConnected, status } = useROS();

  // ── State ──────────────────────────────────────────────────────────────────
  const [stateData,    setStateData]    = useState(null);   // parse edilmiş JSON
  const [selectedNode, setSelectedNode] = useState(null);
  const [filter,       setFilter]       = useState("");
  const [lastStamp,    setLastStamp]    = useState(null);
  const [connError,    setConnError]    = useState("");
  const [saveComment,  setSaveComment]  = useState("");

  // Her satır için: { edit: string, dirty: bool, busy: bool, ok: bool, err: string }
  const [rowState, setRowState] = useState({});

  const stateSubRef  = useRef(null);
  const resultSubRef = useRef(null);
  const mountedRef   = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Subscriptions ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Temizle
    try { stateSubRef.current?.unsubscribe(); }  catch {}
    try { resultSubRef.current?.unsubscribe(); } catch {}
    stateSubRef.current  = null;
    resultSubRef.current = null;

    if (!ros || !isConnected) {
      setStateData(null);
      setConnError("");
      return;
    }

    setConnError("");

    // /nav2_param_manager/state
    const stateTopic = new ROSLIB.Topic({
      ros,
      name: "/nav2_param_manager/state",
      messageType: "std_msgs/String",
      queue_length: 1,
      throttle_rate: 500,
    });
    stateTopic.subscribe((msg) => {
      if (!mountedRef.current) return;
      try {
        const parsed = JSON.parse(msg.data);
        setStateData(parsed);
        setLastStamp(Date.now());
        setConnError("");
        // İlk yüklemede ilk node'u seç
        setSelectedNode(prev => {
          if (prev) return prev;
          const keys = Object.keys(parsed.nodes || {});
          return keys[0] || null;
        });
      } catch (e) {
        setConnError(`State parse hatası: ${e.message}`);
      }
    });
    stateSubRef.current = stateTopic;

    // /nav2_param_manager/result
    const resultTopic = new ROSLIB.Topic({
      ros,
      name: "/nav2_param_manager/result",
      messageType: "std_msgs/String",
      queue_length: 5,
    });
    resultTopic.subscribe((msg) => {
      if (!mountedRef.current) return;
      try {
        const res = JSON.parse(msg.data);
        const rowKey = `${res.node}||${res.param}`;

        setRowState(prev => {
          const cur = prev[rowKey] || {};
          if (res.success) {
            return {
              ...prev,
              [rowKey]: { ...cur, busy: false, ok: true, err: "", dirty: false },
            };
          } else {
            return {
              ...prev,
              [rowKey]: { ...cur, busy: false, ok: false, err: res.message || "Hata" },
            };
          }
        });

        // OK göstergesini 2s sonra sil
        if (res.success) {
          setTimeout(() => {
            if (!mountedRef.current) return;
            setRowState(prev => {
              const cur = prev[rowKey];
              if (cur?.ok) return { ...prev, [rowKey]: { ...cur, ok: false } };
              return prev;
            });
          }, 2000);
        }
      } catch {}
    });
    resultSubRef.current = resultTopic;

    return () => {
      try { stateTopic.unsubscribe(); }  catch {}
      try { resultTopic.unsubscribe(); } catch {}
    };
  }, [ros, isConnected]);

  // ── SET publish ────────────────────────────────────────────────────────────
  const publishSet = useCallback((node, paramName, editStr, paramType) => {
    if (!ros || !isConnected) return;
    const rowKey    = `${node}||${paramName}`;
    const requestId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

    setRowState(prev => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] || {}), busy: true, ok: false, err: "" },
    }));

    try {
      const setTopic = new ROSLIB.Topic({
        ros,
        name: "/nav2_param_manager/set",
        messageType: "std_msgs/String",
        queue_size: 1,
      });
      const payload = {
        node,
        param: paramName,
        value: editStr,   // node string olarak gönderiyoruz, Python tarafı parse eder
        type: paramType,
        request_id: requestId,
      };
      setTopic.publish({ data: JSON.stringify(payload) });
      setTimeout(() => { try { setTopic.unadvertise(); } catch {} }, 500);
    } catch (e) {
      setRowState(prev => ({
        ...prev,
        [rowKey]: { ...(prev[rowKey] || {}), busy: false, err: e.message },
      }));
    }
  }, [ros, isConnected]);

  // ── Türetilmiş veri ────────────────────────────────────────────────────────
  const nodeNames = useMemo(() =>
    stateData ? Object.keys(stateData.nodes || {}).sort() : [],
    [stateData]);

  const filteredParams = useMemo(() => {
    if (!stateData || !selectedNode) return [];
    const params = stateData.nodes[selectedNode] || {};
    const q = filter.toLowerCase().trim();
    return Object.entries(params)
      .filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [stateData, selectedNode, filter]);

  // Staleness
  const isStale = lastStamp && (Date.now() - lastStamp) > 5000;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "calc(100vh - 56px)", width: "100vw",
      background: BG,
      backgroundImage: "radial-gradient(rgba(14,165,233,0.06) 1px, transparent 1px)",
      backgroundSize: "24px 24px",
      color: TEXT, padding: "0.65rem",
      fontFamily: MONO, boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 1500, margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.5rem", height: "calc(100vh - 80px)" }}>

        {/* ── HEADER ── */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <div style={{
            width: 32, height: 32, background: "rgba(14,165,233,0.1)",
            border: `1px solid rgba(14,165,233,0.35)`, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem",
          }}>🔧</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.14em", color: ACCENT }}>
              NAV2 PARAMETER TUNER
            </div>
            <div style={{ fontSize: "0.55rem", color: TEXT2, letterSpacing: "0.1em", marginTop: 1 }}>
              /nav2_param_manager/state · set · result
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
            <input
              type="text"
              value={saveComment}
              onChange={e => setSaveComment(e.target.value)}
              placeholder="Kayıt notu (opsiyonel)…"
              style={{
                padding: "0.35rem 0.5rem",
                background: "#03070e", border: `1px solid ${BORDER2}`,
                borderRadius: 4, color: TEXT, fontSize: "0.65rem",
                outline: "none", fontFamily: MONO, width: 220,
              }}
            />
            <button
              onClick={() => downloadParamsAsYaml(stateData, saveComment)}
              disabled={!stateData}
              style={btnStyle(false, !stateData, "#10b981")}
              title="Parametreleri YAML formatında indir"
            >
              ↓ KAYDET
            </button>
            {stateData?.yaml_path && (
              <div style={{ fontSize: "0.55rem", color: TEXT3, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                   title={stateData.yaml_path}>
                📄 {stateData.yaml_path}
              </div>
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              fontSize: "0.62rem", fontWeight: 600,
              color: !isConnected ? "#ef4444" : isStale ? "#f59e0b" : stateData ? "#10b981" : TEXT2,
            }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: !isConnected ? "#ef4444" : isStale ? "#f59e0b" : stateData ? "#10b981" : TEXT3,
              }} />
              {!isConnected ? status : isStale ? "STALE" : stateData ? "CANLI" : "Bekleniyor…"}
            </div>
          </div>
        </div>

        {/* ── HATA ── */}
        {connError && (
          <div style={{
            flexShrink: 0, background: "rgba(239,68,68,0.08)",
            border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 5,
            padding: "0.45rem 0.75rem", fontSize: "0.65rem", color: "#f87171",
          }}>⚠ {connError}</div>
        )}

        {/* ── BAĞLI DEĞİL ── */}
        {!isConnected && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: "0.5rem",
          }}>
            <div style={{ fontSize: "2rem", opacity: 0.3 }}>🔌</div>
            <div style={{ fontSize: "0.75rem", color: TEXT2 }}>ROS bağlantısı yok</div>
            <div style={{ fontSize: "0.62rem", color: TEXT3 }}>
              nav2_param_manager node'u çalıştırılmış olmalı
            </div>
          </div>
        )}

        {/* ── NODE YOK ── */}
        {isConnected && !stateData && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: "0.5rem",
          }}>
            <div style={{ fontSize: "2rem", opacity: 0.3 }}>⏳</div>
            <div style={{ fontSize: "0.75rem", color: TEXT2 }}>
              /nav2_param_manager/state bekleniyor…
            </div>
            <div style={{ fontSize: "0.62rem", color: TEXT3 }}>
              Jetson'da: <span style={{ color: ACCENT }}>python3 nav2_param_manager.py --ros-args -p yaml_path:=…</span>
            </div>
          </div>
        )}

        {/* ── ANA LAYOUT ── */}
        {isConnected && stateData && (
          <div style={{ flex: 1, display: "flex", gap: "0.5rem", minHeight: 0 }}>

            {/* NODE LİSTESİ */}
            <div style={{
              width: 230, flexShrink: 0,
              background: SURFACE, borderRadius: 6, border: `1px solid ${BORDER2}`,
              padding: "0.55rem", display: "flex", flexDirection: "column", gap: "0.25rem",
              overflowY: "auto",
            }}>
              <div style={lbl}>NODE'LAR ({nodeNames.length})</div>
              {nodeNames.map(n => {
                const params  = stateData.nodes[n] || {};
                const total   = Object.keys(params).length;
                const edCount = Object.values(params).filter(p => p.editable).length;
                const active  = selectedNode === n;
                return (
                  <button
                    key={n}
                    onClick={() => { setSelectedNode(n); setFilter(""); }}
                    style={{
                      ...btnStyle(active, false, ACCENT),
                      textAlign: "left", width: "100%",
                      display: "flex", flexDirection: "column", gap: "0.1rem",
                      padding: "0.45rem 0.6rem",
                    }}
                  >
                    <div style={{ fontSize: "0.64rem", wordBreak: "break-all" }}>
                      {shortNodeLabel(n)}
                    </div>
                    <div style={{ fontSize: "0.5rem", color: active ? ACCENT : TEXT3 }}>
                      {edCount} düzenlenebilir / {total} toplam
                    </div>
                  </button>
                );
              })}
            </div>

            {/* PARAMETRE PANELİ */}
            <div style={{
              flex: 1, background: SURFACE, borderRadius: 6,
              border: `1px solid ${BORDER2}`, padding: "0.55rem",
              display: "flex", flexDirection: "column", gap: "0.45rem", minWidth: 0,
            }}>

              {/* Panel başlık + filtre */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: TEXT }}>
                    {selectedNode || "—"}
                  </div>
                  <div style={{ fontSize: "0.54rem", color: TEXT3, marginTop: 2 }}>
                    {filteredParams.length} parametre gösteriliyor
                  </div>
                </div>
                <input
                  type="text" value={filter}
                  placeholder="Filtrele…"
                  onChange={e => setFilter(e.target.value)}
                  style={{
                    marginLeft: "auto", maxWidth: 240,
                    ...inp(true), width: "auto",
                  }}
                />
              </div>

              {/* Tablo başlığı */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "minmax(200px,2.5fr) 75px minmax(160px,2fr) 70px 120px",
                gap: "0.3rem",
                padding: "0.28rem 0.45rem",
                borderBottom: `1px solid ${BORDER}`,
                fontSize: "0.52rem", color: TEXT3, letterSpacing: "0.1em",
                flexShrink: 0,
              }}>
                <div>PARAMETRE</div>
                <div>TİP</div>
                <div>DEĞER</div>
                <div style={{ textAlign: "center" }}>AKSİYON</div>
                <div>DURUM</div>
              </div>

              {/* Satırlar */}
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                {filteredParams.length === 0 && (
                  <div style={{ color: TEXT3, fontSize: "0.7rem", padding: "1.5rem", textAlign: "center" }}>
                    Parametre bulunamadı.
                  </div>
                )}

                {filteredParams.map(([paramName, paramData]) => {
                  const { value, type, editable } = paramData;
                  const rowKey = `${selectedNode}||${paramName}`;
                  const rs     = rowState[rowKey] || {};

                  const currentEdit = rs.edit !== undefined
                    ? rs.edit
                    : displayValue(value, type);

                  const isDirty = rs.dirty || false;
                  const isBusy  = rs.busy  || false;
                  const isOk    = rs.ok    || false;
                  const err     = rs.err   || "";

                  const typeColor = TYPE_COLOR[type] || TEXT3;

                  return (
                    <div
                      key={paramName}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(200px,2.5fr) 75px minmax(160px,2fr) 70px 120px",
                        gap: "0.3rem", alignItems: "center",
                        padding: "0.28rem 0.45rem",
                        borderRadius: 4,
                        background: isDirty ? "rgba(245,158,11,0.05)" : "transparent",
                        borderLeft: isOk  ? "2px solid #10b981"
                                  : err   ? "2px solid #ef4444"
                                  : isDirty ? "2px solid #f59e0b"
                                  : "2px solid transparent",
                        transition: "background 0.2s",
                      }}
                    >
                      {/* Parametre adı */}
                      <div style={{ fontSize: "0.65rem", color: TEXT, wordBreak: "break-all" }}
                           title={paramName}>
                        {paramName}
                      </div>

                      {/* Tip */}
                      <div style={{ fontSize: "0.55rem", color: typeColor, fontWeight: 600 }}>
                        {type}
                      </div>

                      {/* Değer input */}
                      {type === "bool" && editable ? (
                        <select
                          value={currentEdit}
                          onChange={e => setRowState(prev => ({
                            ...prev,
                            [rowKey]: {
                              ...(prev[rowKey] || {}),
                              edit: e.target.value,
                              dirty: e.target.value !== displayValue(value, type),
                              err: "",
                            },
                          }))}
                          style={inp(true)}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={currentEdit}
                          disabled={!editable}
                          title={!editable ? "Bu parametre düzenlenemiyor" : undefined}
                          onChange={e => setRowState(prev => ({
                            ...prev,
                            [rowKey]: {
                              ...(prev[rowKey] || {}),
                              edit: e.target.value,
                              dirty: e.target.value !== displayValue(value, type),
                              err: "",
                            },
                          }))}
                          onKeyDown={e => {
                            if (e.key === "Enter" && isDirty && !isBusy && editable) {
                              publishSet(selectedNode, paramName, currentEdit, type);
                            }
                          }}
                          style={inp(editable)}
                        />
                      )}

                      {/* SET butonu */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        {editable ? (
                          <button
                            onClick={() => publishSet(selectedNode, paramName, currentEdit, type)}
                            disabled={!isDirty || isBusy}
                            style={{
                              ...btnStyle(isDirty && !isBusy, !isDirty || isBusy, ACCENT),
                              padding: "0.28rem 0.5rem", fontSize: "0.6rem",
                            }}
                          >
                            {isBusy ? "…" : "SET"}
                          </button>
                        ) : (
                          <span style={{ fontSize: "0.55rem", color: TEXT3 }}>—</span>
                        )}
                      </div>

                      {/* Durum */}
                      <div style={{ fontSize: "0.55rem", overflow: "hidden" }}>
                        {isOk && (
                          <span style={{ color: "#10b981" }}>✓ Uygulandı</span>
                        )}
                        {err && (
                          <span style={{ color: "#f87171" }} title={err}>⚠ {err.slice(0, 40)}{err.length > 40 ? "…" : ""}</span>
                        )}
                        {!isOk && !err && isDirty && (
                          <span style={{ color: "#f59e0b" }}>● değişti</span>
                        )}
                        {!isOk && !err && !isDirty && !editable && (
                          <span style={{ color: TEXT3 }}>readonly</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Alt bilgi */}
              <div style={{
                flexShrink: 0, borderTop: `1px solid ${BORDER}`,
                paddingTop: "0.4rem", display: "flex", gap: "1.2rem",
                fontSize: "0.54rem", color: TEXT3,
              }}>
                <span>Enter → hızlı SET</span>
                <span>Sarı satır → bekleyen değişiklik</span>
                <span>Readonly → string[] listeler</span>
                {lastStamp && (
                  <span style={{ marginLeft: "auto" }}>
                    Son güncelleme: {new Date(lastStamp).toLocaleTimeString("tr-TR")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
