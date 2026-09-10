import type { ReactNode } from 'react';

export function ResponsiveDetail({
  list,
  detail,
}: {
  list: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="admin-responsive-detail">
      <div className="admin-responsive-detail__list">{list}</div>
      {detail ? <aside className="admin-responsive-detail__panel">{detail}</aside> : null}
    </div>
  );
}
