// Providers such as Grok narrate before tools.
import { useEffect, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { useTurnLive } from "@/state/turn-status";

export function ThinkingText({ text }: { text: string }) {
  return <p className="max-w-[40rem] whitespace-pre-wrap text-[13px] leading-5 text-ink-secondary">{text}</p>;
}

export function TurnNarrationRun({
  label,
  title,
  forceOpen = false,
  threadId,
  turnId,
  children,
}: {
  label: string;
  title?: string;
  forceOpen?: boolean;
  threadId?: string;
  turnId?: string;
  children: React.ReactNode;
}) {
  const live = useTurnLive(threadId);
  const reasoning = live.turnId === turnId ? live.reasoning : undefined;
  const isLive = live.turnId === turnId && !live.ended;
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={label}
          title={title ?? (open ? "Hide thinking and progress" : "Show thinking and progress")}
          className="ui-pill"
        >
          {isLive ? (
            <Loader2 size={13} className="animate-spin text-ink-secondary" />
          ) : (
            <Check size={13} className="text-success" />
          )}
          <span>{label}</span>
          <ChevronRight size={13} className={open ? "rotate-90" : undefined} />
        </button>
      </div>
      {open && reasoning && <ThinkingText text={reasoning} />}
      {open && children}
    </div>
  );
}
