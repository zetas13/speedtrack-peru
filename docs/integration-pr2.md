# Integración PR #2 — 2026-11-02

Rama exclusiva: `integration/pr2-final`. Este informe complementa las revisiones históricas de QA; no se integra en `main`.

## Resolución

- Los nueve archivos en conflicto se combinaron por bloques. Los Gradle generados conservan background geolocation, App y Geolocation; `cap sync android` los regenera desde las dependencias.
- `package.json` conserva el plugin background 1.3.1 y `patch-package`, además de las actualizaciones del PR. El lockfile se regenera con `npm install`, sin editar manualmente sus conflictos.
- GPS usa desplazamiento/tiempo y umbrales adaptativos por modo. Cero o null en velocidad del dispositivo no bloquean movimiento, incluso después de recibir velocidad positiva. Se conservan diagnóstico, rechazo de timestamps, saltos y aceleraciones imposibles, ancla para caminata lenta y cortes tras pausas/pérdida de señal.
- Foreground y replay del diario Android comparten `GpsFilter`. Se conserva la captura nativa con pantalla bloqueada, comandos serializados, recuperación del diario y prevención de watchers duplicados.
- Del PR se conservan PKCE, permisos aproximados con aviso, acelerómetro/pasos estimados, cálculos incrementales, reducción de borradores y gráficos largos, icono/splash, CI/APK y mejoras de routing/geocodificación.
- El acelerómetro no bloquea GPS: una lectura de reposo no demuestra ausencia de desplazamiento y el sensor web se suspende en background. Se descartan muestras inválidas y se reinicia la ventana después de un intervalo sin sensor. Los pasos se ofrecen solamente para sesiones foreground, no como un conteo completo durante pantalla bloqueada.
- Se conservan Supabase/Auth/RLS, HeiGIT, ETA, interfaces por modo, voz ES/EN/QU, caché, outbox y persistencia.
- Se eliminan los ejemplos precargados. La simulación académica sigue disponible explícitamente, etiquetada, persistida localmente y excluida de estadísticas, importación y subida a Supabase. Los fixtures de pruebas están separados del generador de simulación.
- Los controles activos quedan anclados sobre la navegación inferior para que destino, avisos y pantallas pequeñas no oculten pausa/finalizar.

## Verificación aprobada

- Sin marcadores de conflicto en código, pruebas, Gradle ni manifiestos npm.
- `npm install`: lockfile regenerado y parche background 1.3.1 aplicado.
- Typecheck, lint y build web aprobados.
- Vitest: 114 pruebas, 18 archivos aprobados; incluye RLS en PGlite, GPS cero/null, replay, watchers, PKCE, sensores y sesiones largas.
- Playwright: 20 E2E aprobados; incluye cuatro modos en tres tamaños, simulación, persistencia, cuentas y ciclo Android emulado.
- `npx cap sync android`: background geolocation, App y Geolocation presentes.
- `gradlew assembleDebug testDebugUnitTest`: aprobado. Seis pruebas Java, cinco del diario nativo; cero errores/fallos.
- APK regenerado: `android/app/build/outputs/apk/debug/app-debug.apk`, 9 291 847 bytes. Firma v2 verificada con `apksigner`.
- SHA-256: `b60509325201c5c249983fe7588733d93556727a0ed07b7e7496d940c2db436a`.

Windows requirió ejecutar npm con acceso al registro/caché y ejecutar E2E, Capacitor y Gradle fuera del sandbox. E2E finalizó con código cero. No se deshabilitaron comprobaciones.

Advertencias no bloqueantes: chunks web grandes, repositorios Gradle `flatDir`, herramientas SDK XML y APIs obsoletas. npm informa 14 avisos moderados; no se aplicaron actualizaciones incompatibles durante el merge.

## Límites de validación

Las pruebas sintéticas de GPS y replay verifican sus escenarios, no garantizan distancia cero ante toda deriva ni precisión en todos los teléfonos. Faltan recorridos de referencia en Android físico, bloqueo prolongado, batería/permisos del fabricante y voz nativa. También quedan la revisión lingüística Quechua y la validación de correo/PKCE y proveedores con servicios reales. Esta integración no cambia ajustes remotos de Supabase.

Los cálculos incrementales y el muestreo reducen el coste de sesiones largas, pero el historial sigue sujeto a las cuotas locales. Los pasos son heurísticos; no sustituyen la distancia GPS.
