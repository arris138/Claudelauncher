import { useEffect, useState } from "react";
import { KeyRound, Check, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { AgentDefinition } from "../../agents/types";
import { hasProjectSecret } from "../../services/secrets";

interface ApiKeyFieldProps {
  agent: AgentDefinition;
  /**
   * Project id, which doubles as the credential reference. Absent in the Add
   * dialog, where the id is minted on save — there can be no stored key yet,
   * so the field is always in entry mode.
   */
  projectId?: string;
  /**
   * The pending key, or "" for "leave whatever is stored alone". The dialog
   * owns it and writes it on save, so cancelling a dialog cannot leave a key
   * written behind.
   */
  value: string;
  onChange: (next: string) => void;
}

const INPUT_CLASS =
  "w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white " +
  "placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

/**
 * Per-project API key entry for agents that declare `secretEnvVar`.
 *
 * The field is never pre-filled, because the backend has no command that reads
 * a key back (see services/secrets.ts). It reports whether one is stored and
 * treats a blank field as "keep it", which means an accidental save cannot
 * silently wipe a working key. Clearing one is deliberate and separate.
 */
export default function ApiKeyField({ agent, projectId, value, onChange }: ApiKeyFieldProps) {
  const [stored, setStored] = useState<boolean | null>(null);

  useEffect(() => {
    if (!projectId) {
      setStored(false);
      return;
    }
    let cancelled = false;
    hasProjectSecret(projectId)
      .then((has) => !cancelled && setStored(has))
      // A credential store that won't answer is worth showing as unknown
      // rather than as "no key", which would invite the user to re-enter one
      // they already have.
      .catch(() => !cancelled && setStored(null));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const help = agent.secretHelp;
  if (!help) return null;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">
        {help.label}
      </label>

      {stored && value === "" ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400">
            <Check size={14} className="text-emerald-500 shrink-0" />
            <span>Key stored in Windows Credential Manager</span>
          </div>
          <button
            type="button"
            onClick={() => onChange(" ")}
            className="px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            Replace
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
            />
            <input
              type="password"
              value={value.trim()}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              placeholder={help.placeholder}
              className={INPUT_CLASS + " pl-9 font-mono"}
            />
          </div>
          {stored && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500 mt-1">
        {stored === null && <>Credential store unavailable. </>}
        Stored per project in the Windows Credential Manager, not in the
        launcher&apos;s settings file, and passed to the session as{" "}
        <span className="font-mono">{agent.secretEnvVar}</span>. It is never
        read back into this window.{" "}
        <button
          type="button"
          onClick={() => open(help.url).catch(() => {})}
          className="text-amber-500 hover:text-amber-400 underline"
        >
          Get a key
        </button>
      </p>

      {projectId && stored === false && value.trim() === "" && (
        <p className="text-xs text-amber-500/80 mt-1 flex items-center gap-1">
          <Loader2 size={11} className="shrink-0" />
          No key stored yet. Sessions will fail to authenticate until you add one.
        </p>
      )}
    </div>
  );
}
