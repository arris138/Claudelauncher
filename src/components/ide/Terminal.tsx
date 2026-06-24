import { useEffect, useRef, useState } from "react";
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
  /** False while the whole IDE view is hidden behind the Launcher view. */
  visible: boolean;
  /** Fired when the user types in / focuses this terminal (clears the blink). */
  onActivity: (id: string) => void;
  /** Fired (throttled) when PTY output arrives — keeps the Working watchdog warm. */
  onBusy: (id: string) => void;
  /** Fired when the user submits a prompt (Enter) — starts the Working state. */
  onSubmit: (id: string) => void;
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

// Smallest geometry we will ever report to the PTY. xterm can transiently
// measure a degenerate cell size — while the WebGL renderer is still building
// its glyph atlas, or before the grid/flex layout settles — which makes
// FitAddon propose a handful of columns. Claude reads the PTY width to wrap its
// OWN output with hard newlines, and that wrapped text never reflows, so a
// single bad resize permanently mangles a chunk of the transcript. Anything
// below these floors is treated as a bad measurement and ignored.
const MIN_COLS = 20;
const MIN_ROWS = 4;
const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

// How close to the live bottom (in rows) re-engages auto-follow. Claude's TUI
// pushes new lines continuously while generating, so `baseY` is a moving target;
// requiring an *exact* landing on the bottom means the user can never re-pin.
// A small slack lets a downward scroll near the end snap back into following.
const FOLLOW_SLACK_ROWS = 2;

/**
 * Fit + resize the PTY ONLY when the proposed geometry is sane. Returns true if
 * a resize was actually applied. A degenerate measurement is dropped entirely —
 * we leave xterm AND the PTY at the last good size rather than briefly shrinking
 * to a few columns (which would make Claude hard-wrap whatever it prints next).
 */
function safeRefit(fit: FitAddon, term: XTerm, sessionId: string): boolean {
  const dims = fit.proposeDimensions();
  if (
    !dims ||
    !Number.isFinite(dims.cols) ||
    !Number.isFinite(dims.rows) ||
    dims.cols < MIN_COLS ||
    dims.rows < MIN_ROWS
  ) {
    return false;
  }
  fit.fit();
  resizePty(sessionId, term.cols, term.rows).catch(() => {});
  return true;
}

export default function Terminal({
  session,
  project,
  settings,
  active,
  visible,
  onActivity,
  onBusy,
  onSubmit,
  onModel,
}: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  // Latest `active` for the async boot path: a new session is opened on a
  // delay (font load + layout settle), by which point the one-shot active
  // effect below has already run and skipped (the term didn't exist yet), so
  // boot() reads this to focus the terminal once it finally opens.
  const activeRef = useRef(active);
  activeRef.current = active;
  // Resizing the PTY (tab switch, layout reflow) makes Claude's TUI repaint,
  // which streams output that isn't real work. Suppress the "busy" ping for a
  // brief window after any resize we trigger so switching tabs doesn't flip
  // every session to "Working" for the full watchdog timeout.
  const busyQuietUntilRef = useRef(0);

  // "Follow the bottom" intent, lifted out of the mount closure so the wheel
  // listener, the active/visible effect, and the Jump-to-latest button can all
  // read and flip it. `following` mirrors it for rendering (the button) but is
  // only written when the value actually changes, so the high-frequency scroll
  // events during generation don't trigger a render per frame.
  const stickRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const setStick = (v: boolean) => {
    if (stickRef.current === v) return;
    stickRef.current = v;
    setFollowing(v);
  };
  const jumpToBottom = () => {
    termRef.current?.scrollToBottom();
    setStick(true);
    termRef.current?.focus();
  };

  // Mount xterm + spawn the PTY exactly once for this session.
  useEffect(() => {
    if (!hostRef.current || startedRef.current) return;
    startedRef.current = true;
    const host = hostRef.current;

    let term: XTerm | null = null;
    let dataSub: { dispose(): void } | null = null;
    let scrollSub: { dispose(): void } | null = null;
    let ro: ResizeObserver | null = null;
    let onWheel: ((e: WheelEvent) => void) | null = null;
    let disposed = false;
    let spawned = false;
    // "Follow the bottom" intent lives in stickRef (component scope). xterm
    // auto-scrolls on write only when it already thinks the viewport is pinned,
    // and Claude Code's Ink TUI repaints its live region with cursor-positioning
    // / scroll-region escapes rather than plain appended lines — which defeats
    // that heuristic, so streaming output stops tracking the bottom and the
    // prompt drifts out of view until a keystroke snaps it back. We replicate
    // that snap for output: scrollToBottom after each write while stickRef is
    // true. The flag drops the instant the user scrolls up (the wheel listener
    // below wins immediately, beating the next write's snap-back), so reading
    // history mid-generation works, and re-engages once they scroll back near
    // the bottom or hit the Jump-to-latest button.

    // Open + fit + spawn deferred behind two guarantees, because getting either
    // wrong makes xterm measure a bogus cell width / container size, compute a
    // tiny `cols`, and spawn the PTY at that width — so Claude starts at a
    // handful of columns and wraps every character onto its own line.
    //
    //  1. The real mono font must actually be downloaded before we open(), or
    //     xterm measures the *fallback* cell width. `document.fonts.ready`
    //     alone is not enough: it resolves immediately when the specific
    //     JetBrains Mono weights xterm uses haven't been requested yet, so we
    //     explicitly load() those weights first.
    //  2. The host must have reached its final laid-out width. A single rAF
    //     isn't guaranteed (the grid/flex stage can still be settling), so we
    //     poll proposeDimensions() until it yields a sane `cols`.
    const boot = async () => {
      try {
        if (typeof document !== "undefined" && document.fonts) {
          await Promise.all([
            document.fonts.load('400 12.5px "JetBrains Mono"'),
            document.fonts.load('700 12.5px "JetBrains Mono"'),
          ]);
          await document.fonts.ready;
        }
      } catch {
        /* measure against whatever's available */
      }
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
        const webgl = new WebglAddon();
        // A lost GL context (common in webviews) renders garbage until
        // disposed — drop the addon so xterm falls back to the DOM renderer.
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        /* fall back to the DOM renderer */
      }
      termRef.current = term;
      fitRef.current = fit;

      // Clipboard shortcuts. xterm doesn't implement copy/paste itself — left
      // alone, Ctrl+V just sends a raw ^V byte to the PTY. Mirror Windows
      // Terminal: Ctrl+V (or Ctrl+Shift+V) pastes the clipboard; Ctrl+C copies
      // when there's a selection and otherwise falls through as the interrupt.
      // Returning false stops xterm from also emitting the control byte, but it
      // does NOT stop the webview's own native clipboard handling — in WebView2
      // the Ctrl+V keydown still produces a native `paste` event that xterm's
      // hidden textarea delivers to the PTY, so without preventDefault() the
      // text lands twice (once from our explicit paste, once from the native
      // event). e.preventDefault() suppresses that native paste/copy so each
      // shortcut is handled exactly once.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown" || !e.ctrlKey) return true;
        const key = e.key.toLowerCase();
        if (key === "v") {
          e.preventDefault();
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) termRef.current?.paste(text);
            })
            .catch(() => {});
          return false;
        }
        if (key === "c") {
          const sel = termRef.current?.getSelection();
          if (sel) {
            e.preventDefault();
            navigator.clipboard.writeText(sel).catch(() => {});
            termRef.current?.clearSelection();
            return false;
          }
          // No selection: let Ctrl+C through so Claude still gets the interrupt.
        }
        return true;
      });

      // Track follow-intent: pinned when the viewport sits within a couple rows
      // of the buffer base, released when the user scrolls further up. The slack
      // matters because new lines keep raising baseY mid-generation — without it
      // a downward scroll could never quite catch the bottom to re-pin.
      // Programmatic scrollToBottom lands on the base too, so it keeps following.
      scrollSub = term.onScroll(() => {
        const buf = term?.buffer.active;
        if (buf) setStick(buf.viewportY >= buf.baseY - FOLLOW_SLACK_ROWS);
      });

      // Wheel intent wins immediately. onScroll alone is too late: at generation
      // speed a write callback can fire scrollToBottom in the gap between the
      // wheel event and onScroll, yanking the user back down so they "can't
      // scroll up". Dropping the flag the moment the wheel turns upward closes
      // that race — the next write sees stickRef false and leaves the viewport
      // where the user put it.
      onWheel = (e: WheelEvent) => {
        if (e.deltaY < 0) setStick(false);
      };
      host.addEventListener("wheel", onWheel, { passive: true });

      // Stream PTY output to xterm, and sniff the active model from the text.
      const decoder = new TextDecoder();
      let rawBuf = "";
      let lastModel = "";
      let lastBusy = 0;
      const onOutput = new Channel<number[]>();
      onOutput.onmessage = (msg) => {
        const bytes = new Uint8Array(msg);
        // Keep the viewport glued to the bottom while following, so streaming
        // generation output doesn't leave the prompt below the fold.
        term?.write(bytes, () => {
          if (stickRef.current) term?.scrollToBottom();
        });
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

      // Poll until the container is genuinely wide enough to measure a sane
      // `cols`, then fit + spawn exactly once. Give up after ~2s and spawn at
      // whatever we have rather than never launching.
      let tries = 0;
      const settleAndSpawn = () => {
        if (disposed || spawned || !term) return;
        const dims = fit.proposeDimensions();
        const ready =
          host.clientWidth > 0 &&
          dims != null &&
          dims.cols >= MIN_COLS &&
          dims.rows >= MIN_ROWS;
        if (!ready && tries < 120) {
          tries++;
          requestAnimationFrame(settleAndSpawn);
          return;
        }
        spawned = true;
        if (ready) {
          fit.fit();
        } else {
          // Never got a sane measurement (~2s elapsed) — launch at a sensible
          // default rather than a degenerate width. A later good resize will
          // correct it, but at least Claude doesn't start a few columns wide.
          term.resize(FALLBACK_COLS, FALLBACK_ROWS);
        }

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
          // Enter (CR) submits the prompt → a turn begins. onActivity above has
          // already cleared any prior complete/waiting banner, so this lands as
          // a clean idle→working transition that only a hook (or exit) ends.
          if (data.includes("\r")) onSubmit(session.id);
          writePty(session.id, data).catch(() => {});
        });

        ro = new ResizeObserver(() => {
          if (!fitRef.current || !termRef.current) return;
          // Guarded: a degenerate measurement (mid-layout / WebGL warmup) is
          // dropped rather than shipped to the PTY as a few-column resize.
          if (safeRefit(fitRef.current, termRef.current, session.id)) {
            busyQuietUntilRef.current = Date.now() + 750;
          }
        });
        ro.observe(host);

        // If this session is the active one (a just-added session is created
        // active), drop the cursor straight into it so the user can type a
        // prompt without clicking. The async open means the active effect below
        // already ran while termRef was null, so we focus here too.
        if (activeRef.current) term.focus();
      };
      requestAnimationFrame(settleAndSpawn);
    };
    boot();

    return () => {
      disposed = true;
      ro?.disconnect();
      dataSub?.dispose();
      scrollSub?.dispose();
      if (onWheel) host.removeEventListener("wheel", onWheel);
      killPty(session.id).catch(() => {});
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit + focus when this session becomes the active one, or when the IDE
  // view is shown again after being hidden behind the Launcher. While hidden
  // (display:none) the host has no measurable size and xterm can't repaint, so
  // returning needs a fresh fit; scrollToBottom lands back on the prompt.
  useEffect(() => {
    if (active && visible && fitRef.current && termRef.current) {
      requestAnimationFrame(() => {
        if (!fitRef.current || !termRef.current) return;
        termRef.current.focus();
        if (safeRefit(fitRef.current, termRef.current, session.id)) {
          busyQuietUntilRef.current = Date.now() + 750;
        }
        termRef.current.scrollToBottom();
        setStick(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, visible, session.id]);

  return (
    <div className={`term-pane${active ? "" : " hidden"}`}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      {active && !following && (
        <button
          className="term-jump"
          onClick={jumpToBottom}
          title="Jump to the live bottom and resume following"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}
