# Guía de lanzamiento SaaS — TallerPilot

## Decisión recomendada

Lanzar primero un piloto cerrado con 3 a 5 talleres de Montería durante 30 días. La aplicación debe operar como SaaS multiempresa: cada taller es un `workshop`, cada usuario pertenece a ese taller por una membresía y todos los registros llevan `workshop_id`. Ninguna consulta puede depender solo de filtros del frontend; el aislamiento también se aplica en PostgreSQL mediante Row Level Security (RLS).

Stack recomendado para la primera versión comercial:

- Frontend: React/PWA responsive.
- API: Node.js/Express, desplegada detrás de HTTPS.
- Base de datos, autenticación y archivos: Supabase (PostgreSQL, Auth y Storage privado).
- Cobros: Wompi Colombia.
- Correo transaccional: Resend, Postmark o equivalente.
- WhatsApp: iniciar manual; después integrar Meta WhatsApp Business Cloud API.
- Observabilidad: Sentry y alertas de disponibilidad.
- Facturación del SaaS: proveedor tecnológico autorizado o el servicio gratuito de la DIAN, según decisión contable.

El archivo `supabase/migrations/001_saas_core.sql` contiene el primer esquema productivo multiempresa. La base JSON local se conserva únicamente para demos sin internet.

## Planes iniciales sugeridos

Los valores son hipótesis comerciales y deben validarse con talleres reales. El anual equivale a pagar diez meses.

| Plan | Mensual | Anual | Usuarios | Órdenes/mes | Fotos | Sedes |
|---|---:|---:|---:|---:|---:|---:|
| Gratis | $0 | $0 | 1 | 20 | 5 por orden / 0,25 GB | 1 |
| Esencial | $79.000 | $790.000 | 3 | 150 | 2 GB | 1 |
| Profesional | $149.000 | $1.490.000 | 10 | 500 | 10 GB | 1 |
| Empresarial | $299.000 | $2.990.000 | 30 | 2.000 | 50 GB | 3 |

Recomendación comercial:

- Plan Gratis sin tarjeta y sin vencimiento; los datos se conservan al alcanzar un límite.
- Mostrar el consumo de usuarios y órdenes dentro de la página de planes.
- Plan Profesional marcado como recomendado.
- Configuración inicial y migración de datos se cobran aparte cuando requieran trabajo manual.
- No prometer WhatsApp automático, DIAN ni múltiples sedes en un plan hasta que la integración esté terminada y probada.
- Definir por contrato qué pasa al superar órdenes, usuarios o almacenamiento: bloquear nuevas altas, permitir compra adicional o solicitar cambio de plan.

## Flujo de alta de un taller

1. El propietario registra nombre, NIT, teléfono, ciudad, correo y aceptación de términos/política de datos.
2. Supabase Auth confirma el correo y crea el usuario propietario.
3. Una función de backend crea el taller, perfil, membresía `owner` y suscripción permanente al plan Gratis.
4. El propietario invita usuarios. Cada invitación tiene vencimiento y rol; nunca se comparte una contraseña entre operarios.
5. Durante la prueba se muestran consumo y fecha de vencimiento.
6. Al elegir un plan, el backend crea una referencia única y firma el checkout de Wompi.
7. Solo un webhook con checksum válido puede marcar el pago como aprobado y activar el periodo.
8. Si el pago vence, se aplican avisos y un periodo de gracia. No se borran datos de inmediato.

## Estrategia Wompi

### Fase 1 — recomendable para el piloto

Usar Web Checkout de Wompi para el pago mensual o anual. TallerPilot no recibe ni almacena datos de tarjetas. El backend genera referencia, monto en centavos, moneda y firma de integridad. Después valida el webhook de Wompi e ignora una simple redirección como prueba de pago.

La demo ya implementa este flujo. Si no hay llaves, ofrece una aprobación simulada que está deshabilitada cuando `NODE_ENV=production`.

### Fase 2 — renovación automática

Cuando el piloto pruebe demanda y Wompi habilite la cuenta, integrar tokenización/fuentes de pago. El cliente autoriza inicialmente los débitos futuros y el backend conserva únicamente el identificador de la fuente de pago, nunca PAN, CVV ni información sensible. Se deben manejar pagos aprobados, rechazados, pendientes, reintentos, cancelación y actualización del medio de pago.

### Datos que deben mantenerse secretos

- `WOMPI_PRIVATE_KEY`
- `WOMPI_INTEGRITY_SECRET`
- `WOMPI_EVENTS_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `JWT_SECRET`

Ninguna de estas variables puede empezar con `VITE_` ni viajar al navegador. Las llaves de pruebas y producción deben ser diferentes.

## Seguridad mínima antes de vender

- Dominio propio y HTTPS obligatorio.
- Supabase Auth con confirmación de correo, recuperación de contraseña y MFA para propietarios/administradores.
- RLS activa en todas las tablas expuestas; pruebas automáticas con dos talleres para verificar aislamiento.
- Roles efectivos en backend: propietario, administrador, asesor, técnico, contador y consulta.
- Fotos en buckets privados con rutas por taller y URLs firmadas de corta duración.
- Contraseñas nunca registradas en logs; secretos solo en el gestor del proveedor de despliegue.
- Rate limiting para login/API, cabeceras de seguridad, validación de entradas y tamaño/tipo de archivos.
- Auditoría de altas, cambios de estado, aprobaciones, exportaciones, usuarios y pagos.
- Backups comprobados mediante una restauración de prueba; retención definida.
- Política de tratamiento, autorización, términos del servicio y acuerdo sobre quién es responsable/encargado de los datos.
- Plan de incidentes: contacto, contención, rotación de llaves, recuperación y comunicación.
- Revisión de dependencias, pruebas y monitoreo en cada despliegue.

La aplicación local ya incluye Helmet, límites de solicitudes, JWT con vencimiento, bcrypt, límites de archivos, roles administrativos para usuarios/pagos y validación de firmas Wompi. Para producción, Supabase Auth reemplaza el inicio de sesión JWT local.

## Lo que depende del propietario del producto

### Comercial y marca

- Confirmar el nombre comercial final y comprar un dominio.
- Entrevistar al menos 10 talleres y conseguir 3 a 5 pilotos.
- Validar precios, límites, periodo de prueba, descuento anual y servicio de implementación.
- Definir soporte: horario, canal, tiempo de respuesta y qué está incluido.
- Preparar demostración, contrato/orden de servicio, términos y política de cancelación/reembolsos.

### Empresa y cobros

- Definir quién venderá y facturará el software: persona natural o empresa.
- Mantener RUT, cuenta bancaria y datos tributarios actualizados; confirmar obligaciones con contador.
- Crear la cuenta del comercio en Wompi, completar validación y obtener llaves Sandbox/Producción.
- Elegir cómo emitir la factura electrónica de la mensualidad del software.
- Definir tratamiento de IVA/retenciones con contador; no codificar reglas fiscales basadas en suposiciones.

### Datos y legal

- Contratar revisión jurídica colombiana para política de privacidad, tratamiento de datos, autorización, términos SaaS y contratos con encargados.
- Definir tiempo de conservación de fotos, documentos, órdenes y copias de seguridad.
- Obtener autorización clara de clientes para WhatsApp y tratamiento de imágenes/datos del vehículo.
- Establecer procedimiento para consulta, corrección, exportación y eliminación cuando corresponda.

### Cuentas técnicas necesarias

- Proyecto Supabase.
- Cuenta Wompi del comercio.
- Dominio y proveedor de DNS.
- Proveedor de hosting para frontend/API.
- Cuenta de correo transaccional.
- Meta Business verificado cuando se automatice WhatsApp.
- Proveedor DIAN si TallerPilot va a emitir documentos electrónicos dentro de la app.

## Lo que ya queda construido en este repositorio

- Catálogo central de tres planes y precios.
- Página responsive para mensual/anual, plan actual y activación demo.
- Creación de usuarios con roles, contraseña cifrada y control del límite del plan.
- Endpoint de checkout que genera referencia única y firma de integridad.
- Webhook Wompi con validación criptográfica e idempotencia básica.
- Activación de suscripción mensual/anual y registro de transacciones.
- Modo simulación deshabilitado en producción.
- Cabeceras seguras, rate limiting y secreto JWT obligatorio en producción.
- Migración PostgreSQL para talleres, membresías, suscripciones, pagos, clientes, vehículos, órdenes, evidencias, notas, cotizaciones, facturas, gastos y auditoría.
- RLS e índices multiempresa.
- Archivo `.env.example` sin secretos reales.
- Pruebas unitarias de referencias, firmas y eventos de pago.

## Trabajo técnico siguiente

### Hito 1 — piloto online

1. Crear Supabase y ejecutar la migración.
2. Reemplazar login local por Supabase Auth.
3. Migrar endpoints desde JSON a PostgreSQL y agregar `workshop_id` desde la membresía autenticada, nunca desde un valor libre enviado por el navegador.
4. Mover evidencias a Storage privado.
5. Desplegar API y frontend con variables seguras.
6. Conectar Wompi Sandbox y probar aprobado, rechazado, pendiente, evento repetido y firma inválida.
7. Ejecutar pruebas de aislamiento entre dos talleres.

### Hito 2 — piloto comercial

1. Alta/autoservicio de talleres y correo de invitación.
2. Portal temporal del cliente para estado, fotos y aprobación de cotización.
3. Medición de consumo y límites por plan.
4. Recordatorios de vencimiento y periodo de gracia.
5. Auditoría, backups, monitoreo y soporte.

### Hito 3 — automatización

1. WhatsApp Business Cloud API y plantillas aprobadas.
2. Renovación automática con fuente de pago Wompi.
3. Integración con proveedor de facturación electrónica.
4. Multisede y reportes consolidados del plan Empresarial.

## Criterio para poder cobrar al primer cliente

No se debe aceptar dinero real hasta que estén completos: aislamiento entre talleres, autenticación y recuperación de contraseña, Storage privado, HTTPS, checkout Sandbox probado, webhook verificado, backups restaurables, términos/política aceptados, soporte definido y proceso de factura de la suscripción. Para una demostración presencial, el modo local actual y la activación simulada son suficientes.
