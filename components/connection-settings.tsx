"use client";
import { useState, useRef, useEffect } from "react";
import { Check, RefreshCw } from "lucide-react";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Settings } from "@/hooks/use-classroom";
import {
  readConnectionSettings,
  translationKeys,
} from "@/lib/connection-preferences";
import { TranslationKeyPool } from "@/lib/translation-key-pool";
import { api } from "@/lib/classroom-client";
import {
  DEEPSEEK_URL,
  OPENAI_URL,
  normalizeTranslationUrl,
  usesDefaultTranslationKey,
  type TranslationProtocol,
} from "@/lib/translation-config";

export function ConnectionSettings({
  settings,
  configured,
  devices,
  locked,
  onApply,
  onPersist,
  onClear,
}: {
  settings: Settings;
  configured: { gemini: boolean; deepseek: boolean };
  devices: MediaDeviceInfo[];
  locked: boolean;
  onApply: (settings: Settings) => void;
  onPersist: (settings: Settings) => void;
  onClear: () => Settings;
}) {
  const [draft, setDraft] = useState(() => {
      try {
        const restored = readConnectionSettings(localStorage, settings);
        return {
          ...restored,
          deepseekKey: [restored.deepseekKey, ...restored.translationKeys]
            .filter(Boolean)
            .join("\n"),
          translationKeys: [],
        };
      } catch {
        return settings;
      }
    }),
    [models, setModels] = useState<string[]>([]),
    [fetching, setFetching] = useState(false),
    [error, setError] = useState(""),
    [showKeys, setShowKeys] = useState(false),
    [saved, setSaved] = useState(false);
  const requestVersion = useRef(0);
  const skipNextCleanupSave = useRef(false);
  useEffect(() => {
    const flushDraft = () => {
      if (skipNextCleanupSave.current) return;
      try {
        onPersist(draft);
      } catch {
        /* A mounted form reports storage errors below. */
      }
    };
    // Refresh/navigation does not reliably run React's unmount cleanup.
    window.addEventListener("pagehide", flushDraft);
    const timer = setTimeout(() => {
      try {
        onPersist(draft);
        setSaved(true);
      } catch {
        setError(
          "浏览器未允许保存设置，请检查浏览器存储权限。当前填写内容仍保留在页面。",
        );
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flushDraft);
      if (skipNextCleanupSave.current) {
        skipNextCleanupSave.current = false;
        return;
      }
      flushDraft();
    };
  }, [draft, onPersist]);
  const serverKey = (() => {
    try {
      return (
        usesDefaultTranslationKey(
          draft.translationProtocol,
          draft.translationUrl,
        ) && configured.deepseek
      );
    } catch {
      return false;
    }
  })();
  function changeConnection(update: Partial<Settings>) {
    setSaved(false);
    requestVersion.current++;
    setDraft({ ...draft, ...update });
    setModels([]);
    setError("");
    setFetching(false);
  }
  async function getModels() {
    const version = ++requestVersion.current;
    setFetching(true);
    setError("");
    try {
      const baseUrl = normalizeTranslationUrl(
        draft.translationUrl,
        draft.translationProtocol,
      );
      const pool = new TranslationKeyPool(
        translationKeys(draft),
        draft.translationConcurrency,
      );
      const data = await pool.run((key) =>
        api<{ models: string[] }>("/api/translate/models", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "x-translation-key": key } : {}),
          },
          body: JSON.stringify({
            protocol: draft.translationProtocol,
            baseUrl,
          }),
          signal: AbortSignal.timeout(25000),
        }),
      );
      if (version !== requestVersion.current) return;
      setModels(data.models);
      setDraft((d) => ({
        ...d,
        translationUrl: baseUrl,
        translationModel: data.models.includes(d.translationModel)
          ? d.translationModel
          : data.models[0],
      }));
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : "获取模型失败，请重试。");
    } finally {
      if (version === requestVersion.current) setFetching(false);
    }
  }
  return (
    <>
      <DialogTitle>连接课堂模型</DialogTitle>
      <DialogDescription>
        Gemini 转写，所选接口翻译；ChatGPT 通过 MCP 总结课堂。
      </DialogDescription>
      <form
        className="connection-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!draft.translationModel.trim())
              throw new Error("请选择或填写翻译模型。");
            const translationUrl = normalizeTranslationUrl(
              draft.translationUrl,
              draft.translationProtocol,
            );
            const keys = translationKeys(draft);
            if (
              keys.length > 16 ||
              keys.some((key) => key.length > 512 || /[\r\n]/.test(key))
            )
              throw new Error(
                "最多填写 16 个有效 API Key，每个不超过 512 字符。",
              );
            if (!serverKey && !keys.length)
              throw new Error("请为所选翻译接口填写 API Key。");
            skipNextCleanupSave.current = true;
            onApply({
              ...draft,
              translationUrl,
              translationModel: draft.translationModel.trim(),
              deepseekKey: keys[0] || "",
              translationKeys: keys.slice(1),
            });
          } catch (e) {
            skipNextCleanupSave.current = false;
            setError((e as Error).message);
          }
        }}
      >
        <label className="field">
          Google AI Studio API Key
          <input
            type="password"
            autoComplete="off"
            disabled={locked}
            placeholder={
              configured.gemini ? "服务端已配置，可留空" : "输入 Gemini API Key"
            }
            value={draft.geminiKey}
            onChange={(e) => setDraft({ ...draft, geminiKey: e.target.value })}
          />
        </label>
        <div className="settings-grid">
          <label className="field">
            转写方式
            <select
              disabled={locked}
              value={draft.mode}
              onChange={(e) =>
                setDraft({ ...draft, mode: e.target.value as Settings["mode"] })
              }
            >
              <option value="live">Live 实时流式（默认）</option>
              <option value="chunks">兼容分段 · 最长约 6 秒</option>
            </select>
          </label>
          <label className="field">
            Gemini 转写模型
            <input
              disabled={locked}
              value={draft.mode === "live" ? draft.liveModel : draft.chunkModel}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ...(draft.mode === "live"
                    ? { liveModel: e.target.value }
                    : { chunkModel: e.target.value }),
                })
              }
            />
          </label>
        </div>
        <fieldset className="translation-settings" disabled={locked}>
          <legend>翻译接口</legend>
          <label className="field">
            接口格式
            <select
              value={draft.translationProtocol}
              onChange={(e) => {
                const translationProtocol = e.target
                  .value as TranslationProtocol;
                const preset = [DEEPSEEK_URL, OPENAI_URL].includes(
                  draft.translationUrl,
                );
                changeConnection({
                  translationProtocol,
                  ...(preset
                    ? {
                        translationUrl:
                          translationProtocol === "deepseek"
                            ? DEEPSEEK_URL
                            : OPENAI_URL,
                        deepseekKey: "",
                        translationKeys: [],
                        translationModel:
                          translationProtocol === "deepseek"
                            ? "deepseek-flash"
                            : "",
                      }
                    : {}),
                });
              }}
            >
              <option value="deepseek">DeepSeek 兼容</option>
              <option value="openai">OpenAI 兼容</option>
            </select>
          </label>
          <label className="field">
            {draft.translationProtocol === "openai"
              ? "接口网址"
              : "接口基础网址"}
            <input
              type="url"
              required
              placeholder={
                draft.translationProtocol === "openai"
                  ? "https://api.example.com/v1/chat/completions"
                  : "https://api.example.com/v1"
              }
              value={draft.translationUrl}
              onChange={(e) =>
                changeConnection({ translationUrl: e.target.value })
              }
            />
          </label>
          {draft.translationProtocol === "openai" && (
            <p className="settings-help">
              可填写基础网址或完整 /v1/chat/completions
              地址。完整聊天地址会直接用于翻译，不会移除或重复添加路径；模型列表使用同一路径下的
              /models。
            </p>
          )}
          <div className="provider-presets">
            <button
              type="button"
              onClick={() =>
                changeConnection({
                  translationProtocol: "deepseek",
                  translationUrl: DEEPSEEK_URL,
                  deepseekKey: "",
                  translationKeys: [],
                  translationModel: "deepseek-flash",
                })
              }
            >
              DeepSeek 官方
            </button>
            <button
              type="button"
              onClick={() =>
                changeConnection({
                  translationProtocol: "openai",
                  translationUrl: OPENAI_URL,
                  deepseekKey: "",
                  translationKeys: [],
                  translationModel: "",
                })
              }
            >
              OpenAI 官方
            </button>
          </div>
          <label className="field">
            翻译 API Keys（换行或逗号分隔）
            <textarea
              rows={4}
              maxLength={16384}
              className={"key-list-input" + (showKeys ? "" : " masked")}
              autoComplete="off"
              value={draft.deepseekKey}
              placeholder={
                serverKey
                  ? "服务端 DeepSeek 已配置，可留空"
                  : "输入此网址对应的 API Key"
              }
              onChange={(e) =>
                changeConnection({
                  deepseekKey: e.target.value,
                  translationKeys: [],
                })
              }
            />
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showKeys}
              onChange={(e) => setShowKeys(e.target.checked)}
            />
            显示密钥
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={draft.translationStream}
              onChange={(e) =>
                setDraft({ ...draft, translationStream: e.target.checked })
              }
            />
            启用流式传输
          </label>
          <label className="field">
            思考模式
            <select
              value={
                !draft.translationThinkingControl
                  ? "default"
                  : draft.translationThinking
                    ? "enabled"
                    : "disabled"
              }
              onChange={(e) =>
                setDraft({
                  ...draft,
                  translationThinking: e.target.value === "enabled",
                  translationThinkingControl: e.target.value !== "default",
                })
              }
            >
              <option value="default">默认兼容设置</option>
              <option value="disabled">关闭思考</option>
              <option value="enabled">开启思考</option>
            </select>
          </label>
          <p className="settings-help">
            原文收到后立即翻译，初译先显示；随后结合相邻已完成译文断句、拼接与润色。流式传输显示生成进度。默认兼容设置下
            DeepSeek 关闭思考，OpenAI
            兼容接口跟随模型默认；显式开关分别发送对应思考参数，需模型支持。中转站不支持
            reasoning_effort 时请选默认兼容设置。
          </p>
          <label className="field">
            翻译最大并发
            <select
              value={draft.translationConcurrency}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  translationConcurrency: Number(e.target.value),
                })
              }
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} 个请求
                </option>
              ))}
            </select>
          </label>
          <p className="settings-help">
            已填写 {translationKeys(draft).length} 个不同密钥；每个密钥同时最多
            1
            个请求，实际并发不超过密钥数。空闲密钥轮换使用，限流或网络失败后冷却
            30 秒，每个请求最多尝试 3
            个密钥。新片段立即请求初译，空闲时再整理已完成译文。
          </p>
          <button
            type="button"
            className="outline-btn"
            disabled={
              fetching || (!translationKeys(draft).length && !serverKey)
            }
            onClick={() => void getModels()}
          >
            <RefreshCw size={15} className={fetching ? "spin" : ""} />
            {fetching ? "获取中…" : "获取模型列表"}
          </button>
          {models.length > 0 && (
            <label className="field">
              可用模型
              <select
                value={
                  models.includes(draft.translationModel)
                    ? draft.translationModel
                    : ""
                }
                onChange={(e) =>
                  setDraft({ ...draft, translationModel: e.target.value })
                }
              >
                <option value="" disabled>
                  请选择模型
                </option>
                {models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <span className="settings-help">
                已获取 {models.length} 个模型，请选择支持文本对话和 JSON
                输出的模型。
              </span>
            </label>
          )}
          <label className="field">
            翻译模型名称
            <input
              required
              maxLength={200}
              value={draft.translationModel}
              placeholder="获取后选择，也可手动填写"
              onChange={(e) =>
                setDraft({ ...draft, translationModel: e.target.value })
              }
            />
          </label>
        </fieldset>
        <label className="field">
          麦克风设备
          <select
            disabled={locked}
            value={draft.deviceId}
            onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })}
          >
            <option value="">系统默认麦克风</option>
            {devices
              .filter((d) => d.deviceId && d.deviceId !== "default")
              .map((d, i) => (
                <option value={d.deviceId} key={d.deviceId}>
                  {d.label || "麦克风 " + (i + 1)}
                </option>
              ))}
          </select>
        </label>
        <p className="settings-help">
          填写后自动保存到当前浏览器，刷新或回看课堂后自动恢复；点击“保存并应用”生效。密钥保存在此浏览器的本地存储中，不写入课堂记录。多个密钥须属于所选接口并有相同模型权限；英文原文将发送给所选服务。
        </p>
        {saved && (
          <p role="status" className="settings-help">
            已自动保存到本浏览器。刷新后会恢复；当前会话请点击保存并应用。
          </p>
        )}
        {locked && (
          <p className="settings-help">请停止听讲并等待翻译完成后更改连接。</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="primary-btn"
          disabled={locked || fetching}
        >
          <Check size={15} />
          保存并应用
        </button>
        <button
          type="button"
          className="outline-btn"
          disabled={locked || fetching}
          onClick={() => {
            try {
              const reset = onClear();
              skipNextCleanupSave.current = true;
              requestVersion.current++;
              setDraft(reset);
              setSaved(false);
              setModels([]);
              setError("");
            } catch {
              setError("浏览器未允许清除设置，请检查存储权限后重试。");
            }
          }}
        >
          清除已保存的设置与密钥
        </button>
      </form>
    </>
  );
}
