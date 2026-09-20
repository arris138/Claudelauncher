import { useState, useEffect, useCallback } from "react";
import type { Project, SortConfig, AgentId } from "../types";
import { loadAppData, saveProjects } from "../services/store";
import { deleteProjectSecret } from "../services/secrets";
import { randomColor } from "../utils/colors";
import { getAgent, DEFAULT_AGENT_ID } from "../agents/registry";

export interface NewProjectInput {
  name: string;
  path: string;
  agentId?: AgentId;
  flagOverrides?: Record<string, boolean>;
  color?: string;
  model?: string;
  modelContextWindow?: number;
  effort?: string;
  /**
   * Plaintext API key to store for the new project, if its agent takes one.
   * Consumed immediately by the caller and written to the Windows Credential
   * Manager; never persisted to the project record.
   */
  apiKey?: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortConfig>({
    field: "lastLaunchedAt",
    direction: "desc",
  });

  useEffect(() => {
    loadAppData().then((data) => {
      // Backfill a random color for any project created before colors
      // existed, so every project is color-coded.
      const needsColor = data.projects.some((p) => !p.color);
      if (needsColor) {
        const colored = data.projects.map((p) =>
          p.color ? p : { ...p, color: randomColor() }
        );
        setProjects(colored);
        saveProjects(colored);
      } else {
        setProjects(data.projects);
      }
      setLoading(false);
    });
  }, []);

  const addProject = useCallback(
    async (input: NewProjectInput) => {
      const agentId = input.agentId ?? DEFAULT_AGENT_ID;
      const newProject: Project = {
        id: crypto.randomUUID(),
        name: input.name,
        path: input.path,
        agentId,
        flagOverrides: input.flagOverrides ?? {},
        createdAt: new Date().toISOString(),
        lastLaunchedAt: null,
        color: input.color ?? randomColor(),
        model: input.model ?? getAgent(agentId).defaultModel,
        modelContextWindow: input.modelContextWindow,
        effort: input.effort ?? getAgent(agentId).defaultEffort,
      };
      const updated = [newProject, ...projects];
      setProjects(updated);
      await saveProjects(updated);
      // Returned so the caller can key follow-up work (an API key written to
      // the Credential Manager) to the id this function just minted.
      return newProject;
    },
    [projects]
  );

  const removeProject = useCallback(
    async (id: string) => {
      const updated = projects.filter((p) => p.id !== id);
      setProjects(updated);
      await saveProjects(updated);
      // Otherwise the key outlives the project that justified it, and a later
      // project reusing the id (it won't, they're uuids) or a curious look
      // through `cmdkey /list` finds an orphan nobody meant to keep. Failure
      // is not worth surfacing: the project is already gone.
      await deleteProjectSecret(id).catch(() => {});
    },
    [projects]
  );

  const updateLastLaunched = useCallback(
    async (id: string) => {
      const updated = projects.map((p) =>
        p.id === id ? { ...p, lastLaunchedAt: new Date().toISOString() } : p
      );
      setProjects(updated);
      await saveProjects(updated);
    },
    [projects]
  );

  const updateProject = useCallback(
    async (
      id: string,
      changes: Partial<Omit<Project, "id" | "createdAt" | "lastLaunchedAt">>
    ) => {
      const updated = projects.map((p) =>
        p.id === id ? { ...p, ...changes } : p
      );
      setProjects(updated);
      await saveProjects(updated);
    },
    [projects]
  );

  const sortedProjects = [...projects].sort((a, b) => {
    const dir = sort.direction === "asc" ? 1 : -1;
    const aVal = a[sort.field];
    const bVal = b[sort.field];
    // Null values (e.g. never-launched projects) always sort to the top
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return -1;
    if (bVal == null) return 1;
    return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
  });

  const recentProjects = [...projects]
    .filter((p) => p.lastLaunchedAt !== null)
    .sort((a, b) =>
      (b.lastLaunchedAt ?? "").localeCompare(a.lastLaunchedAt ?? "")
    )
    .slice(0, 3);

  return {
    projects: sortedProjects,
    recentProjects,
    loading,
    sort,
    setSort,
    addProject,
    removeProject,
    updateLastLaunched,
    updateProject,
  };
}
