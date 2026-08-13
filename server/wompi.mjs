import crypto from 'node:crypto'
import { BRAND } from './brand.mjs'

export const WOMPI_CHECKOUT_URL = 'https://checkout.wompi.co/p/'

export function paymentReference(workshopId, planId) {
  const nonce = crypto.randomBytes(6).toString('hex')
  return `${BRAND.paymentPrefix}-${workshopId}-${planId}-${Date.now()}-${nonce}`.slice(0, 64)
}

export function integritySignature(reference, amountInCents, currency, integritySecret) {
  return crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest('hex')
}

function valueAtPath(source, path) {
  return path.split('.').reduce((value, part) => value?.[part], source)
}

export function verifyWompiEvent(event, eventsSecret, headerChecksum = '') {
  if (!eventsSecret || !event?.signature?.properties || !event?.timestamp) return false
  const values = event.signature.properties.map((property) => valueAtPath(event.data, property)).join('')
  const expected = crypto.createHash('sha256').update(`${values}${event.timestamp}${eventsSecret}`).digest('hex')
  const received = String(headerChecksum || event.signature.checksum || '').trim().toLowerCase()
  if (!received || expected.length !== received.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}
