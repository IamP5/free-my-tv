# Free My TV (LG web app) verification map

The maintained source for verifying what a person does with the remote on the LG home screen (`web/`). Read this
index, then use the matching feature file as the recipe. `S` below is `.claude/skills/verify-lg-app/fmtv-verify.sh`.

## Baseline preconditions

- A run from `$S launch` (built from `config.properties`), and `$S doctor` all `ok`.
- Start each recipe with `reset` (empty `localStorage`: default Home Settings, default shelf) unless it says otherwise.
- Browser stand-in data (`web/tv.js`, `SAMPLE` and `INPUTS`): shelf Netflix, YouTube, Prime Video, Disney+, Max,
  Apple TV, Globoplay, Spotify; All Apps Crunchyroll, Plex, Settings, Web Browser; drawer Live TV, HDMI 1 (on),
  HDMI 2-4 (off), All Apps, Home Settings, TV Settings.
- After `reset` the focus is on the first shelf tile (Netflix).
- Picks need the TMDB key in `config.properties` and the network; with `--generic` there are none. `picks:` checks
  each tab against TMDB's trending answers (see `picks.md`).

## Driving conventions

- Keys only (`key:`, `seek:`, `seekv:`); `eval:` and `assert:` only read.
- Find items by their label with `seek:`, never by counting presses: where the drawer's focus lands depends on the
  tile above it.
- Wait on DOM state (`waitfor:`), not sleeps.

## Proof and skip reporting

- `state:` before and after the action, `shot:` for anything visual; the side effect (`prefs`, `calls`) asserted.
- A journey whose precondition is missing (no TMDB key, no network) is reported as not run, with the reason; never
  weakened to pass.

## Features

| Feature | File | Entry points |
| --- | --- | --- |
| App shelf | [shelf.md](shelf.md) | the row of tiles at the bottom, where the app opens |
| Drawer | [drawer.md](drawer.md) | ▼ from the shelf |
| All Apps | [all-apps.md](all-apps.md) | drawer → All Apps |
| Home Settings | [home-settings.md](home-settings.md) | drawer → Home Settings; top-right gear |
| Picks: Explore, Movies, Shows (TMDB trending) | [picks.md](picks.md) | ▲ from the shelf (cards), ▲ again (tabs) |
