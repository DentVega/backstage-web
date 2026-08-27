# El proceso en breve

> [!NOTE]
> La versión resumida: los **8 pasos** para implementar una super-app con mini-apps, cada uno
> en una línea con su beneficio. Para el detalle de cada fase —&nbsp;qué es, cuándo conviene y
> el porqué— ver [El proceso (completo)](/docs/proceso).

## Etapa 1 · Cimientos — qué definir primero

1. **La app anfitriona (el host)**
   Es lo único que el usuario instala; las mini-apps entran y salen sin tocar esa instalación. Provee lo común a todas: navegación, sesión, identidad del usuario y el sistema de diseño.
   → *Una sola app para el usuario; los equipos no rehacen lo básico una y otra vez.*

2. **La torre de control**
   El lugar único donde se registran, publican y versionan todas las mini-apps, y desde donde se controla quién puede publicar y qué versión está viva en producción.
   → *Visibilidad y control desde un solo lugar; se sabe qué está en producción y por quién.*

3. **El contrato**
   Define qué ofrece el host y qué debe cumplir una mini-app —&nbsp;por ejemplo, usar las mismas versiones de las librerías de base— para convivir sin romper la app.
   → *Mini-apps de equipos distintos conviven sin romperse entre sí ni tirar abajo la app.*

## Etapa 2 · Publicación y calidad — cómo llega al usuario

4. **La línea de publicación**
   Como las mini-apps viajan por separado del host, se publican directo: se suben, quedan registradas con su versión, y el teléfono trae la nueva sin reenviar la app a la tienda.
   → *De días (cola de la tienda) a minutos (actualización directa) para lanzar.*

5. **El doble control de calidad**
   Dos chequeos automáticos: que la mini-app cumpla el contrato del host, y que un cambio del host no rompa ninguna mini-app ya publicada. Si algo no da, se frena antes de publicar.
   → *Se evita el "actualicé y se cayó todo": el riesgo se detecta antes del usuario.*

## Etapa 3 · Operar y escalar — mantener viva y crecer

6. **Gobierno, seguridad e integridad**
   Permisos por mini-app (quién es responsable, quién puede publicar) + la garantía de que lo que corre en el teléfono es idéntico a lo que se publicó, sin nada alterado en el camino — y firma criptográfica que además prueba *quién* lo publicó.
   → *Control de acceso claro y confianza en cada pieza que llega al usuario.*

7. **La operación del día a día**
   Rollback instantáneo si una versión sale mal, métricas de uso y fallas para decidir con datos, y las dos plataformas (iOS + Android) desde el mismo proceso.
   → *Revertir en segundos; decidir con métricas; una operación para las dos plataformas.*

8. **Escalar la organización**
   Alta guiada de mini-apps nuevas + propagación de las mejoras de base (seguridad, configuración común) a toda la flota desde una plantilla, en vez de repetirlas una por una.
   → *Crecer sin multiplicar el trabajo manual; una mejora se propaga a toda la flota.*

---

> [!TIP]
> **El orden importa.** Los pasos 1–3 son los cimientos; todo lo demás se apoya sobre ellos.
> Cada etapa depende de la anterior. → **[Ver el proceso completo](/docs/proceso)** para el
> detalle de cada fase.
