import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import { siteOriginFromEnv, siteVerificationTokenFromEnv } from "./app/site-origin.mjs";

// Set USE_POLLING=1 when the local environment cannot deliver filesystem events.
const usePolling = /^(1|true)$/iu.test(process.env.USE_POLLING ?? "");

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), "");
  const envSiteOrigin = process.env.SITE_ORIGIN ?? loadedEnv.SITE_ORIGIN;
  const configuredSiteOrigin = siteOriginFromEnv(envSiteOrigin);
  const googleSiteVerification = siteVerificationTokenFromEnv(
    process.env.GOOGLE_SITE_VERIFICATION ?? loadedEnv.GOOGLE_SITE_VERIFICATION,
    "GOOGLE_SITE_VERIFICATION",
  );
  const bingSiteVerification = siteVerificationTokenFromEnv(
    process.env.BING_SITE_VERIFICATION ?? loadedEnv.BING_SITE_VERIFICATION,
    "BING_SITE_VERIFICATION",
  );
  const analyticsTrustProxy = /^(1|true)$/iu.test(
    process.env.ANALYTICS_TRUST_PROXY ?? loadedEnv.ANALYTICS_TRUST_PROXY ?? "",
  );
  const analyticsIngestUrl = (process.env.ANALYTICS_INGEST_URL ?? loadedEnv.ANALYTICS_INGEST_URL ?? "").trim();
  if (analyticsIngestUrl && !/^http:\/\/127\.0\.0\.1:[0-9]+\/analytics$/u.test(analyticsIngestUrl)) {
    throw new TypeError("ANALYTICS_INGEST_URL must be a loopback analytics endpoint");
  }

  return {
    define: {
      "process.env.SITE_ORIGIN": JSON.stringify(configuredSiteOrigin),
      "process.env.GOOGLE_SITE_VERIFICATION": JSON.stringify(googleSiteVerification ?? ""),
      "process.env.BING_SITE_VERIFICATION": JSON.stringify(bingSiteVerification ?? ""),
      "process.env.ANALYTICS_TRUST_PROXY": JSON.stringify(analyticsTrustProxy ? "true" : "false"),
      "process.env.ANALYTICS_INGEST_URL": JSON.stringify(analyticsIngestUrl),
    },
    server: {
      port: 3000,
      watch: usePolling ? { useFsEvents: false, usePolling: true } : undefined,
    },
    plugins: [vinext()],
  };
});
