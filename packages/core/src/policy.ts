/** OSS history cap: scans never read or retain data older than this. */
export const MAX_SINCE_DAYS = 180;

export const MAX_SINCE_MS = MAX_SINCE_DAYS * 24 * 60 * 60 * 1000;
