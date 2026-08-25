import { parsePoundsToMinor, ZERO_MONEY, type MoneyMinor } from '@tux/domain';
import { useEffect, useState } from 'react';
import { moneyMinorInputValue } from './ordersView';

interface SharedMoneyInputProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly compact?: boolean;
}

export interface MoneyInputProps extends SharedMoneyInputProps {
  readonly value: MoneyMinor;
  readonly onCommit: (value: MoneyMinor) => void;
}

export interface OptionalMoneyInputProps extends SharedMoneyInputProps {
  readonly value: MoneyMinor | null;
  readonly onCommit: (value: MoneyMinor | null) => void;
}

function rawValue(value: MoneyMinor | null): string {
  return value === null || value === ZERO_MONEY ? '' : moneyMinorInputValue(value);
}

function MoneyTextEditor({
  id,
  label,
  value,
  placeholder = '0',
  disabled = false,
  compact = false,
  blankValue,
  onCommit,
}: SharedMoneyInputProps & {
  readonly value: MoneyMinor | null;
  readonly blankValue: MoneyMinor | null;
  readonly onCommit: (value: MoneyMinor | null) => void;
}) {
  const [raw, setRaw] = useState(() => rawValue(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(rawValue(value));
  }, [value]);

  function commit(): void {
    if (raw.trim() === '') {
      setError(null);
      setRaw('');
      onCommit(blankValue);
      return;
    }

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
          placeholder={placeholder}
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

export function MoneyInput({ value, onCommit, ...props }: MoneyInputProps) {
  return (
    <MoneyTextEditor
      {...props}
      value={value}
      blankValue={ZERO_MONEY}
      onCommit={(nextValue) => onCommit(nextValue ?? ZERO_MONEY)}
    />
  );
}

export function OptionalMoneyInput({ value, onCommit, ...props }: OptionalMoneyInputProps) {
  return <MoneyTextEditor {...props} value={value} blankValue={null} onCommit={onCommit} />;
}
