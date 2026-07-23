# Cómo actualizar tu miniapp cuando cambia el template

> Guía para desarrolladores de miniapps (pensada para juniors). Explica cómo
> traés las mejoras del `miniapp-template` a tu miniapp **sin perder tu trabajo**.
> Complementa [`miniapps-guide.md`](./miniapps-guide.md) (ciclo de vida) y
> [`LOCAL-DEV.md`](./LOCAL-DEV.md) (desarrollo local).

## La idea en una frase

Tu miniapp **nació como una copia** del template. El template se sigue mejorando
(arreglos, versiones nuevas de librerías). Esto es cómo traés esas mejoras a tu
miniapp **sin perder tu trabajo**.

Es parecido a un `merge` desde un "upstream": el **template es el upstream**, tu
miniapp es tu copia. Pero automatizado y seguro.

---

## Hay DOS tipos de actualización (uno no lo hacés vos)

### Tipo A — El CI (vos no hacés NADA) 🤖

El pipeline que buildea y publica tu miniapp **no está copiado dentro de tu repo**
— se "toma prestado en vivo" del template (tu `ci.yml` solo dice *"usá el del
template"*, apuntando a `@main`). Entonces:

- Cuando el equipo de plataforma arregla algo del CI → **tu próximo build ya usa
  el arreglo.**
- **Acción tuya: cero.** Ni te enterás.

*(Esto es la "Capa 1" de la estrategia anti-drift.)*

### Tipo B — El código y la config (esto SÍ lo hacés) 🙋

Cuando el template cambia archivos de **configuración o código** (una versión de
React Native, una dependencia, ajustes de `rspack.config`, etc.), ahí sí
actualizás tu miniapp con **3 pasos**. Esto es lo que en el día a día significa
"actualizar la miniapp".

*(Esto es la "Capa 2": un merge 3-way que se abre como Pull Request.)*

---

## El procedimiento paso a paso (Tipo B)

**Paso 1 — Te enterás de que hay actualización.**
Hoy te avisa el equipo de plataforma ("actualizamos el template, corré el sync").
*(A futuro habrá un badge en Backstage que te lo muestra.)*

**Paso 2 — En Backstage, apretás el botón.**
Entrás a tu miniapp → botón **"Actualizar desde template"**. Eso es todo lo que
apretás.

**Paso 3 — Se abre un Pull Request en tu repo.**
El botón dispara un proceso que hace el merge y **te abre un PR en GitHub** (en el
repo de tu miniapp). Andá ahí.

> ⚠️ Importante: **abre un PR, no toca tu `main` directamente.** Nada cambia hasta
> que vos mergeás.

**Paso 4 — Revisás el PR.**
- Mirá el diff: son las mejoras del template (ej. `react-native` subió de versión).
- Confirmá que **NO tocó** tu `src/Screen.tsx` ni tu `manifest.json` (no los toca
  — están protegidos).
- Esperá que el **CI del PR quede verde** (el check ✅). Eso te dice que sigue
  compilando.

**Paso 5 — Mergeás.**
- **Caso normal (sin conflictos):** apretás *Merge*. Listo. ✅
- **Caso raro (conflicto):** el PR muestra marcadores `<<<<<<<` en las líneas donde
  **vos Y el template** editaron lo mismo. Resolvés (dejás lo correcto de cada
  lado), pusheás al branch del PR, y mergeás. Es un conflicto de git normal.

**Paso 6 — Re-deploy.**
Después de mergear, se publica una versión nueva (con el botón **Deploy** o
automático). La versión **se auto-incrementa sola** (no tenés que tocar el
número). El host móvil resuelve la última → monta tu miniapp actualizada.

---

## Un ejemplo concreto

El template sube **React Native de 0.76 a 0.77**. Vos, en tu miniapp, ya tenías tu
pantalla hecha y habías agregado la librería `zod`.

Corrés el sync → el PR muestra:

```diff
  package.json
- "react-native": "0.76.6"
+ "react-native": "0.77.0"      ← lo trajo el template
  "zod": "^3.0.0"               ← TU dependencia, intacta ✅

  src/Screen.tsx                ← NO aparece en el PR (protegido) ✅
  manifest.json                 ← NO aparece (protegido) ✅
```

Mergeás → re-deploy → tu miniapp corre con RN 0.77 y **todo tu trabajo sigue ahí**.

---

## Por qué NO rompe tu trabajo (la regla de oro)

Los archivos se dividen en tres grupos, y el sync trata cada uno distinto:

| Grupo | Ejemplos | Qué le pasa |
|---|---|---|
| **Tuyo** 🙋 | `src/Screen.tsx`, cualquier pantalla/componente nuevo tuyo, `manifest.json`, `README` | **Nunca se tocan.** |
| **Del template** 🤖 | `rspack.config.mjs`, `tsconfig.json`, `scripts/publish.mjs`, config de build | Se actualizan (merge, casi siempre limpio). |
| **Compartido** 🤝 | `package.json` | Merge inteligente: **suma** lo del template (bumps de core), **conserva** lo tuyo (deps que agregaste). |

La lista exacta de lo protegido está en el archivo `.templatesyncignore` de tu
repo.

---

## Preguntas frecuentes

**¿Pierdo mi código?**
No. Tu pantalla y tu lógica están en el grupo "tuyo" — el sync ni los mira.

**¿Y si nunca actualizo?**
Tu miniapp sigue funcionando, pero se va quedando vieja: no recibe fixes ni
versiones nuevas de librerías. Cada tanto conviene sincronizar.

**¿Qué es el archivo `.template-sync`?**
Es una "marca" que recuerda desde qué versión del template venís (guarda el SHA del
commit). Lo maneja el proceso solo — **no lo edites.**

**¿Por qué un PR y no algo automático que mergee solo?**
Para que **revises antes**. Nunca queremos cambios sorpresa en `main` sin que un
humano los mire.

**¿Cómo sé si hay una actualización pendiente?**
Hoy: te avisa plataforma. Futuro: un badge en Backstage (comparando la versión de
template de tu miniapp contra la última).

**El PR tiene conflictos, ¿me asusto?**
No. Es un conflicto de git normal (`<<<<<<<`). Resolvés dejando lo que corresponde,
o pedís una mano. Pasa **solo** si tocaste exactamente la misma línea que el
template.

**¿Y si el CI del PR falla (rojo)?**
Mirá el log: capaz el cambio del template necesita un ajuste de tu lado (raro). **No
mergees en rojo.**

**¿Puedo correr el sync sin Backstage?**
Sí, desde la terminal: `gh workflow run template-sync.yml --repo <owner>/miniapp-<id> --ref main`.
Hace exactamente lo mismo (abre el PR).

---

**Ver también:**
[`miniapps-guide.md`](./miniapps-guide.md) (crear → publicar → usar una miniapp) ·
[`LOCAL-DEV.md`](./LOCAL-DEV.md) (desarrollo local con hot reload) ·
[`SETUP.md`](./SETUP.md) (levantar toda la plataforma). Detalle técnico del
mecanismo: `docs/superpowers/specs/2026-07-21-template-sync-layer2-design.md`.
