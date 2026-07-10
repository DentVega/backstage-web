export { auth as middleware } from "@/auth";

export const config = {
  // Run on UI routes only; APIs and assets keep their own criteria.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|signin).*)"],
};
