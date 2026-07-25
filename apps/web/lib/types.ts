/**
 * The TypeScript mirror of the frozen /v1 contract.
 *
 * `packages/core/src/contract.mjs` is the authority — it is plain ESM with
 * JSDoc so it can be vendored into the Claude Code plugin, which runs on a
 * user's machine with nothing installed. These interfaces exist only so the
 * site type-checks; they add no fields the contract does not have.
 *
 * Runtime validation is `parseVerdictHead()` from `@surex/core`, not these
 * types. A shape that arrives off the wire is checked there before anything
 * renders it — a malformed response must degrade to `unknown`, never to
 * `clean`.
 */

/** Contract states. `running` is NOT one of them — see `RowStatus`. */
export type VerdictState =
  | 'clean'
  | 'flagged'
  | 'disputed'
  | 'unreviewable'
  | 'stale'
  | 'unknown';

export type Tier = 'A' | 'B' | 'C' | 'MISMATCH';

/**
 * What the registry list can show in the state column. `running` is a queue
 * status, not a verdict: a review in flight has no VerdictHead yet, and the
 * gate would read it as `unknown`. It is display-only and never decides
 * anything.
 */
export type RowStatus = VerdictState | 'running';

/** Keys match `capabilityLine()` in `@surex/core` — do not rename them. */
export type CapabilityKey = 'network' | 'filesystem' | 'exec' | 'env' | 'credentials';

export interface Capability {
  /** The deterministic scan found it. Not model output. */
  present: boolean;
  /** Plain-language reach, e.g. "reads STRIPE_*, AWS_* wholesale". */
  what?: string;
  /**
   * The same thing under the name the API lane chose. The frozen contract types
   * `capabilities` as an opaque object, so the two lanes picked different keys
   * for the prose — read both rather than making the other lane change.
   */
  detail?: string;
  /** The line that proves it, e.g. "src/init.ts:214". */
  proof?: string;
  /** True when this reach is the thing a finding or a rebuttal is about. */
  implicated?: boolean;
}

export type Capabilities = Partial<Record<CapabilityKey, Capability>>;

export interface Finding {
  file?: string;
  line?: number;
  /** One line, the headline of the finding. */
  title?: string;
  description?: string;
  /** 0-4. `SEVERITY_LABEL` in `@surex/core` names them. */
  severity?: number;
  category?: string;
  /** Source lines around `line`, for the evidence well. */
  excerpt?: { line: number; text: string; implicated?: boolean }[];
}

/** Walrus/Sui pointers. Recorded on every record so a claim stays checkable. */
export interface BlobRef {
  blobId?: string;
  suiObjectId?: string;
  registerTx?: string;
  certifyTx?: string;
  encodingType?: string;
  /**
   * False once the storage epoch has lapsed. Arkiv expiry and Walrus epochs
   * are independent clocks (tech-spec §4.4): "evidence expired" and "no
   * evidence" are different facts and the UI must not conflate them.
   */
  retrievable?: boolean;
  expiredAt?: string;
}

/**
 * Where a recorded identifier can be LOOKED AT, built by `apps/api/src/links.mjs`.
 *
 * The API is the only place that turns an id into a URL — no surface hand-rolls
 * an explorer path — so these arrive already built and the page's only job is to
 * render them. Every field is optional because that module omits anything the
 * record does not carry: a dead link that looks alive is worse than no link.
 *
 * Not part of `@surex/core`'s frozen `VerdictHead` contract, and deliberately
 * not added to it: the gate resolves a decision from annotations alone and has
 * no use for a URL. This type describes what the WEB receives, which is a
 * superset.
 */
export interface RecordLinks {
  /** The bytes themselves, from a Walrus aggregator. */
  blob?: string;
  /** The blob's object on Sui, when our own wallet registered it. */
  suiObject?: string;
  registerTx?: string;
  certifyTx?: string;
  /** The entity on the Arkiv (Braga) explorer — where the pointer is recorded. */
  arkivEntity?: string;
}

/** The whole hot-path answer. Field-for-field with VERDICT_HEAD_FIELDS. */
export interface VerdictHead {
  fingerprint: string;
  state: VerdictState;
  severity: number;
  tier: Tier;
  reason?: string;
  links?: RecordLinks;
  name?: string;
  enforceAfter?: number;
  reviewedCommit?: string;
  reviewedAt?: string;
  modelId?: string;
  promptVersion?: string;
  integrity?: string;
  capabilities?: Capabilities;
  topFinding?: Finding;
  disputeSummary?: string;
  evidence?: BlobRef;
  arkivEntityKey?: string;
  updatedAt?: string;
  /** TRUE when this row is demo data. Never omitted when it is. */
  illustrative?: boolean;
}

/** One line in the registry list. */
export interface RegistryRow {
  fingerprint?: string;
  name: string;
  version: string;
  status: RowStatus;
  tier: Tier | '—';
  standing: string;
  /** Which hue the standing text takes — meaning, not decoration. */
  standingTone?: 'neutral' | 'stale' | 'disputed';
  reviewedAt: string;
  capabilities: string;
  illustrative?: boolean;
  /** No verdict page exists for a review still in flight. */
  linkable?: boolean;
}

export interface Claim {
  title: string;
  body: string;
  file?: string;
  severity?: number;
  filedBy: string;
  filedAt: string;
  evidence?: string;
  onChain?: string;
  /** Agent-filed rebuttals carry a call-volume attestation, not a score. */
  standing?: string;
}

export type DisputeStatus = 'open' | 'under_review' | 'upheld' | 'overturned';

export interface Dispute {
  fingerprint: string;
  subject: string;
  version: string;
  status: DisputeStatus;
  contestantType: 'human' | 'agent';
  contestant: string;
  openedAt: string;
  closesAt?: string;
  closedAt?: string;
  supersededBy?: string;
  accusation: Claim;
  rebuttal: Claim;
  illustrative?: boolean;
}

/** `/v1/entry/<fp>` — everything the verdict page renders. */
export interface Entry {
  head: VerdictHead;
  /** The "in twenty seconds" paragraph. */
  summary?: string;
  /** What the reader can do next, one line. */
  options?: string;
  findings?: Finding[];
  source?: {
    repo?: string;
    commit?: string;
    versionString?: string;
    packageRef?: string;
    licence?: string;
    blob?: BlobRef;
    normalisedTreeSha256?: string;
    /** Its OWN links. The source blob and the review blob are different blobs. */
    links?: RecordLinks;
  };
  review?: {
    key?: string;
    modelId?: string;
    promptVersion?: string;
    agreementRuns?: number;
    analyzedAt?: string;
    blob?: BlobRef;
    links?: RecordLinks;
  };
  /** What the gate compared locally, in words. Never a claim about the machine. */
  localLinkage?: { text: string; tone: 'clean' | 'stale' | 'unknown' };
  tierNote?: string;
  dispute?: Dispute;
  supersededBy?: string;
  supersededAt?: string;
  overrideCommand?: string;
  illustrative?: boolean;
}

export interface RegistryStats {
  reviewed?: number;
  flagged?: number;
  disputed?: number;
  stale?: number;
  tierA?: number;
  illustrative?: boolean;
}

/**
 * Where a screen's data came from. Rendered, not logged: a page backed by
 * fixtures says so at the top, every time, for as long as it is.
 */
export type DataOrigin = 'api' | 'fixture';

export interface Sourced<T> {
  data: T;
  origin: DataOrigin;
  /** True when the payload is not a real review of a real MCP server. */
  illustrative: boolean;
  /** Why the API was not used, when it was not. Shown, not swallowed. */
  note?: string;
}
