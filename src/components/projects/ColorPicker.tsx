import { PROJECT_COLORS } from "../../utils/colors";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          aria-label={`Select color ${c}`}
          className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
            value.toLowerCase() === c.toLowerCase()
              ? "ring-2 ring-offset-2 ring-offset-gray-800 ring-white"
              : ""
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label
        className="relative w-6 h-6 rounded-full overflow-hidden cursor-pointer border border-gray-600"
        title="Custom color"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}
