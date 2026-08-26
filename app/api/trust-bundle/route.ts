import { NextResponse } from "next/server";
import { scaffoldAllowedLogins, rootPublicKey } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getTrustBundleStore } from "@/lib/trust/store";
import { canonicalBundleMessage } from "@/lib/trust/message";
import { verifyMessage } from "@/lib/crypto/ed25519";
import type { SignedTrustBundle, TrustBundleBody } from "@/lib/trust/types";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

function isSignedBundle(x: unknown): x is SignedTrustBundle {
  const b = x as SignedTrustBundle | null;
  if (b === null || typeof b !== "object") return false;
  if (typeof b.signature !== "string") return false;
  const body = b.bundle as TrustBundleBody | undefined;
  return (
    body !== undefined &&
    typeof body.version === "number" &&
    typeof body.updatedAt === "string" &&
    typeof body.keys === "object" &&
    body.keys !== null
  );
}

/** GET /api/trust-bundle — público. Sirve el bundle firmado (o 404 si aún no hay). */
export async function GET(): Promise<NextResponse> {
  const bundle = await getTrustBundleStore().load();
  if (bundle === null) {
    return NextResponse.json({ error: "no trust bundle published" }, { status: 404 });
  }
  return NextResponse.json(bundle, { status: 200 });
}

/**
 * PUT /api/trust-bundle — guarda el bundle que produjo la CLI de firma. Admin (canScaffold).
 * Si ROOT_PUBLIC_KEY está seteada, valida la firma root antes de guardar (feedback temprano).
 */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as unknown;
    if (!isSignedBundle(body)) {
      return NextResponse.json({ error: "body is not a SignedTrustBundle" }, { status: 400 });
    }
    const rootPk = rootPublicKey();
    if (rootPk !== null) {
      const ok = verifyMessage(canonicalBundleMessage(body.bundle), body.signature, rootPk);
      if (!ok) {
        return NextResponse.json(
          {
            error: "bundle signature does not verify against ROOT_PUBLIC_KEY",
            code: "BAD_ROOT_SIGNATURE",
          },
          { status: 400 },
        );
      }
    }
    await getTrustBundleStore().save(body);
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
