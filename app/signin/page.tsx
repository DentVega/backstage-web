import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Backstage</h1>
      <p>Inicia sesión para acceder al catálogo de miniapps.</p>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/catalog" });
        }}
      >
        <button type="submit">Sign in with GitHub</button>
      </form>
    </main>
  );
}
