#!/bin/sh
# Verification harness for the LG (webOS) web app in web/: an isolated preview build served on its own port and
# driven in its own headless Chrome over CDP (drive.mjs), plus read-only checks of the real TV.
#
#   fmtv-verify.sh launch            build, serve, open headless Chrome; prints RUN_ID=...
#   fmtv-verify.sh doctor            is this run's instance worth driving?
#   fmtv-verify.sh drive STEP...     run drive.mjs steps against this run (see SKILL.md)
#   fmtv-verify.sh stop              stop this run's server and Chrome (evidence stays)
#   fmtv-verify.sh tv-doctor [IP]    read-only: is the TV reachable, and does the installed app match web/?
#
# A run is picked by $RUN_ID, else the last one launched from this checkout (out/verify/.last).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
STATE_BASE=${TMPDIR:-/tmp}/fmtv-verify
TV_IP=192.168.0.9

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

load_run() {
  if [ -z "${RUN_ID:-}" ] && [ -f "$ROOT/out/verify/.last" ]; then RUN_ID=$(cat "$ROOT/out/verify/.last"); fi
  [ -n "${RUN_ID:-}" ] || { echo "No run: launch one first (or set RUN_ID)." >&2; exit 2; }
  STATE="$STATE_BASE/$RUN_ID"
  [ -f "$STATE/env" ] || { echo "Run $RUN_ID has no state in $STATE (stopped, or never launched)." >&2; exit 2; }
  . "$STATE/env"
  export RUN_ID PORT CDP_PORT EVIDENCE
}

alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }

case "${1:-}" in
launch)
  [ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)." >&2; exit 1; }
  RUN_ID=${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}
  STATE="$STATE_BASE/$RUN_ID"; EVIDENCE="$ROOT/out/verify/$RUN_ID"
  mkdir -p "$STATE" "$EVIDENCE"
  shift
  # Builds with config.properties (what the TV gets); pass --generic for the release's settings. The build's
  # config.js can hold the TMDB key: it stays in $STATE, never in the evidence, and is never printed.
  (cd "$ROOT" && python3 webos/build.py --preview "$@") > "$STATE/build.log" 2>&1 \
    || { cat "$STATE/build.log" >&2; exit 1; }
  grep -q '^Built FreeMyTV-webos.ipk' "$STATE/build.log" || { cat "$STATE/build.log" >&2; exit 1; }
  # out/webos is shared with the user's own preview server: serve a private copy.
  cp -R "$ROOT/out/webos" "$STATE/site"
  PORT=$(free_port); CDP_PORT=$(free_port)
  nohup python3 -m http.server "$PORT" --bind 127.0.0.1 -d "$STATE/site" > "$STATE/server.log" 2>&1 &
  SERVER_PID=$!
  nohup "$CHROME" --headless=new --remote-debugging-port="$CDP_PORT" --user-data-dir="$STATE/profile" \
    --window-size=1920,1080 --no-first-run --no-default-browser-check --disable-extensions about:blank \
    > "$STATE/chrome.log" 2>&1 &
  CHROME_PID=$!
  cat > "$STATE/env" <<EOF
PORT=$PORT
CDP_PORT=$CDP_PORT
SERVER_PID=$SERVER_PID
CHROME_PID=$CHROME_PID
EVIDENCE=$EVIDENCE
EOF
  echo "$RUN_ID" > "$ROOT/out/verify/.last"
  export RUN_ID PORT CDP_PORT EVIDENCE
  i=0
  until curl -sf "http://127.0.0.1:$PORT/index.html" >/dev/null && curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null; do
    i=$((i + 1)); [ $i -lt 100 ] || { echo "Server or Chrome didn't come up (see $STATE/*.log)." >&2; exit 1; }
    sleep 0.1
  done
  # Usable means the shelf is drawn, not just that a port answers.
  node "$HERE/drive.mjs" open 'waitfor:document.querySelectorAll("#tiles .tile").length > 0' state:boot shot:boot
  echo "RUN_ID=$RUN_ID"
  echo "Evidence: $EVIDENCE"
  ;;

doctor)
  load_run
  ok=1
  alive "$SERVER_PID" && echo "ok   server pid $SERVER_PID" || { echo "FAIL server pid $SERVER_PID not running"; ok=0; }
  alive "$CHROME_PID" && echo "ok   chrome pid $CHROME_PID" || { echo "FAIL chrome pid $CHROME_PID not running"; ok=0; }
  owner=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  [ "$owner" = "$SERVER_PID" ] && echo "ok   port $PORT owned by our server" || { echo "FAIL port $PORT owned by '${owner:-nobody}'"; ok=0; }
  curl -sf "http://127.0.0.1:$PORT/index.html" | grep -q '<title>Free My TV</title>' \
    && echo "ok   index.html is Free My TV" || { echo "FAIL index.html missing or not Free My TV"; ok=0; }
  stale=""
  for f in home.js home.css tv.js data.js strings.js index.html; do
    curl -sf "http://127.0.0.1:$PORT/$f" | cmp -s - "$ROOT/web/$f" || stale="$stale $f"
  done
  [ -z "$stale" ] && echo "ok   served build matches web/" || { echo "FAIL served build differs from web/:$stale (launch again)"; ok=0; }
  node "$HERE/drive.mjs" 'assert:TV.name === "browser" && document.querySelectorAll("#tiles .tile").length > 0' \
    > /dev/null 2>&1 && echo "ok   page up, TV stand-in, shelf drawn" || { echo "FAIL page not usable over CDP $CDP_PORT"; ok=0; }
  echo "run $RUN_ID  http://127.0.0.1:$PORT/index.html  cdp $CDP_PORT"
  [ $ok = 1 ] || exit 1
  ;;

drive)
  load_run
  shift
  exec node "$HERE/drive.mjs" "$@"
  ;;

stop)
  load_run
  # Only what this run started, by pid; the evidence in $EVIDENCE stays.
  alive "$CHROME_PID" && kill "$CHROME_PID" || true
  alive "$SERVER_PID" && kill "$SERVER_PID" || true
  sleep 0.5
  alive "$CHROME_PID" && kill -9 "$CHROME_PID" || true
  rm -rf "$STATE"
  [ "$(cat "$ROOT/out/verify/.last" 2>/dev/null)" = "$RUN_ID" ] && rm -f "$ROOT/out/verify/.last"
  echo "Stopped $RUN_ID. Evidence kept in $EVIDENCE"
  ;;

tv-doctor)
  ip=${2:-$TV_IP}
  key="$HOME/.ssh/freemytv_webos_$(echo "$ip" | tr . _)"
  nc -z -G 3 "$ip" 9922 2>/dev/null && echo "ok   $ip answers on 9922 (Developer Mode SSH)" \
    || { echo "FAIL $ip:9922 closed: TV off, or Developer Mode ran out"; exit 1; }
  [ -f "$key" ] && echo "ok   key present (~/.ssh/$(basename "$key"))" \
    || { echo "FAIL no key: the user runs python3 webos/install.py $ip in their own terminal"; exit 1; }
  # Developer Mode's jailed user may not ask which app is in front (getForegroundAppInfo, running: "Denied method
  # call"), but it can read the installed app's files: compare them with web/.
  (cd "$ROOT" && python3 - "$ip" "$key" <<'EOF'
import hashlib, sys
sys.path.insert(0, 'webos')
import install
ip, key = sys.argv[1], sys.argv[2]
names = ['home.js', 'home.css', 'tv.js', 'data.js', 'strings.js', 'index.html']
out = install.ssh(ip, key, 'cd /media/developer/apps/usr/palm/applications/%s && md5sum %s' % (install.APP_ID, ' '.join(names))).stdout or ''
tv = dict((l.split()[1], l.split()[0]) for l in out.splitlines() if len(l.split()) == 2)
if not tv:
    sys.exit('FAIL %s is not installed on the TV' % install.APP_ID)
stale = [n for n in names if tv.get(n) != hashlib.md5(open('web/' + n, 'rb').read()).hexdigest()]
print('FAIL installed app differs from web/: ' + ' '.join(stale) + ' (install again)' if stale else 'ok   installed %s matches web/' % install.APP_ID)
sys.exit(1 if stale else 0)
EOF
  )
  ;;

*)
  sed -n 2,11p "$0" | sed 's/^# \{0,1\}//'
  exit 2
  ;;
esac
