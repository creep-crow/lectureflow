"use client";
import { useState, useEffect, useRef } from "react";
import Link from "@/components/classroom-link";
import { useRouter } from "next/navigation";
import {
  AudioLines,
  Mic,
  Settings2,
  Download,
  Sparkles,
  BookOpen,
  ArrowUpRight,
  Radio,
  Plug,
  Play,
  Check,
  Languages,
  Square,
  Plus,
  Copy,
  RefreshCw,
  Save,
  X,
  History,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectionSettings } from "@/components/connection-settings";
import { usesDefaultTranslationKey } from "@/lib/translation-config";
import { translationKeys } from "@/lib/connection-preferences";
import { useClassroom } from "@/hooks/use-classroom";
import { useWebMcp } from "@/hooks/use-webmcp";
import { formatTime } from "@/lib/classroom-types";

export default function Home() {
  const router = useRouter();
  const c = useClassroom();
  useWebMcp({
    classroom: c.current,
    demo: c.demo,
    segments: c.segments,
    rawFragments: c.rawSegments,
    notes: c.notes,
    analyses: c.analyses,
    unsavedNotes: c.dirty,
  });
  const [settingsOpen, setSettingsOpen] = useState(false),
    [mcpOpen, setMcpOpen] = useState(false),
    [newOpen, setNewOpen] = useState(false),
    [translation, setTranslation] = useState(true),
    [follow, setFollow] = useState(true),
    [title, setTitle] = useState(""),
    [copied, setCopied] = useState(false),
    [endpoint, setEndpoint] = useState(""),
    [mcpConfig, setMcpConfig] = useState(""),
    [mcpClient, setMcpClient] = useState("generic"),
    [mcpReadOnly, setMcpReadOnly] = useState(false),
    [mcpPlacement, setMcpPlacement] = useState(""),
    [mcpLoading, setMcpLoading] = useState(false),
    [configured, setConfigured] = useState({ gemini: false, deepseek: false });
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mcpOpen) return;
    const controller = new AbortController();
    void fetch(`/api/local/mcp-config?client=${encodeURIComponent(mcpClient)}&readOnly=${mcpReadOnly ? "1" : "0"}`, { signal: controller.signal })
      .then(async response => response.ok ? await response.json() as { content?: string; placement?: string } : null)
      .then(data => { if (!controller.signal.aborted) { setMcpConfig(data?.content || ""); setMcpPlacement(data?.placement || ""); } })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setMcpLoading(false); });
    return () => controller.abort();
  }, [mcpOpen, mcpClient, mcpReadOnly]);
  useEffect(() => {
    void fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setConfigured(data as { gemini: boolean; deepseek: boolean });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (follow && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [c.segments, c.interim, follow]);
  const recording = c.status !== "idle",
    locked =
      recording ||
      c.busy ||
      c.dirty ||
      c.unsaved > 0 ||
      c.translationPending > 0;
  const prompt = c.current
    ? "请使用 LectureFlow 工具读取课堂「" +
      c.current.title +
      "」（classroom_id: " +
      c.current.id +
      "）的完整转写和已有笔记，按 nextCursor 读取所有分页。请用中文梳理核心概念、论证脉络、难点与复习问题，引用转写时间戳，区分课堂原文与补充解释，并调用 save_classroom_analysis 将总结保存到这堂课。不要修改转写或翻译。"
    : "请使用 LectureFlow 的 list_classrooms 找到最近一堂课，完整读取其转写与笔记，分析核心概念和难点，并调用 save_classroom_analysis 保存总结。";
  const displayedPrompt = mcpReadOnly ? prompt.replace(/并调用 save_classroom_analysis[^。]*。/g, "只在聊天中展示总结，不要保存分析。") : prompt;
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      c.setError("复制未成功，请手动选择并复制文字。");
    }
  }
  async function create() {
    try {
      await c.newClassroom(title.trim());
      setNewOpen(false);
      setTitle("");
    } catch (e) {
      c.setError((e as Error).message);
    }
  }
  function openMcp(value: boolean) {
    if (value) resetMcpConfig();
    if (value) {
      setEndpoint(location.origin + "/mcp");
    }
    setMcpOpen(value);
  }
  function resetMcpConfig() {
    setMcpConfig("");
    setMcpPlacement("");
    setMcpLoading(true);
  }
  function begin() {
    if (
      (!c.settings.geminiKey && !configured.gemini) ||
      (!translationKeys(c.settings).length &&
        !(
          configured.deepseek &&
          usesDefaultTranslationKey(
            c.settings.translationProtocol,
            c.settings.translationUrl,
          )
        ))
    ) {
      setSettingsOpen(true);
      return;
    }
    void c.start();
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          Lecture<span className="brand-light">Flow</span>
        </Link>
        <span className="header-caption">全英课堂 · 听懂每一个知识点</span>
        <div className="top-actions">
          <button
            className="outline-btn records-nav"
            disabled={locked}
            onClick={() => router.push("/records")}
          >
            <History size={16} />
            课堂记录
          </button>
          <span className="private-label">
            <span />
            本地课堂空间
          </span>
          <button
            className="icon-btn"
            aria-label="连接设置"
            onClick={() => {
              setSettingsOpen(true);
              void c.refreshDevices();
            }}
          >
            <Settings2 size={19} />
          </button>
          <a
            className="avatar"
            title="打开本地课堂"
            href="/signin-with-chatgpt?return_to=/"
          >
            L
          </a>
        </div>
      </header>
      <main className="workspace">
        <section className="page-heading">
          <div>
            <div className="eyebrow">YOUR LEARNING SPACE</div>
            <h1>
              专注听讲，理解更多<span>。</span>
            </h1>
            <p>让语言不再成为课堂的边界。</p>
          </div>
          <button className="outline-btn" onClick={() => openMcp(true)}>
            <Plug size={16} />
            连接总结助手
            <ArrowUpRight size={15} />
          </button>
        </section>
        {c.error && (
          <div className="error-banner" role="alert">
            <span>
              {c.error}
              {c.error.includes("登录") && (
                <a
                  className="login-link"
                  href="/signin-with-chatgpt?return_to=/"
                >
                  登录课堂空间 →
                </a>
              )}
            </span>
            <button
              className="icon-btn"
              aria-label="关闭提示"
              onClick={() => c.setError("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <section className="session-bar">
          <div className="session-icon">
            <BookOpen size={21} />
          </div>
          <div className="session-name">
            {c.classrooms.length > 0 ? (
              <Select
                value={c.demo ? "demo" : c.current?.id || "none"}
                onValueChange={(id) => void c.loadClassroom(id)}
                disabled={locked}
              >
                <SelectTrigger className="classroom-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>
                    选择一堂课
                  </SelectItem>
                  {c.demo && (
                    <SelectItem value="demo" disabled>
                      Introduction to Machine Learning · 演示
                    </SelectItem>
                  )}
                  {c.classrooms.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <strong>
                {c.demo ? "Introduction to Machine Learning" : "我的英语课堂"}
              </strong>
            )}
            <span>
              {c.demo
                ? "示例课堂 · 预置内容，不采集音频"
                : c.current
                  ? new Date(c.current.created_at).toLocaleDateString("zh-CN") +
                    " · " +
                    c.segments.length +
                    " 段课堂内容"
                  : "准备就绪 · 开始你的第一堂课"}
            </span>
          </div>
          <div className="session-badges">
            <span>EN → 中文</span>
            <span>
              <Radio size={13} />{" "}
              {c.settings.mode === "live" ? "Gemini Live" : "Gemini 分段"}
            </span>
          </div>
          <button
            className="icon-btn"
            title="新建课堂"
            aria-label="新建课堂"
            disabled={locked}
            onClick={() => setNewOpen(true)}
          >
            <Plus size={18} />
          </button>
          <button
            className="icon-btn"
            title="导出 Markdown"
            aria-label="导出课堂"
            disabled={!c.segments.length && !c.notes}
            onClick={c.exportClassroom}
          >
            <Download size={18} />
          </button>
        </section>
        <div className="work-grid">
          <section className="transcript-panel">
            <div className="panel-heading">
              <h2>
                <AudioLines size={18} />
                实时课堂
              </h2>
              <label className="toggle-label">
                显示中文
                <Switch
                  checked={translation}
                  onCheckedChange={setTranslation}
                />
              </label>
            </div>
            <div className="transcript-toolbar">
              <span>
                <span
                  className={
                    recording || c.demo ? "status-dot active" : "status-dot"
                  }
                />
                {c.demo
                  ? "演示模式"
                  : {
                      idle: "等待开始",
                      connecting: "连接麦克风与 Gemini…",
                      live: "正在听讲",
                      reconnecting: "正在重连 · 暂存音频",
                      stopping: "正在收尾…",
                    }[c.status]}
              </span>
              <button
                className="follow-btn"
                aria-pressed={follow}
                onClick={() => setFollow((v) => !v)}
              >
                {follow ? "自动跟随 ↓" : "已暂停跟随"}
              </button>
            </div>
            <div
              className="transcript-scroll"
              ref={scroll}
              role="log"
              aria-label="课堂转写"
            >
              {c.segments.length ? (
                c.segments.map((s) => (
                  <article className="transcript-row" key={s.id}>
                    <span className="timestamp">{formatTime(s.offset_ms)}</span>
                    <div>
                      <p className="english">{s.english}</p>
                      {translation &&
                        (s.chinese ? (
                          <>
                            <p className="chinese">{s.chinese}</p>
                            {s.refinementError && (
                              <button
                                className="translation-retry"
                                onClick={() => c.retryTranslation(s)}
                              >
                                <RefreshCw size={11} />
                                初译已保留 · 重试整理译文
                              </button>
                            )}
                          </>
                        ) : s.translationError ? (
                          <button
                            className="translation-retry"
                            onClick={() => c.retryTranslation(s)}
                          >
                            <RefreshCw size={11} />
                            翻译失败 · 重试此段
                          </button>
                        ) : (
                          <p className="chinese pending">
                            正在翻译，完成后立即显示…
                          </p>
                        ))}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-class">
                  <div className="empty-wave">
                    <AudioLines size={44} />
                  </div>
                  <h3>准备好，开始听讲</h3>
                  <p>
                    连接 Gemini 与翻译接口，开启麦克风。
                    <br />
                    英文原文与中文翻译将在这里同步呈现。
                  </p>
                  <button
                    className="text-btn"
                    disabled={locked}
                    onClick={c.showDemo}
                  >
                    <Play size={14} />
                    先体验示例课堂
                  </button>
                  <div className="empty-steps">
                    <span>
                      <b>01</b> 连接模型
                    </span>
                    <span>
                      <b>02</b> 开启麦克风
                    </span>
                    <span>
                      <b>03</b> 专注课堂
                    </span>
                  </div>
                </div>
              )}
              {c.interim && (
                <article className="transcript-row">
                  <span className="timestamp">LIVE</span>
                  <p className="english pending">{c.interim}</p>
                </article>
              )}
            </div>
            {(c.unsaved > 0 || c.translationPending > 0) && (
              <div className="sync-bar" role="status">
                {c.unsaved > 0 && (
                  <button onClick={() => void c.flush()}>
                    {c.unsaved} 段待保存{c.syncPaused ? " · 保存暂停" : ""} ·
                    重试同步
                  </button>
                )}
                {c.translationPending > 0 && (
                  <span>
                    {c.draftPending > 0 && `${c.draftPending} 段正在翻译`}
                    {c.refining &&
                      `${c.draftPending > 0 ? " · " : ""}正在衔接与润色已完成译文`}
                    {c.thinkingActive
                      ? " · 模型正在思考"
                      : c.settings.translationStream && c.streamCharacters > 0
                        ? ` · 流式已接收 ${c.streamCharacters} 字`
                        : ""}
                  </span>
                )}
              </div>
            )}
            <footer className={"record-bar " + (recording ? "recording" : "")}>
              <div className="record-state">
                <span className="mic-bubble">
                  <Mic size={17} />
                </span>
                <div>
                  <strong>{recording ? "正在使用麦克风" : "系统麦克风"}</strong>
                  {recording ? (
                    <div className="level-meter" aria-label="麦克风音量">
                      <i style={{ width: c.level * 100 + "%" }} />
                    </div>
                  ) : (
                    <span>仅在开始听讲后采集声音</span>
                  )}
                </div>
              </div>
              <div className="record-actions">
                <span className="timer">{formatTime(c.elapsed)}</span>
                {recording ? (
                  <button
                    className="primary-btn stop-btn"
                    disabled={
                      c.status === "stopping" || c.status === "connecting"
                    }
                    onClick={() => void c.stop()}
                  >
                    <Square size={14} />
                    停止听讲
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    disabled={c.busy || c.translationPending > 0}
                    onClick={begin}
                  >
                    <Mic size={16} />
                    {c.segments.length && !c.demo ? "继续听讲" : "开始听讲"}
                  </button>
                )}
              </div>
            </footer>
          </section>
          <aside className="assistant-panel">
            <div className="panel-heading">
              <h2>
                <Sparkles size={18} />
                学习助手
              </h2>
              <span className="ai-label">Agent + MCP</span>
            </div>
            <Tabs defaultValue="summary" className="assistant-tabs">
              <TabsList className="study-tablist">
                <TabsTrigger value="summary">课堂总结</TabsTrigger>
                <TabsTrigger value="notes">
                  我的笔记{c.dirty ? " ·" : ""}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="summary">
                {c.analyses.length ? (
                  <div className="analysis-list">
                    {c.analyses.map((a) => (
                      <article className="analysis-card" key={a.id}>
                        <div className="analysis-meta">
                          <Sparkles size={13} />
                          AI 助手 ·{" "}
                          {new Date(a.created_at).toLocaleDateString("zh-CN")}
                        </div>
                        <h3>{a.title}</h3>
                        <div className="summary-text">{a.content}</div>
                      </article>
                    ))}
                    <button
                      className="outline-btn"
                      onClick={() => openMcp(true)}
                    >
                      继续深入分析
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="summary-content">
                    <div className="summary-icon">
                      <Sparkles size={26} />
                    </div>
                    <h3>从听懂，到掌握</h3>
                    <p>
                      让 AI 助手帮你梳理课堂脉络，
                      <br />
                      解释难点，建立知识之间的联系。
                    </p>
                    {[
                      ["提炼核心知识", "重点概念、论点与课堂结论"],
                      ["深入理解难点", "用清晰的解释和例子辅助理解"],
                      ["形成复习笔记", "分析结果直接回到课堂空间"],
                    ].map(([a, b]) => (
                      <div className="capability" key={a}>
                        <Check size={16} />
                        <div>
                          <strong>{a}</strong>
                          <span>{b}</span>
                        </div>
                      </div>
                    ))}
                    <button className="dark-btn" onClick={() => openMcp(true)}>
                      <Plug size={16} />
                      通过 Agent 总结
                      <ArrowUpRight size={15} />
                    </button>
                    <small>Gemini 转写 · 所选模型翻译 · Agent 总结</small>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="notes">
                {c.current && !c.demo ? (
                  <>
                    <textarea
                      className="notes-editor"
                      aria-label="我的课堂笔记"
                      placeholder="记下疑问、关键词，或你的理解…"
                      value={c.notes}
                      onChange={(e) => c.setNotes(e.target.value)}
                      disabled={c.busy}
                    />
                    <div className="notes-actions">
                      <span className="saved-label">
                        {c.dirty ? "有未保存的更改" : "已与课堂同步"}
                      </span>
                      <button
                        className="outline-btn"
                        disabled={!c.dirty || c.busy}
                        onClick={() => void c.saveNotes()}
                      >
                        <Save size={14} />
                        保存笔记
                      </button>
                    </div>
                    <p className="help-text">
                      AI 助手的分析单独保存在“课堂总结”，不会覆盖你的笔记。
                    </p>
                  </>
                ) : (
                  <div className="notes-placeholder">
                    <BookOpen size={30} />
                    <h3>留住重要的想法</h3>
                    <p>
                      新建或选择课堂后，即可记录笔记。示例课堂不会保存数据。
                    </p>
                    <button
                      className="text-btn"
                      onClick={() => setNewOpen(true)}
                    >
                      新建课堂
                      <Plus size={13} />
                    </button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
            <div className="tip-card">
              <Languages size={19} />
              <div>
                <strong>跟上课堂的节奏</strong>
                <p>
                  原文帮助理解语境，译文辅助快速掌握。遇到难点，课后交给 AI 助手
                  深入解析。
                </p>
              </div>
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            <span className="status-dot active" />
            {c.demo
              ? "当前显示预置示例"
              : c.unsaved
                ? "课堂内容等待同步"
                : "课堂文本与笔记保存在私密空间"}
          </span>
          <span>Listen. Understand. Connect.</span>
        </footer>
      </main>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="settings-dialog">
          {settingsOpen && (
            <ConnectionSettings
              settings={c.settings}
              configured={configured}
              onPersist={c.persistSettings}
              onClear={c.clearSettings}
              devices={c.devices}
              locked={recording || c.translationPending > 0}
              onApply={(settings) => {
                c.setSettings(settings);
                setSettingsOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={mcpOpen} onOpenChange={openMcp}>
        <DialogContent className="mcp-dialog">
          <DialogTitle>连接本地课堂与总结助手</DialogTitle>
          <DialogDescription>
            支持本地 MCP 的桌面助手可以读取课堂和笔记，将总结分析保存回来。
            它不参与转写或翻译。
          </DialogDescription>
          <ol className="mcp-steps">
            <li>
              选择你使用的客户端，将下方 LectureFlow 配置合并进去，保留其他服务。
              配置已填写这台电脑的程序位置。
            </li>
            <li>启用 LectureFlow，发送下方的总结请求。</li>
            <li>完成后回到此处；“课堂总结”会自动同步。</li>
          </ol>
          <label className="field">
            Agent 客户端
            <select aria-label="Agent 客户端" value={mcpClient} onChange={event => { resetMcpConfig(); setMcpClient(event.target.value); }}>
              <option value="generic">通用 MCP / Agent SDK</option>
              <option value="codex">Codex</option>
              <option value="claude-desktop">Claude Desktop</option>
              <option value="claude-code">Claude Code</option>
              <option value="cursor">Cursor</option>
              <option value="vscode">VS Code / Copilot</option>
            </select>
          </label>
          <label className="mcp-access-option">
            <input type="checkbox" checked={mcpReadOnly} onChange={event => { resetMcpConfig(); setMcpReadOnly(event.target.checked); }} />
            只读接入（可总结，不能保存分析）
          </label>
          {mcpPlacement && <p className="settings-help">{mcpPlacement}</p>}
          {mcpConfig ? (
            <details open>
              <summary>查看本地 MCP 配置</summary>
              <pre className="mcp-code">{mcpConfig}</pre>
              <button className="outline-btn" onClick={() => void copy(mcpConfig)}>
                <Copy size={14} />复制 MCP 配置
              </button>
            </details>
          ) : (
            <p className="settings-help">{mcpLoading ? "正在生成当前电脑的配置…" : "请通过 start.cmd 或 bash start.sh 启动，以获取本地 MCP 配置。"}</p>
          )}
          <div className="mcp-code">{displayedPrompt}</div>
          <button
            className="dark-btn"
            disabled={!!c.unsaved || c.demo}
            onClick={() => void copy(displayedPrompt)}
          >
            <Copy size={14} />
            {copied ? "已复制" : "复制总结请求"}
          </button>
          {c.demo && (
            <p className="settings-help">
              示例未保存，无法由 MCP 读取。请先创建真实课堂。
            </p>
          )}
          <details>
            <summary>查看 MCP 地址与工具</summary>
            <code className="endpoint">{endpoint}</code>
            <p className="settings-help">
              list_classrooms · read_classroom · read_notes
              {!mcpReadOnly && " · save_classroom_analysis"}
              <br />
              本地桌面客户端使用 stdio 入口。ChatGPT 网页版无法直接执行本机脚本；
              使用网页版时可导出课堂分析，远程 MCP 需另行配置。
            </p>
          </details>
        </DialogContent>
      </Dialog>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogTitle>新建课堂</DialogTitle>
          <DialogDescription>
            用课程名称区分每次听讲，转写与笔记将保存在这堂课中。
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label className="field">
              课堂名称
              <input
                autoFocus
                maxLength={160}
                required
                placeholder="例如：机器学习 · 第三讲"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button
              className="primary-btn create-btn"
              disabled={!title.trim() || locked}
              type="submit"
            >
              <Plus size={15} />
              创建课堂
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
