import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

const pad = (value: number) => String(value).padStart(2, "0");
const hourOptions = Array.from({ length: 24 }, (_, index) => pad(index));
const minuteOptions = Array.from({ length: 60 }, (_, index) => pad(index));

export const timePartIsValid = (value: string, max: number) => /^\d{1,2}$/.test(value) && Number(value) <= max;

const normalizeTimePart = (value: string, max: number) => {
  if (!/^\d{1,2}$/.test(value)) return value;
  const number = Number(value);
  return number <= max ? pad(number) : value;
};

interface TimePartInputProps {
  label: string; ariaLabel: string; value: string; max: number; options: string[]; disabled: boolean; onChange: (value: string) => void;
}

function TimePartInput({ label, ariaLabel, value, max, options, disabled, onChange }: TimePartInputProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedOption = useRef<HTMLButtonElement>(null);
  const id = useId();
  const listId = `${id}-options`;

  useEffect(() => {
    if (open) selectedOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "Enter") { event.preventDefault(); setOpen(false); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const current = timePartIsValid(value, max) ? Number(value) : 0;
    const next = event.key === "ArrowDown" ? (current + 1) % (max + 1) : (current + max) % (max + 1);
    onChange(pad(next)); setOpen(true);
  };

  return <div className="time-part">
    <label htmlFor={`${id}-input`}>{label}</label>
    <div className="time-part-control">
      <input ref={inputRef} id={`${id}-input`} type="text" inputMode="numeric" maxLength={2} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} placeholder="--" value={value} disabled={disabled} onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onKeyDown={onKeyDown} onBlur={() => { onChange(normalizeTimePart(value, max)); setOpen(false); }}/>
      <button type="button" tabIndex={-1} aria-label={`${label}の候補を表示`} aria-expanded={open} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { inputRef.current?.focus(); setOpen(true); }}>▼</button>
    </div>
    {open && <div id={listId} className="time-part-options" role="listbox" aria-label={`${label}の候補`}>
      {options.map((option) => <button type="button" role="option" aria-selected={value === option} className={value === option ? "selected" : ""} ref={value === option ? selectedOption : undefined} tabIndex={-1} key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); setOpen(false); }}>{option}</button>)}
    </div>}
  </div>;
}

interface TimeFieldsProps {
  ariaLabel: string; labelPrefix: string; hour: string; minute: string; disabled: boolean;
  onHourChange: (value: string) => void; onMinuteChange: (value: string) => void;
}

export function TimeFields({ ariaLabel, labelPrefix, hour, minute, disabled, onHourChange, onMinuteChange }: TimeFieldsProps) {
  return <div className="time-fields" role="group" aria-label={ariaLabel}>
    <TimePartInput label="時" ariaLabel={`${labelPrefix}の時`} value={hour} max={23} options={hourOptions} disabled={disabled} onChange={onHourChange}/>
    <span aria-hidden="true">:</span>
    <TimePartInput label="分" ariaLabel={`${labelPrefix}の分`} value={minute} max={59} options={minuteOptions} disabled={disabled} onChange={onMinuteChange}/>
  </div>;
}
