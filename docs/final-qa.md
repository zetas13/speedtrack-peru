# QA final — 2026-11-02

Rama exclusiva: `fix/final-qa`, base `8001ba6` (V2 integrada). Este documento actualiza los estados históricos de `estado-v2.md`, `precision-v2.md` y `supabase-validation.md`.

## Pendientes encontrados y correcciones

- GPS: el filtro descartaba desplazamiento cuando el proveedor devolvía velocidad cero y movía el ancla, impidiendo acumular pasos. Ahora conserva el ancla y calcula distancia/tiempo aunque `coords.speed` sea cero o nulo.
- Umbral espacial adaptativo: caminar 2–4 m (0,25 × precisión), correr 2,5–5 m (0,30), bicicleta 3–8 m (0,40), vehículo 5–12 m (0,50). Se acumulan pasos contra el ancla, no se exige ese desplazamiento entre cada par de muestras consecutivas. Los límites de plausibilidad por modo se conservan. Precisión máxima aceptada: 35 m.
- Un diálogo de permisos que oculta la aplicación podía pausar la actividad antes de activar GPS. Se distingue el permiso pendiente de una pausa normal; E2E reproduce ocultación/restauración antes de la primera lectura.
- Se rechazan muestras antiguas (>15 s), futuras (>5 s), duplicadas o con coordenadas inválidas. Pausa y pérdida de señal siguen creando tramos independientes, sin sumar el trayecto no observado.
- Cada muestra aceptada actualiza el borrador recuperable inmediatamente. Finalizar o recuperar una actividad real sin movimiento muestra un mensaje explícito y no crea una fila vacía. Se preserva la recuperación del borrador si falla la cola de subida.
- Interfaz ES/EN/QU: búsqueda de GPS, precisión actual, GPS listo, aviso de precisión baja y mensaje de actividad vacía. La pérdida de precisión no elimina distancia ni muestras anteriores.
- Android: `cap sync` incorporó `@capacitor/app` a los dos archivos Gradle generados. Faltaba en el proyecto nativo integrado y es necesario para los callbacks de confirmación/recovery. Manifest conserva ubicación precisa/aproximada y el esquema de retorno de Auth.
- E2E Auth fallaba porque el mock no exponía `X-Supabase-Api-Version` mediante CORS. El SDK recibía el error sin código. Se añadió `Access-Control-Expose-Headers` y se comprobaron todos los mensajes y el enlace vencido.
- El artefacto anterior de demo indicaba una navegación a Inicio antes del resumen; no permite atribuir una causa única. La demo pasó en la reproducción inicial y en la ejecución final. Editar fuentes durante una ejecución produjo una interrupción HMR en otra prueba; la ejecución final se hizo sin cambios concurrentes en fuentes. El cierre del servidor Playwright quedó bloqueado dentro del sandbox de Windows; fuera de él terminó con código 0.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd test` | 84 tests / 13 archivos, aprobados |
| `npm.cmd run test:e2e` | 15 aprobados, código 0 |
| ESLint / TypeScript | Aprobados |
| Build web | Aprobado |
| `npm.cmd run android:apk` | Capacitor sync y Gradle assembleDebug aprobados |
| HeiGIT real | Caminar/correr: 997,7 m y 718,3 s; bicicleta: 1101 m y 271,7 s; vehículo: 1477,8 m y 220,3 s |
| Supabase real | RLS, dos cuentas, anon, rollback, idempotencia, login/refresh/logout, recuperación desde BD sin caché, enlaces reales de recovery web y adaptador Android aprobados |
| Voz e idiomas | Tests de cola, fallback traducido, cancelación y cobertura ES/EN/QU aprobados; audio físico pendiente |

La cobertura GPS incluye teléfono quieto, caminata lenta (0,6 m/s), normal (1,4 m/s), carrera, bicicleta, vehículo, ruido, pérdida temporal, pausa/reanudación y velocidad del sensor nula/cero. E2E comprueba primera lectura válida, permiso interrumpido, persistencia inmediata, historial y ausencia de sesión vacía. ETA conserva pruebas de pausa, señal antigua, velocidad reciente y cortes. Offline/outbox conserva pruebas de cuota, fallo de subida y reintento idempotente.

La validación real usa cuentas temporales y las elimina al terminar. La última ejecución pasó con login → movimiento GPS emulado en Chromium (sin demo) → sesión y al menos dos mediciones comprobadas en Supabase → logout → borrado de caché → login → historial recuperado. Los registros deportivos de prueba no corresponden a recorridos físicos. `scripts/validate-routing.mjs` repite las consultas HeiGIT sin imprimir claves.

## Diagnóstico GPS

En desarrollo (`npm.cmd run dev`), consultar en la consola:

```js
window.speedtrackGpsDiagnostics()
```

Devuelve muestras recibidas, aceptadas y descartadas; precisión, motivo, distancia incremental en metros y velocidad instantánea en km/h de la última evaluación. No contiene coordenadas, identificadores ni tokens. Los contadores se conservan durante pausas y se reinician con una actividad nueva. `below_movement_threshold` indica una muestra válida que todavía no supera el umbral espacial; `fix` establece una referencia sin sumar distancia. El acceso global no se instala en producción.

## APK

- Ruta: `android/app/build/outputs/apk/debug/app-debug.apk` (ignorado por Git).
- Tamaño: 5 926 919 bytes.
- SHA-256: `93f79f5a9154126980eff8498f4e81930fef1e1b391409e9d3e77361461e647b`.

## Validación externa pendiente

- ADB no detectó dispositivos. No se afirma haber reproducido el reporte en teléfono físico. Falta caminar al aire libre con permiso preciso y contrastar distancia, permiso inicial, audio nativo y reapertura de enlaces de correo en Android.
- Sigue siendo seguimiento de primer plano: ocultar/bloquear la app después del permiso pausa la actividad y conserva el borrador; hay que reanudar al volver. No se añadió servicio de ubicación en segundo plano en esta ronda.
- Supabase rechazó las direcciones ficticias `@example.com` con `email_address_invalid`; en las siguientes ejecuciones respondió `over_email_send_rate_limit`. Se confirmaron únicamente cuentas temporales mediante Admin API y se probaron enlaces reales generados administrativamente. Entrega SMTP, registro público con un buzón controlado y apertura manual del correo siguen pendientes; se solicitó el correo de prueba. No se alteraron confirmación global, SMTP ni límites.
- La cobertura técnica Quechua pasa; revisión lingüística nativa pendiente.
- Los filtros no pueden garantizar distancia cero frente a toda deriva GPS. Los tests acreditan sus escenarios sintéticos; falta calibración de ruido y distancia en exteriores con teléfonos reales.
- Advertencias de compilación: chunks grandes (MapLibre diferido), repositorios Gradle `flatDir`, versión XML de herramientas SDK y API obsoleta de voz. No impiden el APK. Los avisos de Auth de E2E son errores provocados intencionalmente y solo registran código/estado; el aviso duplicado de plugin apareció durante HMR, no en la ejecución final.
