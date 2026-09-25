import { CATALOG_SCHEMA_STATEMENTS, catalogUpsertStatement } from '../../api/_catalog.ts';

export const LOAD_BATCH_SIZE = 500;

/** Albums/EPs the pipeline materialized. Rows from a pre-migration build
 *  (release_type NULL) are skipped rather than guessed. */
export async function readPipelineAlbums(source) {
  const result = await source.execute(`
    SELECT mbid, title, primary_artist_name, primary_artist_mbid,
           release_year, release_type, notability_score
    FROM entities
    WHERE entity_type = 'album'
      AND release_type IN ('Album', 'EP')
      AND primary_artist_name IS NOT NULL
    ORDER BY mbid`);
  return result.rows.map((r) => ({
    mbid: String(r.mbid),
    title: String(r.title),
    primary_artist_name: String(r.primary_artist_name),
    primary_artist_mbid: r.primary_artist_mbid == null ? null : String(r.primary_artist_mbid),
    release_year: r.release_year == null ? null : Number(r.release_year),
    primary_type: String(r.release_type),
    listener_count: Number(r.notability_score ?? 0),
  }));
}

export async function loadCatalog({ source, target, write, now = Date.now(), log = console.log }) {
  const albums = await readPipelineAlbums(source);
  const byType = {};
  for (const a of albums) byType[a.primary_type] = (byType[a.primary_type] ?? 0) + 1;
  const report = {
    albums: albums.length,
    byType,
    batches: Math.ceil(albums.length / LOAD_BATCH_SIZE),
    sample: albums.slice(0, 5),
    written: 0,
  };
  if (!write) return report;

  for (const sql of CATALOG_SCHEMA_STATEMENTS) await target.execute(sql);
  for (let i = 0; i < albums.length; i += LOAD_BATCH_SIZE) {
    const chunk = albums.slice(i, i + LOAD_BATCH_SIZE);
    await target.batch(chunk.map((a) => catalogUpsertStatement(a, now, 'full')), 'write');
    report.written += chunk.length;
    if ((i / LOAD_BATCH_SIZE) % 20 === 0) log(`loaded ${report.written}/${albums.length}`);
  }
  return report;
}
