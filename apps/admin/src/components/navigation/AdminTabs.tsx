import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export type AdminTab<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
  disabled?: boolean;
};

export function AdminTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: readonly AdminTab<T>[];
  value: T;
  onChange(value: T): void;
}) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.id === value));

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabled = tabs
      .map((tab, candidateIndex) => ({ tab, candidateIndex }))
      .filter(({ tab }) => !tab.disabled);
    if (enabled.length === 0) return;
    const currentEnabledIndex = enabled.findIndex(({ candidateIndex }) => candidateIndex === index);
    let nextEnabledIndex = currentEnabledIndex;
    if (event.key === 'ArrowRight') nextEnabledIndex = (currentEnabledIndex + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') nextEnabledIndex = (currentEnabledIndex - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') nextEnabledIndex = 0;
    else if (event.key === 'End') nextEnabledIndex = enabled.length - 1;
    else return;

    event.preventDefault();
    const next = enabled[nextEnabledIndex];
    if (!next) return;
    onChange(next.tab.id);
    tabRefs.current[next.candidateIndex]?.focus();
  }

  const selected = tabs[selectedIndex];
  if (!selected) return null;

  return (
    <div className="admin-tabs">
      <div className="admin-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selectedTab = tab.id === value;
          const tabId = `${baseId}-${tab.id}-tab`;
          const panelId = `${baseId}-${tab.id}-panel`;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={tabId}
              className="admin-tabs__tab"
              type="button"
              role="tab"
              aria-selected={selectedTab}
              aria-controls={panelId}
              tabIndex={selectedTab ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <section
        id={`${baseId}-${selected.id}-panel`}
        className="admin-tabs__panel"
        role="tabpanel"
        aria-labelledby={`${baseId}-${selected.id}-tab`}
        tabIndex={0}
      >
        {selected.content}
      </section>
    </div>
  );
}
