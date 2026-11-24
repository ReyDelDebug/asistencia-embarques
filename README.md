# Control de Asistencia – Embarques

Aplicación web para que cada empleado confirme su asistencia desde el celular con **número de empleado + PIN**. El supervisor ve un panel en tiempo real, genera automáticamente el **reporte para WhatsApp** y descarga **Excel**.

- **Flujo:** el supervisor registra a cada trabajador por área y arma el rol de turno → el trabajador entra con su número, crea su PIN y confirma asistencia en su turno → el sistema marca faltas al cierre (08:00 / 20:00 o cuando el supervisor lo cierre) → reporte de WhatsApp y Excel automáticos.
- **Stack:** Next.js 16 (App Router) + TypeScript · Tailwind CSS 4 · PostgreSQL (Supabase) · `pg` · ExcelJS
- **Hora oficial:** la del **servidor**, convertida a `America/Mexico_City`. Nunca se usa la hora del celular.

---

## 1. Funcionalidades

**Trabajador (enlace público `/`)**
- Escribe su **número de empleado**. La **primera vez crea su propio PIN** (4–6 dígitos; se rechazan PIN fáciles como 1111 o 1234). Después entra con número + PIN. El PIN se guarda con hash scrypt.
- Ve **su turno asignado según el rol** (Día/Noche), el próximo cambio programado, su área y el horario.
- Puede **solicitar vacaciones o PSG** (rango de fechas) y ver si fueron aprobadas.
- **Mi perfil:** nombre completo (obligatorio, solo letras con acentos), teléfono, fecha de nacimiento, número de botas y talla de chaleco (chico, mediano, grande); si falta algo, la app le avisa. Ve sus **días de vacaciones** disponibles, tomados y asignados. Foto de perfil (se recorta y comprime en el celular; la ven solo sus compañeros de área y los supervisores) y **restablecer su PIN** (pide el PIN actual; si lo olvidó, el supervisor lo restablece).
- **Mi grupo:** ve únicamente a los compañeros de **su área** (Central —incluida PT—, RC o Lavadoras) con su foto, puesto y turno.
- **Líderes:** además ven **quién ha registrado asistencia hoy en su área** (por defecto su turno; pueden cambiar a Día/Noche), sin motivos ni datos administrativos.
- Botón **CONFIRMAR MI ASISTENCIA** → pantalla **¡ASISTENCIA REGISTRADA!** con la hora exacta.
- Si ya registró, ve su registro. Una segunda confirmación queda bloqueada en el servidor y en la base de datos.
- Fuera de horario: **EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO.**

**Horarios (validados en el servidor)**

| Turno | Abre | Último segundo válido | Bloqueado desde |
|---|---|---|---|
| Día | 05:00:00 | 07:59:59 | 08:00:00 |
| Noche | 17:00:00 | 19:59:59 | 20:00:00 |

**Control manual del supervisor** (Panel → "Registro de asistencia de hoy"): **Cerrar ahora** (antes de las 8:00), **Abrir registro** para todos aunque ya hayan pasado las 8:00 (queda abierto hasta que lo cierre o hasta el fin del día) y **Horario normal**. Solo aplica al día de hoy.

Cada trabajador solo puede registrar en la ventana del turno que le asignó el supervisor en el **rol de turno**. Quien no registra antes del cierre (08:00 / 20:00, o cuando el supervisor lo cierre) aparece como **Falta** en el panel, el reporte y el Excel.

**Abrir el registro a una persona (supervisor y líderes)**
- A quien no registró a tiempo, el supervisor (panel) o el líder de su área ("Mi grupo") le abre el registro, a una persona o a todos los que faltan. Queda abierto hasta que lo cierren o hasta el fin del día.
- El registro queda marcado "con extensión" con quién la autorizó; aparece en *RETARDO* del reporte y como "Confirmado (retardo)" en el Excel.
- Un líder solo puede abrir o cerrar el registro de personas de su área.

**Llegaré tarde**
- Antes del cierre (8:00 / 20:00), el trabajador avisa la hora aproximada de llegada y el **motivo (obligatorio)**.
- Líder y supervisor lo ven como "Avisó retardo" con hora y motivo; en el reporte aparece en *RETARDO*.
- Registra cuando llegue (hasta las 11:19 a. m. / 11:19 p. m.); si no llega, queda como Falta.

**Recordatorios (notificaciones push)**
- El trabajador toca "Activar avisos" una vez. A las 7:05 y 7:15 (19:05 y 19:15 en noche) recibe un aviso si no ha registrado, no tiene incidencia y no avisó retardo.
- En iPhone primero hay que "Agregar a pantalla de inicio" (iOS 16.4+). Ver configuración en la sección 4b.

**Calendario laboral (panel → Calendario laboral)**
- Lunes a jueves laborable (día 7:30 a. m.–7:30 p. m., noche 7:30 p. m.–7:30 a. m.).
- Viernes = tiempo extra (día 7:30–5:30 p. m., noche 5:30 p. m.–5:30 a. m.): trabajan todos y **quien no llega queda en DESCANSO**, no en falta. Se puede cambiar a "jornada larga" (7:30 a 7:30) o a "no se trabaja".
- Sábado, domingo y feriados de ley (LFT art. 74) no se trabaja: no se registra, no hay faltas ni recordatorios y el reporte dice "DÍA NO LABORABLE".
- El supervisor toca cualquier día para cambiarlo (ej. un sábado de inventario o un jueves de paro). Vacaciones y PSG solo cuentan días laborables de lunes a jueves.

**Cambio de área (Rol de turno → "Cambiar área")**
- Turno, área y subárea destino, desde una fecha. **Apoyo temporal** (con fecha de regreso: vuelve solo) o **cambio permanente**.
- Mientras dure, cuenta en el área destino; solo lo ve el líder de esa área. El reporte lo muestra en *APOYO:* ("Gustavo Mata · apoyo en CENTRAL (de LAVADORAS)").

**Ficha del empleado (panel → Empleados → clic en el nombre)**
- Número, área, turno, teléfono, nacimiento y edad, botas, chaleco, vacaciones (asignadas, tomadas, disponibles) y **faltas de la semana y del mes**, con gráficas de las últimas 8 semanas y 6 meses.
- "Editar datos": el supervisor corrige esos datos y captura los **días de vacaciones** y el inicio del periodo. Una solicitud de vacaciones no puede pasar de los días disponibles.
- El supervisor registra **su propia asistencia** desde el panel (tarjeta "Mi asistencia").

**Áreas:** Central (con subárea **PT**), RC y Lavadoras. Central lleva dos líderes (uno de Central y uno de PT); RC y Lavadoras, uno cada una. Los líderes y quiénes pertenecen a PT se asignan desde **Empleados**.

**Rol de turno (`/admin/rol`)**
- El supervisor marca Día o Noche para cada persona, agrupadas por área, y elige desde qué fecha aplica (botones Hoy / Próximo lunes / Lunes en 2 semanas).
- La asignación **sigue igual hasta que se vuelva a cambiar** (sirve para rotar cada semana o cada 15 días). Solo se guardan las personas que cambian.

**Vacaciones y PSG (`/admin/solicitudes`)**
- Lista de solicitudes pendientes con Aprobar / Rechazar (el rechazo exige motivo).
- Calendario mensual con las ausencias aprobadas y pendientes.
- Al aprobar, cada día del periodo aparece directamente como VACACIONES o PSG en el panel, el reporte de WhatsApp y el Excel.

**Panel del supervisor (`/admin`)**
- Tarjetas con el total, confirmados, pendientes, % de asistencia, faltas, vacaciones, incapacidades, PSG y bajas.
- Distribución por área y por turno. Se actualiza cada 15 s.
- Filtros por fecha, turno, área, estado y búsqueda por nombre.
- **Cambiar estado** (Falta, Vacaciones, Incapacidad, PSG, Baja) con motivo obligatorio. Solo aplica a quien no confirmó. La hora original nunca se modifica (la base de datos bloquea UPDATE y DELETE sobre `attendance`).
- Las incidencias reemplazadas o retiradas se conservan en el historial.
- Al cerrar el horario, quien no registró aparece como **Falta (sin registro)**.

**Reporte para WhatsApp (`/admin/reporte`)**
- Reporte de día o de noche, calculado con los registros reales: SUPERVISOR, cada área (`empleados+líderes` cuando el área tiene líder), TOTAL y las listas de FALTA, PSG, VACACIONES, INCAPACIDAD y BAJA.
- Se capturan VACANTES, RECOGE y observaciones.
- Personal adicional por concepto (DESCARGA, BANDA, ELEVADOR, otro), con la opción de sumarlo o no al TOTAL. No se crean empleados ficticios.
- Botones para **Copiar mensaje**, **Compartir por WhatsApp**, **Exportar (.txt)** y **DESCARGAR EXCEL**.

**Excel (`/admin/exportar`)**: un día, un turno, un área o un periodo de hasta 93 días.
- Hoja 1 **ASISTENCIA GENERAL**, hoja 2 **RESUMEN** y hoja 3 **HISTORIAL**.
- Encabezados con formato, filtros y formatos de fecha y hora.

**Administración**
- Empleados: el supervisor **registra a cada trabajador en su área** con su número de empleado real; edición (área, subárea PT, puesto, líder), restablecer PIN (el trabajador crea uno nuevo), baja y reactivación, historial. Columna con el estado del PIN (creado / pendiente).
- Usuarios del panel (solo ADMIN): crear supervisores, restablecer contraseña, activar y desactivar.
- **Auditoría** inalterable: todos los inicios de sesión, registros, intentos fuera de horario, duplicados, cambios de estado, exportaciones y cambios administrativos, con usuario, fecha, hora e IP.

**Seguridad**
- Sesiones con token aleatorio en cookie `httpOnly` + `SameSite=Lax` (`Secure` en producción). En la base de datos solo se guarda el hash del token.
- La cuenta se bloquea 15 minutos tras 5 PIN incorrectos. Además, hay un límite de 40 fallos por IP cada 15 minutos.
- Protección CSRF (validación de origen) y encabezados de seguridad (X-Frame-Options, nosniff, HSTS…).
- RLS activado en todas las tablas sin políticas públicas, y permisos revocados a los roles `anon` y `authenticated` de Supabase. La API pública de Supabase no puede leer nada; solo el backend accede.
- No hay PIN universal. Ningún PIN ni contraseña viaja al frontend, salvo el que el supervisor genera en ese momento, que se muestra una sola vez.

---

## 2. Plantilla cargada

- **36 empleados** según la estructura indicada, con sus líderes:

| Área | Líderes |
|---|---|
| Central | Isaías Romero (día), Javier Ángeles (noche) |
| PT (subárea de Central) | Manuel Cruz |
| RC | Gerardo Marroquín (día), Gerardo González (noche) |
| Lavadoras | Jonathan Cruz |

  - Día: Central 9 + líder, PT: líder Manuel Cruz, RC 5 + líder, Lavadoras 4 + líder.
  - Noche: Central 7 + líder, RC 5 + líder.
- **Manuel (Supervisor de día)**: número **9001**, usuario del panel `manuel` (ADMIN). Es una persona distinta de Manuel Cruz (empleado de Central, #1009).
- Números **provisionales**: día **1001–1022**, noche **2001–2014**, supervisores **9001+**. Cámbialos por los números reales en **Empleados → Editar** antes de compartir el enlace.
- Los empleados se cargan **sin PIN**: cada uno lo crea al entrar por primera vez.
- **Pendientes de configurar** (no se inventaron): los demás integrantes de PT y el supervisor de noche (ver sección 6).

---

## 3. Crear la base de datos (Supabase)

1. Crea un proyecto en <https://supabase.com> (región cercana, por ejemplo `us-east-1`) y guarda la contraseña de la base.
2. Ve a **Project Settings → Database → Connection string → URI**.
   - **Transaction pooler** (puerto 6543): para Vercel.
   - **Session pooler** (puerto 5432): para correr las migraciones desde tu computadora (también funciona el de 6543).
3. En tu computadora (Node 20.9 o superior):

```bash
npm install
cp .env.example .env
# Edita .env y pega tu DATABASE_URL (con tu contraseña real)
npm run db:setup      # aplica migraciones + carga inicial
```

`db:setup` muestra la **contraseña del administrador** (si no definiste `ADMIN_INITIAL_PASSWORD`) y la guarda en `credenciales-iniciales/`. Cámbiala al entrar y borra ese archivo.
- Los trabajadores **no** necesitan que les entregues nada: entran con su número y crean su PIN.
- Si alguien olvida su PIN, el supervisor lo restablece desde **Empleados** y el trabajador crea uno nuevo.
- Puedes ejecutar `npm run db:setup` cuantas veces quieras. No duplica empleados ni sobrescribe cambios.

---

## 4. Desplegar en Vercel

1. Sube el proyecto a un repositorio de GitHub (el `.gitignore` ya excluye `.env` y las credenciales).
2. En <https://vercel.com> → **Add New → Project** → importa el repositorio (framework detectado: Next.js).
3. En **Environment Variables** agrega:
   - `DATABASE_URL`: la URL del **Transaction pooler** de Supabase (puerto 6543).
   - `PG_POOL_MAX` = `2`
4. **Deploy**. Después verifica:
   - `https://TU-APP.vercel.app/api/health` debe responder `{"ok":true,"database":"ok","activeEmployees":37}`.
   - `https://TU-APP.vercel.app/admin`: entra con `manuel` y la contraseña inicial, y cámbiala en **Mi cuenta**.

> Prueba local opcional: `npm run build && npm start` y abre <http://localhost:3000>.

---

### 4b. Activar las notificaciones (una sola vez)

1. **Llaves VAPID.** En la terminal, dentro del proyecto: `npx web-push generate-vapid-keys`. Copia la *Public Key* y la *Private Key*.
2. **Clave del programador.** `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` y copia el resultado.
3. **Vercel → Settings → Environment Variables**, agrega:
   - `VAPID_PUBLIC_KEY` = Public Key
   - `VAPID_PRIVATE_KEY` = Private Key
   - `VAPID_SUBJECT` = `mailto:tu-correo@ejemplo.com`
   - `CRON_SECRET` = la clave del paso 2
   
   Luego **Despliegues → ⋯ → Redeploy**.
4. **Supabase → Database → Extensions**: activa `pg_cron` y `pg_net`.
5. **Supabase → SQL Editor**, pega esto (cambia la URL y `TU_CRON_SECRET`) y presiona **Run**:

```sql
select cron.schedule(
  'recordatorios-asistencia',
  '5,15 1,13 * * *',   -- 13:05/13:15 UTC = 7:05/7:15 a. m. y 01:05/01:15 UTC = 7:05/7:15 p. m. (Ciudad de México)
  $$ select net.http_post(
       url := 'https://asistencia-embarques-joll.vercel.app/api/cron/reminders',
       headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET', 'Content-Type', 'application/json'),
       body := '{}'::jsonb
     ); $$
);
```

Para revisar que se ejecuta: `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;`
Para quitarlo: `select cron.unschedule('recordatorios-asistencia');`

### Actualizar una instalación existente

Cuando recibas una versión nueva del proyecto:

```bash
npm install
npm run db:setup     # aplica solo las migraciones nuevas; no borra datos
git add .
git commit -m "Actualización"
git push             # Vercel publica automáticamente
```

## 5. Compartir el enlace en WhatsApp

Comparte en el grupo **solo** el enlace de empleados (el de `/admin` es solo para supervisores):

```
📋 *REGISTRO DE ASISTENCIA – EMBARQUES*
Confirma tu asistencia aquí:
https://TU-APP.vercel.app

🕔 Día: de 5:00 a. m. a antes de las 7:20 a. m.
🕔 Noche: de 5:00 p. m. a antes de las 7:20 p. m.
Ingresa con tu número de empleado. La primera vez crea tu PIN personal (no lo compartas).
Ahí mismo ves tu turno asignado y puedes pedir vacaciones o PSG.
```

Fija el mensaje en el grupo. En el celular pueden usar "Agregar a pantalla de inicio" para abrirlo como app.

---

## 6. Configurar líderes, PT y supervisor de noche

1. **Líderes:** en **Empleados**, busca a la persona → **Editar** → Puesto: **Líder**.
   - Central: un líder con subárea vacía (Central general) y otro con subárea **PT**.
   - RC y Lavadoras: un líder cada una.
2. **Integrantes de PT:** Editar → Área Central → Subárea **PT**. El reporte muestra `CENTRAL: x+1` y `PT: y+1` en renglones separados.
3. **Supervisor de noche:**
   - En **Empleados → Agregar empleado**, captura su nombre, Puesto **Supervisor** y Turno **Noche**. Se asigna 9002 y un PIN; con eso registra su asistencia.
   - Para darle acceso al panel, ve a **Usuarios → Crear supervisor** y vincúlalo con ese empleado.

---

## 7. Pruebas

```bash
npm test          # 98 pruebas: horarios, autenticación, reglas, reporte, Excel, auditoría (PostgreSQL real)
npm run test:e2e  # 21 pruebas: servidor real + HTTP + Chrome emulando iPhone y Android
```

Las pruebas usan una base **separada**, que se borra en cada corrida (`TEST_DATABASE_URL`, por defecto `postgres://postgres@localhost:5432/asistencia_test`). Por seguridad, solo corren si el nombre de la base contiene `test`.

---

## 8. Estructura

```
db/migrations/001_init.sql   Esquema, índices, restricciones, triggers de inmutabilidad, RLS
scripts/migrate.ts           Migrador idempotente (con bloqueo)
scripts/seed.ts              Carga inicial idempotente (36 empleados + supervisor + admin)
src/lib/time.ts              Lógica de horarios (zona America/Mexico_City)
src/lib/services/*           Reglas de negocio: auth, attendance, roster, incidents, report, excel, employees, users, audit
src/app/api/**               API (route handlers)
src/app/page.tsx             Página del empleado
src/app/admin/**             Panel del supervisor
tests/                       Pruebas de integración y e2e
```

## 9. Tablas

`shifts`, `departments`, `subareas`, `employees`, `employee_photos`, `attendance_extensions`, `shift_window_overrides`, `work_calendar`, `late_notices`, `push_subscriptions`, `push_reminders_sent`, `shift_assignments` (rol de turno), `leave_requests` (vacaciones/PSG), `users`, `attendance` (única por empleado + fecha operativa + turno, inmutable), `incidents` (una activa por empleado/fecha/turno, nunca se borran), `operational_reports`, `operational_extras`, `sessions`, `login_attempts`, `audit_logs` (inmutable), `schema_migrations`.
