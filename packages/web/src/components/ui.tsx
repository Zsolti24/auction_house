import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-line bg-card p-6 shadow-sm", className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{children}</p>;
}

export function Button({
  variant = "primary",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-white hover:bg-accent-dark",
        variant === "secondary" && "border border-line bg-white text-ink hover:border-ink/30",
        className,
      )}
      {...rest}
    />
  );
}

const inputClass =
  "w-full rounded-xl border bg-white px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";

export function Field({
  label,
  hint,
  errors,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {errors && errors.length > 0 ? (
        <span role="alert" className="mt-1.5 block text-sm text-accent">
          {errors.join(" ")}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-sm text-muted">{hint}</span>
      )}
    </label>
  );
}

export function TextInput({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(inputClass, invalid ? "border-accent" : "border-line", className)}
      {...rest}
    />
  );
}

export function TextArea({ invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx(inputClass, "min-h-28 resize-y", invalid ? "border-accent" : "border-line")}
      {...rest}
    />
  );
}

/** Text input with a € prefix. Amounts are typed as text and parsed to cents (no floats). */
export function MoneyInput({ invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">€</span>
      <TextInput invalid={invalid} inputMode="decimal" autoComplete="off" className="pl-9 tabular-nums" {...rest} />
    </div>
  );
}

export function Notice({ tone, children }: { tone: "success" | "error" | "warning" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cx(
        "rounded-xl px-4 py-3 text-sm font-medium",
        tone === "success" && "bg-success-soft text-success",
        tone === "error" && "bg-accent-soft text-accent",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "info" && "bg-paper text-ink",
      )}
    >
      {children}
    </div>
  );
}
