import Link from "@/components/classroom-link";
import { AudioLines, Mic, History } from "lucide-react";
export function RecordsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          Lecture<span className="brand-light">Flow</span>
        </Link>
        <nav className="record-navigation" aria-label="课堂导航">
          <Link href="/">
            <Mic size={16} />
            实时课堂
          </Link>
          <Link href="/records">
            <History size={16} />
            课堂记录
          </Link>
        </nav>
      </header>
      <main className="records-workspace">{children}</main>
    </div>
  );
}
