class LensAudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      const samples = input.slice();
      this.port.postMessage(samples, [samples.buffer]);
    }

    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    return true;
  }
}

registerProcessor("lens-audio-capture", LensAudioCaptureProcessor);
