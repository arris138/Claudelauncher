import { useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { Project, GlobalSettings, Session } from "../../types";
import { spawnPty, writePty, resizePty, killPty } from "../../services/ide";

interface TerminalProps {
  session: Session;
  project: Project;
  settings: GlobalSettings;
  active: boolean;
  /** Fired when the user types in / focuses this terminal (clears the blink). */
  onActivity: (id: string) => void;
  /** Fired (throttled) when PTY output arrives — drives the Working state. */
  onBusy: (id: string) => void;
  /** Fired with a friendly model name parsed from Claude's output. */
  onModel: (id: string, model: string) => void;
}

// Strip ANSI/OSC escapes so we can text-match Claude's output. Built via
// RegExp() with a clean ESC constant to avoid literal control chars in source.
const ESC = "";
const OSC_RE = new RegExp(ESC + "\\][^" + ESC + "]*(?:|" + ESC + "\\\\)", "g");
const CSI_RE = new RegExp(ESC + "\\[[0-9;?]*[ -/]*[@-~]", "g");
const ESC2_RE = new RegExp(ESC + "[@-Z\\\\-_]", "g");
function stripAnsi(s: string): string {
  return s.replace(OSC_RE, "").replace(CSI_RE, "").replace(ESC2_RE, "");
}

// Pull the current model out of Claude's output: the "/model" confirmation
// ("Set model to Sonnet 4.6 …") takes priority, else the startup banner
// ("Opus 4.8 with high effort · Claude Max").
function detectModel(text: string): string | null {
  const setRe = /Set model to ([A-Za-z][A-Za-z0-9.\- ]*?)(?: and saved| for this| \(|\r|\n|$)/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = setRe.exec(text))) last = m[1].trim();
  if (last) return last;
  const banRe = /\b(Opus|Sonnet|Haiku|Fable)\s+([0-9][0-9.]*)/g;
  let b: RegExpExecArray | null;
  let lastB: string | null = null;
  while ((b = banRe.exec(text))) lastB = `${b[1]} ${b[2]}`;
  return lastB;
}

const THEME = {
  background: "#0a0b0d",
  foreground: "#d6dadf",
  cursor: "#e2742f",
  cursorAccent: "#0a0b0d",
  selectionBackground: "#2a2e34",
  black: "#0e0f11",
  red: "#b3361f",
  green: "#6fae5e",
  yellow: "#e8c33b",
  blue: "#5a93c4",
  magenta: "#9a6cc4",
  cyan: "#3fb0a0",
  white: "#aeb6bf",
  brightBlack: "#5b6068",
  brightRed: "#e2742f",
  brightGreen: "#84cc16",
  brightYellow: "#e8c33b",
  brightBlue: "#7fb0d8",
  brightMagenta: "#c08ae0",
  brightCyan: "#5fd0c0",
  brightWhite: "#e6ebef",
};

export default function Terminal({
  session,
  project,
  settings,
  active,
  onActivity,
  onBusy,
  onModel,
}: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  // Resizing the PTY (tab switch, layout reflow) makes Claude's TUI repaint,
  // which streams output that isn't real work. Suppress the "busy" ping for a
  // brief window after any resize we trigger so switching tabs doesn't flip
  // every session to "Working" for the full watchdog timeout.
  const busyQuietUntilRef = useRef(0);

  // Mount xterm + spawn the PTY exactly once for this session.
  useEffect(() => {
    if (!hostRef.current || startedRef.current) return;
    startedRef.current = true;
    const host = hostRef.current;

    let term: XTerm | null = null;
    let dataSub: { dispose(): void } | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;

    // Defer opening xterm until the web font (JetBrains Mono, pulled from the
    // Google CDN with display=swap) is loaded AND a layout frame has passed.
    // If we open/fit against the fallback font or a not-yet-sized container,
    // xterm measures a bogus cell width, computes a tiny `cols`, and spawns the
    // PTY at that width — so Claude starts at ~7 columns and every word wraps
    // onto its own line. Measuring once the real font and final layout are in
    // place fixes the wrapping at the source.
    const fontsReady =
      typeof document !== "undefined" && document.fonts
        ? document.fonts.ready
        : Promise.resolve();

    fontsReady.then(() =>
      requestAnimationFrame(() => {
        if (disposed) return;

        term = new XTerm({
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12.5,
          lineHeight: 1.35,
          cursorBlink: true,
          scrollback: 5000,
          theme: THEME,
          allowProposedApi: true,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        try {
          term.loadAddon(new WebglAddon());
        } catch {
          /* fall back to the DOM renderer */
        }
        fit.fit();
        termRef.current = term;
        fitRef.current = fit;

        // Stream PTY output to xterm, and sniff the active model from the text.
        const decoder = new TextDecoder();
        let rawBuf = "";
        let lastModel = "";
        let lastBusy = 0;
        const onOutput = new Channel<number[]>();
        onOutput.onmessage = (msg) => {
          const bytes = new Uint8Array(msg);
          term?.write(bytes);
          // Throttled "output arrived" ping → Working state. Skip it while a
          // recent resize is still repainting, so a tab switch's repaint burst
          // isn't mistaken for the session doing work.
          const t = Date.now();
          if (t - lastBusy > 120 && t >= busyQuietUntilRef.current) {
            lastBusy = t;
            onBusy(session.id);
          }
          rawBuf = (rawBuf + decoder.decode(bytes, { stream: true })).slice(-8000);
          const model = detectModel(stripAnsi(rawBuf));
          if (model && model !== lastModel) {
            lastModel = model;
            onModel(session.id, model);
          }
        };

        spawnPty(
          session.id,
          project,
          settings,
          session.flags,
          term.cols,
          term.rows,
          onOutput
        ).catch((err) => {
          term?.write(`\r\n\x1b[31m[launch failed: ${String(err)}]\x1b[0m\r\n`);
        });

        dataSub = term.onData((data) => {
          onActivity(session.id);
          writePty(session.id, data).catch(() => {});
        });

        ro = new ResizeObserver(() => {
          if (!fitRef.current || !termRef.current) return;
          fitRef.current.fit();
          busyQuietUntilRef.current = Date.now() + 750;
          resizePty(session.id, termRef.current.cols, termRef.current.rows).catch(
            () => {}
          );
        });
        ro.observe(host);
      })
    );

    return () => {
      disposed = true;
      ro?.disconnect();
      dataSub?.dispose();
      killPty(session.id).catch(() => {});
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit + focus when this session becomes the active one.
  useEffect(() => {
    if (active && fitRef.current && termRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        termRef.current?.focus();
        if (termRef.current) {
          busyQuietUntilRef.current = Date.now() + 750;
          resizePty(session.id, termRef.current.cols, termRef.current.rows).catch(
            () => {}
          );
        }
      });
    }
  }, [active, session.id]);

  return (
    <div className={`term-pane${active ? "" : " hidden"}`}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
