export const PLANS = [
  {
    id: 'esencial',
    name: 'Esencial',
    description: 'Para talleres pequeños que están organizando su operación.',
    monthlyPrice: 79000,
    annualPrice: 790000,
    recommended: false,
    limits: { users: 3, monthlyOrders: 150, storageGb: 2, locations: 1 },
    features: ['Clientes y vehículos', 'Órdenes y evidencias', 'Cotizaciones PDF', 'WhatsApp manual', 'Contabilidad básica'],
  },
  {
    id: 'profesional',
    name: 'Profesional',
    description: 'La operación completa para un taller tecnificado en crecimiento.',
    monthlyPrice: 149000,
    annualPrice: 1490000,
    recommended: true,
    limits: { users: 10, monthlyOrders: 500, storageGb: 10, locations: 1 },
    features: ['Todo en Esencial', 'Roles y auditoría', 'Portal de seguimiento', 'Automatización de WhatsApp', 'Reportes avanzados'],
  },
  {
    id: 'empresarial',
    name: 'Empresarial',
    description: 'Para centros automotrices con varias áreas o sedes.',
    monthlyPrice: 299000,
    annualPrice: 2990000,
    recommended: false,
    limits: { users: 30, monthlyOrders: 2000, storageGb: 50, locations: 3 },
    features: ['Todo en Profesional', 'Hasta 3 sedes', 'MFA obligatorio', 'Integraciones y API', 'Soporte prioritario'],
  },
]

export function findPlan(planId) {
  return PLANS.find((plan) => plan.id === planId)
}

export function planAmount(plan, billingPeriod) {
  return billingPeriod === 'annual' ? plan.annualPrice : plan.monthlyPrice
}
