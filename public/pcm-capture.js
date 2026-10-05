class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    // Capture at the device's native rate, then emit stable 16 kHz PCM.
    // Fractional bins carry across process() calls (including 44.1 kHz).
    this.ratio = sampleRate / 16000;
    this.weight = 0;
    this.sum = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        if (this.weight > 0) this.samples.push(this.sum / this.weight);
        this.weight = this.sum = 0;
        this.flush();
      }
    };
  }
  flush() {
    if (!this.samples.length) return;
    const buffer = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(buffer);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const s = Math.max(-1, Math.min(1, this.samples[i]));
      sum += s * s;
      view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    this.port.postMessage(
      { buffer, rate: 16000, level: Math.sqrt(sum / this.samples.length) },
      [buffer],
    );
    this.samples = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const v of input) {
        let remaining = 1;
        while (remaining > 1e-9) {
          const used = Math.min(remaining, this.ratio - this.weight);
          this.sum += v * used;
          this.weight += used;
          remaining -= used;
          if (this.weight >= this.ratio - 1e-9) {
            this.samples.push(this.sum / this.weight);
            this.weight = this.sum = 0;
            if (this.samples.length >= 2048) this.flush();
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
