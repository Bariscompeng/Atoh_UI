import { useEffect } from "react";
import L from "leaflet";

export default function useNoGoMapLayers({
  mapRef,
  noGoLayerRefs,
  draftNoGoPoints,
  noGoMasterEnabled,
  noGoZones,
  selectedNoGoVertexIndex,
  selectedNoGoZoneId,
  suppressMapClicksFor,
  updateNoGoZonePoints,
  currentGpsLatLng,
  noGoDebugZones,
  robotPoseInfo,
  showNoGoKeepoutBuffer,
  robotLatLonRef,
  robotPoseRef,
  projectionHeadingOffsetRadRef,
  toNum,
  projectMapXYToLatLng,
  normalizeGpsPoint,
  noGoVertexIcon,
  noGoEdgeIcon,
  setDraftNoGoPoints,
  setNoGoPanelOpen,
  setSelectedNoGoZoneId,
  setSelectedNoGoVertexIndex,
}) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    noGoLayerRefs.current.keepouts.forEach(layer => layer.remove());
    noGoLayerRefs.current.keepouts = [];

    if (!noGoMasterEnabled || !showNoGoKeepoutBuffer) return;

    noGoDebugZones.forEach(zone => {
      const geoPoints = Array.isArray(zone?.keepout_points_geo) ? zone.keepout_points_geo : [];
      const keepoutLatLngs = geoPoints.length > 0
        ? geoPoints
          .map(point => {
            const lat = toNum(point?.latitude ?? point?.lat);
            const lng = toNum(point?.longitude ?? point?.lon ?? point?.lng);
            if (lat === null || lng === null) return null;
            return [lat, lng];
          })
          .filter(Boolean)
        : (Array.isArray(zone?.keepout_points_map) ? zone.keepout_points_map : [])
          .map(point => {
            const x = toNum(point?.x ?? point?.map_x);
            const y = toNum(point?.y ?? point?.map_y);
            if (x === null || y === null) return null;
            const latLng = projectMapXYToLatLng(
              x,
              y,
              robotLatLonRef.current,
              robotPoseRef.current,
              projectionHeadingOffsetRadRef.current
            );
            return latLng ? [latLng.lat, latLng.lng] : null;
          })
          .filter(Boolean);

      if (keepoutLatLngs.length < 3) return;

      const keepout = L.polygon(keepoutLatLngs, {
        color: "#f59e0b",
        weight: 2,
        opacity: 0.95,
        dashArray: "8 6",
        fillColor: "#f59e0b",
        fillOpacity: 0.08,
        lineJoin: "round",
        interactive: false,
        bubblingMouseEvents: false
      }).addTo(map);

      noGoLayerRefs.current.keepouts.push(keepout);
    });
  }, [
    mapRef,
    noGoLayerRefs,
    noGoMasterEnabled,
    showNoGoKeepoutBuffer,
    noGoDebugZones,
    currentGpsLatLng,
    robotPoseInfo,
    robotLatLonRef,
    robotPoseRef,
    projectionHeadingOffsetRadRef,
    toNum,
    projectMapXYToLatLng,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(noGoLayerRefs.current.polygons).forEach(layer => layer.remove());
    noGoLayerRefs.current.polygons = {};
    noGoLayerRefs.current.vertices.forEach(marker => marker.remove());
    noGoLayerRefs.current.vertices = [];
    noGoLayerRefs.current.edges.forEach(marker => marker.remove());
    noGoLayerRefs.current.edges = [];
    noGoLayerRefs.current.draftVertices.forEach(marker => marker.remove());
    noGoLayerRefs.current.draftVertices = [];
    noGoLayerRefs.current.draft?.remove();
    noGoLayerRefs.current.draft = null;

    if (draftNoGoPoints.length > 0) {
      const draftLatLngs = draftNoGoPoints.map(point => [point.lat, point.lng]);
      const draftLayer = L.polyline(draftNoGoPoints.length >= 3 ? [...draftLatLngs, draftLatLngs[0]] : draftLatLngs, {
        color: "#f87171",
        weight: 3,
        opacity: 0.95,
        dashArray: "7 5",
        fill: draftNoGoPoints.length >= 3,
        fillColor: "#ef4444",
        fillOpacity: 0.14,
        interactive: false,
        bubblingMouseEvents: false
      }).addTo(map);
      noGoLayerRefs.current.draft = draftLayer;

      draftNoGoPoints.forEach((point, index) => {
        const marker = L.marker([point.lat, point.lng], {
          icon: noGoVertexIcon(index + 1, false),
          draggable: true,
          keyboard: false,
          bubblingMouseEvents: false,
          riseOnHover: true
        }).addTo(map);

        marker.on("click", e => {
          L.DomEvent.stopPropagation(e);
          setNoGoPanelOpen(true);
        });
        marker.on("dragstart", () => {
          suppressMapClicksFor();
        });
        marker.on("dragend", e => {
          suppressMapClicksFor();
          const latlng = e.target.getLatLng();
          setDraftNoGoPoints(prev => prev.map((draftPoint, pointIndex) => (
            pointIndex === index ? { ...draftPoint, lat: latlng.lat, lng: latlng.lng } : draftPoint
          )));
        });

        noGoLayerRefs.current.draftVertices.push(marker);
      });
    }

    if (!noGoMasterEnabled) return;

    noGoZones.forEach(zone => {
      const points = (zone.coordinates || []).map(normalizeGpsPoint).filter(Boolean);
      if (points.length < 3) return;

      const isSelected = zone.id === selectedNoGoZoneId;
      const enabled = zone.enabled !== false;
      const polygon = L.polygon(points.map(point => [point.lat, point.lng]), {
        color: isSelected ? "#7f1d1d" : "#ef4444",
        weight: isSelected ? 4 : 3,
        opacity: enabled ? 0.95 : 0.45,
        fillColor: isSelected ? "#7f1d1d" : "#ef4444",
        fillOpacity: isSelected ? (enabled ? 0.44 : 0.16) : (enabled ? 0.28 : 0.09),
        lineJoin: "round",
        interactive: true,
        bubblingMouseEvents: false
      }).addTo(map);

      polygon.on("click", e => {
        L.DomEvent.stopPropagation(e);
        setSelectedNoGoZoneId(zone.id);
        setSelectedNoGoVertexIndex(null);
        setNoGoPanelOpen(true);
      });

      noGoLayerRefs.current.polygons[zone.id] = polygon;

      if (!isSelected) return;

      points.forEach((point, index) => {
        const marker = L.marker([point.lat, point.lng], {
          icon: noGoVertexIcon(index + 1, selectedNoGoVertexIndex === index),
          draggable: true,
          keyboard: false,
          bubblingMouseEvents: false,
          riseOnHover: true
        }).addTo(map);

        marker.on("click", e => {
          L.DomEvent.stopPropagation(e);
          setSelectedNoGoVertexIndex(index);
          setNoGoPanelOpen(true);
        });
        marker.on("dragstart", () => {
          suppressMapClicksFor();
        });
        marker.on("dragend", e => {
          suppressMapClicksFor();
          const latlng = e.target.getLatLng();
          const nextPoints = [...points];
          nextPoints[index] = { lat: latlng.lat, lng: latlng.lng };
          updateNoGoZonePoints(zone.id, nextPoints);
        });

        noGoLayerRefs.current.vertices.push(marker);

        const next = points[(index + 1) % points.length];
        const mid = {
          lat: (point.lat + next.lat) / 2,
          lng: (point.lng + next.lng) / 2
        };
        const edgeMarker = L.marker([mid.lat, mid.lng], {
          icon: noGoEdgeIcon(),
          keyboard: false,
          bubblingMouseEvents: false,
          riseOnHover: true
        }).addTo(map);

        edgeMarker.on("click", e => {
          L.DomEvent.stopPropagation(e);
          const nextPoints = [...points];
          nextPoints.splice(index + 1, 0, mid);
          if (updateNoGoZonePoints(zone.id, nextPoints)) {
            setSelectedNoGoVertexIndex(index + 1);
          }
        });

        noGoLayerRefs.current.edges.push(edgeMarker);
      });
    });
  }, [
    mapRef,
    noGoLayerRefs,
    draftNoGoPoints,
    noGoMasterEnabled,
    noGoZones,
    selectedNoGoVertexIndex,
    selectedNoGoZoneId,
    suppressMapClicksFor,
    updateNoGoZonePoints,
    normalizeGpsPoint,
    noGoVertexIcon,
    noGoEdgeIcon,
    setDraftNoGoPoints,
    setNoGoPanelOpen,
    setSelectedNoGoZoneId,
    setSelectedNoGoVertexIndex,
  ]);
}
