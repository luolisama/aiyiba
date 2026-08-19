/**
 * The extended catalog contains every standard-catalog song plus a small set
 * of additional works. Keep this check at the presentation boundary so a
 * standard work drawn from the extended catalog is not mislabeled.
 */
export function isExtendedOnlySong(pool, bvid, standardBvids) {
  return pool === "hardcore" && typeof bvid === "string" && bvid.length > 0 && !standardBvids.has(bvid);
}
