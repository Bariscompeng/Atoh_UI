import React from "react";

export default function NoGoMissionSection({
  showTrigger = true,
  showPanel = true,
  panelOpen,
  setPanelOpen,
  drawingEnabled,
  setDrawingEnabled,
  setCoverageDrawingEnabled,
  setOffsetLineDrawingEnabled,
  draftNoGoPoints,
  setDraftNoGoPoints,
  pendingNoGoZone,
  setPendingNoGoZone,
  pendingNoGoName,
  setPendingNoGoName,
  draftNoGoGroupId,
  finishNoGoDraft,
  cancelNoGoDraft,
  noGoGroupCount,
  noGoZones,
  selectedNoGoZoneId,
  setSelectedNoGoZoneId,
  selectedNoGoZone,
  selectedNoGoVertexIndex,
  setSelectedNoGoVertexIndex,
  selectedNoGoPoints,
  setNoGoZones,
  noGoMasterEnabled,
  setNoGoMasterEnabled,
  showNoGoKeepoutBuffer,
  setShowNoGoKeepoutBuffer,
  noGoDebugZones,
  noGoEdgeAck,
  setNoGoEdgeAck,
  noGoPublishing,
  noGoPublishStatus,
  noGoPublishError,
  setNoGoPublishStatus,
  setNoGoPublishError,
  NO_GO_DEBUG_TOPIC,
  GPS_NO_GO_TOPIC,
  commitPendingNoGoZone,
  deleteDraftNoGoZone,
  updateNoGoZonePoints,
  removeSelectedNoGoVertex,
  deleteSelectedNoGoZone,
  publishNoGoZones,
  nowIso,
}) {
  return (
    <>
      {showTrigger && (
        <button
          className="gmp-mp-btn"
          onClick={() => {
            setPanelOpen(true);
            setDrawingEnabled(true);
            setCoverageDrawingEnabled(false);
            setOffsetLineDrawingEnabled(false);
          }}
          style={{ background: panelOpen ? "#ef4444" : "#e7e7e7", color: panelOpen ? "#fff" : "#111" }}
        >
          NO-GO
        </button>
      )}

      {showPanel && panelOpen && (
        <div className="gmp-coverage-modal-backdrop">
          <div
            className="gmp-coverage-modal gmp-no-go-modal"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="gmp-coverage-head">
              <div>
                <div style={{ color: "#fecaca", fontWeight: 900, fontSize: 13 }}>Yasak Bölge / No-Go Zone</div>
                <div style={{ color: "#fca5a5", fontSize: 10, marginTop: 2 }}>
                  Aktif bölgeler backend&apos;e GPS koordinatlarıyla gönderilir.
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
                <div className="gmp-coverage-label">Çizim</div>
                <button
                  type="button"
                  className="gmp-coverage-btn"
                  onClick={() => {
                    setDraftNoGoPoints([]);
                    setPendingNoGoZone(null);
                    setPendingNoGoName(`Grup ${draftNoGoGroupId} bölgesi`);
                    setDrawingEnabled(true);
                    setCoverageDrawingEnabled(false);
                    setNoGoPublishError("");
                    setNoGoPublishStatus(`Grup ${draftNoGoGroupId} için yeni yasak bölge çizmeye başlayın.`);
                  }}
                  style={{ width: "100%", marginBottom: 7, background: "#7f1d1d", borderColor: "#ef4444", color: "#fff" }}
                >
                  Yeni Yasak Bölge Ekle
                </button>
                <div className="gmp-coverage-row">
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => {
                      setDrawingEnabled(value => !value);
                      setCoverageDrawingEnabled(false);
                    }}
                    style={{
                      flex: 1,
                      borderColor: drawingEnabled ? "#ef4444" : "#555",
                      color: drawingEnabled ? "#fecaca" : "#e7e7e7",
                    }}
                  >
                    {drawingEnabled ? "No-Go Nokta Ekleme Açık" : "No-Go Nokta Ekleme Kapalı"}
                  </button>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={finishNoGoDraft}
                    disabled={draftNoGoPoints.length < 3}
                  >
                    Polygonu Bitir
                  </button>
                </div>
                <div className="gmp-coverage-row">
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => setDraftNoGoPoints(prev => prev.slice(0, -1))}
                    disabled={draftNoGoPoints.length === 0}
                  >
                    Son Noktayı Sil
                  </button>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={cancelNoGoDraft}
                    disabled={draftNoGoPoints.length === 0 && !drawingEnabled}
                  >
                    Çizimi İptal
                  </button>
                </div>
                <div className="gmp-coverage-pill">
                  Nokta: {draftNoGoPoints.length} · En az 3 farklı nokta gerekli. Kenarlar dahil tamamen yasak kabul edilir.
                </div>
              </div>

              {pendingNoGoZone && (
                <div className="gmp-coverage-section">
                  <div className="gmp-coverage-label">Yeni Bölge Onayı</div>
                  <input
                    className="gmp-coverage-field"
                    value={pendingNoGoName}
                    onChange={e => setPendingNoGoName(e.target.value)}
                    autoFocus
                  />
                  <div className="gmp-coverage-pill">
                    Grup: {draftNoGoGroupId} · Nokta: {pendingNoGoZone.points.length} · Alan: {(pendingNoGoZone.area || 0).toFixed(2)} m²
                    <br />
                    Bu bölgenin içi ve sınır çizgileri araç tarafından kullanılamaz kabul edilir.
                    {pendingNoGoZone.warnings.map(warning => (
                      <React.Fragment key={warning}>
                        <br />
                        Uyarı: {warning}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="gmp-coverage-row">
                    <button type="button" className="gmp-coverage-btn" onClick={() => setPendingNoGoZone(null)}>
                      İptal
                    </button>
                    <button
                      type="button"
                      className="gmp-coverage-btn"
                      onClick={commitPendingNoGoZone}
                      style={{ flex: 1, background: "#b91c1c", borderColor: "#ef4444", color: "#fff" }}
                    >
                      İsmi Kaydet
                    </button>
                  </div>
                </div>
              )}

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Bölgeler</div>
                <div className="gmp-coverage-pill" style={{ marginBottom: 8 }}>
                  Toplam grup: {noGoGroupCount} · Kayıtlı bölge: {noGoZones.length} · Taslak nokta: {draftNoGoPoints.length}
                </div>
                <div className="gmp-coverage-row" style={{ marginBottom: 8 }}>
                  <label className="gmp-coverage-pill" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={showNoGoKeepoutBuffer}
                      onChange={e => setShowNoGoKeepoutBuffer(e.target.checked)}
                    />
                    <span>
                      NAV Keepout Buffer
                      <span style={{ color: "#f59e0b", marginLeft: 6 }}>- - -</span>
                      <br />
                      <span style={{ color: "#aaa" }}>{NO_GO_DEBUG_TOPIC} · {noGoDebugZones.length} zone</span>
                    </span>
                  </label>
                </div>
                <div className="gmp-coverage-row" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="gmp-coverage-btn"
                    onClick={() => setNoGoMasterEnabled(value => !value)}
                    style={{
                      flex: 1,
                      background: noGoMasterEnabled ? "#2b1606" : "#065f46",
                      borderColor: noGoMasterEnabled ? "#f59e0b" : "#10b981",
                      color: "#fff"
                    }}
                  >
                    {noGoMasterEnabled ? "Tüm Bölgeleri Pasifleştir" : "Tüm Bölgeleri Yeniden Aktif Et"}
                  </button>
                </div>
                {draftNoGoPoints.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="gmp-coverage-btn"
                      onClick={deleteDraftNoGoZone}
                      style={{
                        width: "100%",
                        marginBottom: 8,
                        background: "#260b0b",
                        borderColor: "#ef4444",
                        color: "#fecaca"
                      }}
                    >
                      Tüm Seçili Bölgeyi Sil
                    </button>
                    <div className="gmp-coverage-pill" style={{ color: "#fecaca", borderColor: "#7f1d1d" }}>
                      Grup {draftNoGoGroupId} taslak noktaları haritada ve aşağıdaki listede gösterilir. Köşeleri sürükleyebilirsiniz.
                    </div>
                    {draftNoGoPoints.map((point, index) => (
                      <div className="gmp-coverage-point" key={`draft-no-go-${index}`}>
                        <span style={{ color: "#fca5a5", fontWeight: 900 }}>{index + 1}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {point.lat.toFixed(7)}, {point.lng.toFixed(7)}
                        </span>
                        <button
                          type="button"
                          className="gmp-coverage-btn"
                          onClick={() => setDraftNoGoPoints(prev => prev.filter((_, pointIndex) => pointIndex !== index))}
                          style={{ minWidth: 26, minHeight: 22, padding: 0 }}
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {noGoZones.length === 0 ? (
                  <div className="gmp-coverage-pill">Kayıtlı yasak bölge yok.</div>
                ) : (
                  noGoZones.map(zone => (
                    <button
                      key={zone.id}
                      type="button"
                      className={`gmp-no-go-zone-row ${zone.id === selectedNoGoZoneId ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedNoGoZoneId(zone.id);
                        setSelectedNoGoVertexIndex(null);
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: noGoMasterEnabled && zone.enabled !== false ? "#ef4444" : "#7f1d1d"
                        }}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        G{zone.groupId} · {zone.name}
                      </span>
                      <span style={{ color: "#fca5a5" }}>{(zone.coordinates || []).length}P</span>
                    </button>
                  ))
                )}
              </div>

              {selectedNoGoZone && (
                <div className="gmp-coverage-section">
                  <div className="gmp-coverage-label">Seçili Bölge</div>
                  <div className="gmp-coverage-pill">Grup {selectedNoGoZone.groupId}</div>
                  <div className="gmp-coverage-pill">
                    Keepout buffer istegi: {(Number.isFinite(selectedNoGoZone.bufferMeters) ? selectedNoGoZone.bufferMeters : 0).toFixed(2)} m
                  </div>
                  <input
                    className="gmp-coverage-field"
                    value={selectedNoGoZone.name}
                    onChange={e => {
                      const now = nowIso();
                      setNoGoZones(prev => prev.map(zone => (
                        zone.id === selectedNoGoZone.id
                          ? { ...zone, name: e.target.value, metadata: { ...(zone.metadata || {}), updated_at: now } }
                          : zone
                      )));
                    }}
                  />
                  <div className="gmp-coverage-row">
                    <label className="gmp-coverage-pill" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selectedNoGoZone.enabled !== false}
                        onChange={e => {
                          const now = nowIso();
                          setNoGoZones(prev => prev.map(zone => (
                            zone.id === selectedNoGoZone.id
                              ? { ...zone, enabled: e.target.checked, metadata: { ...(zone.metadata || {}), updated_at: now } }
                              : zone
                          )));
                        }}
                        style={{ accentColor: "#ef4444" }}
                      />
                      Aktif
                    </label>
                    <button
                      type="button"
                      className="gmp-coverage-btn"
                      onClick={removeSelectedNoGoVertex}
                      disabled={selectedNoGoVertexIndex === null || selectedNoGoPoints.length <= 3}
                    >
                      Köşe Sil
                    </button>
                    <button
                      type="button"
                      className="gmp-coverage-btn"
                      onClick={deleteSelectedNoGoZone}
                      disabled={noGoPublishing}
                      style={{ background: "#260b0b", borderColor: "#ef4444", color: "#fecaca" }}
                    >
                      Tüm Seçili Bölgeyi Sil
                    </button>
                  </div>
                  <div className="gmp-coverage-pill">
                    Köşe noktalarını haritada sürükleyin. Kenar ortasındaki kırmızı kareye tıklayarak yeni köşe ekleyin.
                  </div>
                  {selectedNoGoPoints.map((point, index) => (
                    <div className="gmp-coverage-point" key={`${selectedNoGoZone.id}-${index}`}>
                      <button
                        type="button"
                        className="gmp-coverage-btn"
                        onClick={() => setSelectedNoGoVertexIndex(index)}
                        style={{
                          minWidth: 24,
                          minHeight: 22,
                          padding: 0,
                          color: selectedNoGoVertexIndex === index ? "#fff" : "#fecaca",
                          borderColor: selectedNoGoVertexIndex === index ? "#ef4444" : "#555"
                        }}
                      >
                        {index + 1}
                      </button>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {point.lat.toFixed(7)}, {point.lng.toFixed(7)}
                      </span>
                      <button
                        type="button"
                        className="gmp-coverage-btn"
                        onClick={() => {
                          const nextPoints = selectedNoGoPoints.filter((_, pointIndex) => pointIndex !== index);
                          if (updateNoGoZonePoints(selectedNoGoZone.id, nextPoints)) {
                            setSelectedNoGoVertexIndex(null);
                          }
                        }}
                        disabled={selectedNoGoPoints.length <= 3}
                        style={{ minWidth: 26, minHeight: 22, padding: 0 }}
                      >
                        X
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="gmp-coverage-section">
                <div className="gmp-coverage-label">Kaydet / Uygula</div>
                <label className="gmp-coverage-pill" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={noGoEdgeAck}
                    onChange={e => setNoGoEdgeAck(e.target.checked)}
                    style={{ marginTop: 1, accentColor: "#ef4444" }}
                  />
                  <span>Aktif bölgelerin iç alanları ve tüm kenarları araç için yasak olarak backend&apos;e gönderilecek.</span>
                </label>
                <button
                  type="button"
                  className="gmp-coverage-btn"
                  onClick={publishNoGoZones}
                  disabled={!noGoEdgeAck || noGoPublishing}
                  style={{
                    minHeight: 34,
                    background: noGoEdgeAck ? "#b91c1c" : "#202027",
                    borderColor: noGoEdgeAck ? "#ef4444" : "#555",
                    color: noGoEdgeAck ? "#fff" : "#8f929d",
                  }}
                >
                  {noGoPublishing ? "Gönderiliyor..." : "Kaydet / Uygula"}
                </button>
                <div className="gmp-coverage-pill">Topic: {GPS_NO_GO_TOPIC}</div>
                <div className="gmp-coverage-pill">No-go zonelar `buffer=0 m` istegiyle publish edilir.</div>
                {noGoPublishStatus && <div className="gmp-coverage-pill" style={{ color: "#86efac" }}>{noGoPublishStatus}</div>}
                {noGoPublishError && <div className="gmp-coverage-pill" style={{ color: "#fca5a5", borderColor: "#ef4444" }}>{noGoPublishError}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
