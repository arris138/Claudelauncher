import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// NOTE: StrictMode intentionally omitted. Its dev-only double-invocation of
// effects mounts → unmounts → remounts components, which spawns an embedded PTY
// and then immediately kills it (IDE Mode sessions died with exit code 1 in dev
// only; production builds don't double-invoke). Removing it makes dev match prod
// and keeps the PTY lifecycle deterministic.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
