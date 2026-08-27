import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import { siteOriginFromEnv, siteVerificationTokenFromEnv } from "./app/site-origin.mjs";

// Set USE_POLLING=1 when the local environment cannot deliver filesystem events.
const usePolling = /^(1|true)$/iu.test(process.env.USE_POLLING ?? "");

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async ({ mode }) => {
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

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      "process.env.SITE_ORIGIN": JSON.stringify(configuredSiteOrigin),
      "process.env.GOOGLE_SITE_VERIFICATION": JSON.stringify(googleSiteVerification ?? ""),
      "process.env.BING_SITE_VERIFICATION": JSON.stringify(bingSiteVerification ?? ""),
    },
    server: usePolling
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
