import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw } from "lucide-react";
import {
  readDirEntries,
  gitStatus,
  gitDiff,
  type DirEntryInfo,
  type GitStatusEntry,
} from "../../services/ide";

interface FilesDrawerProps {
  cwd: string;
  onClose: () => void;
}

type StatusMap = Record<string, "M" | "A" | "D">;

export default function FilesDrawer({ cwd, onClose }: FilesDrawerProps) {
  const [statusMap, setStatusMap] = useState<StatusMap>({});
  const [changeCount, setChangeCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);

  const refreshStatus = useCallback(() => {
    gitStatus(cwd)
      .then((entries: GitStatusEntry[]) => {
        const map: StatusMap = {};
        for (const e of entries) map[e.path] = e.status;
        setStatusMap(map);
        setChangeCount(entries.length);
      })
      .catch(() => {
        setStatusMap({});
        setChangeCount(0);
      });
  }, [cwd]);

  useEffect(() => {
    refreshStatus();
    setSelected(null);
    setDiff("");
  }, [refreshStatus, reloadKey]);

  const openDiff = (rel: string) => {
    setSelected(rel);
    gitDiff(cwd, rel)
      .then(setDiff)
      .catch((e) => setDiff(`(error: ${String(e)})`));
  };

  return (
    <div className="files">
      <div className="files-head">
        <h3>WORKING TREE</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="x"
            title="Refresh"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={13} />
          </button>
          <button className="x" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="ftree" key={reloadKey}>
        <Node
          absPath={cwd}
          rel=""
          depth={0}
          statusMap={statusMap}
          selected={selected}
          onOpen={openDiff}
        />
      </div>

      <div className="files-foot">
        <span style={{ color: changeCount ? "var(--tape)" : "var(--ink-faint)" }}>
          {changeCount} changed
        </span>
        <span>read-only</span>
      </div>

      {selected && (
        <div className="diff">
          {diff.split("\n").map((line, i) => {
            const cls = line.startsWith("+")
              ? "add"
              : line.startsWith("-")
              ? "del"
              : line.startsWith("@@")
              ? "hunk"
              : line.startsWith("diff") || line.startsWith("index")
              ? "dim"
              : "";
            return (
              <div key={i} className={cls}>
                {line || " "}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface NodeProps {
  absPath: string;
  rel: string;
  depth: number;
  statusMap: StatusMap;
  selected: string | null;
  onOpen: (rel: string) => void;
}

function Node({ absPath, rel, depth, statusMap, selected, onOpen }: NodeProps) {
  const [entries, setEntries] = useState<DirEntryInfo[] | null>(null);

  useEffect(() => {
    readDirEntries(absPath)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [absPath]);

  const children = entries ?? [];

  return (
    <>
      {children.map((entry) => {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const childAbs = `${absPath}\\${entry.name}`;
        if (entry.isDir) {
          return (
            <DirNode
              key={childRel}
              name={entry.name}
              absPath={childAbs}
              rel={childRel}
              depth={depth}
              statusMap={statusMap}
              selected={selected}
              onOpen={onOpen}
            />
          );
        }
        const status = statusMap[childRel];
        return (
          <div
            key={childRel}
            className={`frow${selected === childRel ? " sel" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onOpen(childRel)}
          >
            {entry.name}
            {status && <span className={`badge ${status.toLowerCase()}`}>{status}</span>}
          </div>
        );
      })}
    </>
  );
}

function DirNode(props: NodeProps & { name: string }) {
  const { name, absPath, rel, depth, statusMap, selected, onOpen } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="frow dir"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} {name}
      </div>
      {open && (
        <Node
          absPath={absPath}
          rel={rel}
          depth={depth + 1}
          statusMap={statusMap}
          selected={selected}
          onOpen={onOpen}
        />
      )}
    </>
  );
}
