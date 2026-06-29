import { useEffect } from "react";
import L from "leaflet";

export default function useCoverageMapLayers({
  mapRef,
  coveragePointMarkersRef,
  coveragePolygonRef,
  coverageSweepLineRef,
  coverageGeneratedMarkersRef,
  coveragePoints,
  coverageAnchor,
  coveragePathNodes,
  coverageRouteNodes,
  coverageIntermediateNodes,
  coverageWaitPoints,
  selectedCoverageNodeLabel,
  suppressMapClicksFor,
  coverageVertexIcon,
  coverageIntermediateIcon,
  setCoveragePoints,
  setSelectedCoverageNodeLabel,
  setCoveragePlannerOpen,
  constrainLatLngToPolygon,
  setCoveragePublishStatus,
  setCoverageNodeOverrides,
}) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    coveragePolygonRef.current?.remove();
    coveragePolygonRef.current = null;
    coverageSweepLineRef.current?.remove();
    coverageSweepLineRef.current = null;
    coverageGeneratedMarkersRef.current.forEach(marker => marker.remove());
    coverageGeneratedMarkersRef.current = [];
    coveragePointMarkersRef.current.forEach(marker => marker.remove());
    coveragePointMarkersRef.current = [];

    if (coveragePoints.length > 0) {
      const latLngs = coveragePoints.map(point => [point.lat, point.lng]);
      if (coveragePoints.length >= 3) {
        coveragePolygonRef.current = L.polygon(latLngs, {
          color: "#f97316",
          weight: 3,
          opacity: 0.9,
          fillColor: "#f97316",
          fillOpacity: 0.1,
          lineJoin: "round",
          interactive: false,
          bubblingMouseEvents: false
        }).addTo(map);
      } else {
        coveragePolygonRef.current = L.polyline(latLngs, {
          color: "#f97316",
          weight: 3,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
          bubblingMouseEvents: false
        }).addTo(map);
      }

      coveragePoints.forEach((point, index) => {
        const marker = L.marker([point.lat, point.lng], {
          icon: coverageVertexIcon(index + 1, index === 0),
          draggable: true,
          keyboard: false,
          riseOnHover: true,
          bubblingMouseEvents: false
        });
        marker.on("click", e => {
          L.DomEvent.stopPropagation(e);
          suppressMapClicksFor();
        });
        marker.on("dragstart", () => {
          suppressMapClicksFor();
        });
        marker.on("dragend", e => {
          suppressMapClicksFor();
          const ll = e.target.getLatLng();
          setCoveragePoints(prev => prev.map((p, i) => (
            i === index ? { lat: ll.lat, lng: ll.lng } : p
          )));
        });
        marker.addTo(map);
        coveragePointMarkersRef.current.push(marker);
      });
    }

    if (coveragePathNodes.length >= 2) {
      coverageSweepLineRef.current = L.polyline(
        coveragePathNodes.map(node => [node.lat, node.lng]),
        {
          color: "#38bdf8",
          weight: 3,
          opacity: 0.95,
          interactive: false,
          bubblingMouseEvents: false
        }
      ).addTo(map);
    } else if (coverageRouteNodes.length >= 2) {
      coverageSweepLineRef.current = L.polyline(
        coverageRouteNodes.map(node => [node.lat, node.lng]),
        {
          color: "#38bdf8",
          weight: 2,
          opacity: 0.55,
          dashArray: "6 6",
          interactive: false,
          bubblingMouseEvents: false
        }
      ).addTo(map);
    }

    coverageIntermediateNodes.forEach(node => {
      const isSelected = selectedCoverageNodeLabel === node.label;
      const hasWait = Boolean(coverageWaitPoints[node.label]);
      const marker = L.marker([node.lat, node.lng], {
        icon: coverageIntermediateIcon(node.label, { hasWait, isSelected }),
        keyboard: false,
        riseOnHover: true,
        draggable: false,
        interactive: false,
        bubblingMouseEvents: false
      }).addTo(map);

      coverageGeneratedMarkersRef.current.push(marker);
    });
  }, [
    mapRef,
    coveragePointMarkersRef,
    coveragePolygonRef,
    coverageSweepLineRef,
    coverageGeneratedMarkersRef,
    coveragePoints,
    coverageAnchor,
    coveragePathNodes,
    coverageRouteNodes,
    coverageIntermediateNodes,
    coverageWaitPoints,
    selectedCoverageNodeLabel,
    suppressMapClicksFor,
    coverageVertexIcon,
    coverageIntermediateIcon,
    setCoveragePoints,
    setSelectedCoverageNodeLabel,
    setCoveragePlannerOpen,
    constrainLatLngToPolygon,
    setCoveragePublishStatus,
    setCoverageNodeOverrides,
  ]);
}
