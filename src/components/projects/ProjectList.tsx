import { ChevronUp, ChevronDown, Plus } from "lucide-react";
import type { Project, SortConfig, SortField } from "../../types";
import ProjectRow from "./ProjectRow";

interface ProjectListProps {
  projects: Project[];
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  onLaunch: (project: Project) => void;
  onEditFlags: (id: string) => void;
  onRemove: (id: string) => void;
  onAddProject: () => void;
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
  const isActive = sort.field === field;
  return (
    <button
      onClick={() =>
        onSortChange({
          field,
          direction:
            isActive && sort.direction === "asc" ? "desc" : "asc",
        })
      }
      className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-white transition-colors"
    >
      {label}
      {isActive ? (
        sort.direction === "asc" ? (
          <ChevronUp size={14} />
        ) : (
          <ChevronDown size={14} />
        )
      ) : (
        <ChevronUp size={14} className="opacity-0" />
      )}
    </button>
  );
}

export default function ProjectList({
  projects,
  sort,
  onSortChange,
  onLaunch,
  onEditFlags,
  onRemove,
  onAddProject,
}: ProjectListProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Projects
        </h2>
        <button
          onClick={onAddProject}
          className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
        >
          <Plus size={16} />
          Add Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">No projects yet.</p>
          <p className="text-xs mt-1">
            Click "Add Project" to get started.
          </p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 pr-4">
                <SortHeader
                  label="Name"
                  field="name"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              </th>
              <th className="text-left py-2 pr-4">
                <SortHeader
                  label="Last Used"
                  field="lastLaunchedAt"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              </th>
              <th className="text-left py-2 pr-4">
                <SortHeader
                  label="Created"
                  field="createdAt"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              </th>
              <th className="text-right py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onLaunch={onLaunch}
                onEditFlags={onEditFlags}
                onRemove={onRemove}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
