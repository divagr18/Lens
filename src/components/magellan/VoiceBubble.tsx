import { useEffect } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';

interface Props {
  stream: MediaStream | null;
  className?: string;
}

export function VoiceBubble({ stream, className }: Props) {
  const volume = useMotionValue(0);
  useEffect(() => {
    if (!stream) return;

    const audioCtx = new AudioContext();
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyserNode);
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    let animating = true;

    const tick = () => {
      if (!animating) return;
      analyserNode.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      volume.set(avg / 128);
      requestAnimationFrame(tick);
    };
    tick();

    return () => {
      animating = false;
      audioCtx.close();
    };
  }, [stream, volume]);

  const scale = useTransform(volume, [0, 1], [0.8, 1.4]);

  if (!stream) return null;

  return (
    <motion.div
      style={{ scale }}
      className={['w-12 h-12 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 blur-sm opacity-80', className].filter(Boolean).join(' ')}
    />
  );
}
