import test from 'node:test'
import assert from 'node:assert/strict'
import { PLANS, findPlan, planAmount } from './plans.mjs'

test('ofrece un plan gratuito permanente con límites de crecimiento', () => {
  const plan = findPlan('gratis')
  assert.ok(plan)
  assert.equal(plan.monthlyPrice, 0)
  assert.equal(plan.annualPrice, 0)
  assert.equal(plan.limits.users, 1)
  assert.equal(plan.limits.monthlyOrders, 20)
  assert.equal(plan.limits.evidencePerOrder, 5)
})

test('mantiene tres opciones pagas después del plan gratuito', () => {
  assert.deepEqual(PLANS.map(plan => plan.id), ['gratis', 'esencial', 'profesional', 'empresarial'])
  assert.equal(planAmount(findPlan('esencial'), 'monthly'), 79000)
  assert.equal(planAmount(findPlan('esencial'), 'annual'), 790000)
})

test('reserva el crecimiento multisede para planes superiores', () => {
  assert.equal(findPlan('gratis').limits.locations, 1)
  assert.equal(findPlan('esencial').limits.locations, 1)
  assert.equal(findPlan('profesional').limits.locations, 2)
  assert.equal(findPlan('empresarial').limits.locations, 3)
})
