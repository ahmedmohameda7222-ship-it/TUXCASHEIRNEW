import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'regular' | 'small';
  pending?: boolean;
};

const buttonClasses: Record<ButtonVariant, string> = {
  primary: 'admin-primary-button',
  secondary: 'admin-secondary-button',
  quiet: 'admin-button--quiet',
  destructive: 'admin-destructive-button',
};

export function Button({
  variant = 'secondary',
  size = 'regular',
  pending = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={[buttonClasses[variant], size === 'small' && 'admin-button--small', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  );
}
