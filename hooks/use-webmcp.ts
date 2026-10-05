"use client";
import { useEffect, useRef } from "react";
type Context = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useWebMcp(snapshot: unknown) {
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "read_current_classroom",
            title: "读取当前课堂",
            description:
              "Read only the classroom transcript, notes and analyses currently visible in LectureFlow. Demo content is explicitly marked. Does not read API keys, start the microphone or call external services.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(input) {
              if (
                !input ||
                typeof input !== "object" ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error("Expected an empty object");
              return latest.current;
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
}
