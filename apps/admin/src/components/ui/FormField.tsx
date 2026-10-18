import type { ReactNode } from 'react';

export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="admin-field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? <p id={`${id}-hint`} className="admin-form-field__hint">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="admin-form-field__error" role="alert">{error}</p> : null}
    </div>
  );
}
