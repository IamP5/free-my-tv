# Picks

The top half: tabs Explore / Movies / Shows, a row of picks (cards from TMDB, with the service that has each), the
backdrop behind the focused one, the clock, quotes, and three round buttons (Live TV, inputs, gear).

Where the picks come from (`fetchList` in `web/data.js`): TMDB's `/trending/movie/week` and `/trending/tv/week`
(first 16 each, kept only when the title's details say it's on one of the TV's apps), alternated movie/series; then
`/discover/movie` (last year) and `/discover/tv` (last 90 days) on those apps, sorted by popularity; 24 at most, saved
in `localStorage['fmtv.recs']` for 6 hours. Each tab shows `Prefs.cards()` of them (3 by default), rotating by the
hour: Explore both kinds, Movies `kind: movie`, Shows `kind: tv` (its line starts with "Series").

## Sub-features

- `picks-explore`: Explore, the first tab: movies and series from the trending catalog, then recent releases.
- `picks-movies`: Movies: only movies.
- `picks-shows`: Shows: only series, each line starting with "Series".
- `picks-cards`: ▲ from the shelf focuses the first card; ◀ ▶ move along them and the backdrop follows.
- `picks-open`: OK opens the card's service (`TV.launch` with its app id; with a Watchmode key, the title's page as
  params; with *Open picks in* Nuvio, Nuvio).
- `picks-tabs`: ▲ from the cards reaches the tabs; ◀ ▶ switch tab and the row reloads from its first pick.
- `top-buttons`: ▶ past the tabs: Live TV, inputs (opens the drawer), gear (Home Settings).

## How to get to it (user POV)

- ▲ from the shelf (cards), ▲ again (tabs and buttons), ◀ ▶ to change tab.

## Driving it with fmtv-verify.sh

Preconditions: a doctor-clean run built with the TMDB key in `config.properties` (not `--generic`) and the network up.

The `picks:TAB` step checks one tab against what TMDB answered in the same drive call, so the call must start with
`reset` (empty cache, so the list is fetched again). It waits up to 90 s for the cards and their lines, then requires:
- `/trending/movie/week` and `/trending/tv/week` were requested and answered 200;
- the tab on screen is TAB (by position, so any language works);
- 1 to `Prefs.cards()` cards, the same titles in the same order as `Data.picks` for that tab;
- Movies: every pick a movie, never reading "Series"; Shows: every pick a series reading "Series ·";
- every shown pick is in TMDB's trending or discover answer for its kind, and has an app to open it;
- in the whole list, no recent release comes before a trending title.
It writes `picks-TAB.json` (cards with kind, TMDB id, line and origin; the list's order by origin; the requests with
the key replaced by `REDACTED`) and prints e.g. `Shows: Grey's Anatomy [tv, discover]; ...; list 24, 17 trending`.

Proven on 2026-10-31 (about 8 s with the network up), all three tabs in one call:

```bash
$S drive reset picks:explore shot:picks-explore \
  key:up key:up 'assert:document.querySelector("#tabs .focus") === document.getElementById("tabs").children[0]' \
  key:right picks:movies shot:picks-movies \
  key:right picks:shows shot:picks-shows tmdb:tmdb
```

- **Cards.** After the above, `$S drive key:down state:picks-card0 key:right state:picks-card1` → focus moves from
  card 0 to card 1 in `cards`.
- **Open.** `$S drive key:ok state:picks-open` → the last call is a `launch` of the card's service app (e.g.
  `com.apple.appletv` for an Apple TV card).
- **Gear.** From the tabs, `key:right` until `#buttons` has the focus on its last child, `key:ok` →
  `sheets: ["settings"]`.

## Gotchas

- No TMDB key (`--generic`, or none in `config.properties`): no tabs and no cards; `picks:` fails with "no TMDB key
  in this build: picks not run". Report it not run; don't fake picks.
- Without `reset` the list comes from the cache and `picks:` fails with "no TMDB requests in this drive call".
- Picks are live TMDB data: titles change between runs and by the hour, so assert on structure (kind, origin, a
  launch call), never on a title.
- Trending is kept only when it's on one of the TV's apps; in the browser those are the stand-in's eight shelf apps
  plus All Apps, in the region of `tmdb_region` (BR here). If none is, the list is recent releases only and `picks:`
  says so in its output: report it, it isn't a failure of the app.
- Services turned off in Home Settings and *Cartoons and anime* off change the list.
- The key must never be printed: `picks:` and `tmdb:` cut `api_key=` out of every path; a v4 token travels in a
  header, which isn't recorded. Don't `eval:` `Prefs.tmdbKey()` or `CONFIG`.
