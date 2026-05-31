"""Turn result.json into a self-contained HTML report. Open poc/report.html
in a browser and eyeball: would 5 artists from a lane be a fun matchup?

This is the POC's actual output. The judgment is human and visual.
"""

import json
import html
from pathlib import Path

HERE = Path(__file__).parent
d = json.loads((HERE / "result.json").read_text())


def esc(s):
    return html.escape(str(s))


def chips(tags):
    return "".join(f'<span class="tag">{esc(t)}</span>' for t in tags[:8])


parts = []
parts.append(f"""<!doctype html><meta charset=utf-8>
<title>Taste Test — Clustering POC</title>
<style>
 body{{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}}
 h1{{font-size:1.5rem}} h2{{margin-top:2rem;border-bottom:2px solid #eee;padding-bottom:.3rem}}
 .meta{{color:#666;font-size:.9rem}}
 .lane{{border:1px solid #ddd;border-radius:10px;padding:1rem;margin:.8rem 0;background:#fafafa}}
 .lane h3{{margin:.2rem 0 .6rem;font-size:1.05rem}}
 .artist{{margin:.35rem 0}}
 .artist b{{font-size:1rem}}
 .tag{{display:inline-block;background:#eef;border-radius:6px;padding:1px 7px;margin:1px;font-size:.72rem;color:#446}}
 .attr .lane{{background:#fffaf0;border-color:#e8d8b0}}
 .empty{{color:#999;font-style:italic}}
 .verdict{{background:#f0f7ff;border-left:4px solid #57f;padding:.8rem 1rem;margin:1rem 0}}
</style>
<h1>Taste Test — Clustering POC</h1>
<p class=meta>{d['n_resolved']}/{d['n_seeds']} seeds resolved ·
 similarity graph: {d['graph']['nodes']} nodes, {d['graph']['edges']} edges ·
 source: MusicBrainz (identity+tags) + ListenBrainz CC0 similarity (Louvain communities)</p>
<div class=verdict><b>How to read this:</b> each similarity lane is a community the
algorithm found among the seed artists (their shared neighbors pulled them together).
The question for each lane: would a 5-artist matchup drawn from here be <i>fun</i> and
<i>apples-to-apples</i>? Attribute lanes below test the generated-lane mechanism.</div>
""")

parts.append("<h2>Similarity lanes (auto-derived)</h2>")
if not d["similarity_lanes"]:
    parts.append('<p class=empty>No multi-seed communities — graph collapsed or fragmented.</p>')
for ln in d["similarity_lanes"]:
    parts.append(f'<div class=lane><h3>Community {ln["community"]} · {len(ln["members"])} seeds</h3>')
    for m in ln["members"]:
        parts.append(
            f'<div class=artist><b>{esc(m["name"])}</b> '
            f'<span class=meta>({m["n_similar"]} similar)</span><br>{chips(m["tags"])}</div>'
        )
    parts.append("</div>")

if d.get("singletons"):
    parts.append(f'<p class=meta><b>Lone seeds</b> (own community, no seed-peers): {esc(", ".join(d["singletons"]))}</p>')

parts.append('<h2>Attribute lanes (generated)</h2><div class=attr>')
for ln in d["attribute_lanes"]:
    members = ln["members"]
    body = ", ".join(esc(m) for m in members) if members else "<span class=empty>no hits in seed set</span>"
    parts.append(f'<div class=lane><h3>{esc(ln["name"])} · {len(members)} hits</h3>{body}</div>')
parts.append("</div>")

(HERE / "report.html").write_text("\n".join(parts))
print("wrote report.html")
