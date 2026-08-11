---
name: octogent
description: Start, drive, and screenshot the Octogent dashboard for this project — a web UI that orchestrates multiple Claude Code terminals into scoped containers ("tentacles"). Use when asked to run, launch, open, or screenshot Octogent, to create a tentacle or terminal, or to check whether the Octogent server is up.
---

# Octogent

Octogent is a **separate Node web app**, not a Claude Code skill or extension. It runs a
local server that spawns `claude` CLI processes into scoped containers ("tentacles") and
renders them in a browser dashboard. This skill only starts and drives it.

- Installed globally from a clone at `C:\Users\LENOVO\source\repos\octogent`
- Serves API **and** UI on `http://127.0.0.1:8787`
- Per-project state lives in `<project>/.octogent/` (gitignored here)

Paths below are relative to the repo root (`c:\Users\LENOVO\Desktop\prep`).

## Prerequisites

Already satisfied on this machine — re-verify only if something breaks:

```powershell
node -v          # v24.16.0  (octogent needs >=22)
pnpm -v ; git --version ; curl.exe --version
where.exe claude # must resolve — octogent spawns `claude` by name
```

`claude` lives in `D:\npm-global` (the real `npm prefix -g`). That directory was **not**
on PATH; it has been appended to the persisted user PATH. A shell started before that
change will not see it — open a new terminal, or prefix with:

```powershell
$env:PATH = "D:\npm-global;$env:PATH"
```

## Install / reinstall

```powershell
git clone --depth 1 https://github.com/hesamsheikh/octogent.git "$env:USERPROFILE\source\repos\octogent"
Set-Location "$env:USERPROFILE\source\repos\octogent"
pnpm install
pnpm rebuild node-pty esbuild @biomejs/biome   # pnpm 10 blocks these build scripts by default
pnpm build                                     # ~2 min: vite web build + api bundle
npm install -g .                               # not published to npm — install from the clone
```

Verify the native terminal backend loads before trusting the install:

```powershell
Set-Location "$env:USERPROFILE\source\repos\octogent"
node -e "const p=require('node-pty'); const t=p.spawn(process.env.ComSpec,['/c','echo PTY_OK'],{cols:80,rows:24}); t.onData(d=>process.stdout.write(d));"
```

Prints `PTY_OK`. The process will not exit on its own — Ctrl-C it.

## Run (agent path)

Start the server in the background from the project root:

```powershell
$env:PATH = "D:\npm-global;$env:PATH"
Set-Location "c:\Users\LENOVO\Desktop\prep"
octogent
```

It prints the project name, workspace id, and `API`/`UI` URLs, then holds the terminal
open. Run it with `run_in_background: true` and read the URL out of the task output file.

Health check and drive it over the CLI — **these require the server to be running**:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:8787' -UseBasicParsing | Select-Object StatusCode
octogent projects              #   prep  workspace-a8d1625bdc253efc  C:\Users\LENOVO\Desktop\prep
octogent tentacle create content-pipeline   #   Created tentacle "content-pipeline"
octogent tentacle list
octogent terminal list
octogent --help                # full surface: terminal create/stop/kill/prune, channel send/list
```

`tentacle create <name>` writes `.octogent/tentacles/<name>/CONTEXT.md` and `todo.md`, and
the new node appears in the UI graph attached to "Octoboss".

Screenshot the dashboard — this is the only way to know the UI actually renders:

```powershell
node .claude\skills\octogent\shot.mjs C:\path\to\out.png
```

Then `Read` the PNG. First run lands on **Workspace Setup**; once initialized it shows the
agent graph. **Run this in the background** — cold Chrome start plus the SPA settle window
puts it at 1–3 minutes, past a default tool timeout.

`shot.mjs` drives Chrome over the DevTools protocol (dependency-free: Node 22+ has a global
`WebSocket`) rather than using `chrome --headless --screenshot`, which is broken here —
see Gotchas. Override the browser with `CHROME_PATH`, pass a different URL as a second arg.

## Run (human path)

Same `octogent` command — it opens the dashboard in your default browser. To keep it inside
the editor instead: VS Code command palette → **Simple Browser: Show** → `http://127.0.0.1:8787`.

Stop it with Ctrl-C in its terminal.

## Gotchas

- **`npm i -g` installs somewhere unreachable.** `~/.npmrc` sets `prefix=D:\npm-global`, but
  the user PATH listed a stale `D:\DevGlobal\npm-global` (which exists and is empty of
  shims). Anything installed globally — `claude`, `octogent` — was invisible. Fixed by
  appending `D:\npm-global`; if a global CLI ever "isn't installed", compare
  `npm prefix -g` against PATH before reinstalling.
- **`pnpm install` silently skips native builds.** pnpm 10 prints `Ignored build scripts:
  @biomejs/biome, esbuild, node-pty` and continues. `pnpm approve-builds` is interactive and
  unusable from a tool call — use `pnpm rebuild <pkgs>` instead.
- **node-pty needs no compiler here.** It ships a `win32-x64` prebuild, so Visual Studio
  Build Tools are irrelevant despite the usual node-gyp reputation.
- **`chrome --headless --screenshot=out.png` does not work on this machine.** It succeeded
  twice, then began failing every time with `Failed to write file: Access is denied (0x5)`
  — in the scratchpad, in `%TEMP%`, with and without an isolated `--user-data-dir`, and
  `msedge.exe` fails identically. It is Chrome's file write that fails, not the render.
  Don't retry it or hunt for a writable directory; use `shot.mjs`, which captures over CDP
  and writes the base64 from Node.
- **The UI is an SPA** — `Invoke-WebRequest` on `/` returns a 479-byte shell with an empty
  `<div id="root">`. That is a healthy response, not a broken one. Only a real browser
  render tells you the app works.
- **`octogent tentacle *` needs the server up.** The CLI talks to the running instance, not
  to disk. With nothing running these commands fail rather than falling back.
- **`.octogent/` is gitignored** (the app's own setup flow flags this as required). There is
  no `tentacle delete` in the CLI — remove the directory under `.octogent/tentacles/`, or
  use **DELETE ALL** in the UI toolbar.
- Octogent is **v0.1.0, unpublished, single-author**, and overlaps with what Claude Code
  already does natively in VS Code (session tabs, subagents, worktrees). Treat breakage as
  expected.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `octogent` → not recognized | New shell, or `$env:PATH = "D:\npm-global;$env:PATH"` |
| UI says *Check Claude Code* fails | `claude` not on PATH — same fix as above |
| `shot.mjs` → "devtools never came up" | Chrome not at the default path — set `CHROME_PATH` |
| `shot.mjs` screenshot is blank/dark | Server isn't up; check `Invoke-WebRequest http://127.0.0.1:8787` returns 200 |
| Port 8787 in use | Another `octogent` is already running — reuse it rather than starting a second |
