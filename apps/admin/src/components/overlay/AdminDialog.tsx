import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

export type AdminDialogVariant = 'dialog' | 'sheet';

export type AdminDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: AdminDialogVariant;
  destructive?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange(open: boolean): void;
};

export function AdminDialog({
  open,
  title,
  description,
  children,
  footer,
  variant = 'dialog',
  destructive = false,
  initialFocusRef,
  onOpenChange,
}: AdminDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();

    const focusTarget =
      initialFocusRef?.current ??
      dialog.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    focusTarget?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      restoreFocusRef.current?.focus();
    };
  }, [initialFocusRef, open]);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      className={`admin-dialog admin-dialog--${variant}${destructive ? ' is-destructive' : ''}`}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
    >
      <div className="admin-dialog__surface">
        <header className="admin-dialog__header">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </header>
        {children ? <div className="admin-dialog__body">{children}</div> : null}
        {footer ? <footer className="admin-dialog__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  pending = false,
  destructive = false,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  destructive?: boolean;
  onConfirm(): void | Promise<void>;
  onOpenChange(open: boolean): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AdminDialog
      open={open}
      title={title}
      description={description}
      destructive={destructive}
      initialFocusRef={cancelRef}
      onOpenChange={onOpenChange}
      footer={
        <>
          <button
            ref={cancelRef}
            className="admin-secondary-button"
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            className={destructive ? 'admin-destructive-button' : 'admin-primary-button'}
            type="button"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    />
  );
}
