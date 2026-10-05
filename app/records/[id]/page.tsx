"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "@/components/classroom-link";
import { Download, Mic, BookOpen, Sparkles } from "lucide-react";
import { RecordsShell } from "@/components/records-shell";
import { readFullClassroom, downloadClassroom } from "@/lib/classroom-client";
import { displaySegments } from "@/lib/semantic-translation";
import { formatTime, type ClassroomData } from "@/lib/classroom-types";
export default function RecordDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClassroomData | null>(null),
    [error, setError] = useState(""),
    [translation, setTranslation] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void readFullClassroom(id, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError((e as Error).message);
      });
    return () => abort.abort();
  }, [id]);
  return (
    <RecordsShell>
      <Link href="/records" className="record-back">
        返回课堂记录
      </Link>
      {error ? (
        <div role="alert" className="error-banner">
          {error}
          {error.includes("登录") && (
            <a
              className="login-link"
              href={`/signin-with-chatgpt?return_to=${encodeURIComponent(`/records/${id}`)}`}
            >
              登录课堂空间
            </a>
          )}
        </div>
      ) : !data ? (
        <div role="status" className="records-empty">
          正在读取完整课堂…
        </div>
      ) : (
        <>
          <div className="records-heading">
            <div>
              <h1>{data.classroom.title}</h1>
              <p>
                {new Date(data.classroom.created_at).toLocaleString("zh-CN")} ·{" "}
                {data.segments.length} 段原文 · {data.analyses.length} 份总结
              </p>
            </div>
            <div className="record-detail-actions">
              <button
                className="outline-btn"
                onClick={() => downloadClassroom(data)}
              >
                <Download size={16} />
                导出 Markdown
              </button>
              <Link className="primary-btn" href={`/?classroom=${id}`}>
                <Mic size={16} />
                打开课堂
              </Link>
            </div>
          </div>
          <div className="record-detail-grid">
            <section className="record-detail-panel">
              <div className="record-panel-heading">
                <h2>
                  <BookOpen size={18} />
                  课堂原文
                </h2>
                <label>
                  <input
                    type="checkbox"
                    checked={translation}
                    onChange={(e) => setTranslation(e.target.checked)}
                  />
                  显示中文
                </label>
              </div>
              {data.segments.length ? (
                displaySegments(data.segments).map((segment) => (
                  <article className="record-transcript" key={segment.id}>
                    <span>{formatTime(segment.offset_ms)}</span>
                    <div>
                      <p>{segment.english}</p>
                      {translation && (
                        <p className="record-chinese">
                          {segment.chinese || "这段尚未保存翻译。"}
                        </p>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <p className="record-placeholder">这堂课还没有转写内容。</p>
              )}
            </section>
            <aside className="record-review">
              <section className="record-detail-panel">
                <h2>
                  <BookOpen size={18} />
                  我的笔记
                </h2>
                <div className="record-notes">
                  {data.classroom.notes || "还没有笔记。"}
                </div>
              </section>
              <section className="record-detail-panel">
                <h2>
                  <Sparkles size={18} />
                  课堂总结
                </h2>
                {data.analyses.length ? (
                  data.analyses.map((a) => (
                    <article className="record-analysis" key={a.id}>
                      <h3>{a.title}</h3>
                      <p className="record-meta">
                        ChatGPT ·{" "}
                        {new Date(a.created_at).toLocaleString("zh-CN")}
                      </p>
                      <div>{a.content}</div>
                    </article>
                  ))
                ) : (
                  <p className="record-placeholder">
                    打开课堂后，可以通过 ChatGPT 生成总结。
                  </p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </RecordsShell>
  );
}
