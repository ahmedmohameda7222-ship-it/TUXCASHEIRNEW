import { cloneElement, isValidElement, type ReactNode } from 'react';

type FieldControlProps = {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
};

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
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = isValidElement<FieldControlProps>(children)
    ? cloneElement(children, {
        id,
        required: required || children.props.required,
        'aria-describedby':
          [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') ||
          undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children;

  return (
    <div className="admin-field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="admin-form-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="admin-form-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
