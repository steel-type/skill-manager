import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/wireframes.css";
import "./styles/global.css";

// Block window-level drag/drop and dragover so Chrome doesn't navigate to a
// dropped file's URL. Defense-in-depth atop the main-process will-navigate
// guard.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
