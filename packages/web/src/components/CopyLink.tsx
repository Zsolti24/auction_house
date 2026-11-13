import { useState } from "react";
import { notify } from "../notify";
import { Button } from "./ui";

export function CopyLink({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      notify.success(`${label} copied`, `copied-${label}`);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context): the URL is selectable in the field.
      notify.error("Couldn't copy automatically — select the link and copy it by hand.");
    }
  };

  return (
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-ink/80">{label}</p>
      <div className="mt-1.5 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="glass-control min-w-0 flex-1 rounded-2xl px-3 py-2.5 font-mono text-[13px]"
        />
        <Button variant="secondary" type="button" onClick={copy} className="shrink-0 px-4 py-2.5">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{hint}</p>
    </div>
  );
}
