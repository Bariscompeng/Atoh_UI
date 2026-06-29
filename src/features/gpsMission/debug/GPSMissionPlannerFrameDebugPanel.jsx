import React from "react";

export default function GPSMissionPlannerFrameDebugPanel({
  formatSignedDeg,
  rosUiHeadingDiffDeg,
  tfYawDeg,
  baseLinkCompassBearingDeg,
  showBaseLinkXAxisArrow,
  setShowBaseLinkXAxisArrow,
  rosHeadingBearingDeg,
  projectionHeadingOffsetDeg,
  projectedUiBearingDeg,
  showUiHeadingArrow,
  setShowUiHeadingArrow,
  uiHeadingBearingDeg,
  showRosMapXAxisArrow,
  setShowRosMapXAxisArrow,
  rosPlusXBearingDeg,
  showRosMapYAxisArrow,
  setShowRosMapYAxisArrow,
  rosPlusYBearingDeg,
  frameDebugSource,
}) {
  return (
    <div
      className="gmp-frame-debug-panel"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="gmp-frame-debug-panel__title">ROS Map Axis / Frame Debug</div>
      <div className="gmp-frame-debug-panel__grid">
        <span>base_link +X vs UI diff</span>
        <span>{formatSignedDeg(rosUiHeadingDiffDeg, 1)}</span>
        <span>TF yaw_deg</span>
        <span>{tfYawDeg !== null ? `${tfYawDeg.toFixed(1)}°` : "-"}</span>
        <span>raw TF compass</span>
        <span>{baseLinkCompassBearingDeg !== null ? `${baseLinkCompassBearingDeg.toFixed(1)}°` : "-"}</span>
        <span>
          <label className="gmp-frame-debug-panel__row-toggle" title="Mavi kalibre edilmiş base_link +X okunu göster/gizle">
            <input
              type="checkbox"
              checked={showBaseLinkXAxisArrow}
              onChange={e => setShowBaseLinkXAxisArrow(e.target.checked)}
            />
            <span>base_link +X</span>
          </label>
        </span>
        <span>{rosHeadingBearingDeg !== null ? `${rosHeadingBearingDeg.toFixed(1)}°` : "-"}</span>
        <span>Active map→screen offset</span>
        <span>{`${projectionHeadingOffsetDeg.toFixed(1)}°`}</span>
        <span>Projected base_link +X</span>
        <span>{projectedUiBearingDeg !== null ? `${projectedUiBearingDeg.toFixed(1)}°` : "-"}</span>
        <span>
          <label className="gmp-frame-debug-panel__row-toggle" title="Sarı UI/pusula heading okunu göster/gizle">
            <input
              type="checkbox"
              checked={showUiHeadingArrow}
              onChange={e => setShowUiHeadingArrow(e.target.checked)}
            />
            <span>UI heading</span>
          </label>
        </span>
        <span>{uiHeadingBearingDeg !== null ? `${uiHeadingBearingDeg.toFixed(1)}°` : "-"}</span>
        <span>
          <label className="gmp-frame-debug-panel__row-toggle" title="Kırmızı ROS map +X okunu göster/gizle">
            <input
              type="checkbox"
              checked={showRosMapXAxisArrow}
              onChange={e => setShowRosMapXAxisArrow(e.target.checked)}
            />
            <span>ROS +X</span>
          </label>
        </span>
        <span>{rosPlusXBearingDeg !== null ? `${rosPlusXBearingDeg.toFixed(1)}°` : "-"}</span>
        <span>
          <label className="gmp-frame-debug-panel__row-toggle" title="Yeşil ROS map +Y okunu göster/gizle">
            <input
              type="checkbox"
              checked={showRosMapYAxisArrow}
              onChange={e => setShowRosMapYAxisArrow(e.target.checked)}
            />
            <span>ROS +Y</span>
          </label>
        </span>
        <span>{rosPlusYBearingDeg !== null ? `${rosPlusYBearingDeg.toFixed(1)}°` : "-"}</span>
        <span>source</span>
        <span>{frameDebugSource}</span>
      </div>
    </div>
  );
}
