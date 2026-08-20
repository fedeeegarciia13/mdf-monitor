import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AppDesktop from "./AppDesktop.jsx";
import "./index.css";

const isDesktop = window.innerWidth >= 1024;
createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isDesktop ? <AppDesktop /> : <App />}
  </StrictMode>
);
