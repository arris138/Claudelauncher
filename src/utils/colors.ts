// Project tab colors. Used for the Windows Terminal --tabColor option and
// for visually distinguishing projects in the UI.

// A curated palette of distinct, terminal-friendly hex colors.
export const PROJECT_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
] as const;

/** Returns true for a valid `#rrggbb` hex color string. */
export function isValidColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

/** Pick a random color from the palette. */
export function randomColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
}
