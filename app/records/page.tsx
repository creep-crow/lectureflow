"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  BookOpen,
  Pencil,
  Trash2,
  RotateCcw,
  Download,
  RefreshCw,
} from "lucide-react";
import { RecordsShell } from "@/components/records-shell";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  api,
  readFullClassroom,
  downloadClassroom,
} from "@/lib/classroom-client";
import type { ClassroomRecord } from "@/lib/classroom-types";
type Page = {
  classrooms: ClassroomRecord[];
  total: number;
  nextOffset: number | null;
};
export default function RecordsPage() {
  const [page, setPage] = useState<Page>({
      classrooms: [],
      total: 0,
      nextOffset: null,
    }),
    [view, setView] = useState("active"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [action, setAction] = useState(false),
    [edit, setEdit] = useState<ClassroomRecord | null>(null),
    [title, setTitle] = useState(""),
    [remove, setRemove] = useState<ClassroomRecord | null>(null),
    [notice, setNotice] = useState("");
  function reload() {
    setLoading(true);
    setRefresh((v) => v + 1);
  }
  useEffect(() => {
    const abort = new AbortController();
    void api<Page>(
      `/api/classrooms?manage=1&view=${view}&offset=${offset}&q=${encodeURIComponent(search)}`,
      { signal: abort.signal },
    )
      .then((data) => {
        if (!abort.signal.aborted) {
          setPage(data);
          setError("");
          if (!data.classrooms.length && offset > 0 && data.total > 0)
            setOffset(Math.floor((data.total - 1) / 30) * 30);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [view, offset, search, refresh]);
  async function mutate(task: () => Promise<unknown>, message: string) {
    setAction(true);
    setError("");
    try {
      await task();
      setEdit(null);
      setRemove(null);
      setNotice(message);
      await reload();
    } catch (e) {
      setError((e as Error).message);
      setEdit(null);
      setRemove(null);
    } finally {
      setAction(false);
    }
  }
  return (
    <RecordsShell>
      <div className="records-heading">
        <div>
          <h1>课堂记录</h1>
          <p>回看每一次听讲，整理你的笔记与总结。</p>
        </div>
        <button
          className="outline-btn"
          onClick={() => void reload()}
          disabled={loading || action}
        >
          <RefreshCw size={16} />
          刷新
        </button>
      </div>
      <div className="records-toolbar">
        <div className="record-view-tabs" aria-label="记录范围">
          <button
            aria-pressed={view === "active"}
            onClick={() => {
              setView("active");
              setOffset(0);
              setNotice("");
              reload();
            }}
          >
            全部课堂
          </button>
          <button
            aria-pressed={view === "trash"}
            onClick={() => {
              setView("trash");
              setOffset(0);
              setNotice("");
              reload();
            }}
          >
            回收站
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
            setOffset(0);
            reload();
          }}
          className="records-search"
        >
          <Search size={17} />
          <input
            aria-label="搜索课堂名称"
            placeholder="搜索课堂名称"
            value={query}
            maxLength={160}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">搜索</button>
        </form>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          {error.includes("登录") && (
            <a
              className="login-link"
              href="/signin-with-chatgpt?return_to=/records"
            >
              登录课堂空间
            </a>
          )}
        </div>
      )}
      {notice && (
        <p className="record-notice" role="status">
          {notice}
        </p>
      )}
      <div className="records-count">
        {view === "trash" ? "回收站" : "课堂"} · {page.total} 条
        {view === "trash" && (
          <span>删除的课堂可恢复，原文、笔记和总结会一并保留。</span>
        )}
      </div>
      {loading ? (
        <div className="records-empty" role="status">
          正在加载课堂记录…
        </div>
      ) : !page.classrooms.length ? (
        <div className="records-empty">
          <BookOpen size={32} />
          <h2>
            {search
              ? "没有找到匹配的课堂"
              : view === "trash"
                ? "回收站为空"
                : "还没有课堂记录"}
          </h2>
          <p>
            {search
              ? "试试其他课程名称。"
              : view === "trash"
                ? "移入回收站的课堂会出现在这里。"
                : "开始听讲后，课堂原文和翻译会自动保存。"}
          </p>
          {view === "active" && !search && (
            <Link className="primary-btn" href="/">
              开始听讲
            </Link>
          )}
        </div>
      ) : (
        <div className="records-list">
          {page.classrooms.map((row) => (
            <article className="record-card" key={row.id}>
              <div className="record-card-icon">
                <BookOpen size={23} />
              </div>
              <div className="record-card-body">
                <h2>
                  {view === "active" ? (
                    <Link href={`/records/${row.id}`}>{row.title}</Link>
                  ) : (
                    row.title
                  )}
                </h2>
                <div className="record-meta">
                  <span>
                    {new Date(row.created_at).toLocaleString("zh-CN")}
                  </span>
                  <span>{row.segment_count} 段原文</span>
                  <span>{row.analysis_count} 份总结</span>
                  {!!row.has_notes && <span>有笔记</span>}
                </div>
                <p className="record-excerpt">
                  {row.excerpt || "这堂课还没有转写内容。"}
                </p>
                {row.deleted_at && (
                  <p className="record-meta">
                    删除于 {new Date(row.deleted_at).toLocaleString("zh-CN")}
                  </p>
                )}
              </div>
              <div className="record-card-actions">
                {view === "trash" ? (
                  <button
                    className="outline-btn"
                    disabled={action}
                    onClick={() =>
                      void mutate(
                        () =>
                          api(`/api/classrooms/${row.id}/restore`, {
                            method: "POST",
                          }),
                        "课堂已恢复。",
                      )
                    }
                  >
                    <RotateCcw size={15} />
                    恢复课堂
                  </button>
                ) : (
                  <>
                    <Link className="outline-btn" href={`/records/${row.id}`}>
                      回看课堂
                    </Link>
                    <button
                      className="icon-btn"
                      aria-label={`重命名 ${row.title}`}
                      disabled={action}
                      onClick={() => {
                        setEdit(row);
                        setTitle(row.title);
                      }}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`导出 ${row.title}`}
                      disabled={action}
                      onClick={async () => {
                        setAction(true);
                        try {
                          downloadClassroom(await readFullClassroom(row.id));
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setAction(false);
                        }
                      }}
                    >
                      <Download size={17} />
                    </button>
                    <button
                      className="icon-btn delete-record"
                      aria-label={`删除 ${row.title}`}
                      disabled={action}
                      onClick={() => setRemove(row)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="record-pagination">
        <button
          className="outline-btn"
          disabled={offset === 0 || loading || action}
          onClick={() => {
            setOffset(Math.max(0, offset - 30));
            reload();
          }}
        >
          上一页
        </button>
        <span>第 {Math.floor(offset / 30) + 1} 页</span>
        <button
          className="outline-btn"
          disabled={page.nextOffset === null || loading || action}
          onClick={() => {
            setOffset(page.nextOffset!);
            reload();
          }}
        >
          下一页
        </button>
      </div>
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !action) setEdit(null);
        }}
      >
        <DialogContent>
          <DialogTitle>重命名课堂</DialogTitle>
          <DialogDescription>
            名称会同步显示在课堂和 ChatGPT 的记录列表中。
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (edit)
                void mutate(
                  () =>
                    api(`/api/classrooms/${edit.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        title: title.trim(),
                        revision: edit.revision,
                      }),
                    }),
                  "课堂名称已更新。",
                );
            }}
          >
            <label className="field">
              课堂名称
              <input
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={action}
              />
            </label>
            <button
              className="primary-btn create-btn"
              disabled={!title.trim() || action}
            >
              保存名称
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !action) setRemove(null);
        }}
      >
        <DialogContent>
          <DialogTitle>将课堂移入回收站？</DialogTitle>
          <DialogDescription>
            「{remove?.title}」将从课堂列表及 ChatGPT
            可读取的记录中隐藏。原文、译文、笔记和总结仍保留，可以在回收站恢复。
          </DialogDescription>
          <div className="record-dialog-actions">
            <button
              className="outline-btn"
              disabled={action}
              onClick={() => setRemove(null)}
            >
              取消
            </button>
            <button
              className="primary-btn danger-btn"
              disabled={action}
              onClick={() => {
                if (remove)
                  void mutate(
                    () =>
                      api(`/api/classrooms/${remove.id}`, {
                        method: "DELETE",
                        body: JSON.stringify({ revision: remove.revision }),
                      }),
                    "课堂已移入回收站，可随时恢复。",
                  );
              }}
            >
              {action ? "处理中…" : "移入回收站"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </RecordsShell>
  );
}
