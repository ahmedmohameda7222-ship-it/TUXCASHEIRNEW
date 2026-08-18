import { parsePoundsToMinor, type MoneyMinor } from '@tux/domain';
import { useEffect, useState } from 'react';
import { moneyMinorInputValue } from './ordersView';

export function MoneyInput({
  id,
  label,
  value,
  disabled = false,
  compact = false,
  onCommit,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: MoneyMinor;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onCommit: (value: MoneyMinor) => void;
}) {
  const [raw, setRaw] = useState(() => moneyMinorInputValue(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(moneyMinorInputValue(value));
  }, [value]);

  function commit(): void {
    const parsed = parsePoundsToMinor(raw);
    if (parsed === null) {
      setError('Enter a valid amount with up to 2 decimal places.');
      return;
    }
    setError(null);
    setRaw(moneyMinorInputValue(parsed));
    onCommit(parsed);
  }

  return (
    <div className={compact ? 'money-field money-field-compact' : 'money-field'}>
      <label htmlFor={id}>{label}</label>
      <div className="money-input-wrap">
        <span aria-hidden="true">EGP</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={raw}
          disabled={disabled}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => {
            setRaw(event.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {error === null ? null : (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
