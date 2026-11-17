import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { uid } from "../shared/ids";
import type { Line } from "../shared/types";
import type { GradeResult } from "../shared/scoring";

export const fmt = (n: number) => String(Math.round(n * 10) / 10);
export const plural = (n: number, w: string, suffix = "s") => `${n} ${w}${n === 1 ? "" : suffix}`;

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  area?: boolean;
  rows?: number;
}) {
  const id = useId();
  const rows = props.rows ?? Math.min(12, Math.max(3, props.value.split("\n").length + 1));
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.area ? (
        <textarea id={id} rows={rows} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input id={id} type="text" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Number input that lets you clear it while typing; stores 0 for empty. */
export function NumberField(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const id = useId();
  const [text, setText] = useState(String(props.value));
  useEffect(() => {
    if (Number(text) !== props.value) setText(String(props.value));
  }, [props.value]);
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={props.min ?? 0}
        max={props.max ?? 100}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n)) props.onChange(Math.max(props.min ?? 0, Math.min(props.max ?? 100, n)));
        }}
      />
    </div>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Delete button that needs a second tap within 3 seconds. */
export function ConfirmButton({ label = "Delete", onConfirm, className = "btn sm danger ghost" }: { label?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? "Tap again to delete" : label}
    </button>
  );
}

export function Seg<T extends string | number>(props: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T | undefined) => void;
}) {
  return (
    <span className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          className={props.value === o.value ? "on" : ""}
          aria-pressed={props.value === o.value}
          onClick={() => props.onChange(props.value === o.value ? undefined : o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * One input per check line. Each line keeps its id for life, so ticks on other
 * lines never shift. Enter adds a line below, Backspace on an empty line removes
 * it, and pasting several lines splits them into separate checks.
 */
export function LineEditor(props: { label: string; hint?: string; prefix: string; lines: Line[]; onChange: (lines: Line[]) => void; placeholder?: string }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (focusId) {
      refs.current.get(focusId)?.focus();
      setFocusId(null);
    }
  }, [focusId, props.lines]);

  const set = (i: number, text: string) => props.onChange(props.lines.map((l, k) => (k === i ? { ...l, text } : l)));
  const insertAfter = (i: number, texts: string[]) => {
    const add = texts.map((text) => ({ id: uid(), text }));
    const next = [...props.lines.slice(0, i + 1), ...add, ...props.lines.slice(i + 1)];
    props.onChange(next);
    setFocusId(add[add.length - 1].id);
  };
  const remove = (i: number) => {
    props.onChange(props.lines.filter((_, k) => k !== i));
    const prev = props.lines[i - 1] ?? props.lines[i + 1];
    if (prev) setFocusId(prev.id);
  };

  return (
    <div className="field">
      <span className="flabel">{props.label}</span>
      {props.hint && <span className="muted small">{props.hint}</span>}
      <div className="lines">
        {props.lines.map((l, i) => (
          <div className="row" key={l.id}>
            <span className="lid" aria-hidden>
              {props.prefix}
              {i + 1}
            </span>
            <input
              ref={(el) => {
                if (el) refs.current.set(l.id, el);
                else refs.current.delete(l.id);
              }}
              className="grow"
              type="text"
              aria-label={`${props.label} ${props.prefix}${i + 1}`}
              value={l.text}
              placeholder={props.placeholder}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  insertAfter(i, [""]);
                } else if (e.key === "Backspace" && l.text === "") {
                  e.preventDefault();
                  remove(i);
                }
              }}
              onPaste={(e) => {
                const t = e.clipboardData.getData("text");
                const parts = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
                if (parts.length > 1) {
                  e.preventDefault();
                  const [first, ...rest] = parts;
                  const merged = props.lines.map((x, k) => (k === i ? { ...x, text: (x.text ? x.text + " " : "") + first } : x));
                  const add = rest.map((text) => ({ id: uid(), text }));
                  props.onChange([...merged.slice(0, i + 1), ...add, ...merged.slice(i + 1)]);
                  setFocusId(add[add.length - 1].id);
                }
              }}
            />
            <button type="button" className="btn sm ghost" aria-label={`Remove ${props.prefix}${i + 1}`} onClick={() => remove(i)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div>
        <button type="button" className="btn sm" onClick={() => insertAfter(props.lines.length - 1, [""])}>
          Add line
        </button>
      </div>
    </div>
  );
}

export function VerdictPill({ g, none = "Not graded" }: { g: GradeResult | null | undefined; none?: string }) {
  if (!g) return <span className="pill plain">{none}</span>;
  if (g.verdict === "pass") return <span className="pill ok">Pass, {fmt(g.total)}</span>;
  if (g.verdict === "fail") return <span className="pill bad">{g.autoFailures.length ? "Fail, automatic" : `Fail, ${fmt(g.total)}`}</span>;
  return <span className="pill warn">Unfinished</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
