/** Tabla de confianza {miniapp→pubkey}, firmada por el root del owner. */
export interface TrustBundleBody {
  /** Monotónico. El host rechaza un rollback a versión menor. */
  readonly version: number;
  readonly updatedAt: string; // ISO
  /** miniappId → pubkey raw base64url */
  readonly keys: Readonly<Record<string, string>>;
}

export interface SignedTrustBundle {
  readonly bundle: TrustBundleBody;
  /** Firma Ed25519 (base64url) del root sobre `canonicalBundleMessage(bundle)`. */
  readonly signature: string;
}
