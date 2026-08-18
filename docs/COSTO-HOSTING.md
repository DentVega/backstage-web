# Costo de hosting: ¿dónde alojar las mini-apps?

> [!NOTE]
> Comparación de costo entre tres opciones para **guardar y servir los chunks** de las
> mini-apps. El costo lo domina el **egress**: cada vez que un teléfono descarga el chunk de
> una mini-app. Precios de las páginas oficiales **al 18-08-2026**, región US —&nbsp;conviene
> re-verificarlos antes de una decisión formal.

## Las tres opciones

| Opción | Qué es | Egress |
|---|---|---|
| **Zephyr Cloud** | Servicio gestionado llave en mano (no construís la plataforma). $19–99 por editor/mes. | Se cobra (~$0,25–0,40/GB) |
| **Nuestra plataforma · Vercel** | Nuestro control-plane en Vercel + chunks en Vercel Blob. | $0,05/GB (Blob Data Transfer) |
| **Nuestra plataforma · Cloudflare** | Mismo control-plane + chunks en Cloudflare R2. | **$0 — gratis** |

## Un escenario de ejemplo

Tomemos una super-app de **100.000 usuarios/mes, 10 mini-apps, releases semanales y 10 editores**.
Eso genera **~1 millón de descargas de chunk al mes** (~400 GB de egress). A esa escala el
bandwidth entra en el tier incluido de las tres —&nbsp;así que lo que las separa es el
**modelo por-asiento**.

| Opción | Uso (egress + ops) | Asientos | **Total / mes** |
|---|---|---|---|
| Zephyr Cloud | $0 (bajo 1 TB incl.) | 10 × $19 = $190 | **~$190** |
| Nuestra · Vercel | ~$2 | 1 × $20 | **~$22** |
| Nuestra · Cloudflare | $0 | 1 × $20 | **~$20** |

> [!TIP]
> La diferencia **no es el tráfico** (a esta escala es casi gratis en las tres) —&nbsp;es que en
> la plataforma propia **los equipos que publican no pagan asiento** (publican vía GitHub / token
> / CI), así que 10 editores cuestan lo mismo que 1. Zephyr cobra **$19 por editor**. Por eso, a
> esta escala, la plataforma propia sale **~9× más barata**.

## Cómo escala si crece el tráfico

Costo mensual vs. cantidad de descargas (eje vertical en escala logarítmica, 1 asiento para
aislar el efecto del tráfico). El escenario de ejemplo cae en la zona de ~1 M.

<div style="overflow-x:auto;margin:16px 0;">
<svg viewBox="0 0 860 440" role="img" aria-label="Costo mensual vs escala" style="width:100%;height:auto;">
<line x1="66" y1="386.0" x2="838" y2="386.0" stroke="#8a8e98" stroke-width="1" opacity="0.25"/>
<text x="56" y="390.0" text-anchor="end" fill="#8a8e98" font-size="12" font-family="monospace">$10</text>
<line x1="66" y1="295.0" x2="838" y2="295.0" stroke="#8a8e98" stroke-width="1" opacity="0.25"/>
<text x="56" y="299.0" text-anchor="end" fill="#8a8e98" font-size="12" font-family="monospace">$100</text>
<line x1="66" y1="204.0" x2="838" y2="204.0" stroke="#8a8e98" stroke-width="1" opacity="0.25"/>
<text x="56" y="208.0" text-anchor="end" fill="#8a8e98" font-size="12" font-family="monospace">$1k</text>
<line x1="66" y1="113.0" x2="838" y2="113.0" stroke="#8a8e98" stroke-width="1" opacity="0.25"/>
<text x="56" y="117.0" text-anchor="end" fill="#8a8e98" font-size="12" font-family="monospace">$10k</text>
<line x1="66" y1="22.0" x2="838" y2="22.0" stroke="#8a8e98" stroke-width="1" opacity="0.25"/>
<text x="56" y="26.0" text-anchor="end" fill="#8a8e98" font-size="12" font-family="monospace">$100k</text>
<text x="66.0" y="408" text-anchor="middle" fill="#8a8e98" font-size="12" font-family="monospace">100 K</text>
<text x="66.0" y="424" text-anchor="middle" fill="#8a8e98" font-size="11" opacity="0.8">~39 GB</text>
<text x="259.0" y="408" text-anchor="middle" fill="#8a8e98" font-size="12" font-family="monospace">1 M</text>
<text x="259.0" y="424" text-anchor="middle" fill="#8a8e98" font-size="11" opacity="0.8">~390 GB</text>
<text x="452.0" y="408" text-anchor="middle" fill="#8a8e98" font-size="12" font-family="monospace">10 M</text>
<text x="452.0" y="424" text-anchor="middle" fill="#8a8e98" font-size="11" opacity="0.8">~3,9 TB</text>
<text x="645.0" y="408" text-anchor="middle" fill="#8a8e98" font-size="12" font-family="monospace">100 M</text>
<text x="645.0" y="424" text-anchor="middle" fill="#8a8e98" font-size="11" opacity="0.8">~39 TB</text>
<text x="838.0" y="408" text-anchor="middle" fill="#8a8e98" font-size="12" font-family="monospace">1 B</text>
<text x="838.0" y="424" text-anchor="middle" fill="#8a8e98" font-size="11" opacity="0.8">~390 TB</text>
<text x="66" y="434" text-anchor="start" fill="#8a8e98" font-size="11" opacity="0.8">descargas de chunk / mes  &#8594;</text>
<line x1="259.0" y1="22" x2="259.0" y2="386" stroke="#178f80" stroke-dasharray="5 4" stroke-width="1.5" opacity="0.8"/>
<text x="266.0" y="35" text-anchor="start" fill="#178f80" font-size="12" font-family="monospace">&#9664; escenario ejemplo</text>
<polyline points="66.0,360.6 259.0,360.6 452.0,208.9 645.0,115.1 838.0,23.1" fill="none" stroke="#d1495b" stroke-width="2.5"/>
<circle cx="66.0" cy="360.6" r="4" fill="#d1495b"/>
<circle cx="259.0" cy="360.6" r="4" fill="#d1495b"/>
<circle cx="452.0" cy="208.9" r="4" fill="#d1495b"/>
<circle cx="645.0" cy="115.1" r="4" fill="#d1495b"/>
<circle cx="838.0" cy="23.1" r="4" fill="#d1495b"/>
<polyline points="66.0,358.6 259.0,354.8 452.0,264.7 645.0,173.7 838.0,82.7" fill="none" stroke="#c9821c" stroke-width="2.5"/>
<circle cx="66.0" cy="358.6" r="4" fill="#c9821c"/>
<circle cx="259.0" cy="354.8" r="4" fill="#c9821c"/>
<circle cx="452.0" cy="264.7" r="4" fill="#c9821c"/>
<circle cx="645.0" cy="173.7" r="4" fill="#c9821c"/>
<circle cx="838.0" cy="82.7" r="4" fill="#c9821c"/>
<polyline points="66.0,358.6 259.0,358.6 452.0,358.6 645.0,320.8 838.0,242.7" fill="none" stroke="#178f80" stroke-width="2.5"/>
<circle cx="66.0" cy="358.6" r="4" fill="#178f80"/>
<circle cx="259.0" cy="358.6" r="4" fill="#178f80"/>
<circle cx="452.0" cy="358.6" r="4" fill="#178f80"/>
<circle cx="645.0" cy="320.8" r="4" fill="#178f80"/>
<circle cx="838.0" cy="242.7" r="4" fill="#178f80"/>
<text x="832.0" y="15.1" text-anchor="end" fill="#d1495b" font-size="12" font-family="monospace">$97.371</text>
<text x="832.0" y="74.7" text-anchor="end" fill="#c9821c" font-size="12" font-family="monospace">$21.531</text>
<text x="832.0" y="234.7" text-anchor="end" fill="#178f80" font-size="12" font-family="monospace">$376</text>
</svg>
</div>

**Leyenda:** <span style="color:#d1495b">■</span> Zephyr Cloud · <span style="color:#c9821c">■</span> Nuestra · Vercel · <span style="color:#178f80">■</span> Nuestra · Cloudflare (R2)

| Descargas / mes | Egress | Zephyr | Vercel (Blob) | Cloudflare (R2) |
|---|---|---|---|---|
| 100 K | ~39 GB | $19 | $20 | **$20** |
| 1 M | ~390 GB | $19 | $22 | **$20** |
| 10 M | ~3,9 TB | $884 | $215 | **$20** |
| 100 M | ~39 TB | $9.480 | $2.153 | **$52** |
| 1 B | ~390 TB | $97.371 | $21.531 | **$376** |

## Conclusión

- **A escala chica** (hasta ~1 M descargas/mes) las tres cuestan parecido en *tráfico*; la
  diferencia la hace el **modelo por-asiento**, donde la plataforma propia gana porque los
  publishers no pagan asiento.
- **A escala grande** el **egress** manda: Zephyr y Vercel lo cobran y se disparan; **Cloudflare
  R2 tiene egress $0** y se queda casi plano. A 100 M descargas: ~$52 (R2) vs ~$2.150 (Vercel)
  vs ~$9.500 (Zephyr).
- **Zephyr** aporta valor cuando *no* querés construir/mantener la plataforma. Cuando ya la
  tenés (como en este proyecto), la comparación real es dónde viven los chunks —&nbsp;y ahí
  **R2 es la opción óptima**. Esta plataforma ya usa R2 por defecto (ver [Setup](/docs/setup)).

## Supuestos

- **Chunk ~0,4 MB** por descarga. **"Descargas" ≠ aperturas de la app**: los chunks son
  inmutables y se cachean en el teléfono → se descargan una vez por versión, no en cada uso.
  El egress real suele ser bastante menor.
- **Escenario de ejemplo:** un usuario abre ~4 de las 10 mini-apps por mes y baja ~2–3 versiones
  nuevas de cada una (release semanal) → ~1 M descargas/mes.
- **Asientos:** en la plataforma propia, publicar no consume asiento (GitHub / token / CI); solo
  cuenta ~1 asiento de admin del control-plane. Zephyr cobra por editor.
- Precios oficiales **al 18-08-2026**, región US. **Re-verificar** antes de decidir.
