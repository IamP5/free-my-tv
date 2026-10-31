# Home Settings

The settings sheet (`#settings.open`): one row per setting, ◀ ▶ (or OK) changes the value, saved at once in
`localStorage['fmtv.prefs']`. Rows come from `settingRows()` in `web/home.js`.

## Sub-features

- `settings-cycle`: Temperature (°C/°F/auto), Theme, Dim, Screensaver, Picks per tab, Forecast cycle with ◀ ▶.
- `settings-toggle`: Hide animation, Watch on the screensaver, Weather, Quotes, each coin: OK flips `.toggle.on`.
- `settings-sub`: Language, City, TMDB key, Shelf, About this TV open their own sheets (`#langpick`, `#citypick`,
  `#keypick`, `#shelfedit`, `#about`); Back returns to the row.
- `settings-persist`: a changed value survives a reload.

## How to get to it (user POV)

- ▼ from the shelf, Home Settings, OK.
- The gear, top right: ▲▲ from the shelf, ▶ to the last button, OK.

## Driving it with fmtv-verify.sh

Preconditions: a doctor-clean run. Proven end to end on 2026-10-31.

- **Open.** `$S drive reset key:down 'seek:Home Settings' key:ok 'waitfor:document.querySelector("#settings.open")' state:settings-open`
  → `sheets: ["settings"]`, first row `Language`.
- **Cycle.** `$S drive 'seekv:Temperature' state:temp-before key:right state:temp-after shot:temp-after`
  → before: row text `Temperature‹°C›` (São Paulo config), `prefs: null`; after: `Temperature‹°F›`,
  `prefs: {"temperature":"F"}`.
- **Persist.** `$S drive open key:down 'seek:Home Settings' key:ok 'seekv:Temperature' 'assert:document.querySelector("#settings .row.focus").textContent.indexOf("°F") >= 0'`.
- **Toggle.** `$S drive 'seekv:Weather' state:w-before key:ok state:w-after` → `prefs.weather` flips and the
  weather card leaves or joins the top.
- **Shelf editor.** `$S drive 'seekv:Shelf' key:ok 'waitfor:document.querySelector("#shelfedit.open")' 'seekv:Plex' key:ok state:shelf-added`
  → the Plex row reads `#9`, `prefs.shelf` ends with `cdp-30`, `shelf` has 9 tiles.
- **Close.** `$S drive key:back state:settings-closed` → `sheets: []`.

## Gotchas

- The defaults come from `config.properties` (°C here); with `--generic` they come from the time zone.
- Rows depend on the config: coins only with `show_crypto`, service rows only with picks, TV Settings only where
  `TV.canOpenSettings`. `seekv:` by label, never by index.
- The value text has `‹ ›` chevrons; `seek`/`seekv` strip them, `textContent` checks don't.
- City search and the TMDB key check go to the network (Open-Meteo, TMDB): report them not run when offline.
- Typing into City or TMDB key: the field takes keys only after OK on it; never type a real key in a verification.
