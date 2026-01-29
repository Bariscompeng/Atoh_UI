import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import TopNav from "./components/TopNav";
import TeleopPage from "./pages/TeleopPage";
import MapPage from "./pages/MapPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <TopNav />
        <Routes>
          <Route path="/" element={<TeleopPage />} />
          <Route path="/map" element={<MapPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
