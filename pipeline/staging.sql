-- Staging tables for raw CC0 dump ingestion (MusicBrainz + ListenBrainz).
--
-- These are landing tables only: narrow projections of the source dumps,
-- holding just the columns needed to build an `entities` row (see
-- pipeline/schema.sql) -- release-group MBID, title, primary type, first
-- release year, and primary artist name + MBID -- plus popularity counts.
--
-- Truncate-and-reload semantics: both ingest_musicbrainz.py and
-- ingest_listenbrainz.py DELETE all rows from a staging table before
-- reinserting, so a refreshed bi-weekly dump replaces stale rows instead
-- of accumulating duplicates (DATA-05 at the staging layer).

CREATE TABLE IF NOT EXISTS stg_release_group (
    rg_id INTEGER,
    mbid TEXT,
    title TEXT,
    artist_credit INTEGER,
    primary_type INTEGER
);

CREATE TABLE IF NOT EXISTS stg_release_group_meta (
    rg_id INTEGER,
    first_release_year INTEGER
);

CREATE TABLE IF NOT EXISTS stg_artist_credit_name (
    artist_credit INTEGER,
    position INTEGER,
    artist_id INTEGER,
    credited_name TEXT
);

CREATE TABLE IF NOT EXISTS stg_artist (
    artist_id INTEGER,
    mbid TEXT,
    name TEXT
);

CREATE TABLE IF NOT EXISTS stg_popularity (
    release_group_mbid TEXT PRIMARY KEY,
    listen_count INTEGER,
    listener_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stg_release_group_artist_credit
    ON stg_release_group(artist_credit);
CREATE INDEX IF NOT EXISTS idx_stg_release_group_mbid
    ON stg_release_group(mbid);
CREATE INDEX IF NOT EXISTS idx_stg_artist_credit_name_artist_credit
    ON stg_artist_credit_name(artist_credit);
CREATE INDEX IF NOT EXISTS idx_stg_artist_artist_id
    ON stg_artist(artist_id);
CREATE INDEX IF NOT EXISTS idx_stg_release_group_meta_rg_id
    ON stg_release_group_meta(rg_id);
