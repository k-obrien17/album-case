#!/usr/bin/env python3
"""Regenerate artists.js from artists.json.

artists.json is the editable source of truth for the artist pool.
The game loads artists.js (a global array) so it works from file:// with no
server. Run this after editing artists.json:

    python3 build-artists.py

Then Reset in the app (or localStorage.clear() in DevTools) to reshuffle.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
data = json.load(open(HERE / "artists.json"))

lines = [
    "// Auto-generated from artists.json. Do not edit by hand.",
    "// Regenerate: python3 build-artists.py",
    "// artists.json is the editable source of truth.",
    "window.CALIBRATION_ARTISTS = [",
]
for entry in data:
    lines.append("  " + json.dumps(entry, ensure_ascii=False) + ",")
lines.append("];")

(HERE / "artists.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote artists.js with {len(data)} entries")
