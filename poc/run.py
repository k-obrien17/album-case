"""Clustering POC runner. Answers one question: do CC0 sources produce fun lanes?

Pipeline:
  1. Resolve seed names -> MBIDs + tags (MusicBrainz).
  2. Fetch ListenBrainz similar-artists for each seed.
  3. Build a weighted graph (seeds + their neighbors, edges = similarity score),
     run Louvain community detection, record which community each seed landed in.
  4. Generate attribute lanes from seed names (food lexicon + one-word names).
     Wikidata-driven attribute lanes are the production path; this proves the shape.
  5. Write poc/result.json. report.py turns it into eyeball-able HTML.

Writes only to files (no stdout) to dodge the terminal's display truncation.
"""

import json
from pathlib import Path

import networkx as nx
import community as community_louvain

from seed import SEED
from client import resolve_mbid, similar_artists

HERE = Path(__file__).parent

# Food words for the attribute-lane demo. Production derives these from Wikidata
# + a real lexicon; this hand-list just proves the mechanism produces a fun lane.
FOOD_WORDS = {
    "cake", "bread", "korn", "corn", "pumpkin", "pumpkins", "sugar", "cream",
    "cherry", "peach", "meat", "egg", "honey", "salt", "pepper", "rice",
}


def build():
    # 1. resolve
    resolved = {}
    for name in SEED:
        r = resolve_mbid(name)
        if r:
            resolved[name] = r

    # 2. similar-artists per seed
    seed_mbids = {r["mbid"] for r in resolved.values()}
    similars = {}
    for name, r in resolved.items():
        similars[name] = similar_artists(r["mbid"])

    # 3. graph + Louvain
    G = nx.Graph()
    for name, r in resolved.items():
        G.add_node(r["mbid"], label=r["name"], seed=True)
    for name, sims in similars.items():
        src = resolved[name]["mbid"]
        for s in sims:
            w = float(s.get("score") or 1)
            # accumulate weight if edge already exists (mutual / shared paths)
            if G.has_edge(src, s["mbid"]):
                G[src][s["mbid"]]["weight"] += w
            else:
                G.add_edge(src, s["mbid"], weight=w)
            if s["mbid"] not in G.nodes or "label" not in G.nodes[s["mbid"]]:
                G.add_node(s["mbid"], label=s["name"], seed=s["mbid"] in seed_mbids)

    partition = community_louvain.best_partition(G, weight="weight", random_state=42)

    # group SEEDS by community (neighbors are scaffolding, not lane content here)
    clusters = {}
    for name, r in resolved.items():
        comm = partition.get(r["mbid"])
        clusters.setdefault(comm, []).append({
            "name": r["name"],
            "query": r["query"],
            "tags": r["tags"],
            "n_similar": len(similars[name]),
        })
    # only keep communities with >=2 seeds (a lane needs members)
    similarity_lanes = [
        {"community": c, "members": sorted(m, key=lambda x: x["name"])}
        for c, m in sorted(clusters.items())
        if len(m) >= 2
    ]
    singletons = [m[0]["name"] for c, m in clusters.items() if len(m) == 1]

    # 4. attribute lanes from names
    def words(n):
        return {w.strip(".,!*").lower() for w in n.replace("-", " ").split()}

    food_lane = sorted(
        r["name"] for r in resolved.values() if words(r["name"]) & FOOD_WORDS
    )
    oneword_lane = sorted(
        r["name"] for r in resolved.values()
        if len([w for w in r["name"].split() if w]) == 1
    )

    result = {
        "n_seeds": len(SEED),
        "n_resolved": len(resolved),
        "graph": {"nodes": G.number_of_nodes(), "edges": G.number_of_edges()},
        "similarity_lanes": similarity_lanes,
        "singletons": singletons,
        "attribute_lanes": [
            {"name": "Bands with foods in their name", "members": food_lane},
            {"name": "One-word band names", "members": oneword_lane},
        ],
        "resolved_detail": {
            r["query"]: {"name": r["name"], "tags": r["tags"], "score": r["score"]}
            for r in resolved.values()
        },
    }
    (HERE / "result.json").write_text(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    build()
