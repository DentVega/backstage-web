/** El Host Platform Contract: fuente de verdad de lo que el host provee. */
export interface HostContract {
  /** SemVer que bumpea cuando cambia la plataforma. */
  contractVersion: string;
  /** Versión de react-native del host. */
  reactNative: string;
  /** Singletons que provee el host: name → versión concreta. */
  shared: Readonly<Record<string, string>>;
  /** Módulos nativos sin API JS compilados en el binario (presencia only). */
  nativeModules: readonly string[];
}

export function isHostContract(v: unknown): v is HostContract {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.contractVersion === "string" &&
    typeof c.reactNative === "string" &&
    typeof c.shared === "object" && c.shared !== null && !Array.isArray(c.shared) &&
    Array.isArray(c.nativeModules) &&
    c.nativeModules.every((n) => typeof n === "string")
  );
}
