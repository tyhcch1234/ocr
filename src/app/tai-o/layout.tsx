import type { Metadata } from "next";
import { Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
import "./tai-o.css";

const sans = Noto_Sans_TC({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-tai-o-sans",
  display: "swap",
});

const serif = Noto_Serif_TC({
  weight: ["600", "700"],
  subsets: ["latin"],
  variable: "--font-tai-o-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "大澳旅遊指南｜香港水鄉一日遊",
  description:
    "書面粵語寫嘅大澳一日遊：棚屋水鄉、楊侯古廟、漁村市集同手信，由朝早九點半行到下晝五點。",
};

export default function TaiOLayout({ children }: LayoutProps<"/tai-o">) {
  return <div className={`${sans.variable} ${serif.variable} tai-o`}>{children}</div>;
}
