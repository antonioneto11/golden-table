import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppState } from "../shared/types";
import { api } from "./api";
import { App } from "./App";
import { StoreProvider } from "./store";
import "./styles.css";

function Boot() {
  const [loaded, setLoaded] = useState<{ state: AppState; rev: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.load().then(setLoaded, (e: Error) => setError(e.message));
  }, []);
  if (error)
    return (
      <div className="banner" role="alert">
        Could not load data: {error}
      </div>
    );
  if (!loaded) return <p className="muted">Loading…</p>;
  return (
    <StoreProvider initial={loaded.state} rev={loaded.rev}>
      <App />
    </StoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
