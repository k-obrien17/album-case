/** Stored inside lists_json so review decisions use the snapshot's versioned save. */
export type Backlog<T> = {
  readyToRank: T[];
  needsRefresher: T[];
  reviewedArtistIds: string[];
  currentArtistId: string | null;
  /** Full records returned to review, including albums no longer in the seed. */
  pendingReview?: T[];
};

export function emptyBacklog<T>(): Backlog<T> {
  return { readyToRank: [], needsRefresher: [], reviewedArtistIds: [], currentArtistId: null };
}

export function parseBacklog<T>(value: unknown, parseAlbums: (value: unknown) => T[] | null): Backlog<T> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const readyToRank = parseAlbums(raw.readyToRank);
  const needsRefresher = parseAlbums(raw.needsRefresher);
  const pendingReview = raw.pendingReview === undefined ? undefined : parseAlbums(raw.pendingReview);
  if (pendingReview === null) return null;
  if (!readyToRank || !needsRefresher || !Array.isArray(raw.reviewedArtistIds) ||
      !raw.reviewedArtistIds.every((id) => typeof id === 'string' && id.length > 0) ||
      !(raw.currentArtistId === null || (typeof raw.currentArtistId === 'string' && raw.currentArtistId.length > 0))) return null;
  return { readyToRank, needsRefresher, reviewedArtistIds: [...new Set(raw.reviewedArtistIds as string[])], currentArtistId: raw.currentArtistId as string | null,
    ...(pendingReview && { pendingReview }) };
}
