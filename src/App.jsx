import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ROSProvider } from "./context/ROSContext";
import TopNav from "./components/TopNav";
import TeleopPage from "./pages/TeleopPage";
import MapPage from "./pages/MapPage";
import HumanSnapshots from "./pages/HumanSnapshots";
import HealthPage from "./pages/HealthPage";

export default function App() {
  return (
    <BrowserRouter>  {/* ? BrowserRouter EN DI? */}
      <ROSProvider>  {/* ? ROSProvider ?Ç?NDE */}
        <div className="app-container">
          <TopNav />
          <Routes>
            <Route path="/" element={<TeleopPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/human-snapshots" element={<HumanSnapshots />} />
            <Route path="/health" element={<HealthPage />} />
          </Routes>
        </div>
      </ROSProvider>
    </BrowserRouter>
  );
}
