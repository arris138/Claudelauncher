import { Play, Settings2, Trash2 } from "lucide-react";
import type { Project } from "../../types";
import { relativeTime, shortDate } from "../../utils/dateFormat";
import { useState } from "react";

interface ProjectRowProps {
  project: Project;
  onLaunch: (project: Project) => void;
  onEditFlags: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function ProjectRow({
  project,
  onLaunch,
  onEditFlags,
  onRemove,
}: ProjectRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors group">
      <td className="py-3 pr-4">
        <button
          onClick={() => onLaunch(project)}
          className="text-left w-full"
        >
          <div className="text-sm font-medium text-white group-hover:text-amber-400 transition-colors">
            {project.name}
          </div>
          <div
            className="text-xs text-gray-500 truncate max-w-xs"
            title={project.path}
          >
            {project.path}
          </div>
        </button>
      </td>
      <td className="py-3 pr-4 text-sm text-gray-400">
        {relativeTime(project.lastLaunchedAt)}
      </td>
      <td className="py-3 pr-4 text-sm text-gray-400">
        {shortDate(project.createdAt)}
      </td>
      <td className="py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onLaunch(project)}
            className="p-1.5 rounded text-gray-500 hover:text-green-400 hover:bg-gray-700 transition-colors"
            title="Launch"
          >
            <Play size={16} />
          </button>
          <button
            onClick={() => onEditFlags(project.id)}
            className="p-1.5 rounded text-gray-500 hover:text-amber-400 hover:bg-gray-700 transition-colors"
            title="Configure flags"
          >
            <Settings2 size={16} />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1 ml-1">
              <button
                onClick={() => {
                  onRemove(project.id);
                  setConfirmDelete(false);
                }}
                className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
              title="Remove"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
