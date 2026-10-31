# All Apps

A sheet (`#apps.open`) with every app that isn't on the shelf, five per row; OK opens one.

## Sub-features

- `apps-open`: the drawer's All Apps key opens the sheet, focus on the first cell.
- `apps-move`: ◀ ▶ ▲ ▼ move through the grid; long lists scroll by rows.
- `apps-launch`: OK opens the focused app (`TV.launch`).
- `apps-close`: Back closes the sheet, back to the shelf.

## How to get to it (user POV)

- ▼ from the shelf, then All Apps, OK.

## Driving it with fmtv-verify.sh

Preconditions: a doctor-clean run; `reset` (default shelf, so All Apps holds the 4 stand-in extras).

- **Open.** `$S drive reset key:down 'seek:All Apps' key:ok 'waitfor:document.querySelector("#apps.open")' state:apps-open shot:apps-open`
  → `sheets: ["apps"]`, 4 cells: Crunchyroll, Plex, Settings, Web Browser.
- **Launch.** `$S drive 'seek:Plex' key:ok state:apps-launch 'assert:__fmtv.calls.slice(-1)[0].args[0] === "cdp-30"'`.
- **Close.** `$S drive key:back state:apps-closed` → `sheets: []`, focus in `tiles`.

## Gotchas

- The sheet stays open after a launch in the browser (on the TV the app comes to the front over it).
- An app added to the shelf in Home Settings → Shelf leaves this grid.
- Back from All Apps lands on the shelf, not the drawer.
