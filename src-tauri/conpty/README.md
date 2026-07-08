# Sideloaded ConPTY (Windows Terminal's rewritten pseudoconsole)

`conpty.dll` + `OpenConsole.exe` (x64) from the NuGet package
[`Microsoft.Windows.Console.ConPTY` 1.24.260512001](https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY)
(MIT-licensed, from the [microsoft/terminal](https://github.com/microsoft/terminal) project).

Why they're bundled: the in-box Windows ConPTY (what `CreatePseudoConsole` in
kernel32 gives you) does **not** pass VT output through — it re-renders the
child's screen from its own buffer using conhost's width tables, which loses
grapheme/emoji width fidelity and causes cursor-position and stale-glyph
artifacts in the embedded IDE terminal. Windows Terminal 1.22+ rewrote ConPTY
to be near-passthrough and grapheme-aware; this pair is that rewrite.

How they're loaded: `portable_pty` prefers a sideloaded `conpty.dll` found via
the normal DLL search order (application directory first) over kernel32, and
`conpty.dll` spawns the `OpenConsole.exe` sitting next to it. The
`bundle.resources` map in `tauri.conf.json` places both files at the install
root next to `claude-launcher.exe` (and Tauri copies them into `target/debug/`
for `pnpm tauri dev`).

Note: this ConPTY sends a DA1 query (`CSI c`) at startup and waits briefly for
a response — xterm.js answers it automatically, so nothing intercepts parser
traffic between the PTY and xterm.

To upgrade: download a newer stable package version, copy
`runtimes/win-x64/native/conpty.dll` and `build/native/runtimes/x64/OpenConsole.exe`
over these files.
