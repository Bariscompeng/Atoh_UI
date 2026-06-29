import React from "react";
import { Link, useLocation } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Teleop" },
  { to: "/map", label: "Live Map" },
  { to: "/human-snapshots", label: "Human" },
  { to: "/health", label: "Health" },
  { to: "/coverage", label: "Coverage" },
  { to: "/piezo", label: "Piezo" },
  { to: "/tasks", label: "Task Manager" },
  { to: "/gps-mission", label: "GPS Mission" },
];

export default function TopNav() {
  const loc = useLocation();
  return (
    <nav className="nav-bar">
      {LINKS.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={"nav-link" + (loc.pathname === to ? " active" : "")}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
