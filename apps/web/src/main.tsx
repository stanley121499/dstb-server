import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { getRequiredEnv } from "./config/env";

import "./styles.css";

/**
 * Application entrypoint.
 *
 * We eagerly validate required environment variables so misconfiguration fails fast
 * (especially useful on Vercel/local dev).
 */
getRequiredEnv();

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("Root element #root was not found in index.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);




