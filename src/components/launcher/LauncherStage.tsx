import { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Folder,
  Play,
  Pencil,
  Trash2,
  ArrowDownUp,
} from "lucide-react";
import type { Project, SortConfig, SortField } from "../../types";
import { relativeTime, shortDate } from "../../utils/dateFormat";
import { getAgent, DEFAULT_AGENT_ID } from "../../agents/registry";

interface LauncherStageProps {
  projects: Project[];
  recentProjects: Project[];
  sort: SortConfig;
  /** projectId -> number of live IDE sessions, for the LIVE chips. */
  liveCounts: Record<string, number>;
  launchError: string | null;
  onSortChange: (sort: SortConfig) => void;
  /** Launch in a Windows Terminal tab (the classic launcher behaviour). */
  onLaunch: (project: Project) => void;
  /** Open the project as an IDE session in this window. */
  onJackIn: (project: Project) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDismissError: () => void;
}

function SortHeader({
  label,
  field,
  sort,
  onSortChange,
}: {
  label: string;
  field: SortField;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
}) {
  const on = sort.field === field;
  return (
    <button
      className={`sorth${on ? " on" : ""}`}
      onClick={() =>
        onSortChange({
          field,
          direction: on && sort.direction === "asc" ? "desc" : "asc",
        })
      }
    >
      {label}
      {on &&
        (sort.direction === "asc" ? (
          <ChevronUp size={12} />
        ) : (
          <ChevronDown size={12} />
        ))}
    </button>
  );
}

/** LIVE chip — a project with sessions running right now in the rail. */
function LiveChip({ count }: { count: number }) {
  return (
    <span className="live-chip" title={`${count} live session${count > 1 ? "s" : ""}`}>
      <span className="d" />
      {count > 1 ? `${count} live` : "live"}
    </span>
  );
}

function ProjectTableRow({
  project,
  live,
  onLaunch,
  onJackIn,
  onEdit,
  onRemove,
}: {
  project: Project;
  live: number;
  onLaunch: (p: Project) => void;
  onJackIn: (p: Project) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const agent = getAgent(project.agentId);

  return (
    <tr>
      <td className="nm">
        <span className="pname">
          <span
            className="pdot"
            style={{ background: project.color || "#6b7178" }}
          />
          <span className="txt">
            <span className="n">
              {project.name}
              {live > 0 && <LiveChip count={live} />}
            </span>
            <span className="p" title={project.path}>
              {project.path}
            </span>
          </span>
        </span>
      </td>
      <td className="agent">
        {/* Only badge non-default agents — tagging every row "Claude Code"
            would be noise for the common single-agent case. */}
        {agent.id !== DEFAULT_AGENT_ID && (
          <span className="agent-chip">{agent.label}</span>
        )}
      </td>
      <td className="cell-mono used">{relativeTime(project.lastLaunchedAt)}</td>
      <td className="cell-mono dim made">{shortDate(project.createdAt)}</td>
      <td className="act">
        <span className="rowacts">
          {confirmDelete ? (
            <span className="confirm-del">
              <button
                className="runbtn danger"
                onClick={() => {
                  onRemove(project.id);
                  setConfirmDelete(false);
                }}
              >
                Remove
              </button>
              <button className="runbtn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <>
              <button
                className="runbtn"
                onClick={() => onLaunch(project)}
                title="Launch in a Windows Terminal tab"
              >
                Terminal
              </button>
              <button
                className="runbtn jack"
                onClick={() => onJackIn(project)}
                title="Open as a session in this window"
              >
                Jack in
              </button>
              <button
                className="miniact"
                onClick={() => onEdit(project.id)}
                title="Edit project"
              >
                <Pencil size={13} />
              </button>
              <button
                className="miniact kill"
                onClick={() => setConfirmDelete(true)}
                title="Remove project"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

/**
 * The project board, rendered inside the shared IDE frame. Adding a project
 * lives in the top bar (so it's reachable from the terminal stage too), which
 * is why this stage bar only carries the sort control.
 */
export default function LauncherStage({
  projects,
  recentProjects,
  sort,
  liveCounts,
  launchError,
  onSortChange,
  onLaunch,
  onJackIn,
  onEdit,
  onRemove,
  onDismissError,
}: LauncherStageProps) {
  return (
    <section className="stage">
      <div className="stage-bar">
        <span className="name">PROJECTS</span>
        <span className="path">claude-launcher-data.json</span>
        <span className="spacer" />
        <button
          className="tbtn"
          onClick={() =>
            onSortChange({
              field: sort.field,
              direction: sort.direction === "asc" ? "desc" : "asc",
            })
          }
          title="Flip the sort direction"
        >
          <span className="g">
            <ArrowDownUp size={11} />
          </span>
          {sort.direction === "asc" ? "Ascending" : "Descending"}
        </button>
      </div>

      <div className="board">
        {launchError && (
          <div className="launch-error">
            <span>Launch failed: {launchError}</span>
            <button onClick={onDismissError}>Dismiss</button>
          </div>
        )}

        {recentProjects.length > 0 && (
          <>
            <div className="sec-head">
              <h3>Recent</h3>
              <span className="rule" />
              <span className="count">top {recentProjects.length} by last launch</span>
            </div>
            <div className="recents">
              {recentProjects.map((p) => {
                const live = liveCounts[p.id] ?? 0;
                return (
                  <button
                    key={p.id}
                    className="rcard brushed"
                    style={{ borderTopColor: p.color || undefined }}
                    onClick={() => onLaunch(p)}
                    title={`Launch ${p.name} in a terminal tab`}
                  >
                    <span className="top">
                      <span className="glyph">
                        <Folder size={14} style={{ color: p.color || undefined }} />
                      </span>
                      {live > 0 ? (
                        <LiveChip count={live} />
                      ) : (
                        <span className="glyph go">
                          <Play size={12} />
                        </span>
                      )}
                    </span>
                    <span className="nm">{p.name}</span>
                    <span className="pt" title={p.path}>
                      {p.path}
                    </span>
                    <span className="ago">{relativeTime(p.lastLaunchedAt)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="sec-head">
          <h3>Projects</h3>
          <span className="rule" />
          <span className="count">{projects.length} total</span>
        </div>

        {projects.length === 0 ? (
          <div className="board-empty">
            NO PROJECTS YET
            <br />
            Hit <b>+ PROJECT</b> in the top bar to add one.
          </div>
        ) : (
          <table className="projects">
            <thead>
              <tr>
                <th className="nm">
                  <SortHeader
                    label="Name"
                    field="name"
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                </th>
                <th className="agent">
                  <span className="sorth">Agent</span>
                </th>
                <th className="used">
                  <SortHeader
                    label="Last used"
                    field="lastLaunchedAt"
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                </th>
                <th className="made">
                  <SortHeader
                    label="Created"
                    field="createdAt"
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                </th>
                <th className="act">
                  <span className="sorth">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <ProjectTableRow
                  key={p.id}
                  project={p}
                  live={liveCounts[p.id] ?? 0}
                  onLaunch={onLaunch}
                  onJackIn={onJackIn}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
