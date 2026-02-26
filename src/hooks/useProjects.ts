import { useState, useEffect, useCallback } from "react";
import type { Project, SortConfig, FlagOverrides } from "../types";
import { loadAppData, saveProjects } from "../services/store";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortConfig>({
    field: "lastLaunchedAt",
    direction: "desc",
  });

  useEffect(() => {
    loadAppData().then((data) => {
      setProjects(data.projects);
      setLoading(false);
    });
  }, []);

  const addProject = useCallback(
    async (name: string, path: string) => {
      const newProject: Project = {
        id: crypto.randomUUID(),
        name,
        path,
        flagOverrides: {},
        createdAt: new Date().toISOString(),
        lastLaunchedAt: null,
      };
      const updated = [...projects, newProject];
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

  const updateProjectSettings = useCallback(
    async (id: string, overrides: FlagOverrides, preLaunchCommand: string) => {
      const updated = projects.map((p) =>
        p.id === id
          ? {
              ...p,
              flagOverrides: overrides,
              preLaunchCommand: preLaunchCommand || undefined,
            }
          : p
      );
      setProjects(updated);
      await saveProjects(updated);
    },
    [projects]
  );

  const sortedProjects = [...projects].sort((a, b) => {
    const dir = sort.direction === "asc" ? 1 : -1;
    const aVal = a[sort.field] ?? "";
    const bVal = b[sort.field] ?? "";
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
    updateProjectSettings,
  };
}
