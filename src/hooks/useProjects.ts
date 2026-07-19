import { useState, useEffect, useCallback } from "react";
import type { Project, SortConfig, AgentId } from "../types";
import { loadAppData, saveProjects } from "../services/store";
import { randomColor } from "../utils/colors";
import { getAgent, DEFAULT_AGENT_ID } from "../agents/registry";

export interface NewProjectInput {
  name: string;
  path: string;
  agentId?: AgentId;
  flagOverrides?: Record<string, boolean>;
  color?: string;
  model?: string;
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
      };
      const updated = [newProject, ...projects];
      setProjects(updated);
      await saveProjects(updated);
    },
    [projects]
  );

  const removeProject = useCallback(
    async (id: string) => {
      const updated = projects.filter((p) => p.id !== id);
      setProjects(updated);
      await saveProjects(updated);
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
