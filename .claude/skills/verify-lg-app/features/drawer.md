# Drawer

The row that slides up under the shelf: the TV's inputs (Live TV, HDMI) and shortcuts (All Apps, Home Settings, TV
Settings). `body.drawer-open` while it's focused.

## Sub-features

- `drawer-open`: ▼ on the shelf opens it, focus on the key nearest the tile above.
- `drawer-inputs`: OK on Live TV or an HDMI input launches it (`TV.launch` with the input's id); an input with
  nothing on (`.key.off`) is dimmed but still opens.
- `drawer-shortcuts`: All Apps and Home Settings open their sheets; TV Settings calls `TV.settings`.
- `drawer-close`: ▲ or Back returns to the shelf.

## How to get to it (user POV)

- ▼ from the shelf.
- Top-right buttons (▲▲ from the shelf, then ▶): the second one opens the drawer on its inputs.

## Driving it with fmtv-verify.sh

Preconditions: a doctor-clean run; `reset`.

- **Open.** `$S drive reset key:down state:drawer-open shot:drawer-open` → `drawerOpen: true`, focus in `drawer`.
- **Items.** `$S drive 'eval:[].map.call(document.querySelectorAll("#drawer .key"),function(e){return e.textContent})'`
  → `["Live TV","HDMI 1","HDMI 2","HDMI 3","HDMI 4","All Apps","Home Settings","TV Settings"]`.
- **Input.** `$S drive 'seek:HDMI 1' key:ok state:drawer-hdmi 'assert:__fmtv.calls.slice(-1)[0].args[0] === "com.webos.app.hdmi1"'`.
- **TV Settings.** `$S drive 'seek:TV Settings' key:ok 'assert:__fmtv.calls.slice(-1)[0].fn === "settings"'`.
- **Close.** `$S drive key:back state:drawer-closed` → `drawerOpen: false`, focus back in `tiles`.
- **From the top buttons.** The buttons have no text, so `seek:` can't find them: `$S drive reset key:up key:up`,
  then `key:right` until `assert:document.querySelector("#buttons .focus") === document.querySelector("#buttons").children[1]`,
  then `key:ok 'assert:document.body.className.indexOf("drawer-open") >= 0'`.

## Gotchas

- Where the focus lands on ▼ depends on the tile above: always `seek:` by label.
- Which input ids the stand-in uses is in `web/tv.js` `INPUTS`; on the TV the list comes from Luna and can differ.
- `drawer_first` in `config.properties` changes the order (shortcuts before inputs).
