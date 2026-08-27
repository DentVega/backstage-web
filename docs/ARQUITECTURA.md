# Cómo funciona (arquitectura)

> [!NOTE]
> Vista **visual** de la arquitectura: los **tres planos** y los **dos flujos** de la
> plataforma. Para el detalle conceptual completo, ver [Platform Overview](/docs/platform-overview).

La plataforma se organiza en **tres planos** con responsabilidades claras. El código de cada
mini-app (su "chunk") viaja **por separado** del host —&nbsp;por eso se actualiza sin pasar por
la tienda de apps cada vez.

## Los tres planos

<div style="margin:14px 0">
  <div style="border:1px solid rgba(128,128,132,.28);border-left:4px solid #b5771a;border-radius:12px;padding:14px 16px;background:rgba(128,128,132,.06)">
    <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#b5771a;font-weight:700">Plano de control · Backstage — web · Vercel</div>
    <ul style="margin:8px 0 0;padding-left:18px">
      <li><strong>Registro y catálogo</strong> de todas las mini-apps y sus versiones.</li>
      <li><strong>Resolución</strong> (<code>/api/resolve</code>): dado un id + plataforma, devuelve qué versión servir, su URL y su huella.</li>
      <li><strong>Publicación</strong> y <strong>gobierno</strong>: quién puede publicar, pin/rollback, Host Contract y gates.</li>
    </ul>
  </div>
  <div style="text-align:center;color:#8a8e98;font-size:18px;line-height:1;margin:3px 0">&#8597;</div>
  <div style="border:1px solid rgba(128,128,132,.28);border-left:4px solid #5f7d90;border-radius:12px;padding:14px 16px;background:rgba(128,128,132,.06)">
    <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5f7d90;font-weight:700">Plano de distribución · Storage + CDN — Cloudflare R2</div>
    <ul style="margin:8px 0 0;padding-left:18px">
      <li><strong>Chunks</strong> = el código empaquetado de cada mini-app.</li>
      <li><strong>Inmutables por versión</strong>, uno por plataforma (iOS / Android), cada uno con su <strong>sha256</strong>.</li>
      <li>Se sirven por CDN y quedan <strong>cacheados en el teléfono</strong> una vez bajados.</li>
    </ul>
  </div>
  <div style="text-align:center;color:#8a8e98;font-size:18px;line-height:1;margin:3px 0">&#8597;</div>
  <div style="border:1px solid rgba(128,128,132,.28);border-left:4px solid #159485;border-radius:12px;padding:14px 16px;background:rgba(128,128,132,.06)">
    <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#159485;font-weight:700">Plano de ejecución · Host móvil — React Native · Module Federation</div>
    <ul style="margin:8px 0 0;padding-left:18px">
      <li>La app que la gente <strong>instala</strong>; provee lo común (navegación, sesión, diseño).</li>
      <li>En runtime <strong>resuelve → descarga → verifica → monta</strong> cada mini-app.</li>
      <li>Las mini-apps corren <strong>dentro</strong> del host como si fueran parte de la app.</li>
    </ul>
  </div>
</div>

## Flujo 1 · Publicar una mini-app

Cómo una versión nueva pasa de "código listo" a estar disponible, **sin reenviar la app a la tienda**.

<div style="overflow-x:auto;margin:14px 0">
  <div style="display:flex;align-items:stretch;gap:0;min-width:660px">
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#5f7d90;font-weight:700">01</div>
      <div style="font-weight:600;margin-top:2px">Build</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">El equipo pushea; el CI compila el chunk (iOS + Android).</div>
    </div>
    <div style="flex:0 0 28px;display:grid;place-items:center;color:#5f7d90;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#5f7d90;font-weight:700">02</div>
      <div style="font-weight:600;margin-top:2px">Compat gate ✓</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">Se verifica que cumple el contrato del host. Si no, se frena acá.</div>
    </div>
    <div style="flex:0 0 28px;display:grid;place-items:center;color:#5f7d90;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#5f7d90;font-weight:700">03</div>
      <div style="font-weight:600;margin-top:2px">Registrar</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">Backstage registra la versión nueva y calcula su sha256.</div>
    </div>
    <div style="flex:0 0 28px;display:grid;place-items:center;color:#5f7d90;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#5f7d90;font-weight:700">04</div>
      <div style="font-weight:600;margin-top:2px">Guardar</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">El chunk va al storage (R2), inmutable y por plataforma.</div>
    </div>
  </div>
</div>

## Flujo 2 · Montar en el teléfono

Qué pasa cuando un usuario abre una mini-app dentro de la super-app.

<div style="overflow-x:auto;margin:14px 0">
  <div style="display:flex;align-items:stretch;gap:0;min-width:760px">
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#159485;font-weight:700">01</div>
      <div style="font-weight:600;margin-top:2px">Abrir</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">El usuario entra a una mini-app en el host.</div>
    </div>
    <div style="flex:0 0 26px;display:grid;place-items:center;color:#159485;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#159485;font-weight:700">02</div>
      <div style="font-weight:600;margin-top:2px">Resolver</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">El host le pregunta a Backstage qué versión y URL servir.</div>
    </div>
    <div style="flex:0 0 26px;display:grid;place-items:center;color:#159485;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#159485;font-weight:700">03</div>
      <div style="font-weight:600;margin-top:2px">Descargar</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">Baja el chunk del CDN, o lo toma de cache si ya lo tiene.</div>
    </div>
    <div style="flex:0 0 26px;display:grid;place-items:center;color:#159485;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#159485;font-weight:700">04</div>
      <div style="font-weight:600;margin-top:2px">Verificar</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">Chequea el sha256: que sea exactamente lo publicado.</div>
    </div>
    <div style="flex:0 0 26px;display:grid;place-items:center;color:#159485;font-weight:700">&#8594;</div>
    <div style="flex:1;border:1px solid rgba(128,128,132,.28);border-radius:10px;padding:12px 13px;background:rgba(128,128,132,.06)">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#159485;font-weight:700">05</div>
      <div style="font-weight:600;margin-top:2px">Montar</div>
      <div style="opacity:.72;font-size:.85rem;margin-top:3px">Module Federation monta la mini-app dentro del host.</div>
    </div>
  </div>
</div>

> [!TIP]
> **El gobierno cruza los dos flujos.** El **Host Contract + los gates de compatibilidad**
> bloquean al publicar lo que no encaja (en ambos sentidos: mini-app → host y host → flota),
> y la **verificación de integridad** (sha256) garantiza que lo que corre en el teléfono es
> idéntico a lo que se publicó — con **firma** Ed25519 la plataforma suma además
> *autenticidad* (quién lo publicó; ver [API Reference](/docs/api-reference) §5.7). Además, el
> **pin de versión** permite **rollback instantáneo** sin tocar la app instalada. Ver
> [Host Contract](/docs/host-contract) y [Compat gate](/docs/compat-gate).
