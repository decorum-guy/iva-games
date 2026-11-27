import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import App from "./App";
import "./styles.css";

const TerritorialPractice = lazy(() => import("./TerritorialDistrict").then(module => ({ default: module.TerritorialPractice })));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/district-training" ? <Suspense fallback={<span className="spinner" />}><TerritorialPractice /></Suspense> : <App />}
  </React.StrictMode>,
);
