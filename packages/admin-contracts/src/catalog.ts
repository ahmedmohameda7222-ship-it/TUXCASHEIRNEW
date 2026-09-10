export type CatalogJsonPrimitive = string | number | boolean | null;
export type CatalogJsonValue =
  CatalogJsonPrimitive | CatalogJsonValue[] | { [key: string]: CatalogJsonValue };
export type CatalogJsonObject = { [key: string]: CatalogJsonValue };

export type CatalogDraftStatus = 'DRAFT' | 'PUBLISHED' | 'DISCARDED';

export type CatalogDraftSummary = {
  id: string;
  shopId: string;
  title: string | null;
  status: CatalogDraftStatus;
  basePublishVersion: number;
  draftRevision: number;
  publishedVersion: number | null;
  updatedAt: string;
};

export type CatalogCategorySummary = {
  id: string;
  shopId: string;
  slug: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

export type CatalogProductDetail = {
  id: string;
  shopId: string;
  categoryId: string;
  slug: string | null;
  name: string;
  description: string | null;
  priceMinor: number;
  imageKey: string | null;
  family: string | null;
  bestSeller: boolean;
  active: boolean;
  soldOut: boolean;
  isCombo: boolean;
  sortOrder: number;
};

export type CatalogWorkspace = {
  shopId: string;
  currentPublishVersion: number;
  categories: CatalogCategorySummary[];
  products: CatalogProductDetail[];
  drafts: CatalogDraftSummary[];
};

export type CatalogPublishPreview = {
  draftId: string;
  shopId: string;
  basePublishVersion: number;
  currentPublishVersion: number;
  draftRevision: number;
  stale: boolean;
  changedProductIds: string[];
  priceChangedProductIds: string[];
};

/**
 * Bundle replacement is the compatibility boundary used while the editor evolves.
 * changedPaths is advisory UI metadata for early permission feedback only; the trusted
 * database publish/draft RPCs independently compare canonical price fields and enforce
 * catalog.pricing, so this metadata can never grant authority.
 */
export type CatalogDraftChange = {
  kind: 'bundle.replace';
  bundleJson: CatalogJsonObject;
  changedPaths?: string[];
};

export type CatalogCreateDraftInput = {
  shopId: string;
  expectedVersion: number;
  title?: string;
};

export type CatalogSaveDraftInput = {
  draftId: string;
  shopId: string;
  expectedDraftRevision: number;
  changes: CatalogDraftChange[];
};

export type CatalogPublishDraftInput = {
  draftId: string;
  shopId: string;
  expectedDraftRevision: number;
  expectedVersion: number;
};

export type CatalogImmediateAvailabilityInput = {
  shopId: string;
  productId: string;
  soldOut: boolean;
};

export type CatalogStaleVersionResult = {
  ok: false;
  code: 'stale_version';
  message: string;
  currentVersion: number;
};

export type CatalogDraftCreateResult =
  | {
      ok: true;
      draftId: string;
      draftRevision: number;
      basePublishVersion: number;
      bundleJson: CatalogJsonObject;
    }
  | CatalogStaleVersionResult;

export type CatalogDraftSaveResult =
  | {
      ok: true;
      draftId: string;
      draftRevision: number;
      basePublishVersion: number;
    }
  | {
      ok: false;
      code: 'draft_not_found' | 'draft_not_editable' | 'stale_draft_revision' | 'invalid_change';
      currentDraftRevision?: number;
    };

export type CatalogPublishResult =
  | {
      ok: true;
      draftId: string;
      publishVersion: number;
      operationsConfigurationVersion: number;
    }
  | CatalogStaleVersionResult
  | {
      ok: false;
      code: 'draft_not_found' | 'draft_not_publishable' | 'stale_draft_revision';
      currentDraftRevision?: number;
    };

export type CatalogImmediateAvailabilityResult =
  | {
      ok: true;
      productId?: string;
      soldOut?: boolean;
      publishVersion: number;
      operationsConfigurationVersion: number;
      idempotentReplay?: boolean;
    }
  | { ok: false; code: 'invalid_request' | 'product_not_found' };

export type CatalogCommand =
  | ({ type: 'draft.create' } & CatalogCreateDraftInput)
  | ({ type: 'draft.save' } & CatalogSaveDraftInput)
  | ({ type: 'draft.publish' } & CatalogPublishDraftInput)
  | ({ type: 'availability.set' } & CatalogImmediateAvailabilityInput);
