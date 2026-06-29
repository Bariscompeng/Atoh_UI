import { useCallback, useEffect } from "react";
import L from "leaflet";

export default function useOffsetLineOverlays({
  mapRef,
  offsetLineStart,
  offsetLineEnd,
  offsetLineSide,
  offsetLineStartRef,
  offsetLineEndRef,
  offsetLineSideRef,
  offsetLineMarkersRef,
  offsetReferencePolylineRef,
  offsetLinePolylineRef,
  offsetLinePathRef,
  showOffsetLineRef,
  offsetTrailPolylineRef,
  offsetLineTrailRef,
  updatePlanPolyline,
  latLngDeltaMeters,
  offsetLatLng,
  MONO,
}) {
  const updateOffsetReferenceOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const start = offsetLineStartRef.current;
    const end = offsetLineEndRef.current;

    offsetLineMarkersRef.current.forEach(marker => marker.remove());
    offsetLineMarkersRef.current = [];

    if (!start) {
      offsetReferencePolylineRef.current?.setLatLngs([]);
      return;
    }

    if (!offsetReferencePolylineRef.current) {
      offsetReferencePolylineRef.current = L.polyline([], {
        interactive: false,
        bubblingMouseEvents: false,
        color: "#facc15",
        weight: 3,
        opacity: 0.85,
        dashArray: "4 8",
        lineCap: "round"
      }).addTo(map);
    }

    offsetLineMarkersRef.current.push(
      L.circleMarker([start.lat, start.lng], {
        radius: 6, color: "#0a0a0a", weight: 2, fillColor: "#facc15", fillOpacity: 1
      }).bindTooltip("1 (Referans başlangıç)", { permanent: false }).addTo(map)
    );

    if (!end) {
      offsetReferencePolylineRef.current.setLatLngs([]);
      return;
    }

    offsetReferencePolylineRef.current.setLatLngs([[start.lat, start.lng], [end.lat, end.lng]]);

    offsetLineMarkersRef.current.push(
      L.circleMarker([end.lat, end.lng], {
        radius: 6, color: "#0a0a0a", weight: 2, fillColor: "#facc15", fillOpacity: 1
      }).bindTooltip("2 (Referans bitiş)", { permanent: false }).addTo(map)
    );

    const delta = latLngDeltaMeters(start, end);
    const length = delta ? Math.hypot(delta.east, delta.north) : 0;
    if (delta && length > 1e-3) {
      const ux = delta.east / length;
      const uy = delta.north / length;
      const left = offsetLineSideRef.current !== "right";
      const nx = left ? -uy : uy;
      const ny = left ? ux : -ux;
      const midLat = (start.lat + end.lat) / 2;
      const midLng = (start.lng + end.lng) / 2;
      const tickLatLng = offsetLatLng({ lat: midLat, lng: midLng }, nx * 1.0, ny * 1.0);
      if (tickLatLng) {
        offsetLineMarkersRef.current.push(
          L.marker([tickLatLng.lat, tickLatLng.lng], {
            icon: L.divIcon({
              className: "",
              html: `<div style="color:#facc15;font-weight:800;font-family:${MONO};font-size:12px;text-shadow:0 0 3px #000,0 0 3px #000;">${left ? "◀ SOL" : "SAĞ ▶"}</div>`,
              iconSize: [60, 16],
              iconAnchor: [30, 8]
            }),
            interactive: false
          }).addTo(map)
        );
      }
    }
  }, [
    mapRef,
    offsetLineStartRef,
    offsetLineEndRef,
    offsetLineSideRef,
    offsetLineMarkersRef,
    offsetReferencePolylineRef,
    latLngDeltaMeters,
    offsetLatLng,
    MONO,
  ]);

  const updateOffsetLinePathOverlay = useCallback(() => {
    updatePlanPolyline(
      offsetLinePolylineRef,
      offsetLinePathRef,
      showOffsetLineRef,
      {
        color: "#fb923c",
        weight: 4,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round"
      }
    );
  }, [updatePlanPolyline, offsetLinePolylineRef, offsetLinePathRef, showOffsetLineRef]);

  const updateOffsetTrailOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!offsetTrailPolylineRef.current) {
      offsetTrailPolylineRef.current = L.polyline([], {
        interactive: false,
        bubblingMouseEvents: false,
        color: "#38bdf8",
        weight: 4,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(map);
    }

    const points = offsetLineTrailRef.current;
    offsetTrailPolylineRef.current.setLatLngs(
      points.length >= 2 ? points.map(p => [p.lat, p.lng]) : []
    );
  }, [mapRef, offsetTrailPolylineRef, offsetLineTrailRef]);

  const updateOffsetLineOverlays = useCallback(() => {
    updateOffsetReferenceOverlay();
    updateOffsetLinePathOverlay();
    updateOffsetTrailOverlay();
  }, [updateOffsetReferenceOverlay, updateOffsetLinePathOverlay, updateOffsetTrailOverlay]);

  useEffect(() => {
    updateOffsetReferenceOverlay();
  }, [offsetLineStart, offsetLineEnd, offsetLineSide, updateOffsetReferenceOverlay]);

  return {
    updateOffsetReferenceOverlay,
    updateOffsetLinePathOverlay,
    updateOffsetTrailOverlay,
    updateOffsetLineOverlays,
  };
}
