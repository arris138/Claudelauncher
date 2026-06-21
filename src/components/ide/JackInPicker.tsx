import { useState, useMemo, useEffect } from "react";
import type { Project, GlobalSettings } from "../../types";
import { resolveSessionFlags } from "../../services/ide";

interface JackInPickerProps {
  projects: Project[];
  settings: GlobalSettings;
  onPick: (project: Project) => void;
  onClose: () => void;
}

export default function JackInPicker({
  projects,
  settings,
  onPick,
  onClose,
}: JackInPickerProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }, [projects, query]);

  return (
    <div className="ide-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ide-picker">
        <div className="hazbar" />
        <div className="picker-head">
          <h2>JACK IN</h2>
          <p>SELECT A PROJECT TO SPIN UP A NEW SESSION</p>
        </div>
        <div className="picker-search">
          <span className="k">/</span>
          <input
            autoFocus
            placeholder="filter projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="k" style={{ color: "#5b6068" }}>esc</span>
        </div>
        <div className="picker-list">
          {filtered.length === 0 ? (
            <div className="picker-empty">NO MATCHING PROJECTS</div>
          ) : (
            filtered.map((p) => {
              const flags = resolveSessionFlags(p, settings);
              const danger = flags.includes("--dangerously-skip-permissions");
              const model = (p.model ?? "").replace("claude-", "");
              return (
                <div key={p.id} className="pj" onClick={() => onPick(p)}>
                  <div className="swatch" style={{ background: p.color ?? "#c2632f" }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="info">
                    <div className="nm">{p.name}</div>
                    <div className="pt">{p.path}</div>
                  </div>
                  <div className="flags">
                    {danger && <span className="fl danger">skip-perms</span>}
                    {model && <span className="fl">{model}</span>}
                  </div>
                  <span className="go">JACK IN →</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
