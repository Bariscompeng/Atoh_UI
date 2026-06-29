import React from "react";

function DebugRow({ label, value, title }) {
  return (
    <div title={title || String(value ?? "")} style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 6, alignItems: "baseline" }}>
      <span style={{ color: "#8f929d" }}>{label}</span>
      <span style={{ color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function DebugSection({ title, children, note }) {
  return (
    <div style={{ borderTop: "1px solid #3b3b42", paddingTop: 8 }}>
      <div style={{ color: "#9ea0a8", marginBottom: 3 }}>{title}</div>
      {note && <div style={{ color: "#777", fontSize: 10, marginBottom: 6, lineHeight: 1.35 }}>{note}</div>}
      <div style={{ display: "grid", gap: 4 }}>{children}</div>
    </div>
  );
}

export default function OffsetDebugSection({
  rosStampText,
  offsetLineRunState,
  offsetLineStatusInfo,
  offsetLinePathPointCount,
  offsetLineDebugInfo,
  offsetLineStart,
  offsetLineEnd,
  haversine,
}) {
  return (
    <DebugSection title="Offset Çizgi Takibi">
      <DebugRow label="çalışma durumu" value={offsetLineRunState} />
      <DebugRow label="/gps_offset_line/status" value={offsetLineStatusInfo?.detail || "-"} />
      <DebugRow label="status son mesaj" value={rosStampText(null, offsetLineStatusInfo?.ts)} />
      <DebugRow label="/gps_offset_line/path points" value={offsetLinePathPointCount} />
      <DebugRow label="/gps_offset_line/debug_points" value={offsetLineDebugInfo?.text || "-"} />
      <DebugRow label="referans çizgi" value={offsetLineStart && offsetLineEnd ? `${haversine(offsetLineStart, offsetLineEnd).toFixed(2)} m` : "-"} />
    </DebugSection>
  );
}
