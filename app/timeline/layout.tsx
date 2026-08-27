import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "哎一把｜时光机",
  description: "按投稿日期排列 10 首 ilem 音乐作品，挑战你的作品时间线记忆。",
  alternates: { canonical: "/timeline" },
};

export default function TimelineLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
