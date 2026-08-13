# TallerPilot

Prototipo funcional de una plataforma de gestión para talleres mecánicos tecnificados. Está enfocado en la trazabilidad del servicio y la comunicación con el cliente, no en inventario.

## Ejecutar localmente

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev
```

Abrir `http://localhost:5173`. El acceso de demostración es `motorpro@gmail.com` / `TallerPilot`.

Para validar la compilación de producción:

```bash
npm run build
```

## Publicar la demostración en Render

El repositorio incluye `render.yaml`. En Render selecciona **New → Blueprint**, conecta este repositorio y confirma el servicio `tallerpilot-demo`. La plantilla instala también las dependencias de compilación, genera el frontend, inicia Express, crea un secreto JWT y comprueba `/api/health`.

Esta publicación es apropiada para demostraciones: la base JSON y las fotos usan el sistema de archivos temporal del servidor y pueden reiniciarse en un despliegue. Antes de incorporar talleres reales se deben migrar autenticación, datos y archivos a Supabase/PostgreSQL.

## Incluido en el prototipo

- Inicio de sesión y perfil de usuario/rol.
- Panel operativo con órdenes activas, agenda, alertas y ventas.
- Creación rápida de clientes naturales o empresas con cédula/NIT, contacto y dirección.
- Vinculación inicial de vehículo y creación de órdenes de taller.
- Flujo de siete etapas: ingreso, diagnóstico, cotización, autorización, reparación, control de calidad y entrega.
- Inspección de ingreso, kilometraje, combustible, elementos recibidos y evidencia visual.
- Carga local de fotos desde el detalle de una orden.
- Actividades técnicas, progreso, técnico responsable e historial.
- Notas del cliente, técnico y administrativo.
- Cotización detallada con repuestos, servicios, mano de obra, impuestos y garantía.
- Estado de autorización y acciones de descarga/envío representadas en la interfaz.
- Ventas, facturas, recordatorio de próximo mantenimiento y cuentas por cobrar.
- Contabilidad operativa: ingresos, gastos, utilidad, caja e impuestos estimados.
- Reportes de productividad, cumplimiento y satisfacción.
- Configuración de usuarios, WhatsApp Business, evidencias en nube y facturación DIAN.
- Diseño responsive para escritorio, tableta y celular.
- Backend Express con autenticación JWT y persistencia local.
- Áreas multiservicio: mecánica, diagnóstico, electricidad, latonería y pintura, aire acondicionado, llantas, detailing y gestión comercial automotriz.
- Órdenes de pintura con color/código y zonas afectadas.
- Eventos en tiempo real mediante Server-Sent Events.
- Carga persistente de evidencias y generación real de PDF.
- Tres planes SaaS mensual/anual con límites de usuarios y órdenes.
- Alta de usuarios por rol desde Configuración.
- Checkout Wompi preparado, webhook firmado y pago simulado para demos.
- Esquema PostgreSQL/Supabase multiempresa con Row Level Security.
- Cabeceras de seguridad y límites de solicitudes.

La ruta comercial y técnica está detallada en [`docs/GUIA-LANZAMIENTO-SAAS.md`](docs/GUIA-LANZAMIENTO-SAAS.md).

## Alcance técnico actual

La aplicación es una demostración full-stack en React + TypeScript y Express. El backend guarda clientes, vehículos, órdenes, fotos, notas, cotizaciones, facturas y gastos en un archivo JSON local. WhatsApp funciona mediante enlaces con mensajes prellenados y las cotizaciones se descargan como PDF. La automatización de WhatsApp Business y la facturación electrónica requieren servicios reales antes de entrar en producción.

## Siguiente fase recomendada

1. API y base de datos PostgreSQL con aislamiento por taller/sede.
2. Autenticación segura, recuperación de contraseña, roles y permisos auditables.
3. Almacenamiento privado de fotos y videos mediante URLs firmadas.
4. WhatsApp Business Cloud API con plantillas aprobadas, webhooks y trazabilidad de entrega.
5. Generación de PDF para cotizaciones, órdenes, actas de entrega y facturas.
6. Proveedor tecnológico autorizado para documentos electrónicos DIAN.
7. Firma/aprobación digital del cliente y registro de consentimiento.
8. Portal público seguro por enlace temporal para seguimiento del vehículo.
9. Copias de seguridad, auditoría, observabilidad y política de tratamiento de datos.
10. Pruebas automatizadas, despliegue y aplicación PWA instalable.

El inventario se mantiene deliberadamente fuera del alcance. Los repuestos se registran como renglones de cotización/compra asociados a una orden, sin existencias, kardex ni bodegas.

## Datos y modo demostración

- La base de datos se crea automáticamente en `server/data/tallerpilot.json`.
- Si existe una base anterior `taller360.json`, el backend la migra automáticamente sin perder sus registros.
- Las evidencias se guardan en `server/uploads/`.
- El botón **Reiniciar demo** elimina los registros de prueba y restaura los datos iniciales.
- WhatsApp abre una conversación real con un mensaje prellenado; no envía mensajes automáticamente.
- DIAN aparece como integración pendiente para no confundir la demostración con facturación electrónica legal.
