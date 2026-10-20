import { parseDecimal } from '../model/units';
import { h, icon, type Child, type IconName } from './dom';

export function iconButton(name: IconName, label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

export function appBar(options: {
  title: string;
  subtitle?: string;
  leading?: Node;
  actions?: Node[];
  /** Shown under the bar, e.g. a compact result that slides in on scroll. */
  below?: Node;
}): HTMLElement {
  return h(
    'header',
    { class: 'appbar' },
    h(
      'div',
      { class: 'appbar-inner' },
      options.leading ?? null,
      h(
        'div',
        { class: options.leading ? 'titles' : 'titles titles-large' },
        h('h1', { class: 'title' }, options.title),
        options.subtitle ? h('div', { class: 'subtitle' }, options.subtitle) : null,
      ),
      ...(options.actions ?? []),
    ),
    options.below ?? null,
  );
}

export function section(title: string | null, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, title ? h('h2', { class: 'section-title' }, title) : null, ...children);
}

// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
}

/** Single-choice control with large touch targets (radiogroup semantics). */
export function segmented<T extends string>(options: {
  label: string;
  items: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}): HTMLElement {
  const group = h('div', {
    class: `segmented ${options.className ?? ''}`.trim(),
    role: 'radiogroup',
    'aria-label': options.label,
    style: `--cols: ${options.items.length}`,
  });
  const buttons = options.items.map((item) => {
    const button = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(item.value === options.value),
        tabindex: item.value === options.value ? '0' : '-1',
        'data-value': item.value,
        onclick: () => select(item.value, false),
      },
      h('span', { class: 'seg-label' }, item.label),
      item.sub ? h('span', { class: 'seg-sub' }, item.sub) : null,
    );
    return button;
  });
  function select(value: T, focus: boolean) {
    for (const button of buttons) {
      const checked = button.dataset.value === value;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
      if (checked && focus) button.focus();
    }
    options.onChange(value);
  }
  group.addEventListener('keydown', (event) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const delta = keys[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const current = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = options.items[(current + delta + buttons.length) % buttons.length];
    if (next) select(next.value, true);
  });
  group.append(...buttons);
  return group;
}

// ---------------------------------------------------------------------------

export function switchRow(options: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): { el: HTMLButtonElement; setSub: (text: string) => void } {
  const sub = h('span', { class: 'row-sub' }, options.sub ?? '');
  const el = h(
    'button',
    {
      class: 'switch-row',
      type: 'button',
      role: 'switch',
      'aria-checked': String(options.checked),
      onclick: () => {
        const checked = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', String(checked));
        options.onChange(checked);
      },
    },
    h('span', { class: 'row-text' }, h('span', { class: 'row-label' }, options.label), sub),
    h('span', { class: 'switch', 'aria-hidden': 'true' }),
  );
  return {
    el,
    setSub: (text: string) => {
      sub.textContent = text;
    },
  };
}

// ---------------------------------------------------------------------------

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export interface StepperOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  /** Called on every value the user types or steps to, after `onChange`, even if the value didn't change. */
  onCommit?: (value: number) => void;
}

export type Stepper = HTMLElement & {
  /** Shows this value, kept within the limits, without calling `onChange`. */
  setValue: (value: number) => void;
  /** Changes the maximum. The value is not changed: follow up with {@link setValue}. */
  setMax: (max: number) => void;
};

/** −/+ buttons around an editable number. Hold a button to repeat. */
export function stepper(options: StepperOptions): Stepper {
  const decimals = decimalsOf(options.step);
  const format = options.format ?? ((v: number) => v.toFixed(decimals).replace(/\.0+$/, ''));
  let value = options.value;
  let max = options.max;

  const input = h('input', {
    class: 'stepper-input',
    type: 'text',
    inputmode: 'decimal',
    enterkeyhint: 'done',
    autocomplete: 'off',
    'aria-label': `${options.label} (${options.unit})`,
    value: format(value),
  });

  function normalize(v: number): number {
    const clamped = Math.min(max, Math.max(options.min, v));
    return Number((Math.round(clamped / options.step) * options.step).toFixed(decimals));
  }

  /** `fromUser`: notify the caller, as typed or stepped by the user. */
  function set(v: number, fromUser = true) {
    const next = normalize(v);
    input.value = format(next);
    if (next !== value) {
      value = next;
      if (fromUser) options.onChange(value);
    }
    minus.disabled = value <= options.min;
    plus.disabled = value >= max;
    if (fromUser) options.onCommit?.(value);
  }

  // Apply valid values while typing (without rewriting the text), so they are
  // saved even if the app is closed before the field loses focus.
  input.addEventListener('input', () => {
    const parsed = parseDecimal(input.value);
    if (Number.isNaN(parsed) || parsed < options.min || parsed > max) return;
    const next = normalize(parsed);
    if (next !== value) {
      value = next;
      options.onChange(value);
    }
    minus.disabled = value <= options.min;
    plus.disabled = value >= max;
    options.onCommit?.(value);
  });
  input.addEventListener('change', () => {
    const parsed = parseDecimal(input.value);
    if (Number.isNaN(parsed)) input.value = format(value);
    else set(parsed);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  input.addEventListener('focus', () => input.select());

  function bumpButton(direction: 1 | -1): HTMLButtonElement {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'stepper-btn',
        'aria-label': `${direction > 0 ? 'Increase' : 'Decrease'} ${options.label}`,
      },
      icon(direction > 0 ? 'add' : 'remove'),
    );
    let delay: ReturnType<typeof setTimeout> | undefined;
    let repeat: ReturnType<typeof setInterval> | undefined;
    let repeated = false;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
    };
    button.addEventListener('pointerdown', () => {
      repeated = false;
      stop();
      delay = setTimeout(() => {
        // Step right away, so releasing before the first repeat still counts as a press.
        repeated = true;
        set(value + direction * options.step);
        repeat = setInterval(() => set(value + direction * options.step), 90);
      }, 450);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
    button.addEventListener('click', () => {
      if (repeated) {
        repeated = false;
        return;
      }
      set(value + direction * options.step);
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    return button;
  }

  const minus = bumpButton(-1);
  const plus = bumpButton(1);
  const el = h(
    'div',
    { class: 'stepper' },
    minus,
    h('label', { class: 'stepper-value' }, input, h('span', { class: 'stepper-unit' }, options.unit)),
    plus,
  );
  set(value, false);
  // Out-of-range or off-step data is shown normalized: report it so what the caller computes with
  // matches what is displayed. Deferred, as callers are usually still building their view.
  if (value !== options.value) queueMicrotask(() => options.onChange(value));
  return Object.assign(el, {
    setValue: (v: number) => set(v, false),
    setMax: (m: number) => {
      max = m;
    },
  });
}

/** Label (+ optional hint) on the left, control on the right. */
export function row(label: string, control: Node, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'row-text' }, h('span', { class: 'row-label' }, label), hint ? h('span', { class: 'row-sub' }, hint) : null),
    control,
  );
}

export function textField(options: {
  label: string;
  value: string;
  placeholder?: string;
  /** For codes and keys: no auto-capitalization, correction or spell checking. */
  verbatim?: boolean;
  type?: 'text' | 'password';
  maxLength?: number;
  onInput: (value: string) => void;
}): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    class: 'text-input',
    type: options.type ?? 'text',
    value: options.value,
    placeholder: options.placeholder,
    autocomplete: 'off',
    enterkeyhint: 'done',
    maxlength: String(options.maxLength ?? 40),
    ...(options.verbatim ? { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' } : {}),
    oninput: () => options.onInput(input.value),
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return { el: h('label', { class: 'field' }, h('span', { class: 'field-label' }, options.label), input), input };
}

/** Optional number: empty means "not set". */
export function optionalNumber(options: {
  label: string;
  value: number | null;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number | null) => void;
}): HTMLElement {
  const input = h('input', {
    class: 'stepper-input',
    type: 'text',
    inputmode: 'decimal',
    enterkeyhint: 'done',
    autocomplete: 'off',
    placeholder: '–',
    'aria-label': `${options.label} (${options.unit})`,
    value: options.value === null ? '' : String(options.value),
  });
  let value = options.value;
  const show = () => (input.value = value === null ? '' : String(value));
  input.addEventListener('change', () => {
    // Only an explicitly emptied field removes the limit; a typo keeps the last valid value.
    const parsed = input.value.trim() === '' ? null : parseDecimal(input.value);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < options.min || parsed > options.max)) {
      show();
      return;
    }
    value = parsed;
    options.onChange(value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return h('label', { class: 'stepper-value optional-number' }, input, h('span', { class: 'stepper-unit' }, options.unit));
}

export function alertBox(level: 'info' | 'warn' | 'danger', message: string): HTMLElement {
  const name: IconName = level === 'danger' ? 'error' : level === 'warn' ? 'warning' : 'info';
  return h('div', { class: `alert alert-${level}`, role: level === 'info' ? null : 'alert' }, icon(name), h('span', null, message));
}
