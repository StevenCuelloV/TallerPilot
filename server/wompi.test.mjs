import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { integritySignature, paymentReference, verifyWompiEvent } from './wompi.mjs'

test('genera referencias únicas con el prefijo del producto', () => {
  const first=paymentReference('motorpro','profesional'),second=paymentReference('motorpro','profesional')
  assert.match(first,/^TPILOT-motorpro-profesional-/)
  assert.notEqual(first,second)
  assert.ok(first.length<=64)
})

test('firma el checkout con SHA-256 en el orden exigido', () => {
  const expected=crypto.createHash('sha256').update('REF-12314900000COPintegrity-secret').digest('hex')
  assert.equal(integritySignature('REF-123',14900000,'COP','integrity-secret'),expected)
})

test('valida y rechaza eventos según su checksum', () => {
  const event={data:{transaction:{id:'txn_1',status:'APPROVED'}},timestamp:1720000000,signature:{properties:['transaction.id','transaction.status'],checksum:''}}
  event.signature.checksum=crypto.createHash('sha256').update(`txn_1APPROVED${event.timestamp}events-secret`).digest('hex')
  assert.equal(verifyWompiEvent(event,'events-secret'),true)
  assert.equal(verifyWompiEvent(event,'otro-secreto'),false)
})
