type Callbacks = {
  token: () => Promise<{ token: string; model: string; config: unknown }>;
  onFinal: (text: string, at?: number) => void;
  onInterim: (text: string) => void;
  onState: (s: "connecting" | "live" | "reconnecting" | "stopped") => void;
  onLevel: (n: number) => void;
  onError: (s: string) => void;
};
export class GeminiLive {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private socket?: WebSocket;
  private active = false;
  private ready = false;
  private reconnecting = false;
  private pending: string[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private connectingReject?: (e: Error) => void;
  constructor(private callbacks: Callbacks) {}
  async start(deviceId = "") {
    this.active = true;
    this.callbacks.onState("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "浏览器无法使用麦克风，请使用 HTTPS 或 localhost 打开。",
        );
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (!this.active) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream
        .getAudioTracks()
        .forEach(
          (t) =>
            (t.onended = () => this.fail("麦克风已断开，请重新选择设备。")),
        );
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule("/pcm-capture.js");
      if (!this.active) {
        await this.cleanup();
        return;
      }
      this.node = new AudioWorkletNode(this.context, "pcm-capture");
      const source = this.context.createMediaStreamSource(this.stream);
      const mute = this.context.createGain();
      mute.gain.value = 0;
      source.connect(this.node);
      this.node.connect(mute);
      mute.connect(this.context.destination);
      this.node.port.onmessage = (event) => {
        if (!this.active) return;
        const bytes = new Uint8Array(event.data.buffer);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const packet = JSON.stringify({
          realtimeInput: {
            audio: {
              data: btoa(binary),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        });
        this.callbacks.onLevel(Math.min(1, event.data.level * 5));
        if (this.ready && this.socket?.readyState === WebSocket.OPEN)
          this.socket.send(packet);
        else {
          this.pending.push(packet);
          if (this.pending.length > 80)
            this.fail(
              "连接中断超过 10 秒，已停止采集。请重试，避免遗漏课堂内容。",
            );
        }
      };
      await this.context.resume();
      await this.connect();
    } catch (e) {
      await this.cleanup();
      const error = e as Error;
      throw new Error(
        error.name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器地址栏允许访问麦克风。"
          : error.name === "NotFoundError"
            ? "未找到麦克风，请连接设备后重试。"
            : error.name === "NotReadableError"
              ? "麦克风被其他应用占用或系统禁止访问。"
              : error.message,
      );
    }
  }
  private async connect() {
    const session = await this.callbacks.token();
    if (!this.active) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" +
          encodeURIComponent(session.token),
      );
      this.socket = ws;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.timer);
        this.connectingReject = undefined;
        ws.onclose = null;
        ws.close();
        reject(error);
      };
      this.connectingReject = fail;
      this.timer = setTimeout(
        () => fail(new Error("Gemini 连接超时，请检查网络和模型权限。")),
        15000,
      );
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            setup: {
              model: "models/" + session.model,
              generationConfig: { responseModalities: ["TEXT"] },
              inputAudioTranscription: { languageCodes: ["en-US"] },
            },
          }),
        );
      let receive = Promise.resolve();
      ws.onmessage = (event) => {
        receive = receive
          .then(async () => {
            const raw =
              typeof event.data === "string"
                ? event.data
                : await (event.data as Blob).text();
            if (this.socket !== ws) return;
            const message = JSON.parse(raw);
            if (message.error) {
              const error = new Error(
                "Gemini 拒绝了实时会话，请检查模型名称、密钥权限及额度。",
              );
              if (!settled) fail(error);
              else this.fail(error.message);
              return;
            }
            if (message.setupComplete) {
              settled = true;
              clearTimeout(this.timer);
              this.connectingReject = undefined;
              this.ready = true;
              this.callbacks.onState("live");
              for (const packet of this.pending) ws.send(packet);
              this.pending = [];
              resolve();
            }
            const content = message.serverContent;
            if (content?.interimInputTranscription?.text)
              this.callbacks.onInterim(content.interimInputTranscription.text);
            if (content?.inputTranscription?.text) {
              // The dedicated transcribe-live model emits finalized utterances here.
              // Speculative updates belong only in interimInputTranscription.
              this.callbacks.onFinal(content.inputTranscription.text);
              this.callbacks.onInterim("");
            }
            if (message.goAway && this.active) {
              this.callbacks.onState("reconnecting");
            }
          })
          .catch(() => this.fail("Gemini 返回了无法解析的数据，已停止采集。"));
      };
      ws.onerror = () => {
        if (!settled)
          fail(
            new Error("无法连接 Gemini，请检查网络能否访问 Google AI Studio。"),
          );
      };
      ws.onclose = () => {
        this.ready = false;
        if (!settled) {
          fail(new Error("Gemini 会话未能建立，请检查模型权限。"));
          return;
        }
        if (this.active) void this.reconnect();
      };
    });
  }
  private async reconnect() {
    if (this.reconnecting || !this.active) return;
    this.reconnecting = true;
    this.ready = false;
    this.callbacks.onState("reconnecting");
    try {
      let last: unknown;
      for (let i = 0; i < 3 && this.active; i++) {
        // Leave the first recovery immediate; back off subsequent failures.
        if (i > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
        if (!this.active) return;
        try {
          await this.connect();
          return;
        } catch (e) {
          last = e;
        }
      }
      if (this.active)
        this.fail(last instanceof Error ? last.message : "实时连接已断开。");
    } finally {
      this.reconnecting = false;
    }
  }
  private fail(message: string) {
    this.callbacks.onError(message);
    void this.cleanup();
  }
  async stop() {
    if (!this.active) return;
    this.node?.port.postMessage("flush");
    await new Promise((r) => setTimeout(r, 80));
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.active = false;
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({ realtimeInput: { audioStreamEnd: true } }),
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
    await this.cleanup();
  }
  async cleanup() {
    this.active = false;
    this.ready = false;
    clearTimeout(this.timer);
    this.connectingReject?.(new Error("连接已取消。"));
    this.connectingReject = undefined;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = undefined;
    this.node?.disconnect();
    this.node = undefined;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = undefined;
    }
    if (this.context && this.context.state !== "closed")
      await this.context.close().catch(() => {});
    this.context = undefined;
    this.pending = [];
    this.callbacks.onLevel(0);
    this.callbacks.onState("stopped");
  }
}
