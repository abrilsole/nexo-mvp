# Roles y permisos (Lote 5A)

Blerp pasó de dos experiencias (Gestión y Taller) a **cuatro roles**. Este lote es la base: permisos, usuarios y precios con vigencia. Las pantallas completas de cada rol vienen después (5B planta y operario, 5C compras, 5D dashboard de horas).

## Los cuatro roles

| Rol | Valor en la base (`organization_members.role`) | Antes se llamaba |
|---|---|---|
| **Administrativo** | `owner` (quien creó la empresa) o `member` | Gestión |
| **Compras** | `compras` | — (nuevo) |
| **Jefe de planta** | `jefe_planta` | — (nuevo) |
| **Operario** | `operator` | Taller |

**Decisión:** se mantienen los valores internos `owner` y `member` para Administrativo. Todas las políticas del Lote 2 los usan (`private.is_org_manager`): renombrarlos obligaba a recrear políticas con DROP. En pantalla siempre dice "Administrativo". Un usuario Administrativo nuevo se guarda como `member`; `owner` queda solo para quien creó la empresa.

## Qué ve y qué hace cada rol

| Dato o acción | Administrativo | Compras | Jefe de planta | Operario |
|---|---|---|---|---|
| Precio de venta | Sí | **No** | **No** | **No** |
| Rentabilidad (esperada, proyectada, real) | Sí | **No** | **No** | **No** |
| Valor de la mano de obra (líneas de horas, tarifas) | Sí | **No** | **No** | **No** |
| Costo por hora de cada operario | Sí | **No** | **No** | **No** |
| Costo de materiales presupuestado (lista de materiales) | Sí | Sí | **No** | **No** |
| Precios de compra, compras, stock con costo | Sí | Sí | **No** | **No** |
| Proyectos (código, nombre, cliente, etapa, fechas) | Sí | Sí | Sí | Solo los suyos, en ejecución |
| Operarios y asignaciones | Sí | **No** | Sí (sin costo) | Solo su nombre |
| Horas cargadas | Sí (con valor) | **No** | Sí (sin valor) | Solo las suyas (sin valor) |
| Cargar horas y consumos | Sí | — | — (Próximamente) | Sus propias horas y consumos |
| Usuarios y Configuración | Sí | **No** | **No** | **No** |
| Corregir valores congelados | Sí | **No** | **No** | **No** |

**Menú de cada rol** (el mismo mapa arma el menú y los guards de ruta):

- **Administrativo:** Dashboard, Proyectos, Alertas, Cotizador, Historial, Stock, Operarios, Configuración (con la pestaña Usuarios).
- **Compras:** Materiales por proyecto. Marcados "Próximamente", sin función detrás: Stock, Proveedores, Precios de compra, Cotizador, Historial.
- **Jefe de planta:** Operarios y proyectos. Marcados "Próximamente": Horas, Capacidad, Asignaciones.
- **Operario:** Mi día (sus proyectos asignados y la carga de horas), igual que el Taller de antes.

## Cómo se hace cumplir

### En la base (lo que vale de verdad)

- **Las tablas con importes** son solo de Administrativo: `projects`, `budget_lines`, `purchase_entries`, `material_usages`, `actual_entries`, `operators`, `stock_lots`, `hour_rates`, `cost_settings`, `price_history`, `value_corrections` y el resto de las tablas del proyecto. Sus políticas usan `private.is_org_manager()`, que ahora además exige la cuenta activa.
- **Compras y Jefe de planta** no tienen ninguna política sobre esas tablas: leen solo con funciones `security definer`, igual que `taller_workspace()`. Esas funciones devuelven únicamente las columnas permitidas:
  - **`compras_workspace()`:**
    - trae los proyectos **sin** `sales_price`, `baseline` ni `progress_percent`;
    - trae solo las líneas de **materiales** del costo presupuestado;
    - trae compras, consumos, stock, pedidos y precios de materiales.
  - **`planta_workspace()`:**
    - trae los proyectos sin importes;
    - trae los operarios **sin** `hourly_cost`;
    - trae las horas **sin** `amount` ni `hourlyCost`;
    - trae muebles, bitácora y pedidos.
- **El Operario** sigue con `taller_workspace()` y las funciones `taller_*` (Lote 2).
- **Llamando a la API directamente** pasa lo mismo: un `select` a una tabla con importes devuelve 0 filas, y las funciones de otro rol dan error.
- **Baja de una cuenta:** `organization_members.deactivated_at`.
  - Una cuenta dada de baja no pasa ninguna política ni función.
  - En un Operario también se puede dar de baja la persona (`operators`), como antes.
- **Otra empresa:** no ve nada (todas las funciones filtran por la empresa del usuario).

### En la app (el mismo criterio, aplicado a la pantalla)

- **`lib/permissions.ts`:** es el único mapa rol → menú, rutas, datos y acciones, con funciones puras.
  - `navFor`, `canAccess` y `homeFor` arman el menú lateral y el guard de cada pantalla.
  - Si un rol entra a una ruta que no le corresponde, ve "No tenés acceso a esta sección". Desde el Dashboard se lo lleva a su inicio.
- **`lib/role-views.ts`:** las vistas de Compras y Jefe de planta solo arman los campos permitidos. Esto importa en la demo, donde un Administrativo mira la app "como" otro rol con todos los datos en memoria.

## Usuarios (Configuración → Usuarios, solo Administrativo)

- **Usuario ≠ persona.**
  - Un **usuario** es una cuenta para entrar a Blerp (`organization_members`), con su rol.
  - Una **persona** de Operarios (`operators`) es el operario con su costo por hora. Puede existir **sin usuario**.
  - Para que un operario entre, se lo invita como Operario y se elige qué persona es.
- **Crear:** nombre, rol y mail de invitación (validado con Zod).
  1. La invitación la registra la base con la sesión de quien invita (`admin_invite_member`, que exige un Administrativo activo).
  2. El mail lo manda Supabase Auth desde el servidor (`app/(gestion)/settings/actions.ts`) con la service role.
  3. La clave está en `SUPABASE_SERVICE_ROLE_KEY`, sin `NEXT_PUBLIC_`, así que nunca llega al navegador. El módulo `lib/supabase/service.ts` es `server-only`.
  4. Si la persona entra con Google usando ese mail, también queda en la empresa con su rol, aunque el mail no se haya mandado.
- **Cambiar rol:**
  - Pasar a Operario pide elegir la persona de Operarios.
  - Pasar de Operario a otro rol desvincula la persona.
- **Dar de baja y reactivar:**
  - En un Operario se usa el mismo flujo de Operarios: hay que darle destino a sus proyectos (reasignación).
  - La cuenta dada de baja pierde el acceso.
- **Reglas** (en la base, con el trigger `guard_members`, y en pantalla, con `lib/users.ts`):
  - nadie se cambia el rol ni se da de baja a sí mismo;
  - siempre queda al menos un Administrativo activo.
- **Operarios sin mail:** queda como **pregunta abierta para el cliente**. El modelo está preparado para un acceso con PIN (`operators.pin_hash`, sin uso todavía).

### Configuración para que salga el mail de invitación (una sola vez)

1. **Vercel → Settings → Environment Variables:** agregar `SUPABASE_SERVICE_ROLE_KEY`.
   - El valor está en Supabase → Project Settings → API Keys → service_role / secret.
   - Marcala como Sensitive y volvé a deployar.
   - Sin la clave, la invitación igual se guarda: la persona entra con Google usando ese mail.
2. **Supabase → Authentication → URL Configuration:** en Redirect URLs agregar `https://*-blerp1.vercel.app/auth/confirm` y la URL de producción + `/auth/confirm`.
3. **(Recomendado) Supabase → Authentication → Emails → Invite user:** cambiar el link por:
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/dashboard
   ```
   Así la persona entra directo al tocar el link. Con la plantilla de siempre, el link confirma la invitación y la manda al login para que entre con Google con ese mail.

## Demo

- El selector de la demo tiene cuatro botones: Administrativo, Compras, Jefe de planta y Operario.
- Cada rol tiene su usuario de ejemplo:
  - Laura Gómez (Administrativa);
  - Martín Ruiz (Compras);
  - María Ruiz (Jefa de planta);
  - el Operario que elijas entre los operarios cargados.
- **Solo aparece en una empresa demo** (`organizations.is_demo`) y para un Administrativo. En una empresa real el selector no existe y no cambia nada.
- En la demo se muestran los datos de ejemplo. No se puede escribir como Compras ni como Jefe de planta (no tienen acciones todavía).

## Archivos

- `supabase/migrations/20261016120000_lote5a_roles_usuarios_vigencia.sql`: roles, funciones de lectura, usuarios, precios con vigencia y valores congelados. Sin DROP ni DELETE.
- `supabase/manual/20261016120100_lote5a_manual.sql`: **se corre a mano** porque tiene DROP y DELETE. Hace dos cosas:
  - amplía la regla de la columna `role` para aceptar `compras` y `jefe_planta`;
  - hace que `reset_workspace` rechace a un Administrativo dado de baja.
- `lib/permissions.ts`, `lib/users.ts`, `lib/role-views.ts`, `lib/supabase/users.ts`, `lib/supabase/service.ts`.
- Tests:
  - `tests/lote5a-permisos.test.ts`: cada rol ve exactamente su menú;
  - `tests/lote5a-usuarios.test.ts`;
  - `tests/lote5a-vistas.test.ts`;
  - `tests/lote5a-pantallas.test.tsx`;
  - `tests/db/lote5a.test.ts`: políticas en Postgres real.
