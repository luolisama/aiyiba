import type { MetadataRoute } from "next";

import { buildSitemapEntries, siteOriginFromEnv } from "./site-origin.mjs";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries(siteOriginFromEnv(process.env.SITE_ORIGIN));
}
