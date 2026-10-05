import type { ReactNode } from 'react';

type StateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

function StateSurface({
  kind,
  title,
  description,
  action,
}: StateProps & { kind: 'loading' | 'empty' | 'error' }) {
  return (
    <div
      className={`admin-state admin-state--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      aria-busy={kind === 'loading' ? true : undefined}
    >
      {kind === 'loading' ? <span className="admin-state__skeleton" aria-hidden="true" /> : null}
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
      {action ? <div className="admin-state__action">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ title = 'Loading…', description }: Partial<StateProps>) {
  return <StateSurface kind="loading" title={title} description={description} />;
}

export function EmptyState(props: StateProps) {
  return <StateSurface kind="empty" {...props} />;
}

export function ErrorState(props: StateProps) {
  return <StateSurface kind="error" {...props} />;
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="admin-inline-error" role="alert">
      {children}
    </p>
  );
}
