type Callbacks = {
  transcribe: (audio: string) => Promise<string>;
  /** `at` is the Date.now() wall-clock time when speech in this chunk began. */
  onFinal: (text: string, at?: number) => void;
  onInterim: (text: string) => void;
  onState: (s: "connecting" | "live" | "stopped") => void;
  onLevel: (n: number) => void;
  onError: (s: string) => void;
};
export function wavBase64(chunks: Uint8Array[], rate: number) {
  const size = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buffer = new ArrayBuffer(44 + size);
  const view = new DataView(buffer);
  const word = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  word(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, size, true);
  const bytes = new Uint8Array(buffer);
  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
export class GeminiChunks {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private active = false;
  private chunks: Uint8Array[] = [];
  private size = 0;
  private speech = false;
  private silence = 0;
  private speechAt = 0;
  private jobs: { audio: string; at: number }[] = [];
  private processing?: Promise<void>;
  private failed = false;
  constructor(private callbacks: Callbacks) {}
  async start(deviceId = "") {
    this.callbacks.onState("connecting");
    this.active = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("请使用 HTTPS 或 localhost 打开麦克风。");
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
        this.releaseMic();
        return;
      }
      this.stream.getAudioTracks().forEach(
        (t) =>
          (t.onended = () => {
            this.callbacks.onError("麦克风已断开。");
            void this.stop();
          }),
      );
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule("/pcm-capture.js");
      if (!this.active) {
        this.releaseMic();
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
        const chunk = new Uint8Array(event.data.buffer);
        this.chunks.push(chunk);
        this.size += chunk.length;
        this.callbacks.onLevel(Math.min(1, event.data.level * 5));
        const bytesPerSecond = 16000 * 2;
        if (event.data.level > 0.004) {
          if (!this.speech)
            this.speechAt =
              Date.now() - Math.round((this.size / bytesPerSecond) * 1000);
          this.speech = true;
          this.silence = 0;
        } else this.silence += chunk.length;
        if (!this.speech && this.chunks.length > 3) {
          this.size -= this.chunks.shift()!.length;
        }
        if (
          this.speech &&
          (this.size >= bytesPerSecond * 6 ||
            (this.silence >= bytesPerSecond * 0.7 &&
              this.size >= bytesPerSecond))
        )
          this.flush();
      };
      await this.context.resume();
      this.callbacks.onState("live");
    } catch (e) {
      await this.cleanup();
      throw new Error(
        (e as Error).name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器中允许访问。"
          : (e as Error).message,
      );
    }
  }
  private flush() {
    if (this.speech && this.size > 0) {
      this.jobs.push({
        audio: wavBase64(this.chunks, 16000),
        at: this.speechAt || Date.now(),
      });
      this.callbacks.onInterim("正在识别这一段课堂语音…");
    }
    this.chunks = [];
    this.size = 0;
    this.speech = false;
    this.silence = 0;
    this.speechAt = 0;
    if (this.active && this.jobs.length > 5) {
      this.callbacks.onError(
        "转写速度落后于录音，已暂停采集并处理剩余音频。处理完成后可继续听讲。",
      );
      this.active = false;
      this.releaseMic();
    }
    this.pump();
  }
  private pump() {
    if (this.processing) return;
    this.processing = (async () => {
      while (this.jobs.length && !this.failed) {
        const job = this.jobs[0];
        let result: string | undefined;
        let error: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            result = await this.callbacks.transcribe(job.audio);
            break;
          } catch (e) {
            error = e;
          }
        }
        if (this.failed) return;
        if (result === undefined) {
          this.failed = true;
          this.active = false;
          this.releaseMic();
          this.callbacks.onError(
            (error instanceof Error ? error.message : "转写失败") +
              " 采集已停止，本次未完成的音频未保存。",
          );
          this.jobs = [];
          break;
        }
        this.jobs.shift();
        if (result.trim()) this.callbacks.onFinal(result.trim(), job.at);
      }
    })().finally(() => {
      this.processing = undefined;
      this.callbacks.onInterim("");
      if (!this.active) this.callbacks.onState("stopped");
    });
  }
  private releaseMic() {
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = undefined;
    this.node?.disconnect();
    this.node = undefined;
    if (this.context && this.context.state !== "closed")
      void this.context.close();
    this.callbacks.onLevel(0);
  }
  async stop() {
    this.node?.port.postMessage("flush");
    await new Promise((r) => setTimeout(r, 80));
    this.active = false;
    this.releaseMic();
    this.flush();
    await this.processing;
    this.callbacks.onState("stopped");
  }
  async cleanup() {
    this.active = false;
    this.failed = true;
    this.jobs = [];
    this.chunks = [];
    this.releaseMic();
    this.callbacks.onState("stopped");
  }
}
