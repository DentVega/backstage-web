# El proceso: cómo se implementa una super-app con mini-apps

> [!NOTE]
> Esta página es la vista **de negocio** del proceso —&nbsp;pensada para entender *qué*
> se necesita para llevar una super-app a producción y *por qué*, sin entrar en lo técnico.
> ¿Solo querés los pasos? → [El proceso en breve](/docs/proceso-breve). Para la vista técnica,
> [Cómo funciona](/docs/arquitectura); para el mental model completo, el
> [Platform Overview](/docs/platform-overview).

**Lanzá features en minutos, no en la cola de la tienda —&nbsp;y revertí un problema en
segundos.** Eso es lo que habilita una super-app bien implementada. Este es el proceso para
llegar ahí.

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

## Las 8 fases de un vistazo

| Etapa | # | Fase | En una línea |
|---|---|---|---|
| **Cimientos** | 1 | La app anfitriona | La app que se instala; provee lo común a todas. |
| | 2 | La torre de control | Panel central: registrar, publicar, gobernar. |
| | 3 | El contrato | Las reglas para convivir sin romperse entre sí. |
| **Publicación y calidad** | 4 | La línea de publicación | De código a vivo, sin pasar por la tienda cada vez. |
| | 5 | El doble control de calidad | Chequeos automáticos que frenan lo incompatible. |
| **Operar y escalar** | 6 | Gobierno, seguridad e integridad | Quién puede qué + lo que corre es lo que se publicó. |
| | 7 | La operación del día a día | Rollback, métricas, iOS + Android. |
| | 8 | Escalar la organización | Sumar equipos y propagar mejoras a la flota. |

## ¿Cuándo conviene una super-app?

No es la respuesta para toda app. Vale la pena ser honesto sobre cuándo suma y cuándo es
sobre-ingeniería.

| Conviene si… | Es overkill si… |
|---|---|
| **Varios equipos o áreas** publican en la misma app y no quieren pisarse. | Un **solo equipo** mantiene toda la app. |
| Las funcionalidades se **actualizan seguido** y molesta la cola de la tienda. | Releases **esporádicos**; la cola de la tienda no es un problema. |
| La app es **grande** y conviene modularizarla por dominio. | La app es **chica** y simple; un solo bundle alcanza. |
| Querés **rollback por parte** sin frenar todo, y gobierno por equipo. | No necesitás versionar ni gobernar partes por separado. |

En una frase: **cuantos más equipos, más frecuencia de release y más superficie**, más paga el
modelo. Para una app chica de un equipo, el overhead no se justifica.

---

## Etapa 1 — Cimientos

*Lo que hay que definir antes de escribir la primera mini-app.*

### 1. La app anfitriona (el host)

**Qué es:** es lo único que el usuario instala y actualiza desde la tienda; todo lo demás
—&nbsp;las mini-apps— entra y sale sin tocar esa instalación. El host provee lo común a todas:
navegación, sesión, identidad del usuario y el sistema de diseño compartido. Definir el host
es, en el fondo, decidir qué queda *fijo* (lo estable y común) y qué queda *móvil* (las
mini-apps que evolucionan por su cuenta).

- **Beneficio:** una sola app para el usuario; los equipos no rehacen lo básico una y otra vez.
- **Cómo queda resuelto:** un host listo para alojar cualquier mini-app, con librerías y servicios compartidos.

### 2. La torre de control (el control-plane)

**Qué es:** sin un lugar central, cada equipo publicaría por su cuenta y nadie sabría con
certeza qué versión está viva ni quién la subió. La torre de control es ese lugar único: un
catálogo de todas las mini-apps, el historial de versiones de cada una, y los permisos de
quién puede publicar qué. Es también desde donde se ordena una vuelta atrás o se congela una
versión cuando hace falta.

- **Beneficio:** visibilidad y control desde un solo lugar; se sabe qué está en producción y por quién.
- **Cómo queda resuelto:** un panel web con catálogo, publicación, historial de versiones y estado de cada mini-app.

### 3. El contrato (las reglas de convivencia)

**Qué es:** es el punto más importante y el menos obvio. Cuando muchas mini-apps comparten la
misma app, tienen que ponerse de acuerdo en las piezas comunes —&nbsp;por ejemplo, usar la
misma versión de las librerías de base. El contrato pone eso por escrito: qué ofrece el host y
qué puede dar por sentado una mini-app. Sin contrato, dos equipos que evolucionan por separado
tarde o temprano chocan y rompen la app para todos.

- **Beneficio:** mini-apps de distintos equipos conviven sin romperse entre sí ni tirar abajo la app.
- **Cómo queda resuelto:** un contrato versionado, única fuente de verdad compartida entre el host y las mini-apps.

---

## Etapa 2 — Publicación y calidad

*Cómo una funcionalidad llega al usuario —&nbsp;rápido y sin sorpresas.*

### 4. La línea de publicación

**Qué es:** normalmente, cambiar cualquier cosa en una app móvil implica reenviarla a la
tienda y esperar la revisión —&nbsp;días. Acá, como las mini-apps viajan por separado del host,
se publican directo: se suben, quedan registradas con su número de versión, y el teléfono las
trae la próxima vez que el usuario entra. La app instalada no cambia; cambia el contenido que
baja. Ese es el corazón de por qué una super-app se mueve tan rápido.

- **Beneficio:** de **días** (cola de revisión de la tienda) a **minutos** (actualización directa) para lanzar una funcionalidad o un arreglo.
- **Cómo queda resuelto:** publicación automatizada; el teléfono resuelve y trae la versión correcta en el momento.

### 5. El doble control de calidad

**Qué es:** el riesgo de una plataforma así es que una sola pieza rompa al resto. Por eso hay
dos chequeos automáticos que corren solos: **(1)** cuando una mini-app se va a publicar, se
verifica que cumple el contrato del host; **(2)** cuando el host va a cambiar algo compartido,
se verifica que ese cambio no rompa ninguna mini-app ya publicada. Si algo no da, se frena ahí
—&nbsp;antes de llegar al usuario, no después.

- **Beneficio:** se evita el "actualicé y se cayó todo": el riesgo se detecta antes de llegar al usuario.
- **Cómo queda resuelto:** chequeos automáticos en ambas direcciones que bloquean lo incompatible.

---

## Etapa 3 — Operar y escalar

*Mantener la plataforma viva y hacerla crecer con la organización.*

### 6. Gobierno, seguridad e integridad

**Qué es:** son dos cosas distintas que van juntas. **Gobierno:** quién es responsable de cada
mini-app y quién puede publicar —&nbsp;para que no cualquiera suba cualquier cosa.
**Integridad y autenticidad:** una garantía de que lo que corre en el teléfono es idéntico a
lo que se publicó, sin nada alterado en el camino (integridad); si una pieza no coincide con
su huella, no se ejecuta. Sobre eso, la plataforma suma **firma criptográfica**, que prueba
además *quién* publicó esa versión (autenticidad), no solo que no cambió.
Juntas dan control de acceso y confianza en cada actualización.

- **Beneficio:** control de acceso claro y confianza en cada pieza que llega al usuario.
- **Cómo queda resuelto:** permisos por mini-app + verificación de integridad (y firma) de cada versión antes de ejecutarla.

### 7. La operación del día a día

**Qué es:** una vez en producción, la plataforma necesita herramientas de operación. Si una
mini-app falla, se vuelve a la versión anterior al instante —&nbsp;sin reenviar nada a la
tienda. Se miden los usos y las fallas para saber qué se usa de verdad y qué está fallando. Y
todo el proceso sirve iOS y Android a la vez, sin duplicar el trabajo por plataforma.

- **Beneficio:** ante una falla, rollback en **segundos** (no un release de emergencia); decisiones con métricas; **una** operación para las **dos** plataformas.
- **Cómo queda resuelto:** rollback por versión, métricas de uso y fallas, y publicación iOS + Android.

### 8. Escalar la organización

**Qué es:** al principio son pocas mini-apps; el valor real aparece cuando son muchas y de
muchos equipos. Para eso, sumar una mini-app nueva tiene que ser rápido y guiado, y las mejoras
de base —&nbsp;seguridad, configuración común— deben propagarse a toda la flota desde una
plantilla, en vez de repetirlas una por una. Se suma también un entorno local simple para que
cada equipo itere rápido sin depender de la nube.

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
| **3 mini-apps** | reales en producción, actualizándose solas |

---

## Cómo se arranca: el orden importa

Los tres primeros pasos son los cimientos —&nbsp;todo lo demás se apoya sobre ellos:

1. **Definir el host** — qué app anfitriona y qué servicios comunes ofrece a las mini-apps.
2. **Montar la torre de control** — el panel central que registra, publica y gobierna la flota.
3. **Fijar el contrato** — las reglas de convivencia.

Con esos cimientos en su lugar, se suma la línea de publicación y los controles de calidad
(Etapa 2), y por último la operación y la escala (Etapa 3). Cada etapa se apoya en la anterior:
por eso el orden importa.

> [!NOTE]
> **Qué vs. cómo.** Este documento describe *qué* se construye y en qué orden. El *cómo* lo
> ejecuta el equipo —&nbsp;el ritmo de trabajo— es independiente: se lleva adelante con una
> metodología ágil (Scrum, Kanban), construyendo las fases de forma incremental. El orden marca
> **dependencias** (sin host no hay dónde publicar), no entregas de a bloques cerrados.

---

> [!TIP]
> **En una frase.** Una super-app se construye en 8 pasos sobre tres cimientos —&nbsp;host,
> torre de control y contrato—; con eso, muchos equipos publican mini-apps de forma
> independiente, con releases en minutos, rollback en segundos y controles que evitan que una
> pieza rompa al resto. **Acá ya está construido y probado end-to-end.**
