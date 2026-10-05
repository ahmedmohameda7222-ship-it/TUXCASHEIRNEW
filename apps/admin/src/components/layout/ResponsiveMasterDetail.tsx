import type { ReactNode } from 'react';
import { Link } from 'wouter';

type ResponsiveMasterDetailProps = {
  list: ReactNode;
  detail?: ReactNode;
  listLabel: string;
  detailLabel: string;
  detailActive: boolean;
  backHref: string;
  emptyDetail?: ReactNode;
};

export function ResponsiveMasterDetail({
  list,
  detail,
  listLabel,
  detailLabel,
  detailActive,
  backHref,
  emptyDetail,
}: ResponsiveMasterDetailProps) {
  return (
    <div
      className="admin-master-detail"
      data-detail-active={detailActive ? 'true' : 'false'}
      data-admin-master-detail
    >
      <section className="admin-master-detail__list" aria-label={listLabel}>
        {list}
      </section>
      <aside className="admin-master-detail__detail" aria-label={detailLabel}>
        {detailActive ? (
          <>
            <Link className="admin-master-detail__back" href={backHref}>
              ← Back to {listLabel.toLocaleLowerCase()}
            </Link>
            {detail}
          </>
        ) : (
          emptyDetail
        )}
      </aside>
    </div>
  );
}
