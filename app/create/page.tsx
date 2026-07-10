import { CreateForm } from "@/app/components/CreateForm";

export default function CreatePage() {
  return (
    <main className="page">
      <p className="eyebrow">Scaffolder</p>
      <h1 className="page-title">Crear miniapp</h1>
      <p className="page-lede">
        Genera un repo nuevo desde el template (<code>miniapp-template</code>) y lo registra
        en el catálogo.
      </p>
      <div style={{ marginTop: 28 }}>
        <CreateForm />
      </div>
    </main>
  );
}
