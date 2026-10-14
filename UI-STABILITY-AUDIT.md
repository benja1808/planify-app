# Levantamiento de pérdida de datos y reinicios de vista

Fecha: 14/10/2026. Cambios locales; no se publicó un despliegue.

## Alcance y evidencia

Revisión de los puntos de reconstrucción de vistas, refresco manual, gesto táctil, notificaciones, realtime, formularios HTML, acordeones de rutas y cargas asíncronas. Se revisaron app.js, index.html, sw.js, módulos Avisos y Mantenimiento y el refresco del visor público de tiristores. El visor público es de lectura y no contiene un formulario de captura que proteger.

La mayoría de los síntomas encontrados son reemplazos de HTML, no una recarga del documento. No se encontró una llamada explícita a location.reload en el código de aplicación revisado. El service worker ya evita recargar automáticamente al actualizarse.

## Hallazgos y correcciones

| Prioridad | Disparador | Consecuencia anterior | Corrección |
|---|---|---|---|
| Alta | Finaliza la consulta de ejecuciones mientras está abierta una ruta | renderRutasView reconstruía la pantalla y podía iniciar otra consulta | Se difiere el render mediante el aviso de cambios nuevos |
| Alta | Deslizar hacia abajo sobre controles o un formulario | El gesto global disparaba el refresco de toda la vista | Se excluyen controles, formularios y ventanas; se comprueba edición antes de refrescar |
| Alta | Iniciar refresco y luego navegar o editar durante la espera | La respuesta reconstruía la nueva pantalla | Se verifica la vista y el estado de edición al terminar |
| Alta | Abrir Inventario u Horas extra y navegar antes de que termine la carga | La respuesta tardía reemplazaba el contenido actual | Cada carga comprueba que su pantalla de carga siga siendo la vigente; cubre cargas solapadas |
| Media | Contraer/expandir un equipo de Requerimientos después de guardar horas | Se mostraban horas de una copia antigua del equipo | Se obtiene la versión vigente del equipo al dibujar el cuerpo |
| Media | Reconstruir un acordeón móvil mientras hay una observación escrita | El texto dependía de que se disparara blur | Se persiste con input usando el mecanismo existente de guardado |
| Alta | Cambiar el filtro de Mantenimiento con texto o fotos seleccionadas | paint reemplazaba el formulario y la selección de archivos | Se bloquea el cambio de filtro y se conserva el formulario hasta guardar |
| Preventiva | Envío HTML de los formularios Historial/Avisos | Carecían de una cancelación explícita del envío nativo | Se cancela submit; sus botones de guardado conservan el flujo existente |

Los formularios de solicitudes de insumos, creación de trabajadores y Mantenimiento ya cancelaban el envío nativo. Los temporizadores de notificaciones y estado de sincronización no constituyen por sí mismos una recarga del documento.

## Verificación

- `npm test`: 69 pruebas aprobadas, incluidas seis nuevas en ui-stability.test.cjs.
- Pruebas con promesas controladas: dos cargas simultáneas, navegación durante una carga, edición iniciada mientras llega una respuesta, refresco de rutas sin reentrada.
- Pruebas de protección de inputs vacíos, selectores y ventanas abiertas.
- Prueba de Mantenimiento: fotos y texto se conservan; un formulario intacto permite filtrar.
- Sintaxis de app.js, Avisos y Mantenimiento comprobada.
- Inspección de la sesión localhost: el búfer de consola consultado no devolvió errores ni advertencias. No se enviaron formularios reales para simular operaciones.

## Límites y seguimiento

No equivale a probar manualmente cada combinación de equipo, rol y dispositivo. Los gestos nativos de Android/iOS, recargas forzadas, cierre de pestaña y pérdida de red durante una subida requieren validación en dispositivos reales. No se debe asumir que todos los módulos tienen borradores persistentes.

Hay reconstrucciones intencionales al navegar, cambiar filtros y guardar. No se eliminaron indiscriminadamente: requieren pruebas por flujo para distinguir navegación deseada de pérdida involuntaria. La navegación entre equipos/unidades de Mantenimiento todavía merece validación específica con archivos pendientes; la corrección de este módulo cubre el filtro de registros.

Durante esta revisión había otros cambios concurrentes en el árbol de trabajo (sesión, borradores de excitatriz, noticias y estilos). Se conservaron; no se atribuyen a este levantamiento ni se incluyen como correcciones verificadas aquí.

## Comprobaciones manuales recomendadas

1. En Requerimientos: guardar horas, escribir una observación, contraer y expandir el equipo; comprobar los valores.
2. Mantener una captura abierta mientras otra sesión modifica una ruta: debe aparecer el aviso sin cerrar la captura.
3. Con red lenta: abrir Inventario/Horas extra y navegar a otra sección; la respuesta no debe devolver a la pantalla anterior.
4. En móvil: arrastrar dentro de un campo, selector o modal; no debe iniciar el refresco global.
5. En Mantenimiento: seleccionar fotos y escribir una intervención; cambiar filtro debe conservar los archivos y mostrar el aviso.
