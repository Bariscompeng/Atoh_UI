import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ROSProvider } from "./context/ROSContext";
import TopNav from "./components/TopNav";
import TeleopPage from "./pages/TeleopPage";
import MapPage from "./pages/MapPage";
import HumanSnapshots from "./pages/HumanSnapshots";
import CoveragePage from "./pages/CoveragePage";
import HealthPage from "./pages/HealthPage";
import PiezoPage from "./pages/PiezoPage";
import TerminalPage from "./pages/TerminalPage";
import TaskManagerPage from "./pages/TaskManagerPage";
import Nav2ParamsPage from "./pages/Nav2ParamsPage";
export default function App() {
  return (
    <BrowserRouter>
      <ROSProvider>
        <div className="app-container">
          <TopNav />
          <Routes>
            <Route path="/" element={<TeleopPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/human-snapshots" element={<HumanSnapshots />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/piezo" element={<PiezoPage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/tasks" element={<TaskManagerPage />} />
            <Route path="/nav2-params" element={<Nav2ParamsPage />} />
          </Routes>
        </div>
      </ROSProvider>
    </BrowserRouter>
  );
}
