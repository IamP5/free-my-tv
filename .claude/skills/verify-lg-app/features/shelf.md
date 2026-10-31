# App shelf

The glass row of app tiles at the bottom of the home screen; OK opens the focused app. Its apps and order come from
Home Settings → Shelf (`fmtv.prefs.shelf`), else `CONFIG.shelfApps`, else the TV's list.

## Sub-features

- `shelf-focus`: ◀ ▶ move the focus along the tiles; it stops at both ends.
- `shelf-open`: OK opens the focused app (`TV.launch(id)`).
- `shelf-scroll`: more apps than fit (`SHELF_VISIBLE`) scroll the row, with arrows inside the glass.
- `shelf-edit`: Home Settings → Shelf: OK adds or removes an app, ◀ ▶ moves it (see `home-settings.md`).

## How to get to it (user POV)

- It's where the focus is when the app opens.
- Back from any sheet or the drawer returns to it.
- ▼ from the picks row.

## Driving it with fmtv-verify.sh

Preconditions: a doctor-clean run; `reset`.

- **Focus.** `$S drive reset state:shelf-start key:rightx2 state:shelf-moved` → `shelf-moved.json` focus is
  `{"in":"tiles","text":"Prime Video"}`.
- **End stop.** `$S drive key:leftx5 'assert:document.querySelector("#tiles .focus").textContent === "Netflix"'`.
- **Open.** `$S drive 'seek:YouTube' key:ok state:shelf-open 'assert:__fmtv.calls.slice(-1)[0].args[0] === "youtube.leanback.v4"'`
  → `calls` ends with `{"fn":"launch","args":["youtube.leanback.v4",null]}`.
- **Edited shelf persists.** In Home Settings → Shelf, OK on `Plex` (adds it), Back twice, then `open`:
  `state:` shows `Plex` last in `shelf` and in `prefs.shelf`.
- **Proof.** `shot:shelf-open` with the focused tile visible.

## Gotchas

- In the browser `TV.launch` opens nothing; the recorded call is the proof. Whether the TV opens the app in
  front: the user confirms on the TV (`tv-doctor` only proves the installed files).
- The first key after the screensaver only wakes the screen (5 idle minutes; a long `wait:` can trigger it).
- Tile text is the app name only when its logo didn't load; `state:` falls back to `img:<src>`.
