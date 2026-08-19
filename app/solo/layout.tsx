import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "哎一把｜单人模式",
  description: "选择标准或扩展题库，从六项线索中猜出 ilem 的音乐作品。",
};

export default function SoloLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
