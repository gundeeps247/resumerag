"use client";

import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: React.ReactNode;
}

export function Composer({ onSend, onStop, busy, disabled, placeholder = "Ask about your experience or projects…", hint }: ComposerProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "bg-card focus-within:border-ring/60 focus-within:ring-ring/15 flex items-end gap-2 rounded-2xl border p-2 pl-4 shadow-sm transition-shadow focus-within:ring-3",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="placeholder:text-muted-foreground max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none"
        />
        {busy ? (
          <Button size="icon" variant="secondary" onClick={onStop} aria-label="Stop generating" className="rounded-xl">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={!value.trim() || disabled} aria-label="Send" className="rounded-xl">
            <ArrowUp />
          </Button>
        )}
      </div>
      {hint && <div className="text-muted-foreground px-2 text-center text-[11px]">{hint}</div>}
    </div>
  );
}
