import { motion } from 'framer-motion';
import { useMagellanStore } from './store';

interface Props {
  orientation: 'vertical' | 'horizontal';
}

export function ConnectionBadge({ orientation }: Props) {
  const isConnected = useMagellanStore((s) => s.isConnected);
  const isVertical = orientation === 'vertical';

  return (
    <motion.div
      className={`absolute top-[calc(0.5rem+env(safe-area-inset-top))] z-40
                  flex items-center gap-2 px-3 py-1.5 rounded-full
                  glass-panel text-xs font-medium pointer-events-none
                  ${isVertical ? 'right-4' : 'left-4'}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-rose-400 animate-pulse'
        }`}
      />
      <span className={isConnected ? 'text-emerald-200' : 'text-rose-200'}>
        {isConnected ? 'Live' : 'Reconnecting…'}
      </span>
    </motion.div>
  );
}
