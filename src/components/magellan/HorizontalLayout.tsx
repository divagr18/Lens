import type { ReactNode } from "react";
import { acknowledge } from "./acknowledge";
import { MicButton } from "./MicButton";
import { useMagellanStore } from "./store";

export function HorizontalLayout({ cameraFeed, glassPanel }: { cameraFeed: ReactNode; glassPanel: ReactNode }) {
  const isVoiceActive = useMagellanStore((state) => state.isVoiceActive);
  const setVoiceActive = useMagellanStore((state) => state.setVoiceActive);
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        {cameraFeed}
        <div className={`camera-aura ${isVoiceActive ? "is-active" : ""}`} />
      </div>
      <div className="absolute bottom-6 left-6 z-10">
        <MicButton
          isActive={isVoiceActive}
          onToggle={() => {
            acknowledge();
            setVoiceActive(!isVoiceActive);
          }}
        />
      </div>
      <aside className="pointer-events-none absolute bottom-4 right-4 top-4 flex w-[28%] min-w-[14rem] max-w-[24rem] flex-col overflow-hidden rounded-[36px]">
        <div className="pointer-events-auto min-h-0 flex-1 overflow-hidden rounded-[36px]">{glassPanel}</div>
      </aside>
    </div>
  );
}
