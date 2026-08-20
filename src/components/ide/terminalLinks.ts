import type { Terminal as XTerm, ILink, IDisposable } from "@xterm/xterm";
import { open } from "@tauri-apps/plugin-shell";

/**
 * Ctrl+click support for file paths and URLs in the IDE terminal.
 *
 * xterm renders everything as inert text unless a link provider claims a range,
 * and this app loaded only fit/webgl/unicode11 — so nothing was ever clickable.
 * This registers one provider that claims both URLs and file paths, decorates
 * them on hover, and opens them through Tauri's shell `open` (the
 * `shell:allow-open` permission is already granted in
 * src-tauri/capabilities/default.json).
 *
 * Ctrl (or Cmd) is REQUIRED to activate, matching VS Code and the browser: a
 * bare click must keep selecting text, which is what a terminal is mostly for.
 */

// http/https. Excludes quotes/brackets so trailing punctuation in prose does not
// get swallowed into the URL.
const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+/g;

// A file path. Deliberately requires at least ONE separator, so a bare word like
// `README` or `notes.md` is not claimed — that would linkify half of any English
// sentence. Accepts:
//   C:\a\b.txt   C:/a/b.txt   \\server\share   ./rel   ../rel   ~/rel
//   /c/Users/... (Git Bash)   LGS_Docs/impl/x.md   src/App.tsx:42:7
//
// A drive letter is matched only as a PREFIX and :line:col only as a SUFFIX, so
// `C:\a\b.cpp:42` parses correctly rather than the `C:` being read as a line.
//
// ⚠️ Every separator class here is `[\\/]` — BOTH slashes. An earlier revision
// shipped `[\/]` (forward slash only) after a shell heredoc ate one backslash;
// it typechecked clean, matched every forward-slash path in testing, and
// silently ignored every `C:\...` path on the platform this app targets. If you
// edit these regexes, edit them in the file, not through a shell.
const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|~[\\/]|\/)?(?:[\w.@+~%-]+[\\/])+[\w.@+~%-]+(?::\d+(?::\d+)?)?/g;

/** Trailing prose punctuation to shed. `:` is excluded — it may be a line number. */
const TRAILING_RE = /[.,;!?)\]}'"]+$/;

/** Split a trailing `:line` / `:line:col` off a path. */
export function splitLineSuffix(raw: string): { path: string; line?: number } {
  const m = raw.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (!m) return { path: raw };
  return { path: m[1], line: Number(m[2]) };
}

/**
 * Turn a terminal-printed path into something Windows can open.
 *
 * Relative paths resolve against the SESSION cwd rather than the project path,
 * so a worktree session resolves inside its own worktree.
 */
export function resolvePath(cwd: string, raw: string): string {
  let p = raw.trim();

  // Git Bash prints /c/Users/... — turn it back into a real Windows path.
  const gitBashDrive = p.match(/^\/([A-Za-z])\/(.*)$/);
  if (gitBashDrive) p = `${gitBashDrive[1].toUpperCase()}:/${gitBashDrive[2]}`;

  const isAbsolute =
    /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");

  if (!isAbsolute && cwd) p = `${cwd.replace(/[\\/]+$/, "")}/${p}`;

  return p.replace(/\//g, "\\");
}

/**
 * Rebuild the full logical line that `bufferLine` belongs to.
 *
 * Long paths WRAP, and a provider that reads one row would claim only the first
 * fragment and silently mis-map every column after the wrap. Rows are joined
 * untrimmed so each contributes exactly `cols` characters, which is what makes
 * the index→(x, y) arithmetic below valid.
 */
function readWrappedLine(
  term: XTerm,
  bufferLine: number,
): { text: string; startRow: number } | null {
  const buf = term.buffer.active;
  let startRow = bufferLine - 1; // provideLinks is 1-based; the buffer is 0-based
  if (startRow < 0 || startRow >= buf.length) return null;

  while (startRow > 0 && buf.getLine(startRow)?.isWrapped) startRow--;

  let text = "";
  for (let row = startRow; row < buf.length; row++) {
    const line = buf.getLine(row);
    if (!line) break;
    if (row > startRow && !line.isWrapped) break;
    text += line.translateToString(false);
  }
  return { text, startRow };
}

export function registerTerminalLinks(
  term: XTerm,
  getCwd: () => string,
): IDisposable {
  return term.registerLinkProvider({
    provideLinks(bufferLine, callback) {
      const wrapped = readWrappedLine(term, bufferLine);
      if (!wrapped) return callback(undefined);

      const { text, startRow } = wrapped;
      const cols = term.cols;
      const links: ILink[] = [];
      const claimed: Array<[number, number]> = [];

      const push = (start: number, raw: string, isUrl: boolean) => {
        const trimmed = raw.replace(TRAILING_RE, "");
        if (!trimmed) return;
        const end = start + trimmed.length - 1;

        // The row this provider was asked about must actually be part of the
        // match, or a wrapped line would report the same link once per row.
        const sy = startRow + Math.floor(start / cols);
        const ey = startRow + Math.floor(end / cols);
        if (bufferLine - 1 < sy || bufferLine - 1 > ey) return;

        claimed.push([start, end]);
        links.push({
          text: trimmed,
          range: {
            start: { x: (start % cols) + 1, y: sy + 1 },
            end: { x: (end % cols) + 1, y: ey + 1 },
          },
          decorations: { pointerCursor: true, underline: true },
          activate(event, linkText) {
            // Ctrl/Cmd required — a bare click stays a text selection.
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();

            if (isUrl) {
              void open(linkText).catch(() => {});
              return;
            }
            // NOTE: the Windows default handler takes a path only, so the line
            // number is parsed off and DROPPED. `foo.cpp:42` opens foo.cpp at
            // the top. Switching this to `code -g` is what would honour it.
            const { path } = splitLineSuffix(linkText);
            void open(resolvePath(getCwd(), path)).catch(() => {});
          },
        });
      };

      URL_RE.lastIndex = 0;
      for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
        push(m.index, m[0], true);
      }

      PATH_RE.lastIndex = 0;
      for (let m = PATH_RE.exec(text); m; m = PATH_RE.exec(text)) {
        const s = m.index;
        const e = s + m[0].length - 1;
        // A path inside an already-claimed URL is part of that URL, not a file.
        if (claimed.some(([cs, ce]) => s <= ce && e >= cs)) continue;
        push(s, m[0], false);
      }

      callback(links.length ? links : undefined);
    },
  });
}
