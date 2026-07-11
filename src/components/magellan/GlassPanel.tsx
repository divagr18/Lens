import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export function GlassPanel({ children, className }: Props) {
  return (
    <motion.div
      className={['glass-panel rounded-3xl p-4', className].filter(Boolean).join(' ')}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}
