export type CatalogJsonPrimitive = string | number | boolean | null;
export type CatalogJsonValue =
  CatalogJsonPrimitive | CatalogJsonValue[] | { [key: string]: CatalogJsonValue };
export type CatalogJsonObject = { [key: string]: CatalogJsonValue };

export type CatalogDraftStatus = 'DRAFT' | 'PUBLISHED' | 'DISCARDED';
export type CatalogPublishSourceKind =
  | 'BASELINE'
  | 'DRAFT'
  | 'IMMEDIATE_AVAILABILITY'
  | 'RECURRING_AVAILABILITY'
  | 'SCHEDULE'
  | 'ROLLBACK';
export type CatalogScheduleStatus = 'PENDING' | 'CLAIMED' | 'APPLIED' | 'FAILED' | 'CANCELLED';

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

export type CatalogPublishVersionSummary = {
  shopId: string;
  publishVersion: number;
  operationsConfigurationVersion: number;
  sourceKind: CatalogPublishSourceKind;
  draftId: string | null;
  publishedByEmployeeId: string | null;
  restoredFromPublishVersion: number | null;
  publishedAt: string;
};

export type CatalogScheduledChangeSummary = {
  id: string;
  shopId: string;
  draftId: string | null;
  expectedDraftRevision: number | null;
  status: CatalogScheduleStatus;
  timezone: 'Africa/Cairo';
  localScheduledAt: string;
  scheduledFor: string;
  targetBasePublishVersion: number | null;
  attemptCount: number;
  lastError: string | null;
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

export type CatalogPublishingWorkspace = {
  shopId: string;
  currentPublishVersion: number;
  versions: CatalogPublishVersionSummary[];
  draftPreviews: CatalogPublishPreview[];
  schedules: CatalogScheduledChangeSummary[];
};

export type CatalogRecurringAvailabilityProduct = {
  masterProductId: string;
  productId: string;
  name: string;
  manualSoldOut: boolean;
};

export type CatalogRecurringAvailabilityRuleSummary = {
  id: string;
  shopId: string;
  masterProductId: string;
  timezone: 'Africa/Cairo';
  daysOfWeek: number[];
  startLocal: string;
  endLocal: string;
  available: boolean;
  active: boolean;
  version: number;
  updatedAt: string;
};

export type CatalogRecurringAvailabilityWorkspace = {
  shopId: string;
  products: CatalogRecurringAvailabilityProduct[];
  rules: CatalogRecurringAvailabilityRuleSummary[];
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

export type CatalogRestoreVersionInput = {
  shopId: string;
  sourcePublishVersion: number;
  expectedVersion: number;
};

export type CatalogScheduleDraftInput = {
  draftId: string;
  shopId: string;
  expectedDraftRevision: number;
  expectedVersion: number;
  /** Wall-clock activation time interpreted only in Africa/Cairo by the trusted server. */
  localScheduledAt: string;
};

export type CatalogCancelScheduleInput = {
  shopId: string;
  scheduleId: string;
};

export type CatalogSaveRecurringAvailabilityRuleInput = {
  shopId: string;
  ruleId: string | null;
  masterProductId: string;
  /** Sunday=0 through Saturday=6. */
  daysOfWeek: number[];
  /** Cairo wall-clock time, HH:MM or HH:MM:SS. */
  startLocal: string;
  /** Cairo wall-clock time, HH:MM or HH:MM:SS. end <= start means next local day. */
  endLocal: string;
  /** Whether the product should be available while the recurring window is active. */
  available: boolean;
  active: boolean;
  expectedVersion: number | null;
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

export type CatalogRestoreVersionResult =
  | {
      ok: true;
      sourcePublishVersion: number;
      publishVersion: number;
      operationsConfigurationVersion: number;
    }
  | CatalogStaleVersionResult
  | {
      ok: false;
      code: 'invalid_request' | 'publish_version_not_found' | 'restore_source_must_be_historical';
    };

export type CatalogScheduleResult =
  | {
      ok: true;
      scheduleId: string;
      status: CatalogScheduleStatus;
      scheduledFor: string;
      localScheduledAt: string;
      timezone: 'Africa/Cairo';
      idempotentReplay: boolean;
    }
  | CatalogStaleVersionResult
  | {
      ok: false;
      code:
        | 'draft_not_found'
        | 'draft_not_schedulable'
        | 'stale_draft_revision'
        | 'scheduled_time_required'
        | 'scheduled_time_must_be_future';
      currentDraftRevision?: number;
    };

export type CatalogCancelScheduleResult =
  | {
      ok: true;
      scheduleId: string;
      status: 'CANCELLED';
      idempotentReplay: boolean;
    }
  | {
      ok: false;
      code:
        | 'schedule_not_found'
        | 'unsupported_schedule_kind'
        | 'schedule_in_progress'
        | 'schedule_already_applied';
    };

export type CatalogSaveRecurringAvailabilityRuleResult =
  | {
      ok: true;
      ruleId: string;
      version: number;
      timezone: 'Africa/Cairo';
      active: boolean;
    }
  | {
      ok: false;
      code:
        | 'invalid_request'
        | 'product_not_found'
        | 'rule_not_found'
        | 'stale_rule_version'
        | 'recurring_rule_conflict';
      currentVersion?: number;
    };

export type CatalogCommand =
  | ({ type: 'draft.create' } & CatalogCreateDraftInput)
  | ({ type: 'draft.save' } & CatalogSaveDraftInput)
  | ({ type: 'draft.publish' } & CatalogPublishDraftInput)
  | ({ type: 'availability.set' } & CatalogImmediateAvailabilityInput)
  | ({ type: 'availability.recurring.save' } & CatalogSaveRecurringAvailabilityRuleInput)
  | ({ type: 'version.restore' } & CatalogRestoreVersionInput)
  | ({ type: 'draft.schedule' } & CatalogScheduleDraftInput)
  | ({ type: 'schedule.cancel' } & CatalogCancelScheduleInput);