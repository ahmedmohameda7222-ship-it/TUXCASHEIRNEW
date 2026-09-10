import type { ReactNode } from 'react';

export function PageScaffold({
  eyebrow,
  title,
  description,
  primaryAction,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="admin-page" aria-labelledby="admin-page-title">
      <header className="admin-page__header">
        <div>
          {eyebrow ? <p className="admin-page__eyebrow">{eyebrow}</p> : null}
          <h1 id="admin-page-title">{title}</h1>
          {description ? <p className="admin-page__description">{description}</p> : null}
        </div>
        {primaryAction ? <div className="admin-page__primary-action">{primaryAction}</div> : null}
      </header>
      {children ? <div className="admin-page__body">{children}</div> : null}
    </section>
  );
}
