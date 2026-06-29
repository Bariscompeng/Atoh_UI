import React from "react";

export default function OffsetTrackingMissionSection({
  showTrigger = true,
  showPanel = true,
  panelOpen,
  setPanelOpen,
  drawingEnabled,
  setDrawingEnabled,
  setNoGoDrawingEnabled,
  setCoverageDrawingEnabled,
  cancelOffsetLineTracking,
  isConnected,
  offsetLineRunState,
  offsetLineStart,
  offsetLineEnd,
  haversine,
  resetOffsetLineDraft,
  offsetLineDistanceCm,
  setOffsetLineDistanceCm,
  offsetLineSide,
  setOffsetLineSide,
  startOffsetLineTracking,
  offsetLineReady,
  offsetLinePathPointCount,
  offsetLineStatusInfo,
  offsetLineError,
}) {
  return (
    <>
      {showTrigger && (
        <>
          <button
            className="gmp-mp-btn"
            onClick={() => {
              setPanelOpen(true);
              setDrawingEnabled(true);
              setNoGoDrawingEnabled(false);
              setCoverageDrawingEnabled(false);
            }}
            style={{ background: panelOpen ? "#fb923c" : "#e7e7e7", color: panelOpen ? "#fff" : "#111" }}
          >
            OFFSET TAKİP
          </button>
          <button
            className="gmp-mp-btn"
            onClick={cancelOffsetLineTracking}
            disabled={!isConnected || !["RUNNING", "PLANNED"].includes(offsetLineRunState)}
            style={{ background: "#7f1d1d", color: "#fff" }}
          >
            OFFSET DURDUR
          </button>
        </>
      )}

      {showPanel && panelOpen && (
        <div className="gmp-coverage-modal-backdrop">
          <div
            className="gmp-coverage-modal gmp-offset-line-modal"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="gmp-coverage-head">
              <div>
                <div style={{ color: "#fdba74", fontWeight: 900, fontSize: 13 }}>Offset Çizgi Takibi</div>
                <div style={{ color: "#fed7aa", fontSize: 10, marginTop: 2 }}>
                  Haritaya tıklayarak referans çizginin 1. ve 2. noktasını seçin.
                </div>
              </div>
              <button
                type="button"
                className="gmp-coverage-btn"
                onClick={() => {
                  setPanelOpen(false);
                  setDrawingEnabled(false);
                }}
                style={{ minWidth: 32, padding: 0 }}
              >
                X
              </button>
            </div>

            <div className="gmp-coverage-body">
              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Referans Çizgi</div>
                <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 6 }}>
                  1. nokta: {offsetLineStart ? `${offsetLineStart.lat.toFixed(7)}, ${offsetLineStart.lng.toFixed(7)}` : "—"}<br />
                  2. nokta: {offsetLineEnd ? `${offsetLineEnd.lat.toFixed(7)}, ${offsetLineEnd.lng.toFixed(7)}` : "—"}<br />
                  {offsetLineStart && offsetLineEnd
                    ? `Uzunluk: ${haversine(offsetLineStart, offsetLineEnd).toFixed(2)} m`
                    : "Haritaya tıklayarak 2 nokta seçin."}
                </div>
                <button
                  type="button"
                  className="gmp-coverage-btn"
                  onClick={resetOffsetLineDraft}
                  style={{ width: "100%" }}
                >
                  Noktaları Sıfırla
                </button>
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Offset Mesafesi (cm)</div>
                <input
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  value={offsetLineDistanceCm}
                  onChange={e => setOffsetLineDistanceCm(Number(e.target.value) || 0)}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Takip Tarafı (1 → 2 yönüne göre)</div>
                <div className="gmp-coverage-row">
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => setOffsetLineSide("left")}
                    style={{
                      flex: 1,
                      background: offsetLineSide === "left" ? "#fb923c" : undefined,
                      color: offsetLineSide === "left" ? "#111" : undefined
                    }}
                  >
                    Sol
                  </button>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => setOffsetLineSide("right")}
                    style={{
                      flex: 1,
                      background: offsetLineSide === "right" ? "#fb923c" : undefined,
                      color: offsetLineSide === "right" ? "#111" : undefined
                    }}
                  >
                    Sağ
                  </button>
                </div>
              </div>

              <div className="gmp-coverage-section">
                <button
                  type="button"
                  className="gmp-coverage-btn"
                  onClick={startOffsetLineTracking}
                  disabled={!offsetLineReady || !offsetLineStart || !offsetLineEnd}
                  style={{ width: "100%", background: "#b9ff2f", color: "#111", fontWeight: 800 }}
                >
                  Takibi Başlat
                </button>
                {!offsetLineReady && (
                  <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 6 }}>
                    GPS fix / TF hazır değil — Görev Hazırlığı panelini kontrol edin.
                  </div>
                )}
              </div>

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Durum</div>
                <div style={{ fontSize: 11, color: "#cbd5e1" }}>
                  Çalışma durumu: <b>{offsetLineRunState}</b><br />
                  Offset path noktaları: {offsetLinePathPointCount}<br />
                  {offsetLineStatusInfo?.detail ? <>Son mesaj: {offsetLineStatusInfo.detail}<br /></> : null}
                  {offsetLineError ? <span style={{ color: "#fca5a5" }}>Hata: {offsetLineError}</span> : null}
                </div>
              </div>

              <div className="gmp-coverage-section">
                <div style={{ fontSize: 10, color: "#9ea0a8", lineHeight: 1.4 }}>
                  Sarı kesik çizgi: referans çizgi (1→2). Turuncu çizgi: aracın takip edeceği offset çizgisi.
                  Mavi çizgi: aracın gerçekte izlediği yol. Engel varsa Nav2 geçici olarak offsetten sapabilir,
                  engel geçince offset çizgisine geri döner.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
