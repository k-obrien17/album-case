"""CC0 data client for the POC: MusicBrainz (identity + tags) and ListenBrainz
(similarity). Caches every response to poc/cache/ so reruns are free and we
stay polite to the APIs.

Not production code. Production uses bulk dumps, not these endpoints (see
PRODUCT.md "use dumps, not APIs for anything stored"). This is a spike to
answer one question: do the CC0 sources produce fun lanes?
"""

import json
import time
import hashlib
import urllib.parse
from pathlib import Path

import requests

CACHE = Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)

USER_AGENT = "AlbumCase-POC/0.1 (keith@totalemphasis.com)"
MB_BASE = "https://musicbrainz.org/ws/2"
# Similarity lives on the ListenBrainz *labs* API, not the main api host.
LB_LABS = "https://labs.api.listenbrainz.org"

# ListenBrainz CC0 similar-artists algorithm (verified during API recon, see HANDOFF).
LB_ALGO = "session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30"


def _cache_get(key: str):
    f = CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".json")
    if f.exists():
        return json.loads(f.read_text())
    return None


def _cache_put(key: str, value):
    f = CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".json")
    f.write_text(json.dumps(value))


def _get(url: str, params: dict, rate_sleep: float, retries: int = 3):
    """Cached GET with backoff. Cache key is the full URL+params."""
    key = url + "?" + urllib.parse.urlencode(sorted(params.items()))
    cached = _cache_get(key)
    if cached is not None:
        return cached
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(
                url, params=params, headers={"User-Agent": USER_AGENT}, timeout=45
            )
            resp.raise_for_status()
            data = resp.json()
            _cache_put(key, data)
            time.sleep(rate_sleep)  # only sleep on a real network hit
            return data
        except (requests.Timeout, requests.ConnectionError) as e:
            last_err = e
            time.sleep(2 * (attempt + 1))  # 2s, 4s, 6s backoff
    raise last_err


def resolve_mbid(name: str):
    """Name -> (mbid, canonical_name, tags). Returns None if no confident match."""
    data = _get(f"{MB_BASE}/artist", {"query": name, "fmt": "json", "limit": 5}, rate_sleep=1.1)
    artists = data.get("artists", [])
    if not artists:
        return None
    top = artists[0]
    tags = sorted(
        (t["name"] for t in top.get("tags", []) if t.get("count", 0) > 0),
        key=lambda n: n,
    )
    return {
        "mbid": top["id"],
        "name": top.get("name", name),
        "query": name,
        "score": top.get("score"),
        "tags": tags,
    }


def similar_artists(mbid: str):
    """MBID -> list of {artist_mbid, name, score} from the ListenBrainz CC0 dataset."""
    url = f"{LB_LABS}/similar-artists/json"
    params = {"artist_mbids": mbid, "algorithm": LB_ALGO}
    try:
        data = _get(url, params, rate_sleep=0.6)
    except requests.HTTPError:
        return []
    # LB returns a list of records; shape can be [ {...}, ... ] or nested. Normalize.
    out = []
    rows = data if isinstance(data, list) else data.get("payload", [])
    for r in rows:
        ambid = r.get("artist_mbid") or r.get("mbid")
        if ambid:
            out.append({
                "mbid": ambid,
                "name": r.get("name") or r.get("artist_name") or "?",
                "score": r.get("score", 0),
            })
    return out
