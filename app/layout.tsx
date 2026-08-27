import type { Metadata } from "next";
import "./globals.css";
import { siteOriginFromEnv, siteVerificationTokenFromEnv } from "./site-origin.mjs";

const siteOrigin = siteOriginFromEnv(process.env.SITE_ORIGIN);
const googleSiteVerification = siteVerificationTokenFromEnv(
  process.env.GOOGLE_SITE_VERIFICATION,
  "GOOGLE_SITE_VERIFICATION",
);
const bingSiteVerification = siteVerificationTokenFromEnv(
  process.env.BING_SITE_VERIFICATION,
  "BING_SITE_VERIFICATION",
);
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: "哎一把｜猜 ilem 的作品",
  description: "单人或与朋友一起，从演唱、引擎、歌名字数、日期与播放等级猜出 ilem 的音乐作品。",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "哎一把｜猜 ilem 的作品",
    description: "从演唱、引擎、日期与播放等级等线索中，猜出 ilem 的音乐作品。",
    siteName: "哎一把",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "哎一把｜猜 ilem 的作品",
    description: "从演唱、引擎、日期与播放等级等线索中，猜出 ilem 的音乐作品。",
    images: ["/og.png"],
  },
  verification: {
    google: googleSiteVerification,
    other: bingSiteVerification ? { "msvalidate.01": bingSiteVerification } : undefined,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
