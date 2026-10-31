---
name: tv
description: Build this fork's LG app and put it on the TV at 192.168.0.9, then check it installed. Use when asked to try a change on the TV, deploy, install, update or reinstall Free My TV, or "/tv". Pass "uninstall" to remove it.
---

# Put Free My TV on the TV

1. **TV reachable?** `nc -z -G 3 192.168.0.9 9922`. Closed: the TV is off, or Developer Mode ran out. Ask me to turn
   the TV on, or to open the Developer Mode app (and press EXTEND, or turn Dev Mode Status on again). Stop there.
2. **Key there?** `~/.ssh/freemytv_webos_192_168_0_9` must exist. If not, the first install needs the passphrase I
   type: ask me to turn on Key Server on the TV and run `python3 webos/install.py 192.168.0.9` in my own terminal.
   Don't ask for the passphrase in the chat.
3. **Build:** `python3 webos/build.py` must end with `Built FreeMyTV-webos.ipk`.
4. **Install:** `python3 webos/install.py 192.168.0.9` (run it in the background: the TV's installer can take a
   minute). Done when it prints `Installed and open on the TV.` Anything else: show me what the TV said.
   For "uninstall": `python3 webos/install.py 192.168.0.9 --uninstall`, done at `Removed.`
5. **Tell me** in a line what changed on the TV and what to look at there.
