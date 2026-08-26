import type { MetadataRoute } from "next";

import { buildRobotsConfig, siteOriginFromEnv } from "./site-origin.mjs";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return buildRobotsConfig(siteOriginFromEnv(process.env.SITE_ORIGIN));
}
