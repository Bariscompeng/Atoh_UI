import React from "react";

function formatDistance(distanceM) {
  if (!Number.isFinite(distanceM)) return "0 m";
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${distanceM.toFixed(1)} m`;
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return String(value);
  }
}

export default function SavedGpsRouteCard({
  route,
  actionLabel = "Rotayı Aç",
  onAction,
  onDelete,
  onPreview,
}) {
  if (!route) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "128px minmax(0, 1fr)",
        gap: "0.65rem",
        padding: "0.55rem",
        background: "#0a1020",
        border: "1px solid #1e293b",
        borderRadius: "0.4rem",
        alignItems: "start"
      }}
    >
      <button
        type="button"
        onClick={() => route.previewImage && onPreview?.(route)}
        title={route.previewImage ? `${route.name} önizlemeyi büyüt` : undefined}
        style={{
          width: "128px",
          height: "78px",
          borderRadius: "0.35rem",
          overflow: "hidden",
          border: "1px solid #243244",
          background: "#020617",
          padding: 0,
          cursor: route.previewImage ? "pointer" : "default"
        }}
      >
        {route.previewImage ? (
          <img
            src={route.previewImage}
            alt={`${route.name} rota önizlemesi`}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : null}
      </button>

      <div style={{ minWidth: 0, display: "grid", gap: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.76rem", fontWeight: "800", color: "#e2e8f0" }}>{route.name}</div>
          <span style={{ fontSize: "0.46rem", fontWeight: "800", color: "#6ee7b7", background: "#064e3b", padding: "0.07rem 0.28rem", borderRadius: "0.18rem" }}>
            GPS ROTA
          </span>
        </div>

        <div style={{ fontSize: "0.56rem", color: "#94a3b8", lineHeight: "1.45" }}>
          {route.description || "Açıklama girilmedi."}
        </div>

        <div style={{ fontSize: "0.52rem", color: "#64748b", lineHeight: "1.5" }}>
          {route.waypointCount} waypoint · {formatDistance(route.distanceM)}
          <br />
          Güncellendi: {formatDate(route.updatedAt)}
        </div>

        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.15rem", flexWrap: "wrap" }}>
          <button
            onClick={() => onAction?.(route)}
            style={{
              padding: "0.38rem 0.6rem",
              background: "#0f4c75",
              border: "1px solid #1d70a2",
              borderRadius: "0.3rem",
              color: "#e0f2fe",
              cursor: "pointer",
              fontSize: "0.62rem",
              fontWeight: "800"
            }}
          >
            {actionLabel}
          </button>
          {onDelete ? (
            <button
              onClick={() => onDelete(route)}
              style={{
                padding: "0.38rem 0.6rem",
                background: "#7f1d1d",
                border: "1px solid #b91c1c",
                borderRadius: "0.3rem",
                color: "#fee2e2",
                cursor: "pointer",
                fontSize: "0.62rem",
                fontWeight: "800"
              }}
            >
              Sil
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
