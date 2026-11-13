import { useState } from "react";
import { Button } from "./ui";

export function CopyLink({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context): the URL is selectable in the field.
    }
  };

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1.5 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2.5 font-mono text-sm"
        />
        <Button variant="secondary" type="button" onClick={copy} className="shrink-0 py-2.5">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-1.5 text-sm text-muted">{hint}</p>
    </div>
  );
}
