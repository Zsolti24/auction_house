import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Slide, ToastContainer } from "react-toastify";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <ToastContainer position="top-center" autoClose={3500} transition={Slide} newestOnTop limit={4} theme="light" />
  </StrictMode>,
);
