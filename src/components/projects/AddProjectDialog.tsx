import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import Modal from "../shared/Modal";

interface AddProjectDialogProps {
  onAdd: (name: string, path: string, flagOverrides?: Record<string, boolean>) => void;
  onClose: () => void;
}

export default function AddProjectDialog({
  onAdd,
  onClose,
}: AddProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);

  async function handleBrowse() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const dir = selected as string;
      setPath(dir);
      if (!name) {
        const basename = dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
        setName(basename);
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    const overrides = skipPermissions
      ? { "--dangerously-skip-permissions": true }
      : undefined;
    onAdd(
      name.trim() || path.split(/[/\\]/).filter(Boolean).pop() || path,
      path.trim(),
      overrides
    );
    onClose();
  }

  return (
    <Modal title="Add Project" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                       placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Directory
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\Projects\my-project"
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                         placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <FolderOpen size={16} />
              Browse
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(e) => setSkipPermissions(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-amber-500
                       focus:ring-amber-500 focus:ring-offset-0 cursor-pointer accent-amber-500"
          />
          <span className="text-sm text-gray-300">Skip Permissions</span>
          <span className="text-xs text-gray-500">(use with caution)</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!path.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500
                       disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Add Project
          </button>
        </div>
      </form>
    </Modal>
  );
}
