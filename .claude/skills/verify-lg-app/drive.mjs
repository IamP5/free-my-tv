#!/usr/bin/env node
// Drives one verification run's headless Chrome over CDP, with no dependencies (Node 22+ has WebSocket).
// Run it through `fmtv-verify.sh drive STEP...`, which sets PORT, CDP_PORT and EVIDENCE for the run.
//
// Steps, run in order; the first failure stops with exit 1:
//   open                 load the app fresh (load-time errors land in the journal)
//   reset                clear localStorage (Home Settings, shelf, language) and open
//   key:NAME[xN]         press a remote key N times: left right up down ok back (LG keyCodes 37-40, 13, 461)
//   seek:LABEL           press right/left until the focused item's text starts with LABEL (a shelf tile, a drawer
//                        key, an All Apps cell); seekv:LABEL does it with down/up (a settings row)
//   wait:MS              sleep
//   waitfor:JS           poll the expression until truthy (10 s)
//   assert:JS            fail unless the expression is truthy
//   eval:JS              print the expression's value (read-only use)
//   state:NAME           write EVIDENCE/NAME.json: focus, open sheets, toast, prefs, TV calls; and print it
//   shot:NAME            write EVIDENCE/NAME.png (1920x1080)
//   picks:TAB            explore|movies|shows: check the tab on screen against TMDB's trending and discover answers
//                        seen in this call (start it with reset); writes EVIDENCE/picks-TAB.json
//   tmdb:NAME            write EVIDENCE/NAME.json: TMDB requests in this call (key redacted) and the ids each list gave
// Every step and every page error is appended to EVIDENCE/journal.md.
import fs from 'node:fs';
import path from 'node:path';

const {PORT, CDP_PORT, EVIDENCE} = process.env;
if (!PORT || !CDP_PORT || !EVIDENCE) {
  console.error('Run through fmtv-verify.sh drive (PORT, CDP_PORT, EVIDENCE unset).');
  process.exit(2);
}
const APP = `http://127.0.0.1:${PORT}/index.html`;
const KEYS = {left: [37, 'ArrowLeft'], up: [38, 'ArrowUp'], right: [39, 'ArrowRight'], down: [40, 'ArrowDown'],
  ok: [13, 'Enter'], back: [461, 'GoBack']};
fs.mkdirSync(EVIDENCE, {recursive: true});
const journal = path.join(EVIDENCE, 'journal.md');
const log = (line) => fs.appendFileSync(journal, `- ${new Date().toISOString()} ${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The browser stand-in's TV.launch, TV.settings and TV.back do nothing visible: record their calls, the boundary
// where the real TV would act.
const RECORD = `(function () {
  if (!window.TV || TV.__recorded) return;
  window.__fmtv = window.__fmtv || {calls: []};
  ['launch', 'settings', 'back'].forEach(function (n) {
    var f = TV[n];
    TV[n] = function () {
      var args = [].slice.call(arguments).filter(function (a) { return typeof a !== 'function'; });
      __fmtv.calls.push({fn: n, args: args, at: Date.now()});
      return f.apply(TV, arguments);
    };
  });
  TV.__recorded = true;
})()`;

const STATE = `(function () {
  function owner(e) { while (e && !e.id) e = e.parentNode; return e ? e.id : ''; }
  function text(e) { return (e.textContent || '').replace(/\\s+/g, ' ').trim() || (e.querySelector('img') ? 'img:' + e.querySelector('img').getAttribute('src') : ''); }
  var prefs = null; try { prefs = JSON.parse(localStorage.getItem('fmtv.prefs')); } catch (e) {}
  var toast = document.getElementById('toast');
  return {
    tv: window.TV ? TV.name : null,
    focus: [].map.call(document.querySelectorAll('.focus'), function (e) { return {in: owner(e), class: e.className, text: text(e).slice(0, 80)}; }),
    sheets: [].map.call(document.querySelectorAll('.sheet.open'), function (e) { return e.id; }),
    drawerOpen: (' ' + document.body.className + ' ').indexOf(' drawer-open ') >= 0,
    shelf: [].map.call(document.querySelectorAll('#tiles .tile'), text),
    toast: toast && (' ' + toast.className + ' ').indexOf(' on ') >= 0 ? toast.textContent : null,
    prefs: prefs,
    calls: window.__fmtv ? __fmtv.calls : []
  };
})()`;

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target in Chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP connect failed')); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const {res, rej} = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, {res, rej});
    ws.send(JSON.stringify({id: n, method, params}));
  });
  return {send, on: (l) => listeners.push(l), close: () => ws.close()};
}

async function main() {
  const cdp = await connect();
  const errors = [];
  cdp.on((msg) => {
    let line = null;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      line = `page exception: ${d.exception ? d.exception.description : d.text} (${d.url || ''}:${d.lineNumber})`;
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      line = 'console.error: ' + msg.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' ');
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      line = `log error: ${msg.params.entry.text} ${msg.params.entry.url || ''}`;
    }
    if (line && /favicon\.ico/.test(line)) line = null;   // the page has none; not an app error
    if (line) { errors.push(line); log('ERROR ' + line); console.log('  ! ' + line); }
  });
  // TMDB traffic seen during this call: paths with the key cut out (a v4 token goes in a header, never recorded), and
  // the ids each list answered, so the picks can be traced back to TMDB's trending and discover lists.
  const tmdb = {requests: [], lists: {}};
  const tmdbById = new Map();
  cdp.on((msg) => {
    const p = msg.params || {};
    if (msg.method === 'Network.requestWillBeSent' && /^https:\/\/api\.tmdb\.org\//.test(p.request.url)) {
      const path = p.request.url.replace(/^https:\/\/api\.tmdb\.org/, '').replace(/([?&]api_key=)[^&]*/, '$1REDACTED');
      const r = {path, status: null};
      tmdb.requests.push(r);
      tmdbById.set(p.requestId, r);
    } else if (msg.method === 'Network.responseReceived' && tmdbById.has(p.requestId)) {
      tmdbById.get(p.requestId).status = p.response.status;
    } else if (msg.method === 'Network.loadingFinished' && tmdbById.has(p.requestId)) {
      const r = tmdbById.get(p.requestId), m = r.path.match(/^\/3\/(trending|discover)\/(movie|tv)\b/);
      if (!m || r.status !== 200) return;
      cdp.send('Network.getResponseBody', {requestId: p.requestId}).then((b) => {
        const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body);
        tmdb.lists[m[1] + ':' + m[2]] = (body.results || []).map((x) => ({id: x.id, title: x.title || x.name}));
      }).catch(() => {});
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  };
  const open = async () => {
    const loaded = new Promise((res) => cdp.on((m) => { if (m.method === 'Page.loadEventFired') res(); }));
    await cdp.send('Page.navigate', {url: APP});
    await loaded;
    await sleep(300);
  };
  const waitfor = async (expr, ms = 10000) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await evaluate(`!!(${expr})`)) return;
      if (Date.now() > end) throw new Error('timed out waiting for: ' + expr);
      await sleep(100);
    }
  };

  const url = await evaluate('location.href');
  if (url !== APP && !process.argv.slice(2).some((s) => s === 'open' || s === 'reset')) {
    throw new Error(`page is at ${url}, not ${APP}: run the "open" step first`);
  }
  if (url === APP) await evaluate(RECORD);

  for (const step of process.argv.slice(2)) {
    const i = step.indexOf(':');
    const name = i < 0 ? step : step.slice(0, i), arg = i < 0 ? '' : step.slice(i + 1);
    let out = '';
    if (name === 'open' || name === 'reset') {
      if (name === 'reset') { await open(); await evaluate('localStorage.clear()'); }
      await open();
      await evaluate(RECORD);
    } else if (name === 'key') {
      const [k, times] = arg.split('x');
      if (!KEYS[k]) throw new Error('unknown key ' + k);
      const [code, key] = KEYS[k];
      for (let n = 0; n < (Number(times) || 1); n++) {
        await cdp.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key});
        await cdp.send('Input.dispatchKeyEvent', {type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key});
        await sleep(150);
      }
    } else if (name === 'seek' || name === 'seekv') {
      // Press right (seekv: down) until the focused item's text is the label; if it stops moving first, try left (up).
      const focused = `(function () { var f = document.querySelectorAll('.focus'); f = f[f.length - 1];
        return f ? f.textContent.replace(/[‹›]/g, '').replace(/\\s+/g, ' ').trim() : ''; })()`;
      const dirs = name === 'seek' ? ['right', 'left'] : ['down', 'up'];
      let found = (await evaluate(focused)).indexOf(arg) === 0;
      for (const d of dirs) {
        for (let n = 0; n < 40 && !found; n++) {
          const before = await evaluate(focused);
          const [code, key] = KEYS[d];
          await cdp.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key});
          await cdp.send('Input.dispatchKeyEvent', {type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key});
          await sleep(150);
          const now = await evaluate(focused);
          found = now.indexOf(arg) === 0;
          if (now === before) break;
        }
      }
      if (!found) throw new Error(`no focusable item starting with "${arg}" in this row (focused: "${await evaluate(focused)}")`);
    } else if (name === 'picks') {
      out = await checkPicks(arg, evaluate, waitfor, tmdb);
    } else if (name === 'tmdb') {
      fs.writeFileSync(path.join(EVIDENCE, arg + '.json'), JSON.stringify(tmdb, null, 2) + '\n');
      out = `${tmdb.requests.length} TMDB requests, lists: ${Object.keys(tmdb.lists).join(' ') || 'none'}`;
    } else if (name === 'wait') {
      await sleep(Number(arg));
    } else if (name === 'waitfor') {
      await waitfor(arg);
    } else if (name === 'assert') {
      if (!(await evaluate(`!!(${arg})`))) throw new Error('assertion failed: ' + arg);
      out = 'true';
    } else if (name === 'eval') {
      out = JSON.stringify(await evaluate(arg));
    } else if (name === 'state') {
      const s = await evaluate(STATE);
      fs.writeFileSync(path.join(EVIDENCE, arg + '.json'), JSON.stringify(s, null, 2) + '\n');
      out = JSON.stringify(s);
    } else if (name === 'shot') {
      await sleep(400);   // let the focus transition land
      const {data} = await cdp.send('Page.captureScreenshot', {format: 'png'});
      fs.writeFileSync(path.join(EVIDENCE, arg + '.png'), Buffer.from(data, 'base64'));
      out = path.join(EVIDENCE, arg + '.png');
    } else {
      throw new Error('unknown step ' + step);
    }
    log(step + (out ? ' -> ' + out.slice(0, 400) : ''));
    console.log(step + (out ? '\n  ' + out : ''));
  }
  cdp.close();
  if (errors.length) console.log(`${errors.length} page error(s) logged in ${journal}`);
}

// picks:explore|movies|shows: the tab shown is that one, its cards are Data.picks for it, of its kind, and each came
// from TMDB's trending or discover list in this call; in the whole list trending comes first. Writes picks-TAB.json.
const TABS = {explore: [0, null], movies: [1, 'movie'], shows: [2, 'tv']};
async function checkPicks(tab, evaluate, waitfor, tmdb) {
  if (!TABS[tab]) throw new Error('picks: takes explore, movies or shows');
  const [index, kind] = TABS[tab];
  if (!(await evaluate('Data.hasKey()'))) throw new Error('no TMDB key in this build: picks not run');
  // The list is fetched one request at a time (trending, each title's details, discover): give it time.
  await waitfor(`document.querySelectorAll('#cards .card').length > 0 && [].every.call(document.querySelectorAll('#cards .card'), function (c) { return c.querySelector('.meta'); })`, 90000);
  const page = await evaluate(`(function () {
    var tabs = document.getElementById('tabs').children, on = -1;
    for (var i = 0; i < tabs.length; i++) if ((' ' + tabs[i].className + ' ').indexOf(' on ') >= 0) on = i;
    var recs = null; try { recs = JSON.parse(localStorage.getItem('fmtv.recs')); } catch (e) {}
    return {
      on: on, onLabel: on >= 0 ? tabs[on].textContent : '', perTab: Prefs.cards(), series: tr('Series'),
      cards: [].map.call(document.querySelectorAll('#cards .card'), function (c) {
        return {title: c.querySelector('.name').textContent, meta: c.querySelector('.meta').textContent};
      }),
      shown: Data.picks(${JSON.stringify(kind)}).map(function (p) { return {kind: p.kind, id: p.id, title: p.title, app: p.app}; }),
      list: recs && recs.picks ? recs.picks.map(function (p) { return {kind: p.kind, id: p.id, title: p.title}; }) : []
    };
  })()`);
  const has = (list, p) => (tmdb.lists[list + ':' + p.kind] || []).some((x) => x.id === p.id);
  const origin = (p) => has('trending', p) ? 'trending' : has('discover', p) ? 'discover' : null;
  const problems = [];
  if (!tmdb.requests.length) problems.push('no TMDB requests in this drive call: start it with reset so the list is fetched');
  for (const k of ['movie', 'tv']) {
    const r = tmdb.requests.find((x) => x.path.indexOf('/3/trending/' + k + '/week') === 0);
    if (!r) problems.push(`no /trending/${k}/week request`);
    else if (r.status !== 200) problems.push(`/trending/${k}/week answered ${r.status}`);
  }
  if (page.on !== index) problems.push(`tab ${index} should be on, tab ${page.on} (${page.onLabel}) is`);
  if (!page.cards.length || page.cards.length > page.perTab) problems.push(`${page.cards.length} cards, expected 1 to ${page.perTab}`);
  if (page.cards.map((c) => c.title).join('|') !== page.shown.map((p) => p.title).join('|')) problems.push('cards on screen differ from Data.picks for this tab');
  const shown = page.shown.map((p, i) => ({...p, meta: page.cards[i] ? page.cards[i].meta : '', origin: origin(p)}));
  for (const p of shown) {
    if (kind && p.kind !== kind) problems.push(`"${p.title}" is a ${p.kind} in the ${tab} tab`);
    if (p.kind === 'tv' && p.meta.indexOf(page.series) !== 0) problems.push(`"${p.title}" is a series but its line doesn't start with "${page.series}"`);
    if (p.kind === 'movie' && p.meta.indexOf(page.series) === 0) problems.push(`"${p.title}" is a movie but reads "${page.series}"`);
    if (!p.origin && tmdb.requests.length) problems.push(`"${p.title}" (${p.kind} ${p.id}) is in neither TMDB trending nor discover answer`);
    if (!p.app) problems.push(`"${p.title}" has no app to open it`);
  }
  // Trending (kept when on one of the TV's apps) is alternated in first, recent releases after.
  const origins = page.list.map(origin);
  const lastTrending = origins.lastIndexOf('trending'), firstDiscover = origins.indexOf('discover');
  if (tmdb.requests.length && lastTrending >= 0 && firstDiscover >= 0 && firstDiscover < lastTrending) {
    problems.push(`in the list, a recent release (#${firstDiscover}) comes before a trending title (#${lastTrending})`);
  }
  const trendingInList = origins.filter((o) => o === 'trending').length;
  const result = {tab, onLabel: page.onLabel, cards: shown, list: {size: page.list.length, trending: trendingInList,
    order: origins}, requests: tmdb.requests, problems};
  fs.writeFileSync(path.join(EVIDENCE, 'picks-' + tab + '.json'), JSON.stringify(result, null, 2) + '\n');
  if (problems.length) throw new Error('picks:' + tab + ':\n  - ' + problems.join('\n  - '));
  const note = trendingInList ? '' : ' (no trending title is on this TV\'s apps: only recent releases)';
  return `${page.onLabel}: ${shown.map((p) => `${p.title} [${p.kind}, ${p.origin}]`).join('; ')}; list ${page.list.length}, ${trendingInList} trending${note}`;
}

main().catch((e) => {
  log('FAIL ' + e.message);
  console.error('FAIL ' + e.message);
  process.exit(1);
});
