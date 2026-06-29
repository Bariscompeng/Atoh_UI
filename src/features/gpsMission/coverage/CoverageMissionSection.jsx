import React from "react";
import { COVERAGE_STYLE_OPTIONS } from "./coveragePlanner";

export default function CoverageMissionSection({
  showTrigger = true,
  showPanel = true,
  plannerOpen,
  setPlannerOpen,
  drawingEnabled,
  setDrawingEnabled,
  setNoGoDrawingEnabled,
  setOffsetLineDrawingEnabled,
  isConnected,
  coveragePoints,
  setCoveragePoints,
  clearCoveragePlanner,
  coverageHasEditableState,
  coverageIntermediateNodes,
  coverageRouteLengthM,
  coverageHasActualPath,
  gpsCoveragePathInfo,
  coverageStyle,
  setCoverageStyle,
  coverageLineSpacing,
  setCoverageLineSpacing,
  coverageDiagonalAngle,
  setCoverageDiagonalAngle,
  coverageSweepAngle,
  setCoverageSweepAngle,
  coverageHeadingDeg,
  setCoverageHeadingDeg,
  coverageCurveStrength,
  setCoverageCurveStrength,
  coverageCircleDirection,
  setCoverageCircleDirection,
  coverageSpiralDirection,
  setCoverageSpiralDirection,
  coverageSpiralRotation,
  setCoverageSpiralRotation,
  coverageStartRadius,
  setCoverageStartRadius,
  coverageHeadlandPasses,
  setCoverageHeadlandPasses,
  coverageBoundaryDirection,
  setCoverageBoundaryDirection,
  coveragePointDensity,
  setCoveragePointDensity,
  coverageNavPoseSpacing,
  setCoverageNavPoseSpacing,
  coverageStartCorner,
  setCoverageStartCorner,
  coverageNodeOverrides,
  setCoverageNodeOverrides,
  coverageRemovedNodeLabels,
  setCoverageRemovedNodeLabels,
  coverageManualNodes,
  setCoverageManualNodes,
  setCoveragePublishStatus,
  setCoveragePublishError,
  coverageWaitPoints,
  setCoverageWaitPoints,
  selectedCoverageNodeLabel,
  setSelectedCoverageNodeLabel,
  addCoverageManualNodeAfter,
  removeCoverageManualNode,
  coveragePlannerTopic,
  setCoveragePlannerTopic,
  coverageTopicIsGps,
  publishGpsCoveragePolygon,
  canPublishCoveragePolygon,
  coveragePublishing,
  coveragePublishStatus,
  coveragePublishError,
  startGpsCoverage,
  cancelGpsCoverage,
  coverageCancelling,
  coverageStartStatus,
  coverageStartError,
  coverageCancelStatus,
  coverageCancelError,
  coverageStartService,
  coverageCancelService,
}) {
  const isDiagonal = coverageStyle === "diagonal";
  const isStraightAb = coverageStyle === "straight_ab";
  const isAPlus = coverageStyle === "a_plus_heading";
  const isCurvedAb = coverageStyle === "curved_ab";
  const isCirclePivot = coverageStyle === "circle_pivot";
  const isSpiral = coverageStyle === "spiral";
  const isBoundaryHeadland = coverageStyle === "boundary_headland";
  const isHeadlandTurn = coverageStyle === "headland_turn";
  const showLineSpacing = true;
  const showPointDensity = true;
  const showNavPoseSpacing = true;
  const showStartCorner = !isCirclePivot && !isSpiral && !isBoundaryHeadland && !isHeadlandTurn;
  const showSweepAngle = !isDiagonal && !isAPlus && !isStraightAb && !isCurvedAb && !isCirclePivot && !isSpiral && !isBoundaryHeadland && !isHeadlandTurn;

  return (
    <>
      {showTrigger && (
        <button
          className="gmp-mp-btn"
          onClick={() => {
            setPlannerOpen(true);
            setDrawingEnabled(true);
            setNoGoDrawingEnabled(false);
            setOffsetLineDrawingEnabled(false);
          }}
          style={{ background: plannerOpen ? "#60a5fa" : "#e7e7e7" }}
        >
          COVERAGE
        </button>
      )}

      {showPanel && plannerOpen && (
        <div className="gmp-coverage-modal-backdrop">
          <div
            className="gmp-coverage-modal"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="gmp-coverage-head">
              <div>
                <div style={{ color: "#f8fafc", fontWeight: 900, fontSize: 13 }}>GPS Coverage Polygon</div>
                <div style={{ color: "#8f929d", fontSize: 10, marginTop: 2 }}>
                  Polygon gönder: plan üretir. Coverage başlat: üretilen planı Nav2&apos;ye yollar.
                </div>
              </div>
              <button
                type="button"
                className="gmp-coverage-btn"
                onClick={() => {
                  setPlannerOpen(false);
                  setDrawingEnabled(false);
                }}
                style={{ minWidth: 32, padding: 0 }}
              >
                X
              </button>
            </div>

            <div className="gmp-coverage-body">
              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Çizim</div>
                <div className="gmp-coverage-row">
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => setDrawingEnabled(v => !v)}
                    disabled={!isConnected}
                    style={{
                      flex: 1,
                      borderColor: drawingEnabled ? "#22c55e" : "#555",
                      color: drawingEnabled ? "#86efac" : "#e7e7e7",
                    }}
                  >
                    {drawingEnabled ? "Nokta Ekleme Açık" : "Nokta Ekleme Kapalı"}
                  </button>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => setDrawingEnabled(false)}
                    disabled={coveragePoints.length < 3}
                  >
                    Alanı Kapat
                  </button>
                </div>
                <div className="gmp-coverage-row">
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => {
                      setCoveragePoints(prev => prev.slice(0, -1));
                      setCoverageNodeOverrides({});
                      setCoverageRemovedNodeLabels([]);
                      setCoverageManualNodes([]);
                      setSelectedCoverageNodeLabel(null);
                      setCoveragePublishStatus("");
                      setCoveragePublishError("");
                    }}
                    disabled={coveragePoints.length === 0}
                  >
                    Son Noktayı Sil
                  </button>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={clearCoveragePlanner}
                    disabled={!coverageHasEditableState}
                  >
                    Temizle
                  </button>
                </div>
                <div className="gmp-coverage-pill">
                  Köşe: {coveragePoints.length} · Durum: {coveragePoints.length >= 3 ? "alan hazır" : "en az 3 köşe gerekli"}
                  {coverageIntermediateNodes.length > 0 ? ` · ${coverageIntermediateNodes.length} tarama noktası` : ""}
                  {coverageRouteLengthM > 0 ? ` · ${coverageRouteLengthM.toFixed(1)} m` : ""}
                </div>
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Tarama Ayarları</div>
                <div className="gmp-coverage-grid">
                  <label>
                    <div className="gmp-coverage-label">Stil</div>
                    <select
                      className="gmp-coverage-field"
                      value={coverageStyle}
                      onChange={e => setCoverageStyle(e.target.value)}
                    >
                      {COVERAGE_STYLE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  {showLineSpacing && (
                    <label>
                      <div className="gmp-coverage-label">Hat Aralığı (m)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="0.1"
                        max="50"
                        step="0.1"
                        value={coverageLineSpacing}
                        onChange={e => setCoverageLineSpacing(Math.max(0.1, Number(e.target.value) || 0.1))}
                      />
                    </label>
                  )}
                  {isDiagonal ? (
                    <label>
                      <div className="gmp-coverage-label">Diagonal Açı (°)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="-180"
                        max="180"
                        step="1"
                        value={coverageDiagonalAngle}
                        onChange={e => setCoverageDiagonalAngle(Number(e.target.value) || 0)}
                      />
                    </label>
                  ) : showSweepAngle ? (
                    <label>
                      <div className="gmp-coverage-label">Sweep Açısı (°)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="-180"
                        max="180"
                        step="1"
                        value={coverageSweepAngle}
                        onChange={e => setCoverageSweepAngle(Number(e.target.value) || 0)}
                      />
                    </label>
                  ) : null}
                  {isAPlus && (
                    <label>
                      <div className="gmp-coverage-label">Heading (°)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="0"
                        max="360"
                        step="1"
                        value={coverageHeadingDeg}
                        onChange={e => setCoverageHeadingDeg(Number(e.target.value) || 0)}
                      />
                    </label>
                  )}
                  {isCurvedAb && (
                    <label>
                      <div className="gmp-coverage-label">Eğri Şiddeti (m)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="0"
                        max="20"
                        step="0.1"
                        value={coverageCurveStrength}
                        onChange={e => setCoverageCurveStrength(Math.max(0, Number(e.target.value) || 0))}
                      />
                    </label>
                  )}
                  {isCirclePivot && (
                    <label>
                      <div className="gmp-coverage-label">Dönüş Yönü</div>
                      <select
                        className="gmp-coverage-field"
                        value={coverageCircleDirection}
                        onChange={e => setCoverageCircleDirection(e.target.value)}
                      >
                        <option value="cw">Saat Yönü</option>
                        <option value="ccw">Saat Tersi</option>
                      </select>
                    </label>
                  )}
                  {isSpiral && (
                    <>
                      <label>
                        <div className="gmp-coverage-label">Spiral Yönü</div>
                        <select
                          className="gmp-coverage-field"
                          value={coverageSpiralDirection}
                          onChange={e => setCoverageSpiralDirection(e.target.value)}
                        >
                          <option value="outward">Merkezden Dışa</option>
                          <option value="inward">Dıştan Merkeze</option>
                        </select>
                      </label>
                      <label>
                        <div className="gmp-coverage-label">Dönüş</div>
                        <select
                          className="gmp-coverage-field"
                          value={coverageSpiralRotation}
                          onChange={e => setCoverageSpiralRotation(e.target.value)}
                        >
                          <option value="cw">Saat Yönü</option>
                          <option value="ccw">Saat Tersi</option>
                        </select>
                      </label>
                      <label>
                        <div className="gmp-coverage-label">Başlangıç Yarıçapı (m)</div>
                        <input
                          className="gmp-coverage-field"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={coverageStartRadius}
                          onChange={e => setCoverageStartRadius(Math.max(0, Number(e.target.value) || 0))}
                        />
                      </label>
                    </>
                  )}
                  {(isBoundaryHeadland || isHeadlandTurn) && (
                    <>
                      <label>
                        <div className="gmp-coverage-label">Headland Pass</div>
                        <input
                          className="gmp-coverage-field"
                          type="number"
                          min="1"
                          max="20"
                          step="1"
                          value={coverageHeadlandPasses}
                          onChange={e => setCoverageHeadlandPasses(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                        />
                      </label>
                      <label>
                        <div className="gmp-coverage-label">Sınır Yönü</div>
                        <select
                          className="gmp-coverage-field"
                          value={coverageBoundaryDirection}
                          onChange={e => setCoverageBoundaryDirection(e.target.value)}
                        >
                          <option value="cw">Saat Yönü</option>
                          <option value="ccw">Saat Tersi</option>
                        </select>
                      </label>
                    </>
                  )}
                  {showPointDensity && (
                    <label>
                      <div className="gmp-coverage-label">Nokta Yoğunluğu (m)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="0.1"
                        max="20"
                        step="0.1"
                        value={coveragePointDensity}
                        onChange={e => setCoveragePointDensity(Math.max(0.1, Number(e.target.value) || 0.1))}
                      />
                    </label>
                  )}
                  {showNavPoseSpacing && (
                    <label>
                      <div className="gmp-coverage-label">Nav Pose Aralığı (m)</div>
                      <input
                        className="gmp-coverage-field"
                        type="number"
                        min="1.2"
                        max="20"
                        step="0.1"
                        value={coverageNavPoseSpacing}
                        onChange={e => setCoverageNavPoseSpacing(Math.max(1.2, Number(e.target.value) || 1.2))}
                        title="Araç GPS hassasiyeti nedeniyle birbirine çok yakın hedeflerde sorun yaşamaması için en az 1.2 m bırakılır."
                      />
                    </label>
                  )}
                  {showStartCorner && (
                    <label>
                      <div className="gmp-coverage-label">Başlangıç Köşesi</div>
                      <select
                        className="gmp-coverage-field"
                        value={coverageStartCorner}
                        onChange={e => setCoverageStartCorner(Number(e.target.value))}
                      >
                        <option value={0}>0 (sol-alt)</option>
                        <option value={1}>1 (sağ-alt)</option>
                        <option value={2}>2 (sağ-üst)</option>
                        <option value={3}>3 (sol-üst)</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="gmp-coverage-pill">
                  {isStraightAb && "İlk iki köşe A-B referansı olarak alınır; paralel hatlar alan içinde üretilir."}
                  {isAPlus && "İlk köşe A kabul edilir; heading değerine göre paralel tarama hatları oluşturulur."}
                  {isCurvedAb && "A-B referansına göre eğrisel geçişler üretilir; eğri şiddeti arttıkça rota daha kıvrımlı olur."}
                  {isCirclePivot && "Polygon merkezi etrafında eş merkezli dairesel hatlar üretilir."}
                  {isSpiral && "Polygon merkezi etrafında spiral rota oluşturulur; yön ve dönüş seçenekleri etkilidir."}
                  {isBoundaryHeadland && "Sınırı çevreleyen çevrimler üretilir; headland pass sayısı içe doğru kaç kat dönüleceğini belirler."}
                  {isHeadlandTurn && "Önce headland çevrimleri, ardından iç kısım için sweep tabanlı rota üretilir."}
                  {!isStraightAb && !isAPlus && !isCurvedAb && !isCirclePivot && !isSpiral && !isBoundaryHeadland && !isHeadlandTurn && (
                    <>Bu ayarlar backend&apos;in zigzag/ladder/diagonal alan taraması ile aynı algoritmayı önizler.
                    Alanın içini daha sık tarasın istiyorsanız Hat Aralığı&apos;nı düşürün; araç hedefler arası
                    mesafeden sorun yaşamasın istiyorsanız Nav Pose Aralığı&apos;nı artırın - ikisi birbirinden
                    bağımsızdır.</>
                  )}
                </div>
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Noktalar</div>
                {coveragePoints.length === 0 ? (
                  <div className="gmp-coverage-pill">Haritaya tıklayarak alan köşelerini sırayla ekle (en az 3).</div>
                ) : (
                  coveragePoints.map((point, index) => (
                    <div className="gmp-coverage-point" key={`${point.lat}-${point.lng}-${index}`}>
                      <span style={{ color: index === 0 ? "#22c55e" : "#f97316", fontWeight: 900 }}>
                        {index + 1}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {point.lat.toFixed(7)}, {point.lng.toFixed(7)}
                      </span>
                      <button
                        type="button"
                        className="gmp-coverage-btn"
                        onClick={() => setCoveragePoints(prev => prev.filter((_, i) => i !== index))}
                        style={{ minWidth: 26, minHeight: 24, padding: 0 }}
                      >
                        X
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Takip Edilecek Path</div>
                <div className="gmp-coverage-pill">
                  {coverageHasActualPath
                    ? `Araç şu an backend'in /gps_coverage/path hattında ürettiği gerçek rotayı takip edecek. ${coverageIntermediateNodes.length} waypoint algılandı.`
                    : "Alanı planner'a gönderdikten sonra burada backend'in gerçekten ürettiği path ve waypointler görünecek. Köşeleri/stili değiştirince liste planner yanıtına göre güncellenir."}
                  {gpsCoveragePathInfo?.frameId ? ` · frame: ${gpsCoveragePathInfo.frameId}` : ""}
                </div>
                {!coverageHasActualPath ? (
                  <div className="gmp-coverage-pill">
                    Gerçek coverage path'i henüz gelmedi. Önizleme çizgisi haritada taslak olarak gösterilir; asıl takip edilecek rota planner `/gps_coverage/path` yayınladığında görünür.
                  </div>
                ) : (
                  coverageIntermediateNodes.map(node => (
                    <div
                      className="gmp-coverage-point"
                      key={node.label}
                      style={{ gridTemplateColumns: "44px minmax(0,1fr)" }}
                    >
                      <span style={{ color: "#60a5fa", fontWeight: 900 }}>{node.label}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {node.lat.toFixed(7)}, {node.lng.toFixed(7)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">1. Alanı Gönder: plan üret</div>
                <input
                  className="gmp-coverage-field"
                  value={coveragePlannerTopic}
                  onChange={e => setCoveragePlannerTopic(e.target.value)}
                  spellCheck={false}
                />
                {!coverageTopicIsGps && (
                  <div className="gmp-coverage-pill" style={{ color: "#fca5a5", borderColor: "#7f1d1d" }}>
                    GPSMission eski /coverage/* hattını kullanmaz. Topic /gps_coverage/* olmalı.
                  </div>
                )}
                <button
                  type="button"
                  className="gmp-coverage-btn"
                  onClick={publishGpsCoveragePolygon}
                  disabled={!canPublishCoveragePolygon || coveragePublishing}
                  style={{
                    minHeight: 34,
                    background: canPublishCoveragePolygon ? "#065f46" : "#202027",
                    borderColor: canPublishCoveragePolygon ? "#10b981" : "#555",
                    color: canPublishCoveragePolygon ? "#d1fae5" : "#8f929d",
                  }}
                >
                  {coveragePublishing ? "Gönderiliyor..." : "Alanı Gönder"}
                </button>
                {coveragePublishStatus && <div className="gmp-coverage-pill" style={{ color: "#86efac" }}>{coveragePublishStatus}</div>}
                {coveragePublishError && <div className="gmp-coverage-pill" style={{ color: "#fca5a5", borderColor: "#7f1d1d" }}>{coveragePublishError}</div>}
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">2. Coverage Başlat / İptal</div>
                <div className="gmp-coverage-row">
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={startGpsCoverage}
                    disabled={!isConnected}
                    style={{
                      flex: 1,
                      minHeight: 34,
                      background: isConnected ? "#1d4ed8" : "#202027",
                      borderColor: isConnected ? "#60a5fa" : "#555",
                      color: isConnected ? "#dbeafe" : "#8f929d",
                    }}
                  >
                    Coverage Başlat
                  </button>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={cancelGpsCoverage}
                    disabled={!isConnected || coverageCancelling}
                    style={{
                      flex: 1,
                      minHeight: 34,
                      background: isConnected ? "#7f1d1d" : "#202027",
                      borderColor: isConnected ? "#ef4444" : "#555",
                      color: isConnected ? "#fecaca" : "#8f929d",
                      fontWeight: 900,
                    }}
                  >
                    {coverageCancelling ? "İptal Ediliyor..." : "GÖREVİ İPTAL ET"}
                  </button>
                </div>
                <div className="gmp-coverage-pill">
                  Başlat: {coverageStartService} · İptal: {coverageCancelService}
                </div>
                {coverageStartStatus && <div className="gmp-coverage-pill" style={{ color: "#86efac" }}>{coverageStartStatus}</div>}
                {coverageStartError && <div className="gmp-coverage-pill" style={{ color: "#fca5a5", borderColor: "#7f1d1d" }}>{coverageStartError}</div>}
                {coverageCancelStatus && <div className="gmp-coverage-pill" style={{ color: "#fca5a5", borderColor: "#7f1d1d" }}>{coverageCancelStatus}</div>}
                {coverageCancelError && <div className="gmp-coverage-pill" style={{ color: "#fbbf24", borderColor: "#92400e" }}>{coverageCancelError}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
