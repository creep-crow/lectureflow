"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { api, ApiError, readFullClassroom } from "@/lib/classroom-client";
import { GeminiLive } from "@/lib/gemini-live";
import { GeminiChunks } from "@/lib/gemini-chunks";
import {
  clearConnectionSettings,
  readConnectionSettings,
  saveConnectionSettings,
  translationKeys,
} from "@/lib/connection-preferences";
import { TranslationKeyPool } from "@/lib/translation-key-pool";
import { translationApi } from "@/lib/translation-client";
import { drainSaves } from "@/lib/save-queue";
import {
  DEEPSEEK_URL,
  type TranslationProtocol,
} from "@/lib/translation-config";
import {
  displaySegments,
  type TranslationGroup,
} from "@/lib/semantic-translation";
import {
  FastTranslator,
  applyRefinement,
  snapshotMatches,
} from "@/lib/fast-translation";
import {
  LIVE_MODEL,
  TRANSLATION_MODEL,
  formatTime,
  type Classroom,
  type ClassroomData,
  type Segment,
  type Analysis,
} from "@/lib/classroom-types";
export type Settings = {
  geminiKey: string;
  deepseekKey: string;
  translationKeys: string[];
  translationConcurrency: number;
  translationStream: boolean;
  translationThinking: boolean;
  translationThinkingControl: boolean;
  translationUrl: string;
  translationProtocol: TranslationProtocol;
  liveModel: string;
  translationModel: string;
  deviceId: string;
  mode: "chunks" | "live";
  chunkModel: string;
};
const initialSettings: Settings = {
  geminiKey: "",
  deepseekKey: "",
  translationKeys: [],
  translationConcurrency: 2,
  translationStream: false,
  translationThinking: false,
  translationThinkingControl: false,
  translationUrl: DEEPSEEK_URL,
  translationProtocol: "deepseek",
  liveModel: LIVE_MODEL,
  translationModel: TRANSLATION_MODEL,
  deviceId: "",
  mode: "live",
  chunkModel: "gemini-3.5-transcribe",
};
export { ApiError } from "@/lib/classroom-client";
export function useClassroom() {
  const [settings, setSettingsState] = useState(initialSettings),
    [classrooms, setClassrooms] = useState<Classroom[]>([]),
    [current, setCurrent] = useState<Classroom | null>(null),
    [segments, setSegments] = useState<Segment[]>([]),
    [analyses, setAnalyses] = useState<Analysis[]>([]),
    [notes, setNotes] = useState(""),
    [dirty, setDirtyState] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [status, setStatus] = useState<
      "idle" | "connecting" | "live" | "reconnecting" | "stopping"
    >("idle"),
    [interim, setInterim] = useState(""),
    [level, setLevel] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [demo, setDemoState] = useState(false),
    [unsaved, setUnsaved] = useState(0),
    [syncPaused, setSyncPaused] = useState(false),
    [translationPending, setTranslationPending] = useState(0),
    [draftPending, setDraftPending] = useState(0),
    [refining, setRefining] = useState(false),
    [streamCharacters, setStreamCharacters] = useState(0),
    [thinkingActive, setThinkingActive] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const currentRef = useRef<Classroom | null>(null),
    settingsRef = useRef(settings),
    segmentsRef = useRef<Segment[]>([]),
    dirtyRef = useRef(false),
    recorder = useRef<GeminiLive | GeminiChunks | null>(null),
    started = useRef(0),
    offset = useRef(0),
    loading = useRef(0),
    queue = useRef(
      new Map<string, { classroomId: string; segment: Segment }>(),
    ),
    flushing = useRef<Promise<boolean> | null>(null),
    blockedSync = useRef(false),
    semantic = useRef<FastTranslator | null>(null),
    semanticId = useRef(""),
    pendingRef = useRef(0),
    demoRef = useRef(false);
  const keyPool = useRef<{
    signature: string;
    pool: TranslationKeyPool;
  } | null>(null);
  const persistSettings = useCallback(
    (value: Settings) => saveConnectionSettings(localStorage, value),
    [],
  );
  function setSettings(value: Settings) {
    persistSettings(value);
    settingsRef.current = value;
    setSettingsState(value);
  }
  function clearSettings() {
    clearConnectionSettings(localStorage);
    const reset = { ...initialSettings, translationKeys: [] };
    settingsRef.current = reset;
    setSettingsState(reset);
    return reset;
  }
  function poolFor(config: Settings) {
    const keys = translationKeys(config);
    const signature = JSON.stringify([
      config.translationUrl,
      config.translationProtocol,
      keys,
      config.translationConcurrency,
    ]);
    if (keyPool.current?.signature !== signature)
      keyPool.current = {
        signature,
        pool: new TranslationKeyPool(keys, config.translationConcurrency),
      };
    return keyPool.current.pool;
  }
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  function setDirty(value: boolean) {
    dirtyRef.current = value;
    setDirtyState(value);
  }
  function setDemo(value: boolean) {
    demoRef.current = value;
    setDemoState(value);
  }
  const report = useCallback(
    (e: unknown) =>
      setError(e instanceof Error ? e.message : "操作未完成，请重试。"),
    [],
  );
  const updateSegments = useCallback((fn: (rows: Segment[]) => Segment[]) => {
    segmentsRef.current = fn(segmentsRef.current);
    setSegments(segmentsRef.current);
  }, []);
  const enqueue = useCallback((classroomId: string, segment: Segment) => {
    const { id, english, chinese, offset_ms, translation_group } = segment;
    queue.current.set(id, {
      classroomId,
      segment: { id, english, chinese, offset_ms, translation_group },
    });
    setUnsaved(queue.current.size);
  }, []);
  const flush = useCallback(async () => {
    if (flushing.current) return flushing.current;
    if (blockedSync.current) return false;
    if (!queue.current.size) return true;
    const task = (async () => {
      try {
        const first = [...queue.current.values()][0];
        const batch = [...queue.current.values()]
          .filter((x) => x.classroomId === first.classroomId)
          .slice(0, 50);
        const included = new Set(batch.map((item) => item.segment.id));
        const deferred = new Set(
          batch
            .filter((item) =>
              item.segment.translation_group?.some(
                (source) => queue.current.has(source) && !included.has(source),
              ),
            )
            .map((item) => item.segment.id),
        );
        await api("/api/classrooms/" + first.classroomId + "/segments", {
          method: "POST",
          body: JSON.stringify({
            segments: batch.map((x) =>
              deferred.has(x.segment.id)
                ? { ...x.segment, chinese: "", translation_group: undefined }
                : x.segment,
            ),
          }),
        });
        for (const item of batch) {
          if (
            !deferred.has(item.segment.id) &&
            queue.current.get(item.segment.id) === item
          )
            queue.current.delete(item.segment.id);
        }
        setUnsaved(queue.current.size);
        return true;
      } catch (e) {
        if (e instanceof ApiError && [400, 404, 413, 422].includes(e.status)) {
          blockedSync.current = true;
          setSyncPaused(true);
          setError(
            e.message +
              " 自动保存已暂停，内容仍保留在页面。请导出课堂备份，处理问题后点击重试同步。",
          );
        } else report(e);
        return false;
      } finally {
        flushing.current = null;
      }
    })();
    flushing.current = task;
    return task;
  }, [report]);
  function semanticFor(id: string) {
    if (semantic.current && semanticId.current === id) return semantic.current;
    semantic.current?.dispose();
    semanticId.current = id;
    function requestTranslation<T>(
      path: string,
      payload: Record<string, unknown>,
    ) {
      const config = { ...settingsRef.current };
      return poolFor(config).run((key) =>
        translationApi<T>(
          path,
          {
            method: "POST",
            signal: AbortSignal.timeout(
              config.translationStream || config.translationThinking
                ? 180000
                : 55000,
            ),
            headers: key ? { "x-translation-key": key } : {},
            body: JSON.stringify({
              ...payload,
              model: config.translationModel,
              baseUrl: config.translationUrl,
              protocol: config.translationProtocol,
              stream: config.translationStream,
              thinking: config.translationThinking,
              thinkingControl: config.translationThinkingControl,
            }),
          },
          config.translationStream,
          (event) => {
            if (currentRef.current?.id !== id) return;
            setThinkingActive(event.thinking);
            if (event.characters)
              setStreamCharacters((n) => n + event.characters);
          },
        ),
      );
    }
    semantic.current = new FastTranslator({
      concurrency: () => poolFor(settingsRef.current).concurrency,
      snapshot: () => segmentsRef.current,
      translate: async (fragment, context) => {
        const result = await requestTranslation<{ translation: string }>(
          "/api/translate",
          { text: fragment.text, context: JSON.stringify(context) },
        );
        return result.translation;
      },
      refine: async (window) => {
        const result = await requestTranslation<{ groups: TranslationGroup[] }>(
          "/api/translate/segments",
          {
            fragments: window.fragments,
            drafts: window.drafts,
            context: JSON.stringify(window.context),
            force: true,
          },
        );
        return result.groups;
      },
      onDraft: (fragment, translation) => {
        if (currentRef.current?.id !== id) return;
        let anchor: Segment | undefined;
        updateSegments((rows) =>
          rows.map((s) => {
            if (s.id === fragment.id) {
              anchor = {
                ...s,
                chinese: translation,
                translation_group: [],
                translationError: false,
                refinementError: false,
              };
              return anchor;
            }
            return s;
          }),
        );
        if (anchor) enqueue(id, anchor);
        void flush();
      },
      onRefined: async (window, groups) => {
        if (
          currentRef.current?.id !== id ||
          !snapshotMatches(segmentsRef.current, window.expected)
        )
          return;
        const included = new Set(window.expected.map((r) => r.id));
        // Wait for initial translations to be saved; never re-upload stale prior groups.
        if (
          !(await drainSaves(
            () => queue.current,
            flush,
            () => !!flushing.current,
            included,
          ))
        )
          throw new Error("初译尚未保存，保留现有译文，请先重试同步。");
        if (!snapshotMatches(segmentsRef.current, window.expected)) return;
        await api("/api/classrooms/" + id + "/refine", {
          method: "POST",
          body: JSON.stringify({ expected: window.expected, groups }),
        });
        if (currentRef.current?.id !== id) return;
        updateSegments((rows) =>
          applyRefinement(rows, window.expected, groups),
        );
      },
      onPending: (count, polishing) => {
        pendingRef.current = count + (polishing ? 1 : 0);
        setTranslationPending(pendingRef.current);
        setDraftPending(count);
        setRefining(polishing);
        if (!pendingRef.current) setThinkingActive(false);
      },
      onError: (message, ids, stage) => {
        if (currentRef.current?.id !== id) return;
        updateSegments((rows) =>
          rows.map((s) =>
            ids.includes(s.id)
              ? {
                  ...s,
                  ...(stage === "draft"
                    ? { translationError: true }
                    : { refinementError: true }),
                }
              : s,
          ),
        );
        setError(
          message +
            (stage === "draft"
              ? " 原文仍保留，可重试翻译。"
              : " 初译仍保留，可重试整理译文。"),
        );
      },
    });
    return semantic.current;
  }
  function resetSemantic() {
    semantic.current?.dispose();
    semantic.current = null;
    semanticId.current = "";
    pendingRef.current = 0;
    setTranslationPending(0);
    setDraftPending(0);
    setRefining(false);
    setStreamCharacters(0);
    setThinkingActive(false);
  }
  useEffect(() => {
    const abort = new AbortController();
    void Promise.resolve().then(() => {
      if (abort.signal.aborted) return;
      try {
        const restored = readConnectionSettings(localStorage, initialSettings);
        settingsRef.current = restored;
        setSettingsState(restored);
      } catch {
        report(new Error("浏览器未允许读取已保存的连接设置。"));
      }
    });
    void api<{ classrooms: Classroom[] }>("/api/classrooms", {
      signal: abort.signal,
    })
      .then(async (r) => {
        if (abort.signal.aborted) return;
        setClassrooms(r.classrooms);
        const id = new URL(location.href).searchParams.get("classroom");
        if (id) {
          const data = await readFullClassroom(id, abort.signal);
          if (abort.signal.aborted) return;
          currentRef.current = data.classroom;
          setCurrent(data.classroom);
          updateSegments(() =>
            data.segments.map((s) => ({ ...s, translationError: !s.chinese })),
          );
          setNotes(data.classroom.notes);
          setAnalyses(data.analyses);
          setElapsed(data.segments.at(-1)?.offset_ms || 0);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) report(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    const timer = setInterval(() => void flush(), 4000);
    const unload = (e: BeforeUnloadEvent) => {
      if (
        queue.current.size ||
        dirtyRef.current ||
        recorder.current ||
        pendingRef.current
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("beforeunload", unload);
      void recorder.current?.cleanup();
      semantic.current?.dispose();
    };
  }, [flush, report, updateSegments]);
  useEffect(() => {
    if (status === "idle") return;
    const timer = setInterval(
      () => setElapsed(offset.current + Date.now() - started.current),
      500,
    );
    return () => clearInterval(timer);
  }, [status]);
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId || demo) return;
    const id = currentId;
    const timer = setInterval(() => {
      void api<ClassroomData>("/api/classrooms/" + id + "?segments=0")
        .then((data) => {
          if (currentRef.current?.id !== id || demoRef.current) return;
          setAnalyses(data.analyses);
          if (
            !dirtyRef.current &&
            data.classroom.revision >= (currentRef.current?.revision ?? 0)
          ) {
            setNotes(data.classroom.notes);
            setCurrent(data.classroom);
            currentRef.current = data.classroom;
          }
        })
        .catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, [currentId, demo]);
  async function loadClassroom(id: string) {
    if (status !== "idle" || dirty || unsaved || translationPending) {
      setError("请先停止听讲、保存笔记，并等待转写与翻译同步完成。");
      return;
    }
    const version = ++loading.current;
    setBusy(true);
    setError("");
    try {
      let cursor: number | null = 0;
      let all: Segment[] = [];
      let first: ClassroomData | undefined;
      do {
        const data: ClassroomData = await api(
          "/api/classrooms/" + id + "?cursor=" + cursor,
        );
        if (version !== loading.current) return;
        first ??= data;
        all = all.concat(data.segments);
        cursor = data.nextCursor;
      } while (cursor !== null);
      currentRef.current = first!.classroom;
      resetSemantic();
      setCurrent(first!.classroom);
      updateSegments(() =>
        all.map((s) => ({ ...s, translationError: !s.chinese })),
      );
      setNotes(first!.classroom.notes);
      setAnalyses(first!.analyses);
      setDemo(false);
      setDirty(false);
      setElapsed(all.at(-1)?.offset_ms || 0);
    } catch (e) {
      report(e);
    } finally {
      if (version === loading.current) setBusy(false);
    }
  }
  async function newClassroom(title: string) {
    if (status !== "idle" || dirty || unsaved || translationPending)
      throw new Error("请先停止听讲、保存笔记，并等待同步完成。");
    const row = await api<Classroom>("/api/classrooms", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    currentRef.current = row;
    resetSemantic();
    setCurrent(row);
    setClassrooms((c) => [row, ...c]);
    updateSegments(() => []);
    setNotes("");
    setAnalyses([]);
    setElapsed(0);
    setDemo(false);
    setDirty(false);
    return row;
  }
  async function start() {
    if (busy || status !== "idle") return;
    setError("");
    setBusy(true);
    try {
      let c = currentRef.current;
      let fresh = false;
      if (!c || demoRef.current) {
        c = await newClassroom(
          "英语课堂 · " + new Date().toLocaleString("zh-CN"),
        );
        fresh = true;
      }
      const id = c.id;
      const translator = semanticFor(id);
      const last = segmentsRef.current.at(-1)?.offset_ms;
      // `elapsed` holds the previous session's end time for this classroom
      // (or the last segment offset right after loadClassroom).
      offset.current =
        fresh || last === undefined ? 0 : Math.max(last + 1000, elapsed);
      started.current = Date.now();
      const callbacks: Omit<
        ConstructorParameters<typeof GeminiLive>[0],
        "token"
      > = {
        onFinal: (text, at) => {
          if (!text.trim()) return;
          const segment: Segment = {
            id: crypto.randomUUID(),
            offset_ms: Math.round(
              offset.current +
                Math.max(0, (at ?? Date.now()) - started.current),
            ),
            english: text.trim(),
            chinese: "",
          };
          updateSegments((rows) => [...rows, segment]);
          enqueue(id, segment);
          void flush();
          translator.append({ id: segment.id, text: segment.english });
        },
        onInterim: setInterim,
        onLevel: setLevel,
        onError: setError,
        onState: (s) => {
          setStatus(s === "stopped" ? "idle" : s);
          if (s === "stopped") {
            recorder.current = null;
            void translator.finish();
          }
        },
      };
      const live =
        settingsRef.current.mode === "live"
          ? new GeminiLive({
              ...callbacks,
              token: () => {
                const s = settingsRef.current;
                return api("/api/gemini/token", {
                  method: "POST",
                  headers: s.geminiKey ? { "x-gemini-key": s.geminiKey } : {},
                  body: JSON.stringify({ model: s.liveModel }),
                });
              },
            })
          : new GeminiChunks({
              ...callbacks,
              transcribe: async (audio) => {
                const s = settingsRef.current;
                const result = await api<{ text: string }>(
                  "/api/gemini/transcribe",
                  {
                    method: "POST",
                    headers: s.geminiKey ? { "x-gemini-key": s.geminiKey } : {},
                    body: JSON.stringify({ audio, model: s.chunkModel }),
                  },
                );
                return result.text;
              },
            });
      recorder.current = live;
      await live.start(settingsRef.current.deviceId);
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      await recorder.current?.cleanup();
      report(e);
      setStatus("idle");
      recorder.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setStatus("stopping");
    try {
      await recorder.current?.stop();
      await semantic.current?.finish();
      await flush();
    } finally {
      recorder.current = null;
      setStatus("idle");
      setInterim("");
    }
  }
  async function saveNotes() {
    if (!current || demo) return;
    if (notes.length > 100000) {
      setError(
        "笔记超过 100,000 字符，草稿仍保留。请先导出备份，再精简 " +
          (notes.length - 100000).toLocaleString("zh-CN") +
          " 个字符后保存。",
      );
      return;
    }
    const id = current.id;
    const draft = notes;
    setBusy(true);
    setError("");
    try {
      const saved = await api<Classroom>("/api/classrooms/" + id, {
        method: "PATCH",
        body: JSON.stringify({ notes: draft, revision: current.revision }),
      });
      currentRef.current = saved;
      setCurrent(saved);
      setDirty(false);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) return report(e);
      try {
        const latest = await api<ClassroomData>(
          "/api/classrooms/" + id + "?segments=0",
        );
        if (currentRef.current?.id !== id) return;
        currentRef.current = latest.classroom;
        setCurrent(latest.classroom);
        setAnalyses(latest.analyses);
        const server = latest.classroom.notes;
        const merge = server !== draft && !!draft.trim();
        setNotes(
          merge
            ? (server ? server + "\n\n" : "") +
                "--- 本窗口未保存的草稿 ---\n" +
                draft
            : server,
        );
        setDirty(merge);
        setError(
          merge
            ? "笔记已在其他窗口更新。已载入最新版本，并将本窗口草稿附在末尾，请整理后再次保存。"
            : "笔记已在其他窗口更新，已载入最新版本。",
        );
      } catch (inner) {
        report(inner);
      }
    } finally {
      setBusy(false);
    }
  }
  async function refreshDevices() {
    try {
      if (!navigator.mediaDevices)
        throw new Error("当前浏览器无法列出麦克风。");
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      report(e);
    }
  }
  function retryTranslation(segment: Segment) {
    if (!current || demo) return;
    const translator = semanticFor(current.id);
    if (segment.chinese || segment.translation_group?.length) {
      translator.retryRefinement(segment.id);
      return;
    }
    if (!translator.has(segment.id)) {
      const visible = displaySegments(segmentsRef.current);
      const index = visible.findIndex((s) => s.id === segment.id);
      for (const s of visible.slice(index, index + 20)) {
        if (s.chinese || s.translation_group?.length) break;
        translator.append({ id: s.id, text: s.english });
      }
    }
    updateSegments((rows) =>
      rows.map((s) =>
        s.id === segment.id ? { ...s, translationError: false } : s,
      ),
    );
    void translator.finish();
  }
  function showDemo() {
    if (status !== "idle" || dirty || unsaved || translationPending) {
      setError("请先保存当前课堂并等待同步完成。");
      return;
    }
    setDemo(true);
    resetSemantic();
    setError("");
    currentRef.current = null;
    setCurrent(null);
    setNotes("");
    setAnalyses([]);
    setElapsed(46000);
    updateSegments(() => [
      {
        id: "demo1",
        offset_ms: 12000,
        english:
          "Today, we’re going to explore a fundamental question: how do machines learn from experience?",
        chinese: "今天，我们将探讨一个基本问题：机器如何从经验中学习？",
      },
      {
        id: "demo2",
        offset_ms: 28000,
        english:
          "In supervised learning, we give the model examples of inputs along with their correct outputs. Think of it as learning with a teacher.",
        chinese:
          "在监督学习中，我们为模型提供输入及其正确输出的示例。你可以把它理解为有老师指导的学习。",
      },
      {
        id: "demo3",
        offset_ms: 46000,
        english:
          "The goal is not to memorize the training data, but to generalize — to make accurate predictions on examples the model has never seen before.",
        chinese:
          "目标不是记住训练数据，而是泛化——对模型从未见过的样本做出准确预测。",
      },
    ]);
  }
  function exportClassroom() {
    const title = demo ? "示例课堂" : current?.title || "课堂";
    const text =
      "# " +
      title +
      "\n\n" +
      displaySegments(segments)
        .map(
          (s) =>
            "[" +
            formatTime(s.offset_ms) +
            "] " +
            s.english +
            "\n\n" +
            s.chinese,
        )
        .join("\n\n") +
      "\n\n## 我的笔记\n\n" +
      notes +
      "\n\n" +
      analyses.map((a) => "## " + a.title + "\n\n" + a.content).join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = title.replace(/[<>:"/\\|?*]/g, "-") + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    settings,
    setSettings,
    persistSettings,
    clearSettings,
    classrooms,
    current,
    segments: displaySegments(segments),
    rawSegments: segments,
    analyses,
    notes,
    setNotes: (s: string) => {
      setNotes(s);
      setDirty(true);
    },
    dirty,
    error,
    setError,
    busy,
    status,
    interim,
    level,
    elapsed,
    demo,
    unsaved,
    syncPaused,
    translationPending,
    draftPending,
    refining,
    streamCharacters,
    thinkingActive,
    devices,
    loadClassroom,
    newClassroom,
    start,
    stop,
    saveNotes,
    showDemo,
    exportClassroom,
    retryTranslation,
    refreshDevices,
    flush: async () => {
      const id = currentRef.current?.id;
      blockedSync.current = false;
      setSyncPaused(false);
      setError("");
      const saved = await drainSaves(
        () => queue.current,
        flush,
        () => !!flushing.current,
      );
      if (saved && id && currentRef.current?.id === id) {
        const failed = segmentsRef.current
          .filter((s) => s.chinese && s.refinementError)
          .map((s) => s.id);
        if (failed.length) semanticFor(id).retryRefinements(failed);
      }
      return saved;
    },
  };
}
