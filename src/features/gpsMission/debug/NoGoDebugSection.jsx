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

export default function NoGoDebugSection({
  NO_GO_DEBUG_TOPIC,
  noGoDebugZones,
  showNoGoKeepoutBuffer,
}) {
  return (
    <DebugSection title="No-Go Keepout">
      <DebugRow label={NO_GO_DEBUG_TOPIC} value={`${noGoDebugZones.length} zone`} />
      <DebugRow
        label="keepout_points_geo"
        value={noGoDebugZones.reduce((sum, zone) => sum + (Array.isArray(zone?.keepout_points_geo) ? zone.keepout_points_geo.length : 0), 0)}
      />
      <DebugRow
        label="keepout_points_map"
        value={noGoDebugZones.reduce((sum, zone) => sum + (Array.isArray(zone?.keepout_points_map) ? zone.keepout_points_map.length : 0), 0)}
      />
      <DebugRow label="Nav2 Actual Keepout" value={showNoGoKeepoutBuffer ? "gösteriliyor" : "gizli"} />
    </DebugSection>
  );
}
