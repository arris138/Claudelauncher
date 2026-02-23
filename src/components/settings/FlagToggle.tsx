interface FlagToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

export default function FlagToggle({
  label,
  description,
  enabled,
  onToggle,
}: FlagToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 mr-4">
        <div className="text-sm text-white font-mono">{label}</div>
        <div className="text-xs text-gray-400">{description}</div>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? "bg-amber-500" : "bg-gray-600"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
