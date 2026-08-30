import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "哎一把｜多人模式",
  description: "2–8 人同时猜同一首 ilem 作品；经典推理竞速，线索阶梯支持同层并列获胜。",
  alternates: { canonical: "/multi" },
};

export default function MultiLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
