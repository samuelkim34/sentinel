export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return new Float32Array(input);
  const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const output = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let index = 0; index < outLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const weight = position - left;
    output[index] = input[left]! * (1 - weight) + input[right]! * weight;
  }
  return output;
}

export function floatToPcm16(input: Float32Array): Uint8Array {
  const pcm = new Uint8Array(input.length * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return pcm;
}

// Preserve fractional sample position across AudioWorklet chunks (including 44.1 kHz).
export class StreamingResampler {
  private buffered: number[] = [];
  private position = 0;
  constructor(private readonly fromRate: number, private readonly toRate = 24000) {}
  process(input: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return new Float32Array(input);
    this.buffered.push(...input);
    const output: number[] = [];
    const ratio = this.fromRate / this.toRate;
    while (this.position + 1 < this.buffered.length) {
      const left = Math.floor(this.position);
      const weight = this.position - left;
      output.push(this.buffered[left]! * (1 - weight) + this.buffered[left + 1]! * weight);
      this.position += ratio;
    }
    const consumed = Math.min(Math.floor(this.position), this.buffered.length);
    this.buffered.splice(0, consumed);
    this.position -= consumed;
    return Float32Array.from(output);
  }
}

export class AudioFramer {
  private samples: number[] = [];
  constructor(private readonly size = 480) {}
  push(input: Float32Array): Float32Array[] {
    this.samples.push(...input);
    const frames: Float32Array[] = [];
    while (this.samples.length >= this.size) frames.push(Float32Array.from(this.samples.splice(0, this.size)));
    return frames;
  }
  clear() { this.samples = []; }
}

export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  const output = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 32768;
  }
  return output;
}

export class PlaybackQueue {
  private chunks: Array<{ responseId: string; samples: Float32Array }> = [];
  private activeResponse: string | null = null;

  push(responseId: string, samples: Float32Array) {
    if (this.activeResponse && this.activeResponse !== responseId) this.clear();
    this.activeResponse = responseId;
    this.chunks.push({ responseId, samples });
  }

  clear() {
    this.chunks = [];
    this.activeResponse = null;
  }

  drain(): Float32Array {
    const parts = this.chunks.splice(0).map((item) => item.samples);
    const length = parts.reduce((total, item) => total + item.length, 0);
    const output = new Float32Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }
}
