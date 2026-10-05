# SpeedTrack Perú

Prototipo móvil de Física I e Ingeniería de Sistemas. React, Vite, TypeScript, Lucide y Recharts.

## Iniciar desde CMD

```cmd
cd /d "C:\Users\Diego Cueva\Desktop\diego\universidad\PROYECTOFISICAUNO"
npm install
npm run dev
```

Abrir la dirección local que imprime Vite. En PowerShell puede usarse `npm.cmd` si la política bloquea `npm.ps1`.

## Verificación

```cmd
npm run build
npm run lint
npm test
```

## Funcionamiento

- Las demos duran 45 segundos activos reales; pausar detiene el reloj. Deporte simula 30 minutos (×40), vehículo mantiene escala ×1. Se integra velocidad por el método trapezoidal, y los splits interpolan el cruce de cada kilómetro. La demo termina y se guarda automáticamente.
- GPS se solicita solo al iniciar una sesión real. Requiere contexto seguro (HTTPS o localhost); abrir la IP HTTP del PC desde el teléfono permite las demos, pero normalmente no GPS. No se garantiza funcionamiento en segundo plano o con la pantalla bloqueada. La ruta es un esquema, no cartografía.
- La distancia GPS usa Haversine, descarta saltos mayores a 250 km/h y desplazamientos pequeños respecto de la precisión declarada. Es un filtro básico, no una medición certificada. La aceleración escalar usa diferencias finitas en m/s². Las frenadas/aceleraciones fuertes usan umbral 2.5 m/s²; el límite lo establece el usuario y la precaución empieza al 90%.
- Voz usa SpeechSynthesis y voces instaladas. No hay reconocimiento de comandos; figura como Próximamente. Avisos por kilómetro, 30 minutos, mejor split, pausa, reanudación, fin, velocidad y eventos vehiculares.
- Español e inglés completos. Quechua Cusco-Collao (`qu-PE`) parcial y explícitamente pendiente de revisión lingüística. Las cadenas técnicas conservan el español; no se fabrican traducciones. Diccionarios tipados separados.
- Las sesiones y preferencias persisten en localStorage. Los ejemplos precargados son datos simulados. No hay cuenta ni envío a un servidor. Los errores de almacenamiento se muestran sin descartar la sesión en memoria.
- Arquitectura organizada por componentes, páginas, hooks, servicios, utilidades, tipos, datos e i18n. `storageService` es el punto de sustitución por un repositorio Supabase; `docs/schema.sql` documenta el modelo relacional futuro, sin conectarlo al prototipo.

## Referencias de APIs

- [Geolocation.watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)
- [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
