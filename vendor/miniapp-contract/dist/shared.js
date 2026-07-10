function parseTriple(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (m === null)
        return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}
/** Does a concrete version satisfy a (minimal) range? */
export function satisfiesRange(version, range) {
    const trimmed = range.trim();
    if (trimmed === "" || trimmed === "*")
        return true;
    const provided = parseTriple(version);
    if (provided === null)
        return false;
    const operator = trimmed[0];
    const bare = operator === "^" || operator === "~" ? trimmed.slice(1) : trimmed;
    const required = parseTriple(bare);
    if (required === null)
        return false;
    const [pMajor, pMinor, pPatch] = provided;
    const [rMajor, rMinor, rPatch] = required;
    // provided must be >= required within the allowed window
    const gte = pMajor > rMajor ||
        (pMajor === rMajor && pMinor > rMinor) ||
        (pMajor === rMajor && pMinor === rMinor && pPatch >= rPatch);
    if (!gte)
        return false;
    if (operator === "^")
        return pMajor === rMajor;
    if (operator === "~")
        return pMajor === rMajor && pMinor === rMinor;
    // exact
    return pMajor === rMajor && pMinor === rMinor && pPatch === rPatch;
}
/**
 * Compare what the host provides (name → concrete version) against what a
 * miniapp requires. Compatible only when every required dep is present and in range.
 */
export function satisfiesShared(hostProvided, miniappShared) {
    const entries = miniappShared.map((dep) => {
        const providedVersion = hostProvided[dep.name];
        if (providedVersion === undefined) {
            return { name: dep.name, status: "missing", requiredRange: dep.requiredRange };
        }
        const status = satisfiesRange(providedVersion, dep.requiredRange)
            ? "ok"
            : "incompatible";
        return { name: dep.name, status, requiredRange: dep.requiredRange, providedVersion };
    });
    return { compatible: entries.every((e) => e.status === "ok"), entries };
}
//# sourceMappingURL=shared.js.map