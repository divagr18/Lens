let tickCtx: AudioContext | null = null;
let tickBuffer: AudioBuffer | null = null;

async function preloadTick() {
  if (tickCtx && tickBuffer) return { ctx: tickCtx, buffer: tickBuffer };
  tickCtx = new AudioContext();
  const duration = 0.02;
  const sampleRate = tickCtx.sampleRate;
  const buffer = tickCtx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const time = index / sampleRate;
    const envelope = Math.exp(-time * 200);
    data[index] =
      (Math.sin(2 * Math.PI * 1_200 * time) + Math.sin(2 * Math.PI * 800 * time)) *
      0.15 *
      envelope;
  }
  tickBuffer = buffer;
  return { ctx: tickCtx, buffer };
}

let preloadPromise: Promise<void> | null = null;

export function acknowledge() {
  navigator.vibrate?.(10);
  preloadPromise ??= preloadTick().then(() => undefined);
  void preloadPromise.then(() => {
    if (!tickCtx || !tickBuffer) return;
    if (tickCtx.state === "suspended") void tickCtx.resume();
    const source = tickCtx.createBufferSource();
    source.buffer = tickBuffer;
    source.connect(tickCtx.destination);
    source.start(0);
  });
}
