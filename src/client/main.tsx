import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opnay/city-ds-react/styles.css";
import { App } from "./app.tsx";
import "./app.css";

const root = document.querySelector("#root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
