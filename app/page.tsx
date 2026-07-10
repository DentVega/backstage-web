import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Backstage</h1>
      <p>Registro y distribución de miniapps para el host React Native + Re.Pack.</p>
      <ul>
        <li>
          <Link href="/catalog">Ver catálogo</Link>
        </li>
      </ul>
      <h2>API</h2>
      <ul>
        <li>
          <code>POST /api/miniapps</code> — registrar
        </li>
        <li>
          <code>POST /api/miniapps/:id/publish</code> — publicar versión
        </li>
        <li>
          <code>GET /api/resolve?id=</code> — resolver (el host consulta esto)
        </li>
      </ul>
    </main>
  );
}
