import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main className="center-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <span>Backstage</span>
        </div>
        <p>Inicia sesión para acceder al catálogo de miniapps.</p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/catalog" });
          }}
        >
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
            <span aria-hidden="true">⎇</span> Continuar con GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
