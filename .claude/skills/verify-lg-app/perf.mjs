#!/usr/bin/env node
// Measures the drawer's open and close on a page over CDP: the TV itself (webOS Developer Mode serves DevTools on
// port 9998) or a verification run's headless Chrome. No dependencies (Node 22+ has WebSocket).
//
//   node perf.mjs HOST:PORT [--cycles N] [--trace FILE] [--throttle X] [--css RULES] [--detail] [--no-raf] [--keys down,up]
//                 [--on card] [--window MS] [--wait MS] [--auto N]
//
// --on card starts from the posters (--keys right,left then measures the hero's change of pick); --window and --wait
// set the span measured after each key and the pause before the next (the hero waits 250 ms, loads, fades for 700).
// --auto N presses nothing: it waits on the shelf for the hero's carousel to move on N times and measures each move.
//
// Each cycle presses ↓ on the shelf, waits, presses ↑, waits (--keys right,left measures a move along the shelf instead). Prints, per transition, the longest frame and the frames
// over 1.5 vsyncs from requestAnimationFrame, and with --trace the main thread's and the compositor's work in the
// transitions (by event name), from a Chrome trace saved to FILE. --detail lists each late frame: when it began after
// the key, and how long it took. The requestAnimationFrame loop itself runs the main thread every frame: --no-raf
// (with --trace) leaves it out and counts the frames the TV drew from the trace instead.
import fs from 'node:fs';

const args = process.argv.slice(2);
const target = args[0];
const opt = (name, def) => { const i = args.indexOf('--' + name); return i > 0 ? args[i + 1] : def; };
const CYCLES = +opt('cycles', 5), TRACE = opt('trace', ''), THROTTLE = +opt('throttle', 1), CSS = opt('css', ''), DETAIL = args.includes('--detail'), RAF = !args.includes('--no-raf');
const KEYS = {left: [37, 'ArrowLeft'], up: [38, 'ArrowUp'], right: [39, 'ArrowRight'], down: [40, 'ArrowDown']};
const PAIR = opt('keys', 'down,up').split(','), ON = opt('on', 'tile'), WAIT_MS = +opt('wait', 1400);
const WINDOW_MS = +opt('window', 700), SWAP_MS = +opt('window', 500), AUTO = +opt('auto', 0);   // the drawer's transform runs 380 ms; what follows it (late paints, raster) counts too
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!target) { console.error('usage: perf.mjs HOST:PORT [--cycles N] [--trace FILE] [--throttle X]'); process.exit(2); }

async function connect() {
  const page = (await (await fetch(`http://${target}/json/list`)).json()).find((t) => t.type === 'page');
  if (!page) throw new Error('no page at ' + target);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP connect failed')); });
  let id = 0;
  const pending = new Map(), listeners = [];
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

const cdp = await connect();
const evaluate = async (expr) => (await cdp.send('Runtime.evaluate', {expression: expr, returnByValue: true})).result.value;
const press = async (code, key) => {
  await cdp.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key});
  await cdp.send('Input.dispatchKeyEvent', {type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key});
};
const drawerOpen = () => evaluate(`(' ' + document.body.className + ' ').indexOf(' drawer-open ') >= 0`);

const info = await evaluate(`({visible: document.visibilityState, body: document.body.className, html: document.documentElement.className,
  ua: navigator.userAgent, memory: navigator.deviceMemory, ratio: devicePixelRatio, focus: (document.querySelector('.focus') || {}).className})`);
console.log('page:', JSON.stringify(info));
if (info.visible !== 'visible') { console.error('the app is not in front: frames would not run'); process.exit(1); }
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: THROTTLE});
// --css tries a change on the running page, without a build: the rules go in a style element until the next run.
if (CSS) await evaluate(`(function (css) {
  var s = document.getElementById('perf-css');
  if (!s) { s = document.createElement('style'); s.id = 'perf-css'; document.head.appendChild(s); }
  s.textContent = css;
})(${JSON.stringify(CSS)})`);
if (CSS) await sleep(1500);
else await evaluate(`(function (s) { if (s) s.parentNode.removeChild(s); })(document.getElementById('perf-css'))`);

// On the shelf (or the posters), drawer closed, before anything is measured.
if (await drawerOpen()) { await press(38, 'ArrowUp'); await sleep(800); }
const focused = () => evaluate(`(document.querySelector('.focus') || {}).className || ''`);
if (ON === 'card' && /\btile\b/.test(await focused())) { await press(38, 'ArrowUp'); await sleep(WAIT_MS); }
if (ON === 'tile' && /\bcard\b/.test(await focused())) { await press(40, 'ArrowDown'); await sleep(WAIT_MS); }
if (!new RegExp('\\b' + ON + '\\b').test(await focused())) { console.error(`focus is not on a ${ON}; put it there first`); process.exit(1); }

if (RAF) await evaluate(`(function () {
  window.__perf = {frames: [], on: true};
  function tick(t) { if (!__perf.on) return; __perf.frames.push(t); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})()`);

const events = [];
let traceDone = null;
if (TRACE) {
  cdp.on((m) => {
    if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
    if (m.method === 'Tracing.tracingComplete') traceDone();
  });
  await cdp.send('Tracing.start', {transferMode: 'ReportEvents', traceConfig: {includedCategories: [
    'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
    'blink', 'cc', 'gpu', 'viz', 'benchmark', 'toplevel', 'v8.execute', 'blink.user_timing']}});
}

const marks = [];
// The carousel's moves, seen from the page: the first frame after FreeMyTV.state.card changed.
if (AUTO) await evaluate(`(function () {
  var last = FreeMyTV.state.card, photo = '';
  window.__auto = [];
  clearInterval(window.__autoTimer);   // one left by an earlier run would count every move twice
  window.__autoTimer = setInterval(function () {
    // The hero's photo fading in (the front one changed): marked 'fade' for the trace.
    var front = document.querySelector('#hero .shot[style*="z-index: 1"]'), url = front ? front.getAttribute('data-url') : '';
    if (url !== photo) { photo = url; performance.mark('fade'); }
    if (FreeMyTV.state.card === last) return;
    last = FreeMyTV.state.card;
    performance.mark('auto');
    __auto.push(performance.now());
  }, 50);
})()`);
while (AUTO && (await evaluate(`__auto.length`)) < AUTO) await sleep(500);
if (AUTO) { await sleep(WAIT_MS); (await evaluate(`__auto`)).slice(0, AUTO).forEach((at) => marks.push({kind: 'auto', at})); }
for (let c = 0; c < (AUTO ? 0 : CYCLES); c++) {
  for (const [i, kind] of [[0, 'open'], [1, 'close']]) {
    const [code, key] = KEYS[PAIR[i]];
    const at = await evaluate(`performance.now()`);
    await evaluate(`performance.mark('${kind}')`);
    await press(code, key);
    marks.push({kind, at});
    await sleep(WAIT_MS);
  }
}
const frames = RAF ? await evaluate(`(__perf.on = false, __perf.frames)`) : [];
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});

if (RAF) {
const vsync = (() => {
  const d = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
})();
const rows = marks.map((m) => {
  const inside = frames.filter((t) => t >= m.at && t <= m.at + WINDOW_MS);
  const gaps = inside.slice(1).map((t, i) => t - inside[i]);
  const first = inside.length ? inside[0] - m.at : NaN;
  const late = gaps.map((g, i) => [inside[i] - m.at, g]).filter(([, g]) => g > vsync * 1.5);
  return {kind: m.kind, firstFrame: first, longest: Math.max(first, ...gaps), dropped: late.length, frames: inside.length,
    late: late.map(([at, g]) => `${at.toFixed(0)}+${g.toFixed(0)}`).join(' ')};
});
// The same span while nothing moves, at the end of each wait: what the TV drops anyway.
const idle = marks.map((m) => {
  const inside = frames.filter((t) => t >= m.at + WAIT_MS - WINDOW_MS && t <= m.at + WAIT_MS);
  return inside.slice(1).map((t, i) => t - inside[i]).filter((g) => g > vsync * 1.5).length;
});
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log(`vsync ~${vsync.toFixed(1)} ms; window ${WINDOW_MS} ms after each key`);
console.log(`idle  late frames in the same span with nothing moving: ${idle.join(' ')}`);
for (const kind of [...new Set(marks.map((m) => m.kind))]) {
  const r = rows.filter((x) => x.kind === kind);
  console.log(`${kind.padEnd(5)} longest frame ms: ${r.map((x) => x.longest.toFixed(0)).join(' ')} (median ${median(r.map((x) => x.longest)).toFixed(0)})` +
    `  | key→first frame: ${r.map((x) => x.firstFrame.toFixed(0)).join(' ')}` +
    `  | late frames: ${r.map((x) => x.dropped).join(' ')}  | frames: ${r.map((x) => x.frames).join(' ')}`);
  if (DETAIL) r.forEach((x) => console.log(`  ${kind} late (ms after key + length): ${x.late}`));
}
}

if (TRACE) {
  traceDone = null;
  const finished = new Promise((r) => { traceDone = r; });
  await cdp.send('Tracing.end');
  await finished;
  fs.writeFileSync(TRACE, JSON.stringify({traceEvents: events}));
  // The marks in the trace's clock, so each transition's window can be cut out of it.
  const traceMarks = events.filter((e) => e.cat && e.cat.indexOf('blink.user_timing') >= 0 && (e.name === 'open' || e.name === 'close' || e.name === 'auto'));
  const threads = {};
  for (const e of events) if (e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  // Frames the display drew in the first 500 ms (the drawer's slide is 380, the sky's lift 450), or --window: one per
  // 16.7 ms is smooth.
  const swaps = events.filter((e) => e.name === 'Display::DrawAndSwap' && e.ph === 'X').map((e) => e.ts);
  for (const kind of [...new Set(marks.map((m) => m.kind))]) {
    const per = traceMarks.filter((e) => e.name === kind).map((m) => {
      const t = swaps.filter((s) => s >= m.ts && s < m.ts + SWAP_MS * 1000);
      const gaps = t.slice(1).map((s, i) => (s - t[i]) / 1000);
      return `${t.length} drawn, longest gap ${Math.max(0, ...gaps).toFixed(0)} ms`;
    });
    console.log(`${kind}: ${per.join(' | ')}`);
  }
  for (const kind of [...new Set(marks.map((m) => m.kind))]) {
    const wins = traceMarks.filter((e) => e.name === kind).map((e) => [e.ts, e.ts + WINDOW_MS * 1000]);
    const sum = {};
    for (const e of events) {
      if (e.ph !== 'X' || !e.dur) continue;
      if (!wins.some(([a, b]) => e.ts >= a && e.ts < b)) continue;
      const k = (threads[e.pid + ':' + e.tid] || e.tid) + ' / ' + e.name;
      (sum[k] = sum[k] || {ms: 0, n: 0, max: 0});
      sum[k].ms += e.dur / 1000; sum[k].n++; sum[k].max = Math.max(sum[k].max, e.dur / 1000);
    }
    const top = Object.entries(sum).sort((a, b) => b[1].ms - a[1].ms).slice(0, 28);
    console.log(`\n${kind}: work per transition (${wins.length} windows), by thread / event`);
    for (const [k, v] of top) console.log(`  ${(v.ms / wins.length).toFixed(1).padStart(7)} ms  max ${v.max.toFixed(1).padStart(6)}  n ${String(v.n).padStart(4)}  ${k}`);
  }
  // --auto: the frames drawn while each photo fades in (700 ms), what a person sees move.
  const fades = events.filter((e) => e.name === 'fade' && e.cat && e.cat.indexOf('blink.user_timing') >= 0).map((e) => e.ts);
  if (fades.length) console.log('fades: ' + fades.map((f) => {
    const t = swaps.filter((s) => s >= f && s < f + 700000), gaps = t.slice(1).map((s, i) => (s - t[i]) / 1000);
    return `${t.length} drawn, longest gap ${Math.max(0, ...gaps).toFixed(0)} ms`;
  }).join(' | '));
  console.log(`\ntrace: ${TRACE} (${events.length} events)`);
}
cdp.close();
