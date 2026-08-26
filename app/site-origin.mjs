export const DEFAULT_SITE_ORIGIN = "https://aiyiba.getuphole.top";

export const PUBLIC_SITE_PATHS = ["/", "/solo", "/clues", "/timeline", "/multi"];

export function normalizeSiteOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("SITE_ORIGIN must be an absolute http(s) origin");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError("SITE_ORIGIN must be an absolute http(s) origin");
  }

  if (!/^https?:$/u.test(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) {
    throw new TypeError("SITE_ORIGIN must be an absolute http(s) origin without a path");
  }

  return parsed.origin;
}

export function siteOriginFromEnv(value) {
  return value === undefined ? DEFAULT_SITE_ORIGIN : normalizeSiteOrigin(value);
}

export function multiplayerAllowedOriginsFromEnv(explicitOrigins, siteOrigin) {
  const fallbackOrigin = siteOriginFromEnv(siteOrigin);
  return (explicitOrigins ?? fallbackOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function siteUrl(siteOrigin, pathname) {
  const normalizedOrigin = normalizeSiteOrigin(siteOrigin);
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    throw new TypeError("site URL paths must start with a slash");
  }
  return new URL(pathname, `${normalizedOrigin}/`).toString();
}

export function buildSitemapEntries(siteOrigin) {
  return PUBLIC_SITE_PATHS.map((pathname) => ({ url: siteUrl(siteOrigin, pathname) }));
}

export function buildRobotsConfig(siteOrigin) {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/pk/ws"],
    },
    sitemap: siteUrl(siteOrigin, "/sitemap.xml"),
  };
}
