import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LectureFlow · 全英课堂助手",
  description: "Gemini 实时转写，DeepSeek 中英翻译，ChatGPT 总结分析。",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
