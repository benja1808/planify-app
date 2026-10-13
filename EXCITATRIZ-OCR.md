# Lectura de planillas de excitatriz — primera iteración

En Finalizar trabajo y en edición de excitatriz U3/U4/U5 aparece “Leer planilla desde una foto”. Elegir una imagen y pulsar Leer imagen envía la foto al proveedor configurado (Gemini por defecto). La foto permanece en memoria del navegador y no se escribe en la base de datos; OpenAI recibe `store: false` cuando se selecciona ese proveedor. En el nivel gratuito de Gemini, Google puede usar el contenido para mejorar sus productos.

## Configuración local

1. Configurar `GEMINI_API_KEY` en `.env` del servidor. Por defecto: `EXCITATRIZ_OCR_PROVIDER=gemini` y `EXCITATRIZ_OCR_MODEL=gemini-3.1-flash-lite`. Crear la clave en https://aistudio.google.com/apikey y usar un proyecto en Free Tier. La gratuidad depende del nivel de facturación del proyecto, no del nombre del modelo. Los límites se consultan en AI Studio. No hay cambio automático de proveedor ni reintentos al agotar cuota. Para usar OpenAI: `EXCITATRIZ_OCR_PROVIDER=openai`, `EXCITATRIZ_OCR_MODEL=gpt-4.1` y `OPENAI_API_KEY`.
2. Reiniciar con `npm start` y abrir el puerto indicado en `http://localhost:4173`.
3. Abrir una tarea de excitatriz, subir la foto y pulsar Leer imagen.

El endpoint está deliberadamente limitado a loopback y origen local coincidente. La aplicación actual no dispone de sesiones de servidor verificables para este flujo; antes de habilitarlo en producción se necesita autenticar y limitar el uso del servicio de pago. No requiere cambios en Supabase. No colocar claves en archivos JS ni en el navegador.

## Alcance y evaluación

- U4/U5: 84 mediciones de escobillas + 5 variables globales. U3: 112 + 5.
- La cabecera (fecha, técnicos, OT y horas) mantiene el flujo existente de la ruta. Comentarios y casillas técnicas siguen manuales.
- Se exige unidad legible coincidente. Valores ausentes, ambiguos o duplicados quedan vacíos. Se rechazan posiciones fuera del formulario.
- Las lecturas se completan automáticamente como borrador en los campos originales de escobillas y variables globales; se resaltan en amarillo y pueden editarse directamente.
- Solo se completan campos vacíos, conservando datos previos y cambios realizados mientras se procesa la imagen. Nunca se guarda ni finaliza automáticamente.
- La foto queda disponible para comparación y se contrae al terminar para mostrar el formulario.
- Se eliminó la tabla intermedia, las casillas de revisión y el botón de traspaso. Guardar y terminar mantiene el flujo habitual.
- Cobertura = valores detectados / campos esperados. No mide exactitud. La interfaz no atribuye aciertos a valores que la persona no ha verificado.
- El cálculo de exactitud permanece disponible en el módulo de evaluación para futuras comparaciones con transcripciones verificadas; no se muestra una precisión inferida de cambios manuales.

Pruebas: `node --test excitatriz-ocr.test.cjs` y `npm test`. Las pruebas del proveedor son simuladas; la exactitud real requiere una clave y transcripciones verificadas de imágenes reales. La foto proporcionada devolvió 89/89 valores con Gemini 3.1 Flash-Lite en la prueba real. Esa cobertura no certifica exactitud.

Referencia de integración: https://developers.openai.com/api/docs/guides/images-vision y https://developers.openai.com/api/docs/guides/structured-outputs

Documentación Gemini: https://ai.google.dev/gemini-api/docs/pricing y https://ai.google.dev/api/generate-content
