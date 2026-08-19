import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "哎一把｜多人模式",
  description: "2–8 人同时猜同一首 ilem 作品，第一位猜中者获胜。",
};

export default function MultiLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
