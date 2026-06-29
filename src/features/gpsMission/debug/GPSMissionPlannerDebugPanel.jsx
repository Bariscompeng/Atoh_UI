import React from "react";
import CoverageDebugSection from "./CoverageDebugSection";
import NoGoDebugSection from "./NoGoDebugSection";
import OffsetDebugSection from "./OffsetDebugSection";

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

export default function GPSMissionPlannerDebugPanel(props) {
  const {
    fmtNum,
    fmtDeg,
    radToDeg,
    rosStampText,
    covarianceText,
    rawGpsInfo,
    rtkStatusText,
    GPS_DATUM,
    datumDistanceM,
    datumBearingDeg,
    robotPoseInfo,
    mapYawDeg,
    gpsOdomInfo,
    globalOdomInfo,
    gpsTfDx,
    gpsTfDy,
    gpsTfDistance,
    activeBaseLayer,
    orthoTilesLoaded,
    ORTHO_TILE_BASE,
    lastDebugPoint,
    gpsCoverageStatusInfo,
    gpsCoverageDebugInfo,
    gpsCoveragePathInfo,
    noGoDebugZones,
    NO_GO_DEBUG_TOPIC,
    showNoGoKeepoutBuffer,
    offsetLineRunState,
    offsetLineStatusInfo,
    offsetLinePathPointCount,
    offsetLineDebugInfo,
    offsetLineStart,
    offsetLineEnd,
    haversine,
    nav2GoalInfo,
    globalPlanInfo,
    localPlanInfo,
    centerOnRobot,
    setCenterOnRobot,
    publishUiState,
  } = props;

  return (
    <>
      <DebugSection title="Raw GPS">
        <DebugRow label="/fix latitude" value={fmtNum(rawGpsInfo?.latitude, 8)} />
        <DebugRow label="/fix longitude" value={fmtNum(rawGpsInfo?.longitude, 8)} />
        <DebugRow label="/fix status" value={rawGpsInfo ? `${rawGpsInfo.status ?? "-"} / service ${rawGpsInfo.service ?? "-"}` : "-"} />
        <DebugRow
          label="position_covariance"
          value={covarianceText(rawGpsInfo?.positionCovariance)}
          title={covarianceText(rawGpsInfo?.positionCovariance)}
        />
        <DebugRow label="RTK" value={rtkStatusText} />
        <DebugRow label="son mesaj" value={rosStampText(rawGpsInfo?.stamp, rawGpsInfo?.ts)} />
      </DebugSection>

      <DebugSection
        title="Datum"
        note="Datum reset noktası değildir; sadece GPS -> local XY dönüşüm referansıdır."
      >
        <DebugRow label="datum_lat" value={GPS_DATUM.lat.toFixed(7)} />
        <DebugRow label="datum_lon" value={GPS_DATUM.lng.toFixed(7)} />
        <DebugRow label="current_to_datum_distance_m" value={fmtNum(datumDistanceM, 3)} />
        <DebugRow label="current_to_datum_bearing_deg" value={datumBearingDeg !== null ? `${datumBearingDeg.toFixed(2)}°` : "-"} />
      </DebugSection>

      <DebugSection title="ROS TF Pose">
        <DebugRow label="TF map -> base x" value={fmtNum(robotPoseInfo?.x, 3)} />
        <DebugRow label="TF map -> base y" value={fmtNum(robotPoseInfo?.y, 3)} />
        <DebugRow label="TF map -> base yaw_deg" value={fmtDeg(mapYawDeg, 2)} />
        <DebugRow label="base frame" value={robotPoseInfo?.childFrame || "base_link/base_footprint bekleniyor"} />
      </DebugSection>

      <DebugSection title="GPS-Derived Odometry">
        <DebugRow label="/odometry/gps x" value={fmtNum(gpsOdomInfo?.x, 3)} />
        <DebugRow label="/odometry/gps y" value={fmtNum(gpsOdomInfo?.y, 3)} />
        <DebugRow label="frame_id" value={gpsOdomInfo?.frameId || "-"} />
        <DebugRow label="child_frame_id" value={gpsOdomInfo?.childFrameId || "-"} />
        <DebugRow label="son mesaj" value={rosStampText(gpsOdomInfo?.stamp, gpsOdomInfo?.ts)} />
      </DebugSection>

      <DebugSection title="Global EKF">
        <DebugRow label="/odom/global x" value={fmtNum(globalOdomInfo?.x, 3)} />
        <DebugRow label="/odom/global y" value={fmtNum(globalOdomInfo?.y, 3)} />
        <DebugRow label="/odom/global yaw_deg" value={globalOdomInfo ? fmtDeg(radToDeg(globalOdomInfo.yaw), 2) : "-"} />
        <DebugRow label="frame_id" value={globalOdomInfo?.frameId || "-"} />
        <DebugRow label="child_frame_id" value={globalOdomInfo?.childFrameId || "-"} />
        <DebugRow label="son mesaj" value={rosStampText(globalOdomInfo?.stamp, globalOdomInfo?.ts)} />
      </DebugSection>

      <DebugSection
        title="GPS vs TF Hata"
        note="Datum noktasında ve sabit robotta küçük olmalı; büyükse map->odom / navsat hizalaması sorunlu olabilir."
      >
        <DebugRow label="gps_vs_tf_dx" value={fmtNum(gpsTfDx, 3)} />
        <DebugRow label="gps_vs_tf_dy" value={fmtNum(gpsTfDy, 3)} />
        <DebugRow label="gps_vs_tf_distance_m" value={fmtNum(gpsTfDistance, 3)} />
      </DebugSection>

      <DebugSection title="Map Base Layer">
        <DebugRow label="active_base_layer" value={activeBaseLayer} />
        <DebugRow label="ortho_tiles_loaded" value={orthoTilesLoaded ? "true" : "false"} />
        <DebugRow label="ortho_tile_path" value={`${ORTHO_TILE_BASE}/{z}/{x}/{y}.png`} />
      </DebugSection>

      <DebugSection title="Waypoint Conversion Debug">
        <DebugRow label="latitude" value={fmtNum(lastDebugPoint?.latitude, 8)} />
        <DebugRow label="longitude" value={fmtNum(lastDebugPoint?.longitude, 8)} />
        <DebugRow label="altitude" value={fmtNum(lastDebugPoint?.altitude, 3)} />
        <DebugRow label="fromll_frame" value={lastDebugPoint?.fromllFrame || "-"} />
        <DebugRow label="map_x" value={fmtNum(lastDebugPoint?.mapX, 3)} />
        <DebugRow label="map_y" value={fmtNum(lastDebugPoint?.mapY, 3)} />
        <DebugRow label="map_z" value={fmtNum(lastDebugPoint?.mapZ, 3)} />
        <DebugRow label="goal_frame_id" value={lastDebugPoint?.goalFrameId || "-"} />
        <DebugRow label="mode" value={lastDebugPoint?.mode ? String(lastDebugPoint.mode).toUpperCase() : "-"} />
        <DebugRow label="yaw_source" value={lastDebugPoint?.yawSource || "-"} />
        <DebugRow label="yaw_deg" value={lastDebugPoint?.yaw !== null && lastDebugPoint?.yaw !== undefined ? fmtDeg(radToDeg(lastDebugPoint.yaw), 2) : "-"} />
      </DebugSection>

      <CoverageDebugSection
        rosStampText={rosStampText}
        gpsCoverageStatusInfo={gpsCoverageStatusInfo}
        gpsCoverageDebugInfo={gpsCoverageDebugInfo}
        gpsCoveragePathInfo={gpsCoveragePathInfo}
      />

      <NoGoDebugSection
        NO_GO_DEBUG_TOPIC={NO_GO_DEBUG_TOPIC}
        noGoDebugZones={noGoDebugZones}
        showNoGoKeepoutBuffer={showNoGoKeepoutBuffer}
      />

      <OffsetDebugSection
        rosStampText={rosStampText}
        offsetLineRunState={offsetLineRunState}
        offsetLineStatusInfo={offsetLineStatusInfo}
        offsetLinePathPointCount={offsetLinePathPointCount}
        offsetLineDebugInfo={offsetLineDebugInfo}
        offsetLineStart={offsetLineStart}
        offsetLineEnd={offsetLineEnd}
        haversine={haversine}
      />

      <DebugSection title="Nav2 Goal Marker">
        <DebugRow label="goal_pose x" value={fmtNum(nav2GoalInfo?.x, 3)} />
        <DebugRow label="goal_pose y" value={fmtNum(nav2GoalInfo?.y, 3)} />
        <DebugRow label="goal_pose frame" value={nav2GoalInfo?.frameId || "-"} />
        <DebugRow label="goal_pose yaw_deg" value={nav2GoalInfo ? fmtDeg(radToDeg(nav2GoalInfo.yaw), 2) : "-"} />
        <DebugRow label="son mesaj" value={rosStampText(nav2GoalInfo?.stamp, nav2GoalInfo?.ts)} />
      </DebugSection>

      <DebugSection title="Nav2 Path">
        <DebugRow label="/plan points" value={globalPlanInfo?.count ?? 0} />
        <DebugRow label="/plan frame" value={globalPlanInfo?.frameId || "-"} />
        <DebugRow label="/plan son mesaj" value={rosStampText(globalPlanInfo?.stamp, globalPlanInfo?.ts)} />
        <DebugRow label="/local_plan points" value={localPlanInfo?.count ?? 0} />
        <DebugRow label="/local_plan frame" value={localPlanInfo?.frameId || "-"} />
        <DebugRow label="/local_plan son mesaj" value={rosStampText(localPlanInfo?.stamp, localPlanInfo?.ts)} />
      </DebugSection>

    </>
  );
}
