# El proceso: cómo se implementa una super-app con mini-apps

> [!NOTE]
> Esta página es la vista **de negocio** del proceso —&nbsp;pensada para entender *qué*
> se necesita para llevar una super-app a producción y *por qué*, sin entrar en lo técnico.
> Para el detalle de implementación, ver el resto de la documentación.

Una empresa quiere **una sola app** para sus usuarios. Pero adentro hay muchas áreas y
equipos que necesitan lanzar y actualizar sus funcionalidades **sin pisarse entre sí** y sin
esperar la cola de revisión de la App Store o Play Store cada vez.

**La idea, en una frase:** una super-app es **una app anfitriona** (el "host") que aloja
**mini-apps** —&nbsp;cada una desarrollada, publicada y actualizada de forma independiente— y
las muestra al usuario como si fueran parte de la misma aplicación.

> [!TIP]
> **Pensalo como un shopping.** El **host** es el edificio: entrada, pasillos, seguridad,
> servicios comunes. Las **mini-apps** son los locales: cada uno abre, cambia su vidriera y
> renueva su stock por su cuenta, pero todos conviven bajo el mismo techo y las mismas reglas.

El proceso completo se organiza en **8 pasos**, agrupados en 3 etapas.

---

## Etapa 1 — Cimientos

*Lo que hay que definir antes de escribir la primera mini-app.*

### 1. La app anfitriona (el host)

**Qué es:** la app que la gente instala. Provee lo común a todas las mini-apps: navegación,
sesión, identidad del usuario y el sistema de diseño compartido.

- **Beneficio:** una sola app para el usuario; los equipos no rehacen lo básico una y otra vez.
- **Cómo queda resuelto:** un host listo para alojar cualquier mini-app, con librerías y servicios compartidos.

### 2. La torre de control (el control-plane)

**Qué es:** un panel central donde se registran, publican, versionan y gobiernan todas las
mini-apps: qué existe, qué versión está viva y quién puede publicar.

- **Beneficio:** visibilidad y control desde un solo lugar; se sabe qué está en producción y por quién.
- **Cómo queda resuelto:** un panel web con catálogo, publicación, historial de versiones y estado de cada mini-app.

### 3. El contrato (las reglas de convivencia)

**Qué es:** un contrato explícito que define qué provee el host y qué debe cumplir una
mini-app para vivir adentro sin romper la aplicación.

- **Beneficio:** mini-apps de distintos equipos conviven sin romperse entre sí ni tirar abajo la app.
- **Cómo queda resuelto:** un contrato versionado, única fuente de verdad compartida entre el host y las mini-apps.

---

## Etapa 2 — Publicación y calidad

*Cómo una funcionalidad llega al usuario —&nbsp;rápido y sin sorpresas.*

### 4. La línea de publicación

**Qué es:** el camino de "código listo" a "vivo en el teléfono del usuario", sin tener que
reenviar la app a la tienda cada vez que cambia una mini-app.

- **Beneficio:** funcionalidades y arreglos en minutos, no en la cola de revisión de la tienda (actualización directa).
- **Cómo queda resuelto:** publicación automatizada; el teléfono resuelve y trae la versión correcta en el momento.

### 5. El doble control de calidad

**Qué es:** antes de que algo se publique, se verifica automáticamente en dos sentidos: que
la mini-app es compatible con el host, y que un cambio del host no rompa las mini-apps que ya
están publicadas.

- **Beneficio:** se evita el "actualicé y se cayó todo": el riesgo se detecta antes de llegar al usuario.
- **Cómo queda resuelto:** chequeos automáticos en ambas direcciones que bloquean lo incompatible.

---

## Etapa 3 — Operar y escalar

*Mantener la plataforma viva y hacerla crecer con la organización.*

### 6. Gobierno, seguridad e integridad

**Qué es:** quién puede hacer qué (dueños responsables por cada mini-app), y la garantía de
que lo que se ejecuta en el teléfono es exactamente lo que se publicó —&nbsp;nada alterado en el camino.

- **Beneficio:** control de acceso claro y confianza en cada pieza que llega al usuario.
- **Cómo queda resuelto:** permisos por mini-app + verificación de integridad de cada versión antes de ejecutarla.

### 7. La operación del día a día

**Qué es:** volver atrás una versión al instante si algo sale mal, medir uso y fallas para
decidir con datos, y servir iOS y Android desde el mismo proceso.

- **Beneficio:** si una mini-app falla, se revierte en segundos; decisiones con métricas; una sola operación para las dos plataformas.
- **Cómo queda resuelto:** rollback por versión, métricas de uso y fallas, y publicación iOS + Android.

### 8. Escalar la organización

**Qué es:** sumar equipos y mini-apps nuevas rápido, y mantener a toda la flota al día desde
una plantilla común —&nbsp;para que una mejora de base llegue a todos sin trabajo manual repetido.

- **Beneficio:** crecer sin multiplicar el trabajo manual; una mejora se propaga a toda la flota.
- **Cómo queda resuelto:** alta guiada de mini-apps + sincronización con la plantilla + entorno local de un comando para los equipos.

---

## No es teoría: cada paso está construido y probado

Este proceso no es un plan a futuro. Las 8 fases están implementadas y funcionando: una flota
real de mini-apps corre hoy sobre este host, publicando y actualizándose en **iOS y Android**,
con los controles de calidad y el rollback operativos.

| | |
|---|---|
| **8 / 8** | fases del proceso, implementadas |
| **iOS + Android** | desde el mismo proceso de publicación |
| **Flota real** | mini-apps en producción, actualizándose solas |

---

## Cómo se arranca: el orden importa

Los tres primeros pasos son los cimientos —&nbsp;todo lo demás se apoya sobre ellos:

1. **Definir el host** — qué app anfitriona y qué servicios comunes ofrece a las mini-apps.
2. **Montar la torre de control** — el panel central que registra, publica y gobierna la flota.
3. **Fijar el contrato** — las reglas de convivencia.

Con esos cimientos en su lugar, se suma la línea de publicación y los controles de calidad
(Etapa 2), y por último la operación y la escala (Etapa 3).

> [!TIP]
> **Próximo paso:** una sesión de descubrimiento para mapear tu caso —&nbsp;áreas, equipos,
> apps existentes— a este proceso y armar el plan de implementación por etapas.
