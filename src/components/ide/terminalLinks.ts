import type { Terminal as XTerm, ILink, IDisposable } from "@xterm/xterm";
import { open } from "@tauri-apps/plugin-shell";

/**
 * Ctrl+click support for file paths, URLs, and markdown links in the IDE terminal.
 *
 * xterm renders everything as inert text unless a link provider claims a range,
 * and this app loaded only fit/webgl/unicode11 — so nothing was ever clickable.
 * This registers one provider that claims URLs, file paths, AND markdown-style
 * `[text](target)` links, decorates them on hover, and opens them through
 * Tauri's shell `open` (the `shell:allow-open` permission is already granted
 * in src-tauri/capabilities/default.json).
 *
 * Ctrl (or Cmd) is REQUIRED to activate, matching VS Code and the browser: a
 * bare click must keep selecting text, which is what a terminal is mostly for.
 *
 * ⚠️ This terminal renders PLAIN TEXT — there is no markdown layer that hides
 * `[` `]` `(` `)` the way a rendered chat UI would. Claude Code's own output
 * defaults to markdown links, so `[label](path)` arrives here as nine literal
 * characters of punctuation wrapped around a path. Before markdown-link
 * support existed, only the bare path *inside* the parens matched PATH_RE —
 * the brackets, the label text, and the parens sat there unclickable and
 * unhighlighted, which is exactly the "only half the link highlights on
 * hover" bug this file now fixes. The fix claims the FULL `[label](target)`
 * span as one link, so hovering anywhere across it — including the label —
 * underlines the whole thing, and the label (not the raw target path) is
 * what visually reads as the link.
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

// Markdown-style `[label](target)`. No nested brackets/parens and no
// newlines in either half — that covers every link Claude Code actually
// emits and keeps the regex from running away across a whole paragraph if a
// `)` is missing. Matched and claimed BEFORE the bare URL_RE/PATH_RE passes
// below, so a target that happens to look like a URL or path doesn't also
// get claimed a second time as its own separate, overlapping link.
const MD_LINK_RE = /\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g;

/**
 * `file://...` -> a raw OS path `resolvePath`/`open` can use. Handles both
 * `file:///C:/...` (drive-letter form: three slashes, then the drive) and
 * `file://server/share/...` (UNC form: two slashes, then the host).
 */
export function stripFileScheme(raw: string): string {
  if (!/^file:\/\//i.test(raw)) return raw;
  const rest = raw.slice(7); // strip "file://"
  const drive = rest.match(/^\/([A-Za-z]:.*)$/);
  if (drive) return drive[1];
  if (rest && !rest.startsWith("/")) return `\\\\${rest}`; // UNC host, no leading slash
  return rest; // POSIX-style file:///home/... — already a usable absolute path
}

// `open` hands the path to the Windows shell, which RUNS these rather than
// viewing them. Terminal output is untrusted text, so a printed path must never
// be one Ctrl+click away from executing.
const EXECUTABLE_RE =
  /\.(exe|com|scr|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|pif|reg|cpl|jar)$/i;

/**
 * Open a resolved file path through the OS default handler.
 *
 * ⚠️ The shell plugin validates every `open` argument against
 * `plugins.shell.open` in tauri.conf.json. Left unset, that regex allows only
 * http(s)/mailto/tel, so every file path was rejected and the old
 * `.catch(() => {})` hid it: links underlined, Ctrl+click did nothing. Failures
 * are logged now so a scope rejection is visible instead of silent.
 */
function openPath(path: string): void {
  if (EXECUTABLE_RE.test(path)) {
    console.warn("[launcher] refusing to open an executable from a terminal link:", path);
    return;
  }
  open(path).catch((err) => {
    console.warn("[launcher] terminal link open failed:", path, err);
  });
}

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
      const overlapsClaimed = (s: number, e: number) =>
        claimed.some(([cs, ce]) => s <= ce && e >= cs);

      // Shared by every match kind: turns a [start, end] char-index range
      // (into the reconstructed logical line) into an ILink at the right
      // buffer row/column, guarding the same "only report on the row this
      // call is actually about" rule a wrapped line needs.
      const addLink = (
        start: number,
        end: number,
        displayText: string,
        activate: ILink["activate"],
      ) => {
        const sy = startRow + Math.floor(start / cols);
        const ey = startRow + Math.floor(end / cols);
        if (bufferLine - 1 < sy || bufferLine - 1 > ey) return;

        claimed.push([start, end]);
        links.push({
          text: displayText,
          range: {
            start: { x: (start % cols) + 1, y: sy + 1 },
            end: { x: (end % cols) + 1, y: ey + 1 },
          },
          decorations: { pointerCursor: true, underline: true },
          activate,
        });
      };

      const push = (start: number, raw: string, isUrl: boolean) => {
        const trimmed = raw.replace(TRAILING_RE, "");
        if (!trimmed) return;
        const end = start + trimmed.length - 1;
        addLink(start, end, trimmed, (event, linkText) => {
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
          openPath(resolvePath(getCwd(), path));
        });
      };

      // Markdown links FIRST: the whole `[label](target)` span becomes one
      // link (so the label — not the raw target buried in the parens — is
      // what underlines), and its range is pre-claimed so the URL_RE/PATH_RE
      // passes below don't also match the target as a second, overlapping link.
      MD_LINK_RE.lastIndex = 0;
      for (let m = MD_LINK_RE.exec(text); m; m = MD_LINK_RE.exec(text)) {
        const whole = m[0];
        const rawTarget = m[2].trim();
        // A real path/URL target never contains raw whitespace. Without this,
        // ordinary code shaped like `handlers[key](event)` or `arr[0](x y)`
        // misparses as a markdown link with a nonsense target — harmless on
        // activation (open() just fails silently) but an unwanted hover/
        // underline on plain code.
        if (!rawTarget || /\s/.test(rawTarget)) continue;
        const s = m.index;
        const e = s + whole.length - 1;
        const isUrl = /^https?:\/\//i.test(rawTarget);
        const target = isUrl ? rawTarget : stripFileScheme(rawTarget);
        addLink(s, e, whole, (event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          if (isUrl) {
            void open(target).catch(() => {});
            return;
          }
          const { path } = splitLineSuffix(target);
          openPath(resolvePath(getCwd(), path));
        });
      }

      URL_RE.lastIndex = 0;
      for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
        const s = m.index;
        const e = s + m[0].length - 1;
        if (overlapsClaimed(s, e)) continue;
        push(s, m[0], true);
      }

      PATH_RE.lastIndex = 0;
      for (let m = PATH_RE.exec(text); m; m = PATH_RE.exec(text)) {
        const s = m.index;
        const e = s + m[0].length - 1;
        // A path inside an already-claimed URL or markdown link is part of
        // that link, not a second, separate file.
        if (overlapsClaimed(s, e)) continue;
        push(s, m[0], false);
      }

      callback(links.length ? links : undefined);
    },
  });
}
