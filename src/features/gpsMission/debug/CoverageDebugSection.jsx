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

export default function CoverageDebugSection({
  rosStampText,
  gpsCoverageStatusInfo,
  gpsCoverageDebugInfo,
  gpsCoveragePathInfo,
}) {
  return (
    <DebugSection
      title="GPS Coverage"
      note="GPSMission bu ekranda yalnızca /gps_coverage/* hattını izler; eski /coverage/* topicleri burada kullanılmaz."
    >
      <DebugRow label="/gps_coverage/status" value={gpsCoverageStatusInfo?.text || "-"} />
      <DebugRow label="status son mesaj" value={rosStampText(null, gpsCoverageStatusInfo?.ts)} />
      <DebugRow label="/gps_coverage/debug_points" value={gpsCoverageDebugInfo ? `${gpsCoverageDebugInfo.count} nokta` : "-"} />
      <DebugRow label="debug son mesaj" value={rosStampText(null, gpsCoverageDebugInfo?.ts)} />
      <DebugRow label="/gps_coverage/path points" value={gpsCoveragePathInfo?.count ?? 0} />
      <DebugRow label="/gps_coverage/path frame" value={gpsCoveragePathInfo?.frameId || "-"} />
      <DebugRow label="path son mesaj" value={rosStampText(gpsCoveragePathInfo?.stamp, gpsCoveragePathInfo?.ts)} />
    </DebugSection>
  );
}
