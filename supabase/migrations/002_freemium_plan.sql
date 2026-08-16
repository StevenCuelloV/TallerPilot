-- TallerPilot: plan gratuito permanente y límites de crecimiento.
insert into public.plans (id,name,description,monthly_price_cop,annual_price_cop,limits,features,active) values
('gratis','Gratis','Para conocer TallerPilot y organizar una operación pequeña sin límite de tiempo.',0,0,
 '{"users":1,"monthlyOrders":20,"storageGb":0.25,"locations":1,"evidencePerOrder":5}',
 '["Clientes y vehículos","20 órdenes cada mes","Cotizaciones PDF","WhatsApp manual","Hasta 5 fotos por orden"]',true),
('esencial','Esencial','Para talleres pequeños que están organizando su operación.',79000,790000,
 '{"users":3,"monthlyOrders":150,"storageGb":2,"locations":1,"evidencePerOrder":50}',
 '["Clientes y vehículos","Órdenes y evidencias","Cotizaciones PDF","WhatsApp manual","Contabilidad básica"]',true),
('profesional','Profesional','La operación completa para un taller tecnificado en crecimiento.',149000,1490000,
 '{"users":10,"monthlyOrders":500,"storageGb":10,"locations":1,"evidencePerOrder":200}',
 '["Todo en Esencial","Roles y auditoría","Portal de seguimiento","Automatización de WhatsApp","Reportes avanzados"]',true),
('empresarial','Empresarial','Para centros automotrices con varias áreas o sedes.',299000,2990000,
 '{"users":30,"monthlyOrders":2000,"storageGb":50,"locations":3,"evidencePerOrder":500}',
 '["Todo en Profesional","Hasta 3 sedes","MFA obligatorio","Integraciones y API","Soporte prioritario"]',true)
on conflict (id) do update set
  name=excluded.name, description=excluded.description,
  monthly_price_cop=excluded.monthly_price_cop, annual_price_cop=excluded.annual_price_cop,
  limits=excluded.limits, features=excluded.features, active=excluded.active;
