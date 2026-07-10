const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MINIAPP_ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const KNOWN_CAPABILITIES = ["accounts:read", "session:whoami"];
/** Parse & validate a semver string; returns null when malformed. */
export function parseSemVer(value) {
    return SEMVER_RE.test(value) ? value : null;
}
/** Validate a miniapp id; returns null when malformed. */
export function parseMiniappId(value) {
    return value.length > 0 && MINIAPP_ID_RE.test(value) ? value : null;
}
function isSharedDepSpec(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const o = x;
    return (typeof o.name === "string" &&
        o.name.length > 0 &&
        typeof o.requiredRange === "string" &&
        o.requiredRange.length > 0 &&
        typeof o.singleton === "boolean");
}
function isCapability(x) {
    return typeof x === "string" && KNOWN_CAPABILITIES.includes(x);
}
/** Structural type guard for a Manifest coming from an untrusted source. */
export function isManifest(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const o = x;
    if (typeof o.id !== "string" || parseMiniappId(o.id) === null)
        return false;
    if (typeof o.version !== "string" || parseSemVer(o.version) === null)
        return false;
    if (typeof o.entry !== "string" || o.entry.length === 0)
        return false;
    if (!Array.isArray(o.shared) || !o.shared.every(isSharedDepSpec))
        return false;
    if (!Array.isArray(o.capabilities) || !o.capabilities.every(isCapability))
        return false;
    if (o.integrity !== undefined && typeof o.integrity !== "string")
        return false;
    return true;
}
//# sourceMappingURL=guards.js.map