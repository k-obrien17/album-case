// Only type imports here: web/scripts/*.mjs import this file directly under
// Node's type stripping, which can't resolve this directory's './x.js'
// runtime import convention.
import type { Client, InStatement } from '@libsql/client';
import type { DiscoveredAlbum, ReleaseGroup } from './_lp.js';

// Shared reference catalog of MusicBrainz albums and EPs (no secondary
// types). No session_id: this is reference data, not per-owner data.
// Triggers keep the external-content FTS index in sync on every write, so
// neither the bulk load nor the weekly refresh needs a rebuild step.
export const CATALOG_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS catalog_albums (
    mbid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    primary_artist_name TEXT NOT NULL,
    primary_artist_mbid TEXT,
    release_year INTEGER,
    primary_type TEXT NOT NULL,
    listener_count INTEGER NOT NULL,
    loaded_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_albums_artist
    ON catalog_albums(primary_artist_mbid)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS catalog_albums_fts USING fts5(
    title, primary_artist_name,
    content='catalog_albums', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS catalog_albums_ai AFTER INSERT ON catalog_albums BEGIN
    INSERT INTO catalog_albums_fts(rowid, title, primary_artist_name)
      VALUES (new.rowid, new.title, new.primary_artist_name);
  END`,
  `CREATE TRIGGER IF NOT EXISTS catalog_albums_ad AFTER DELETE ON catalog_albums BEGIN
    INSERT INTO catalog_albums_fts(catalog_albums_fts, rowid, title, primary_artist_name)
      VALUES ('delete', old.rowid, old.title, old.primary_artist_name);
  END`,
  `CREATE TRIGGER IF NOT EXISTS catalog_albums_au AFTER UPDATE ON catalog_albums BEGIN
    INSERT INTO catalog_albums_fts(catalog_albums_fts, rowid, title, primary_artist_name)
      VALUES ('delete', old.rowid, old.title, old.primary_artist_name);
    INSERT INTO catalog_albums_fts(rowid, title, primary_artist_name)
      VALUES (new.rowid, new.title, new.primary_artist_name);
  END`,
];

export type CatalogAlbum = {
  mbid: string;
  title: string;
  primary_artist_name: string;
  primary_artist_mbid: string | null;
  release_year: number | null;
  primary_type: string;
  listener_count: number;
};

export type SearchReleaseGroup = ReleaseGroup & {
  'artist-credit'?: { name?: string; artist?: { id?: string } }[];
};

const MAX_FTS_TOKENS = 10;
const FTS_CANDIDATES = 50;

export function coverUrlFor(mbid: string): string {
  return `https://coverartarchive.org/release-group/${mbid}/front-500`;
}

function releaseYearOf(group: ReleaseGroup): number | null {
  const yearStr = (group['first-release-date'] ?? '').split('-')[0];
  const year = Number(yearStr);
  return yearStr.length > 0 && Number.isInteger(year) ? year : null;
}

export function searchGroupToAlbum(group: SearchReleaseGroup): DiscoveredAlbum {
  const credit = group['artist-credit']?.[0];
  return {
    mbid: group.id,
    title: group.title,
    primary_artist_name: credit?.name ?? 'Unknown Artist',
    ...(credit?.artist?.id ? { primary_artist_mbid: credit.artist.id } : {}),
    release_year: releaseYearOf(group),
    cover_url: coverUrlFor(group.id),
  };
}

export function searchGroupToCatalogAlbum(group: SearchReleaseGroup): CatalogAlbum {
  const credit = group['artist-credit']?.[0];
  return {
    mbid: group.id,
    title: group.title,
    primary_artist_name: credit?.name ?? 'Unknown Artist',
    primary_artist_mbid: credit?.artist?.id ?? null,
    release_year: releaseYearOf(group),
    primary_type: group['primary-type'] ?? 'Album',
    listener_count: 0,
  };
}

// Tokens are letters/digits only, so they can't carry FTS syntax (quotes,
// parentheses, operators, column filters). Each is quoted so words like
// AND/OR/NOT stay literal; the last gets a prefix star for type-ahead.
export function toFtsQuery(q: string): string | null {
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_FTS_TOKENS);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}

// bm25 is negative and lower is better; subtracting log10(listeners) lets
// popularity settle close calls without overriding a clearly better match.
export function rankCatalogRows<T extends { relevance: number; listener_count: number }>(rows: T[]): T[] {
  const score = (r: T) => r.relevance - Math.log10(r.listener_count + 1);
  return [...rows].sort((a, b) => score(a) - score(b));
}

export async function searchCatalog(
  client: Pick<Client, 'execute'>,
  q: string,
  limit: number,
): Promise<DiscoveredAlbum[]> {
  const match = toFtsQuery(q);
  if (!match) return [];
  const result = await client.execute({
    sql: `SELECT c.mbid, c.title, c.primary_artist_name, c.primary_artist_mbid,
                 c.release_year, c.listener_count, bm25(catalog_albums_fts) AS relevance
          FROM catalog_albums_fts
          JOIN catalog_albums c ON c.rowid = catalog_albums_fts.rowid
          WHERE catalog_albums_fts MATCH ?
          ORDER BY relevance
          LIMIT ?`,
    args: [match, FTS_CANDIDATES],
  });
  const rows = result.rows.map((r) => ({
    mbid: String(r.mbid),
    title: String(r.title),
    primary_artist_name: String(r.primary_artist_name),
    primary_artist_mbid: r.primary_artist_mbid == null ? null : String(r.primary_artist_mbid),
    release_year: r.release_year == null ? null : Number(r.release_year),
    listener_count: Number(r.listener_count),
    relevance: Number(r.relevance),
  }));
  return rankCatalogRows(rows)
    .slice(0, limit)
    .map((r) => ({
      mbid: r.mbid,
      title: r.title,
      primary_artist_name: r.primary_artist_name,
      ...(r.primary_artist_mbid ? { primary_artist_mbid: r.primary_artist_mbid } : {}),
      release_year: r.release_year,
      cover_url: coverUrlFor(r.mbid),
    }));
}

export function mergeAlbums(
  primary: DiscoveredAlbum[],
  secondary: DiscoveredAlbum[],
  limit: number,
): DiscoveredAlbum[] {
  const seen = new Set(primary.map((a) => a.mbid));
  const merged = [...primary];
  for (const album of secondary) {
    if (seen.has(album.mbid)) continue;
    seen.add(album.mbid);
    merged.push(album);
  }
  return merged.slice(0, limit);
}

const FULL_UPDATE = `title = excluded.title,
  primary_artist_name = excluded.primary_artist_name,
  primary_artist_mbid = excluded.primary_artist_mbid,
  release_year = excluded.release_year,
  primary_type = excluded.primary_type,
  listener_count = excluded.listener_count,
  loaded_at = excluded.loaded_at`;

const KEEP_POPULARITY_UPDATE = `title = excluded.title,
  primary_artist_name = excluded.primary_artist_name,
  primary_artist_mbid = excluded.primary_artist_mbid,
  release_year = excluded.release_year,
  primary_type = excluded.primary_type`;

// 'full' is the bulk dump load (authoritative popularity). 'keep-popularity'
// is the weekly refresh: a new release has no popularity data yet, so it
// must never overwrite a real listener_count from the dump.
export function catalogUpsertStatement(
  album: CatalogAlbum,
  loadedAt: number,
  mode: 'full' | 'keep-popularity',
): InStatement {
  return {
    sql: `INSERT INTO catalog_albums (
            mbid, title, primary_artist_name, primary_artist_mbid,
            release_year, primary_type, listener_count, loaded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(mbid) DO UPDATE SET ${mode === 'full' ? FULL_UPDATE : KEEP_POPULARITY_UPDATE}`,
    args: [
      album.mbid,
      album.title,
      album.primary_artist_name,
      album.primary_artist_mbid,
      album.release_year,
      album.primary_type,
      album.listener_count,
      loadedAt,
    ],
  };
}
