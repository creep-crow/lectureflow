import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

test("PCM worklet preserves samples, clips safely and flushes the final short buffer", async () => {
  let Processor;
  const packets = [];
  const context = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (p) => packets.push(p) };
      }
    },
    registerProcessor: (_, p) => (Processor = p),
    ArrayBuffer,
    DataView,
    Math,
    sampleRate: 16000,
  };
  vm.runInNewContext(
    await readFile(
      new URL("../public/pcm-capture.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  const processor = new Processor();
  processor.process([[new Float32Array([0, 0.5, -0.5, 2, -2])]]);
  assert.equal(packets.length, 0);
  processor.port.onmessage({ data: "flush" });
  const view = new DataView(packets[0].buffer);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, i) => view.getInt16(i * 2, true)),
    [0, 16383, -16384, 32767, -32768],
  );
  processor.port.onmessage({ data: "flush" });
  assert.equal(packets.length, 1);
  processor.process([[new Float32Array(2048).fill(0.25)]]);
  assert.equal(packets.length, 2);
  assert.equal(packets[1].level, 0.25);
});

const source = await readFile(
  new URL("../lib/gemini-live.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { GeminiLive } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const chunkSource = await readFile(
  new URL("../lib/gemini-chunks.ts", import.meta.url),
  "utf8",
);
const chunkJs = ts.transpileModule(chunkSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { GeminiChunks, wavBase64 } = await import(
  "data:text/javascript;base64," + Buffer.from(chunkJs).toString("base64")
);
function setup(rate = 16000) {
  const track = {
    stopped: false,
    onended: null,
    stop() {
      this.stopped = true;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let audio, capture;
  class AudioContext {
    constructor() {
      audio = this; // eslint-disable-line @typescript-eslint/no-this-alias -- Capture the fake browser instance.
      this.state = "running";
      this.sampleRate = rate;
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createGain() {
      return { gain: {}, connect() {} };
    }
    async resume() {}
    async close() {
      this.state = "closed";
    }
  }
  class AudioWorkletNode {
    constructor() {
      capture = this; // eslint-disable-line @typescript-eslint/no-this-alias -- Capture the fake browser instance.
      this.port = { postMessage() {}, onmessage: null };
    }
    connect() {}
    disconnect() {}
  }
  const sockets = [];
  class WebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(data) {
      this.sent.push(JSON.parse(data));
      if (JSON.parse(data).setup)
        queueMicrotask(() =>
          this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }),
        );
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    message(data) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
  }
  const originals = {
    AudioContext: globalThis.AudioContext,
    AudioWorkletNode: globalThis.AudioWorkletNode,
    WebSocket: globalThis.WebSocket,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  Object.assign(globalThis, { AudioContext, AudioWorkletNode, WebSocket });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  return {
    track,
    sockets,
    get capture() {
      return capture;
    },
    get audio() {
      return audio;
    },
    restore() {
      Object.assign(globalThis, {
        AudioContext: originals.AudioContext,
        AudioWorkletNode: originals.AudioWorkletNode,
        WebSocket: originals.WebSocket,
      });
      if (originals.navigator)
        Object.defineProperty(globalThis, "navigator", originals.navigator);
      else delete globalThis.navigator;
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));
test("Native 44.1/48 kHz capture produces continuous 16 kHz PCM across packet boundaries", async () => {
  const worklet = await readFile(
    new URL("../public/pcm-capture.js", import.meta.url),
    "utf8",
  );
  for (const rate of [44100, 48000]) {
    function run(packetSize) {
      let Processor;
      const packets = [];
      vm.runInNewContext(worklet, {
        sampleRate: rate,
        AudioWorkletProcessor: class {
          constructor() {
            this.port = { postMessage: (p) => packets.push(p) };
          }
        },
        registerProcessor: (_, p) => {
          Processor = p;
        },
        ArrayBuffer,
        DataView,
        Math,
      });
      const processor = new Processor();
      const input = Float32Array.from(
        { length: rate },
        (_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / rate),
      );
      for (let i = 0; i < input.length; i += packetSize)
        processor.process([[input.subarray(i, i + packetSize)]]);
      processor.port.onmessage({ data: "flush" });
      assert.ok(packets.every((p) => p.rate === 16000));
      return Buffer.concat(packets.map((p) => Buffer.from(p.buffer)));
    }
    const pcm = run(128);
    assert.equal(
      pcm.length,
      16000 * 2,
      "one second stays one second at " + rate,
    );
    assert.deepEqual(
      pcm,
      run(137),
      "resampling is independent of input packet size",
    );
    let energy = 0;
    for (let i = 0; i < 16000; i++)
      energy += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    assert.ok(Math.abs(Math.sqrt(energy / 16000) - 0.4 / Math.sqrt(2)) < 0.002);
  }
});

test("48 kHz devices still send 16 kHz WAV and Live audio", async () => {
  const fake = setup(48000);
  let wav;
  const callbacks = {
    onFinal() {},
    onInterim() {},
    onState() {},
    onLevel() {},
    onError() {},
  };
  const chunks = new GeminiChunks({
    ...callbacks,
    transcribe: async (data) => {
      wav = Buffer.from(data, "base64");
      return "Speech";
    },
  });
  const live = new GeminiLive({
    ...callbacks,
    token: async () => ({
      token: "test",
      model: "gemini-3.5-transcribe-live",
      config: {},
    }),
  });
  try {
    await chunks.start();
    for (let i = 0; i < 60; i++)
      fake.capture.port.onmessage({
        data: { buffer: new ArrayBuffer(3200), rate: 16000, level: 0.02 },
      });
    await tick();
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt32LE(40), 6 * 16000 * 2);
    await chunks.stop();
    await live.start();
    fake.capture.port.onmessage({
      data: { buffer: new ArrayBuffer(3200), rate: 16000, level: 0.02 },
    });
    assert.equal(
      fake.sockets[0].sent.at(-1).realtimeInput.audio.mimeType,
      "audio/pcm;rate=16000",
    );
  } finally {
    await chunks.cleanup();
    await live.cleanup();
    fake.restore();
  }
});

test("Live session handles interim and final text separately and releases microphone on stop", async () => {
  const fake = setup();
  const finals = [],
    partials = [],
    states = [];
  const errors = [];
  const live = new GeminiLive({
    token: async () => ({
      token: "ephemeral-test-only",
      model: "gemini-3.5-transcribe-live",
      config: {},
    }),
    onFinal: (t) => finals.push(t),
    onInterim: (t) => partials.push(t),
    onState: (s) => states.push(s),
    onLevel() {},
    onError: (e) => errors.push(e),
  });
  try {
    await live.start();
    assert.ok(fake.sockets[0].url.includes("access_token=ephemeral-test-only"));
    assert.ok(fake.sockets[0].url.includes("v1alpha.GenerativeService.BidiGenerateContentConstrained"));
    assert.deepEqual(
      fake.sockets[0].sent[0].setup.generationConfig.responseModalities,
      ["TEXT"],
    );
    fake.sockets[0].message({
      serverContent: { interimInputTranscription: { text: "Learning is" } },
    });
    fake.sockets[0].message({
      serverContent: {
        inputTranscription: { text: "Learning is generalization." },
      },
    });
    await tick();
    assert.deepEqual(finals, ["Learning is generalization."]);
    assert.deepEqual(partials, ["Learning is", ""]);
    await live.stop();
    assert.ok(fake.track.stopped);
    assert.equal(fake.audio.state, "closed");
    assert.equal(states.at(-1), "stopped");
    assert.ok(
      fake.sockets[0].sent.some((p) => p.realtimeInput?.audioStreamEnd),
    );
    assert.deepEqual(errors, []);
  } finally {
    await live.cleanup();
    fake.restore();
  }
});
test("Failed token creation does not leave the microphone active", async () => {
  const fake = setup();
  const live = new GeminiLive({
    token: async () => {
      throw new Error("Missing key");
    },
    onFinal() {},
    onInterim() {},
    onState() {},
    onLevel() {},
    onError() {},
  });
  try {
    await assert.rejects(() => live.start(), /Missing key/);
    assert.ok(fake.track.stopped);
    assert.equal(fake.audio.state, "closed");
    assert.equal(fake.sockets.length, 0);
  } finally {
    await live.cleanup();
    fake.restore();
  }
});
test("Unexpected disconnect obtains a new token and resumes a live session", async () => {
  const fake = setup();
  let tokens = 0;
  const states = [];
  const live = new GeminiLive({
    token: async () => ({
      token: "test-" + ++tokens,
      model: "gemini-3.5-transcribe-live",
      config: {},
    }),
    onFinal() {},
    onInterim() {},
    onState: (s) => states.push(s),
    onLevel() {},
    onError() {},
  });
  try {
    await live.start();
    fake.sockets[0].close();
    await tick();
    assert.equal(tokens, 2);
    assert.equal(fake.sockets.length, 2);
    assert.ok(states.includes("reconnecting"));
    assert.equal(states.at(-1), "live");
  } finally {
    await live.cleanup();
    fake.restore();
  }
});

test("WAV encoding preserves little-endian PCM and the sample rate", () => {
  const bytes = Buffer.from(
    wavBase64([new Uint8Array([1, 2, 3, 4])], 16000),
    "base64",
  );
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt32LE(40), 4);
  assert.deepEqual([...bytes.subarray(44)], [1, 2, 3, 4]);
});
test("Chunk mode transcribes speech, flushes the last fragment and stops the microphone", async () => {
  const fake = setup();
  const finals = [];
  let calls = 0;
  const recorder = new GeminiChunks({
    transcribe: async (audio) => {
      assert.ok(Buffer.from(audio, "base64").length > 44);
      return "Sentence " + ++calls;
    },
    onFinal: (text) => finals.push(text),
    onInterim() {},
    onState() {},
    onLevel() {},
    onError: (e) => {
      throw new Error(e);
    },
  });
  try {
    await recorder.start();
    for (let i = 0; i < 60; i++)
      fake.capture.port.onmessage({
        data: { buffer: new ArrayBuffer(3200), level: 0.02 },
      });
    await tick();
    assert.equal(calls, 1);
    fake.capture.port.onmessage({
      data: { buffer: new ArrayBuffer(3200), level: 0.02 },
    });
    await recorder.stop();
    assert.equal(calls, 2);
    assert.deepEqual(finals, ["Sentence 1", "Sentence 2"]);
    assert.ok(fake.track.stopped);
  } finally {
    await recorder.cleanup();
    fake.restore();
  }
});
test("Silence is not sent to the transcription provider", async () => {
  const fake = setup();
  let calls = 0;
  const recorder = new GeminiChunks({
    transcribe: async () => {
      calls++;
      return "";
    },
    onFinal() {},
    onInterim() {},
    onState() {},
    onLevel() {},
    onError() {},
  });
  try {
    await recorder.start();
    for (let i = 0; i < 70; i++)
      fake.capture.port.onmessage({
        data: { buffer: new ArrayBuffer(3200), level: 0 },
      });
    await recorder.stop();
    assert.equal(calls, 0);
  } finally {
    await recorder.cleanup();
    fake.restore();
  }
});
test("Chunk mode reports when speech began, not when transcription returned", async () => {
  const fake = setup();
  const stamps = [];
  const recorder = new GeminiChunks({
    transcribe: async () => {
      await new Promise((r) => setTimeout(r, 150));
      return "Delayed sentence";
    },
    onFinal: (_, at) => stamps.push({ at, now: Date.now() }),
    onInterim() {},
    onState() {},
    onLevel() {},
    onError: (e) => {
      throw new Error(e);
    },
  });
  try {
    await recorder.start();
    // Two silent pre-roll packets (0.2 s) followed by speech.
    for (let i = 0; i < 2; i++)
      fake.capture.port.onmessage({
        data: { buffer: new ArrayBuffer(3200), level: 0 },
      });
    const spoke = Date.now();
    for (let i = 0; i < 20; i++)
      fake.capture.port.onmessage({
        data: { buffer: new ArrayBuffer(3200), level: 0.02 },
      });
    await recorder.stop();
    assert.equal(stamps.length, 1);
    const { at, now } = stamps[0];
    assert.equal(typeof at, "number");
    // Start = speech detection time minus buffered pre-roll + first packet (0.3 s).
    assert.ok(at <= spoke && at >= spoke - 400, "at=" + at + " spoke=" + spoke);
    assert.ok(now - at >= 150, "timestamp must precede transcription latency");
  } finally {
    await recorder.cleanup();
    fake.restore();
  }
});
