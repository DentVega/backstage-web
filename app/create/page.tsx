import { CreateForm } from "@/app/components/CreateForm";

export default function CreatePage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Create miniapp</h1>
      <p>
        Genera un repo nuevo desde el template (<code>miniapp-template</code>) y lo
        registra en el catálogo.
      </p>
      <CreateForm />
    </main>
  );
}
