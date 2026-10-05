import type { Settings } from "../hooks/use-classroom";

export const CONNECTION_STORAGE_KEY = "lectureflow.connections.v1";
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function translationKeys(
  settings: Pick<Settings, "deepseekKey" | "translationKeys">,
) {
  return [
    ...new Set(
      [settings.deepseekKey, ...settings.translationKeys]
        .flatMap((k) => k.split(/[\r\n,，;；]+/).map((value) => value.trim()))
        .filter(Boolean),
    ),
  ];
}
export function readConnectionSettings(
  storage: StorageAccess,
  defaults: Settings,
): Settings {
  try {
    const parsed = JSON.parse(
      storage.getItem(CONNECTION_STORAGE_KEY) || "null",
    );
    if (
      parsed?.version !== 1 ||
      !parsed.settings ||
      typeof parsed.settings !== "object"
    )
      return { ...defaults };
    const saved = parsed.settings;
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof Settings)[]) {
      if (
        typeof defaults[key] === "string" &&
        typeof saved[key] === "string" &&
        saved[key].length <= (key === "deepseekKey" ? 16384 : 1000) &&
        (key === "deepseekKey" || !/[\r\n]/.test(saved[key]))
      )
        Object.assign(result, { [key]: saved[key] });
    }
    if (!["deepseek", "openai"].includes(result.translationProtocol))
      result.translationProtocol = defaults.translationProtocol;
    if (!["live", "chunks"].includes(result.mode)) result.mode = defaults.mode;
    if (Array.isArray(saved.translationKeys))
      result.translationKeys = [
        ...new Set<string>(
          saved.translationKeys
            .filter(
              (key: unknown) =>
                typeof key === "string" &&
                key.length <= 512 &&
                !/[\r\n]/.test(key),
            )
            .slice(0, 15),
        ),
      ];
    if (
      Number.isInteger(saved.translationConcurrency) &&
      saved.translationConcurrency >= 1 &&
      saved.translationConcurrency <= 6
    )
      result.translationConcurrency = saved.translationConcurrency;
    for (const key of [
      "translationStream",
      "translationThinking",
      "translationThinkingControl",
    ] as const) {
      if (typeof saved[key] === "boolean") result[key] = saved[key];
    }
    return result;
  } catch {
    return { ...defaults };
  }
}
export function saveConnectionSettings(
  storage: StorageAccess,
  settings: Settings,
) {
  storage.setItem(
    CONNECTION_STORAGE_KEY,
    JSON.stringify({ version: 1, settings }),
  );
}
export function clearConnectionSettings(storage: StorageAccess) {
  storage.removeItem(CONNECTION_STORAGE_KEY);
}
