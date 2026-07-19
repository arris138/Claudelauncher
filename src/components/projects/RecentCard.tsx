import { Folder, Play } from "lucide-react";
import type { Project } from "../../types";
import { relativeTime } from "../../utils/dateFormat";
import { getAgent, DEFAULT_AGENT_ID } from "../../agents/registry";

interface RecentCardProps {
  project: Project;
  onLaunch: (project: Project) => void;
}

export default function RecentCard({ project, onLaunch }: RecentCardProps) {
  const agent = getAgent(project.agentId);
  const showAgentBadge = agent.id !== DEFAULT_AGENT_ID;

  return (
    <button
      onClick={() => onLaunch(project)}
      className="group flex-shrink-0 w-44 bg-gray-800 rounded-lg border border-gray-700 p-4 border-t-4
                 hover:border-amber-500/50 hover:bg-gray-750 transition-all duration-200
                 hover:shadow-lg hover:shadow-amber-500/5 cursor-pointer text-left"
      style={{ borderTopColor: project.color || undefined }}
    >
      <div className="flex items-center justify-between mb-2">
        <Folder size={18} style={{ color: project.color || undefined }} className="text-amber-400" />
        {showAgentBadge && (
          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
            {agent.label}
          </span>
        )}
        <Play
          size={14}
          className="text-gray-500 group-hover:text-amber-400 transition-colors"
        />
      </div>
      <div className="text-sm font-medium text-white truncate">
        {project.name}
      </div>
      <div className="text-xs text-gray-400 mt-1 truncate" title={project.path}>
        {project.path}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        {relativeTime(project.lastLaunchedAt)}
      </div>
    </button>
  );
}
