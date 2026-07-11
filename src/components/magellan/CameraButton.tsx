import { motion } from 'framer-motion';
import { Camera, CameraOff } from 'lucide-react';
import { useMagellanStore } from './store';
import { acknowledge } from './acknowledge';

export function CameraButton() {
  const isCameraActive = useMagellanStore((s) => s.isCameraActive);
  const setCameraActive = useMagellanStore((s) => s.setCameraActive);

  return (
    <motion.button
      onClick={() => {
        acknowledge();
        setCameraActive(!isCameraActive);
      }}
      className={`w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-sm transition-colors ${
        isCameraActive
          ? 'bg-purple-500/20 border-purple-400 text-purple-200'
          : 'bg-white/10 border-white/20 text-white/70'
      }`}
      whileTap={{ scale: 0.9 }}
      aria-label={isCameraActive ? 'Turn camera off' : 'Turn camera on'}
    >
      {isCameraActive ? <CameraOff className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
    </motion.button>
  );
}
