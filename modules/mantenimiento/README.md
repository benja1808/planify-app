# Mantenimiento: sesión PIN y Supabase privado

Inicio local: `npm start` con `HOST=127.0.0.1`, `PORT=4173` y `DISABLE_PUSH=1`.
El servidor existente conserva sus endpoints PDF/Excel y añade el gateway de Mantenimiento.
`npm run start:maintenance` configura esas variables e inicia el mismo servidor.

El PIN de Planificador o Administrador se valida en el servidor. Ya no hay registro por
correo ni contraseña en el módulo. Una cookie HttpOnly y SameSite=Strict dura 8 horas;
al cerrar sesión se revoca en el servidor. Reiniciar el servidor cierra estas sesiones.
Después de actualizar, las sesiones antiguas de Planify deben ingresar una vez con el PIN.
Cinco PIN incorrectos bloquean ese origen de red durante 15 minutos.

Configuración privada: `%USERPROFILE%/.planify-private/maintenance.json`, fuera del
repositorio y de la raíz pública, con ACL para el usuario de Windows y SYSTEM.
Contiene URL, clave publicable, credencial técnica, sal y hashes scrypt de los PIN.
La cuenta técnica tiene correo interno, confirmado por la API de administración,
y autorización en mantenimiento_privado.accesos. No requiere correo humano.
La clave administrativa se usó solo para provisionar y se eliminó del disco después.
El navegador nunca recibe credenciales ni tokens de esa cuenta. El gateway permite
solo tablas, RPC y bucket de Mantenimiento; sigue usando las políticas RLS existentes.
Los PIN compartidos no identifican a una persona. No desplegar este piloto como
servicio público: antes hay que configurar HTTPS, cookies Secure y límites persistentes.

Las fotos siguen siendo privadas. JPG/PNG/WebP, 100 fotos por registro, 20 MiB por foto.
La barra cuenta Storage del proyecto hasta el límite de trabajo de 1 GB. Las reservas
son conservadoras durante cargas parciales. Descargar ZIP no borra fotos.
Los datos del piloto antiguo IndexedDB permanecen intactos, sin importación automática.

Validación: sintaxis, pruebas del adaptador, PIN erróneo, origen externo, cookie,
revocación al salir, rutas ajenas bloqueadas y una carga/descarga/eliminación real en
Supabase con imagen sintética y equipo temporal, eliminados al acabar la prueba.
