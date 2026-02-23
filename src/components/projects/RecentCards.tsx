import type { Project } from "../../types";
import RecentCard from "./RecentCard";

interface RecentCardsProps {
  projects: Project[];
  onLaunch: (project: Project) => void;
}

export default function RecentCards({ projects, onLaunch }: RecentCardsProps) {
  if (projects.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Recent
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 recent-scroll">
        {projects.map((project) => (
          <RecentCard key={project.id} project={project} onLaunch={onLaunch} />
        ))}
      </div>
    </section>
  );
}
