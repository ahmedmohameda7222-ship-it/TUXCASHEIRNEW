import type { CatalogCategorySummary, CatalogJsonObject } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';
import { formatEgpMinor, parseEgpToMinor } from './ProductEditor';
import type { CatalogDefinitionCollection } from './catalogDefinitionsDraft';

export type CatalogModifierDefinition = {
  id: string;
  shopId: string;
  name: string;
  priceMinor: number;
  active: boolean;
  sortOrder: number;
};

type EditorState = {
  collection: CatalogDefinitionCollection;
  id: string;
  name: string;
  description: string;
  sortOrder: string;
  active: boolean;
  slug: string | null;
  price: string;
};

function editingCategory(category: CatalogCategorySummary): EditorState {
  return {
    collection: 'categories',
    id: category.id,
    name: category.name,
    description: category.description ?? '',
    sortOrder: String(category.sortOrder),
    active: category.active,
    slug: category.slug,
    price: '0.00',
  };
}
function editingModifier(modifier: CatalogModifierDefinition): EditorState {
  return {
    collection: 'modifiers',
    id: modifier.id,
    name: modifier.name,
    description: '',
    sortOrder: String(modifier.sortOrder),
    active: modifier.active,
    slug: null,
    price: formatEgpMinor(modifier.priceMinor),
  };
}

export function CatalogDefinitionsEditor({
  shopId,
  categories,
  modifiers,
  canEdit,
  canPrice,
  pending,
  onSave,
}: {
  shopId: string;
  categories: readonly CatalogCategorySummary[];
  modifiers: readonly CatalogModifierDefinition[];
  canEdit: boolean;
  canPrice: boolean;
  pending: boolean;
  onSave(input: {
    collection: CatalogDefinitionCollection;
    definition?: CatalogJsonObject;
    orderedIds?: readonly string[];
  }): Promise<void>;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orderedCategories = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const orderedModifiers = [...modifiers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  function beginCreate(collection: CatalogDefinitionCollection) {
    if (!canEdit || (collection === 'modifiers' && !canPrice)) return;
    const current = collection === 'categories' ? categories : modifiers;
    setEditor({
      collection,
      id: crypto.randomUUID(),
      name: '',
      description: '',
      active: true,
      slug: null,
      sortOrder: String(current.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10),
      price: '0.00',
    });
    setError(null);
  }

  async function persist(collection: CatalogDefinitionCollection, definition: CatalogJsonObject) {
    try {
      await onSave({ collection, definition });
      setEditor(null);
      setError(null);
    } catch {
      setError(
        'The catalog draft could not be saved. Review permissions and refresh if the draft changed.',
      );
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !canEdit || pending) return;
    const sortOrder = Number(editor.sortOrder);
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || !editor.name.trim()) {
      setError('Enter a name and a non-negative whole-number order.');
      return;
    }
    if (editor.collection === 'categories') {
      void persist('categories', {
        id: editor.id,
        shopId,
        name: editor.name.trim(),
        slug: editor.slug,
        description: editor.description.trim() || null,
        sortOrder,
        active: editor.active,
      });
    } else {
      try {
        const previous = modifiers.find((modifier) => modifier.id === editor.id);
        const priceMinor = canPrice ? parseEgpToMinor(editor.price) : (previous?.priceMinor ?? 0);
        void persist('modifiers', {
          id: editor.id,
          shopId,
          name: editor.name.trim(),
          priceMinor,
          sortOrder,
          active: editor.active,
        });
      } catch {
        setError('Enter a valid price in EGP with at most 2 decimals.');
      }
    }
  }

  function changeOrder(
    collection: CatalogDefinitionCollection,
    id: string,
    direction: 'up' | 'down',
  ) {
    const entries = collection === 'categories' ? orderedCategories : orderedModifiers;
    const index = entries.findIndex((entry) => entry.id === id);
    const neighborIndex = index + (direction === 'up' ? -1 : 1);
    if (index < 0 || neighborIndex < 0 || neighborIndex >= entries.length) return;
    const orderedIds = entries.map((entry) => entry.id);
    const moved = orderedIds[index]!;
    orderedIds[index] = orderedIds[neighborIndex]!;
    orderedIds[neighborIndex] = moved;
    void onSave({ collection, orderedIds }).catch(() => {
      setError('The draft order could not be saved. Refresh and retry.');
    });
  }

  return (
    <section className="admin-form-grid" aria-label="Catalog definitions">
      <div className="admin-catalog-draft-banner">
        <strong>
          Category and modifier changes remain in Draft until validated and published.
        </strong>
      </div>
      <section
        className="admin-catalog-editor__section"
        aria-labelledby="catalog-categories-heading"
      >
        <div className="admin-catalog-editor__section-heading">
          <h2 id="catalog-categories-heading">Categories</h2>
          {canEdit ? (
            <button
              className="admin-primary-button"
              type="button"
              disabled={pending}
              onClick={() => beginCreate('categories')}
            >
              Add category
            </button>
          ) : null}
        </div>
        {orderedCategories.length === 0 ? (
          <p>No categories configured. Add a category to start creating products.</p>
        ) : null}
        {orderedCategories.map((category, index) => (
          <article className="admin-settings-row admin-settings-row--stack" key={category.id}>
            <div className="admin-settings-row__main">
              <strong>{category.name}</strong>
              <span>
                {category.active ? 'Active' : 'Archived'} · Position {category.sortOrder}
              </span>
            </div>
            {canEdit ? (
              <div className="admin-inventory-page-actions">
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => setEditor(editingCategory(category))}
                >
                  Edit {category.name}
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void persist('categories', {
                      id: category.id,
                      shopId,
                      slug: category.slug,
                      name: category.name,
                      description: category.description,
                      sortOrder: category.sortOrder,
                      active: !category.active,
                    })
                  }
                >
                  {category.active ? 'Archive' : 'Restore'} {category.name}
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending || index === 0}
                  onClick={() => changeOrder('categories', category.id, 'up')}
                >
                  Move up
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending || index === orderedCategories.length - 1}
                  onClick={() => changeOrder('categories', category.id, 'down')}
                >
                  Move down
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      <section
        className="admin-catalog-editor__section"
        aria-labelledby="catalog-modifiers-heading"
      >
        <div className="admin-catalog-editor__section-heading">
          <h2 id="catalog-modifiers-heading">Modifiers / extras</h2>
          {canEdit && canPrice ? (
            <button
              className="admin-primary-button"
              type="button"
              disabled={pending}
              onClick={() => beginCreate('modifiers')}
            >
              Add modifier
            </button>
          ) : null}
        </div>
        {orderedModifiers.length === 0 ? <p>No modifiers configured for this draft.</p> : null}
        {orderedModifiers.map((modifier, index) => (
          <article className="admin-settings-row admin-settings-row--stack" key={modifier.id}>
            <div className="admin-settings-row__main">
              <strong>{modifier.name}</strong>
              <span>
                {formatEgpMinor(modifier.priceMinor)} EGP ·{' '}
                {modifier.active ? 'Active' : 'Archived'}
              </span>
            </div>
            {canEdit ? (
              <div className="admin-inventory-page-actions">
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => setEditor(editingModifier(modifier))}
                >
                  Edit {modifier.name}
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void persist('modifiers', {
                      id: modifier.id,
                      shopId,
                      name: modifier.name,
                      priceMinor: modifier.priceMinor,
                      active: !modifier.active,
                      sortOrder: modifier.sortOrder,
                    })
                  }
                >
                  {modifier.active ? 'Archive' : 'Restore'} {modifier.name}
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending || index === 0}
                  onClick={() => changeOrder('modifiers', modifier.id, 'up')}
                >
                  Move up
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending || index === orderedModifiers.length - 1}
                  onClick={() => changeOrder('modifiers', modifier.id, 'down')}
                >
                  Move down
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      {editor && canEdit ? (
        <form className="admin-form-grid" onSubmit={submit}>
          <h3>{editor.collection === 'categories' ? 'Category details' : 'Modifier details'}</h3>
          <label>
            Name
            <input
              required
              maxLength={160}
              value={editor.name}
              disabled={pending}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, name: event.currentTarget.value } : current,
                )
              }
            />
          </label>
          {editor.collection === 'categories' ? (
            <label>
              Description
              <textarea
                rows={3}
                maxLength={600}
                value={editor.description}
                disabled={pending}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, description: event.currentTarget.value } : current,
                  )
                }
              />
            </label>
          ) : (
            <label>
              Extra price (EGP)
              <input
                inputMode="decimal"
                value={editor.price}
                disabled={pending || !canPrice}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, price: event.currentTarget.value } : current,
                  )
                }
              />
            </label>
          )}
          <label>
            Sort order
            <input
              type="number"
              min={0}
              step={1}
              value={editor.sortOrder}
              disabled={pending}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, sortOrder: event.currentTarget.value } : current,
                )
              }
            />
          </label>
          <label className="admin-check-field">
            <input
              type="checkbox"
              checked={editor.active}
              disabled={pending}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, active: event.currentTarget.checked } : current,
                )
              }
            />
            <span>Active</span>
          </label>
          <button className="admin-primary-button" type="submit" disabled={pending}>
            Save definition to draft
          </button>
          <button
            className="admin-secondary-button"
            type="button"
            disabled={pending}
            onClick={() => setEditor(null)}
          >
            Cancel
          </button>
        </form>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
