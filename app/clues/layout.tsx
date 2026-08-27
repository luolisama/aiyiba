import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "哎一把｜线索阶梯",
  description: "逐层解锁引擎、播放等级、演唱、投稿年份和歌名字数，猜出 ilem 的音乐作品。",
  alternates: { canonical: "/clues" },
};

export default function CluesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
