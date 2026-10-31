---
name: verify-lg-app
description: Drive this fork's LG (webOS) home screen app (web/, also Samsung's) the way a remote does and capture proof. Builds an isolated preview, serves it on its own port, presses remote keys in headless Chrome over CDP, and saves screenshots, state snapshots and a journal; also checks that the real TV at 192.168.0.9 runs the same files. Use to prove a change in web/ works (shelf, drawer, All Apps, Home Settings, and the Explore, Movies and Shows picks from TMDB trending) before committing or putting it on the TV.
---

# Verify the LG app

The app is a web page (`web/`) packed by `webos/build.py`. Outside a TV, `web/tv.js` runs a stand-in (`TV.name ===
"browser"`): eight sample apps on the shelf, four in All Apps, Live TV and HDMI 1 to 4 in the drawer (2 to 4 off), and
`TV.launch` / `TV.settings` / `TV.back` that do nothing. The harness records those three calls in `window.__fmtv.calls`:
that's the boundary where the real TV would act, so in the preview a launch is proven by the recorded call.

Everything goes through one script (run from the repo root):

```bash
.claude/skills/verify-lg-app/fmtv-verify.sh launch
```

It needs Python 3, Node 22+ (WebSocket built in; this Mac has 24) and Google Chrome at the standard macOS path
(`CHROME=...` overrides). Nothing to install.

## Launch

`fmtv-verify.sh launch [--generic]` builds with `python3 webos/build.py --preview` (from `config.properties`, what
the TV gets; `--generic` builds the release's settings: no TMDB key, city from the time zone), copies `out/webos/` to
a private folder, serves it on a free port on 127.0.0.1, starts headless Chrome with its own profile and CDP port,
opens the app and waits until the shelf is drawn (`#tiles .tile`). Ready when it prints:

```
RUN_ID=20261031-150205-27907
Evidence: /Users/tuba/Dev/projects/free-my-tv/out/verify/20261031-150205-27907
```

It starts with an empty profile (no `localStorage`, so default Home Settings) and already saved `boot.png` and
`boot.json`. The run's state (pids, ports, the served copy, Chrome's profile) is in `$TMPDIR/fmtv-verify/<RUN_ID>/`.
Later commands use `$RUN_ID` if set, else the last run launched (`out/verify/.last`). Runs are isolated (own ports,
profile, copy), so two can run side by side; pass `RUN_ID=...` to each command to tell them apart.

Edited `web/` since launching? The served copy is stale: `stop` and `launch` again (doctor says so).

## Doctor

```bash
.claude/skills/verify-lg-app/fmtv-verify.sh doctor
```

Read-only. Every line must be `ok`: both pids alive, the port owned by our server, `index.html` is Free My TV, the
served `home.js home.css tv.js data.js strings.js index.html` match `web/` byte for byte, and over CDP the page has the
browser stand-in and a drawn shelf. Run it first whenever anything looks off.

## Drive

```bash
.claude/skills/verify-lg-app/fmtv-verify.sh drive STEP...
```

Steps run in order in one CDP session and stop at the first failure (exit 1). The page keeps its state between drive
calls (it's the same Chrome tab), so a journey can span several calls.

| Step | Does |
| --- | --- |
| `open` / `reset` | load the app fresh / clear `localStorage` first (back to default settings) |
| `key:left` `right` `up` `down` `ok` `back`, `key:rightx3` | press a remote key (LG keyCodes 37-40, 13, 461), N times |
| `seek:LABEL` | press right/left until the focused item's text starts with LABEL (tile, drawer key, All Apps cell) |
| `seekv:LABEL` | the same with down/up (a Home Settings row, the language list) |
| `waitfor:JS` / `assert:JS` | wait up to 10 s for / require a truthy expression |
| `eval:JS` | print a value (only read; never call the app's functions to skip the keys) |
| `state:NAME` | save `NAME.json`: focused items, open sheets, drawer, shelf, toast, `fmtv.prefs`, TV calls |
| `shot:NAME` | save `NAME.png`, 1920x1080 |
| `picks:explore` `movies` `shows` | check that tab's cards against TMDB's trending/discover answers in this call (start with `reset`); `picks-TAB.json` |
| `tmdb:NAME` | save `NAME.json`: TMDB requests in this call (key replaced by `REDACTED`), ids each list returned |
| `wait:MS` | sleep (prefer `waitfor`) |

Stable handles in the DOM (`web/index.html`, `web/home.js`): the focused item has class `focus`; `#tiles .tile`
(shelf), `#drawer .key` (drawer; `.off` = input with nothing on), `#apps.open .cell .label` (All Apps),
`#settings.open .row` (Home Settings: label, then `‹value›` or a `.toggle.on`), `#tabs`, `#buttons`, `#cards`
(top), `#toast.on`, `body.drawer-open`. Saved settings: `localStorage['fmtv.prefs']` (JSON).

Example (proven): change the temperature unit in Home Settings.

```bash
S=.claude/skills/verify-lg-app/fmtv-verify.sh
$S drive reset key:down 'seek:Home Settings' key:ok 'waitfor:document.querySelector("#settings.open")' \
  'seekv:Temperature' state:temp-before key:right state:temp-after shot:temp-after \
  'assert:JSON.parse(localStorage.getItem("fmtv.prefs")).temperature === "F"'
```

The feature recipes are in `features/` (start at `features/README.md`). Cover every entry point a feature file lists,
not only the handiest one.

## Evidence

Everything lands in `out/verify/<RUN_ID>/` (git-ignored, survives `stop`): `journal.md` (every step with its result,
and every page exception, `console.error` and failed request, flagged `ERROR`), `*.png`, `*.json`.

Proof standards:
- Drive with keys (`key:`, `seek:`), the way the remote does. `eval:` only reads; never call `openSettings()`,
  `Prefs.set` or the like to reach a state.
- Capture before and after: a `state:` (and a `shot:` when it's visual) before the action and after it.
- Check the side effect, not only the screen: `fmtv.prefs` for settings, `calls` for launches, the reload for
  persistence (`open`, then `state:` again).
- A clean run has no `ERROR` lines in `journal.md` that the change could have caused. Network errors from TMDB,
  Open-Meteo or Binance are outside the app; say so if they show.
- Never put `config.js` (it can hold the TMDB key) in the evidence or print it; `state:` doesn't read it.
- The preview is Chrome on a Mac, not webOS 3's Chrome 38: it can't prove ES5 or old-CSS safety. `tools/check.sh web`
  does that; run it too before committing.

## On the TV

The real proof that something reaches the TV. Installing changes the TV, so do it when asked (the `/tv` skill:
`python3 webos/build.py && python3 webos/install.py 192.168.0.9`, ends at `Installed and open on the TV.`).
Read-only check, any time:

```bash
.claude/skills/verify-lg-app/fmtv-verify.sh tv-doctor
```

`ok` lines: port 9922 answers (Developer Mode on), the key `~/.ssh/freemytv_webos_192_168_0_9` is there (never print
or copy it), and the installed app's `home.js home.css tv.js data.js strings.js index.html` (in
`/media/developer/apps/usr/palm/applications/io.freemytv/`) match `web/` by MD5: proof the change is what the TV runs.
Developer Mode's user can't ask which app is in front (`getForegroundAppInfo`, `running`, `getAppInfo` all answer
"Denied method call"). But while Free My TV is open, the TV serves DevTools for it on port 9998
(`curl http://192.168.0.9:9998/json/list`, Chrome 120 on this set): CDP there evaluates, presses keys
(`Input.dispatchKeyEvent`) and traces on the real TV. For what it looks like, still ask the user to look.

## Perf on the TV

```bash
node .claude/skills/verify-lg-app/perf.mjs 192.168.0.9:9998 --cycles 6
```

Opens and closes the drawer over CDP (focus must be on the shelf) and prints, per transition, the longest frame, the
late frames and the frames drawn in the 700 ms after the key, plus the same span with nothing moving. `--keys
right,left` measures a move along the shelf; `--css RULES` tries a CSS change on the running app without a build (gone
at the next run); `--trace FILE` saves a Chrome trace and prints the busiest work per thread; `--no-raf --trace FILE`
counts the frames the display drew without the script's own rAF loop. Interleave runs (A, B, A, B) before believing a
difference. October 2026, this TV (2 GB, drawn at devicePixelRatio 2): the drawer drew 1-5 frames in its 500 ms
(longest 217 ms) until its moving parts became layers; then about 22 (longest 33 ms).

## Cleanup

```bash
.claude/skills/verify-lg-app/fmtv-verify.sh stop
```

Kills this run's Chrome and server by their pids (never by name: the user's own `free-my-tv preview` server on 8765
and their Chrome are not ours), deletes the run's state folder, and keeps `out/verify/<RUN_ID>/`. After a failed or
abandoned attempt, run `stop` too, so no Chrome or port is left behind. `launch` also overwrites
`FreeMyTV-webos.ipk` and `out/webos/` (normal build output).

## Helpers

- `fmtv-verify.sh` (`launch`, `doctor`, `drive`, `stop`, `tv-doctor [IP]`; no arguments prints its usage).
- `drive.mjs`, the CDP driver behind `drive`; its header lists the steps. Run it through `fmtv-verify.sh drive`,
  which sets `PORT`, `CDP_PORT` and `EVIDENCE`.
