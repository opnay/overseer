import { Button } from "@opnay/city-ds-react/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CommandBlock({
  ariaLabel,
  command,
  copyLabel,
  label,
}: {
  ariaLabel: string;
  command: string;
  copyLabel: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number>(undefined);

  useEffect(() => {
    setCopied(false);
    return () => window.clearTimeout(resetTimer.current);
  }, [command]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overseer-command-block">
      <div>
        <span>{label}</span>
        <Button aria-label={copyLabel} onClick={() => void copy()} size="sm" variant="ghost">
          {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
          {copied ? "복사됨" : "복사"}
        </Button>
      </div>
      <pre aria-label={ariaLabel} tabIndex={0}>
        <code>{command}</code>
      </pre>
    </div>
  );
}
