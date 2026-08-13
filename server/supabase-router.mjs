import express from 'express'
import multer from 'multer'
import PDFDocument from 'pdfkit'
import { rateLimit } from 'express-rate-limit'
import { PLANS, findPlan, planAmount } from './plans.mjs'
import { WOMPI_CHECKOUT_URL, integritySignature, paymentReference, verifyWompiEvent } from './wompi.mjs'
import {
  addSupabaseEvidence, addSupabaseNote, authenticateSupabase, bootstrapSupabase,
  createSupabaseCustomer, createSupabaseExpense, createSupabaseInvoice, createSupabaseOrder,
  createSupabasePayment, createSupabaseUser, deleteSupabaseCustomer, listSupabaseUsers,
  processSupabaseWompiEvent, signInSupabase, subscriptionSupabase, updateSupabaseCustomer,
  updateSupabaseOrder, updateSupabaseQuote,
} from './supabase.mjs'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
})
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const adminOnly = (req, res, next) => ['Administrador', 'Propietario'].includes(req.user?.role)
  ? next() : res.status(403).json({ error: 'Esta acción requiere rol de administrador' })
const formatMoney = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)

export function createSupabaseRouter({ appBaseUrl, isProduction, setupState }) {
  const router = express.Router()
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' } })
  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Límite temporal de solicitudes alcanzado.' } })
  const clients = new Set()
  const broadcast = (type, data) => {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
    for (const response of clients) response.write(message)
  }
  const auth = asyncRoute(async (req, _res, next) => {
    req.user = await authenticateSupabase(req.headers.authorization?.replace(/^Bearer\s+/, ''))
    next()
  })

  router.get('/api/health', (_req, res) => res.json({ ok: true, service: 'TallerPilot API', database: 'supabase', initialized: Boolean(setupState?.initialized), time: new Date().toISOString() }))
  router.get('/api/public/plans', (_req, res) => res.json(PLANS))
  router.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '')
    if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios' })
    res.json(await signInSupabase(email, password))
  }))
  router.get('/api/events', asyncRoute(async (req, res) => {
    await authenticateSupabase(req.query.token)
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders()
    res.write('event: connected\ndata: {"ok":true}\n\n'); clients.add(res); req.on('close', () => clients.delete(res))
  }))
  router.post('/api/webhooks/wompi', asyncRoute(async (req, res) => {
    if (!verifyWompiEvent(req.body, process.env.WOMPI_EVENTS_SECRET || '', req.get('X-Event-Checksum'))) return res.status(401).json({ error: 'Firma de evento Wompi no válida' })
    const payment = await processSupabaseWompiEvent(req.body)
    if (payment) broadcast('subscription.updated', { reference: payment.reference, status: req.body?.data?.transaction?.status })
    res.json({ received: true, ignored: !payment })
  }))

  router.use('/api', apiLimiter, auth)
  router.get('/api/bootstrap', asyncRoute(async (req, res) => res.json(await bootstrapSupabase(req.user))))
  router.post('/api/reset', (_req, res) => res.status(403).json({ error: 'El reinicio masivo está deshabilitado cuando TallerPilot usa la base de datos real' }))
  router.get('/api/users', adminOnly, asyncRoute(async (req, res) => res.json(await listSupabaseUsers(req.user))))
  router.post('/api/users', adminOnly, asyncRoute(async (req, res) => res.status(201).json(await createSupabaseUser(req.user, req.body))))

  router.get('/api/billing/subscription', adminOnly, asyncRoute(async (req, res) => {
    const account = await subscriptionSupabase(req.user)
    res.json({ ...account, plan: findPlan(account.subscription?.planId) || null })
  }))
  router.post('/api/billing/checkout', adminOnly, asyncRoute(async (req, res) => {
    const plan = findPlan(String(req.body?.planId || '')), billingPeriod = req.body?.billingPeriod === 'annual' ? 'annual' : 'monthly'
    if (!plan) return res.status(400).json({ error: 'Selecciona un plan válido' })
    const reference = paymentReference(req.user.workshopId, plan.id), amountInCents = planAmount(plan, billingPeriod) * 100
    const payment = await createSupabasePayment(req.user, plan, billingPeriod, reference, amountInCents)
    const publicKey = process.env.WOMPI_PUBLIC_KEY, integritySecret = process.env.WOMPI_INTEGRITY_SECRET
    if (!publicKey || !integritySecret) return res.json({ mode: 'demo', reference, payment, message: 'Wompi aún no está configurado.' })
    const currency = 'COP', signature = integritySignature(reference, amountInCents, currency, integritySecret)
    const params = new URLSearchParams({ 'public-key': publicKey, currency, 'amount-in-cents': String(amountInCents), reference, 'signature:integrity': signature, 'redirect-url': process.env.WOMPI_REDIRECT_URL || `${appBaseUrl}/?payment=return` })
    res.json({ mode: 'wompi', reference, payment, checkoutUrl: `${WOMPI_CHECKOUT_URL}?${params}` })
  }))
  router.post('/api/billing/demo-confirm', (_req, res) => res.status(isProduction ? 404 : 501).json({ error: 'La simulación de pagos no modifica la base de datos real' }))

  router.post('/api/customers', asyncRoute(async (req, res) => { const data = await createSupabaseCustomer(req.user, req.body); broadcast('customer.created', data); res.status(201).json(data) }))
  router.put('/api/customers/:id', asyncRoute(async (req, res) => { const data = await updateSupabaseCustomer(req.user, req.params.id, req.body); broadcast('customer.updated', data); res.json(data) }))
  router.delete('/api/customers/:id', asyncRoute(async (req, res) => { await deleteSupabaseCustomer(req.user, req.params.id); res.status(204).end() }))
  router.post('/api/orders', asyncRoute(async (req, res) => { const data = await createSupabaseOrder(req.user, req.body); broadcast('order.created', data); res.status(201).json(data) }))
  router.put('/api/orders/:id', asyncRoute(async (req, res) => { const data = await updateSupabaseOrder(req.user, req.params.id, req.body); broadcast('order.updated', data); res.json(data) }))
  router.post('/api/orders/:id/notes', asyncRoute(async (req, res) => { const data = await addSupabaseNote(req.user, req.params.id, req.body?.text); broadcast('order.note', { orderId: req.params.id, note: data }); res.status(201).json(data) }))
  router.post('/api/orders/:id/evidence', upload.array('files', 8), asyncRoute(async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Selecciona al menos una fotografía JPG, PNG o WEBP' })
    const data = await addSupabaseEvidence(req.user, req.params.id, req.files, req.body.type || 'Proceso', req.body.caption || '')
    broadcast('order.evidence', { orderId: req.params.id, items: data }); res.status(201).json(data)
  }))
  router.put('/api/orders/:id/quote', asyncRoute(async (req, res) => { const data = await updateSupabaseQuote(req.user, req.params.id, req.body); broadcast('order.quote', { orderId: req.params.id, quote: data }); res.json(data) }))

  router.get('/api/orders/:id/quote.pdf', asyncRoute(async (req, res) => {
    const db = await bootstrapSupabase(req.user), order = db.orders.find(item => item.id === req.params.id)
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' })
    const doc = new PDFDocument({ margin: 48, size: 'A4' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="Cotizacion-${order.id}.pdf"`); doc.pipe(res)
    doc.fontSize(22).fillColor('#ef633f').text(db.workshop.name).fontSize(9).fillColor('#596273').text(`NIT ${db.workshop.nit} · ${db.workshop.address} · ${db.workshop.phone}`)
    doc.moveDown(2).fontSize(18).fillColor('#172237').text(`COTIZACIÓN ${order.id}`, { align: 'right' }).moveDown().fontSize(11).text(`Cliente: ${order.customer}`).text(`Vehículo: ${order.car} · Placa ${order.plate}`).text(`Fecha: ${new Date().toLocaleDateString('es-CO')}`)
    doc.moveDown().fontSize(10).fillColor('#6d7788').text('DESCRIPCIÓN                                  CANT.      UNITARIO       TOTAL'); doc.moveTo(48, 190).lineTo(547, 190).strokeColor('#dfe4e9').stroke()
    let y = 205
    for (const item of order.quote.items) { doc.fillColor('#172237').text(item.name, 48, y, { width: 280 }).text(String(item.qty), 340, y).text(formatMoney(item.price), 380, y, { width: 75, align: 'right' }).text(formatMoney(item.qty * item.price), 465, y, { width: 82, align: 'right' }); y += 30 }
    const subtotal = order.quote.items.reduce((sum, item) => sum + item.qty * item.price, 0), tax = Math.round(subtotal * (order.quote.taxRate || 0) / 100)
    doc.moveTo(330, y).lineTo(547, y).stroke().text(`Subtotal: ${formatMoney(subtotal)}`, 330, y + 12, { width: 217, align: 'right' }).text(`IVA (${order.quote.taxRate || 0}%): ${formatMoney(tax)}`, 330, y + 30, { width: 217, align: 'right' }).fontSize(13).fillColor('#ef633f').text(`TOTAL: ${formatMoney(subtotal + tax)}`, 330, y + 52, { width: 217, align: 'right' })
    doc.fontSize(9).fillColor('#6d7788').text('Esta cotización no representa control de inventario.', 48, 730, { width: 499, align: 'center' }); doc.end()
  }))
  router.post('/api/expenses', asyncRoute(async (req, res) => { const data = await createSupabaseExpense(req.user, req.body); broadcast('expense.created', data); res.status(201).json(data) }))
  router.post('/api/invoices', asyncRoute(async (req, res) => { const data = await createSupabaseInvoice(req.user, req.body); broadcast('invoice.created', data); res.status(201).json(data) }))
  router.post('/api/orders/:id/whatsapp', asyncRoute(async (req, res) => {
    const db = await bootstrapSupabase(req.user), order = db.orders.find(item => item.id === req.params.id)
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' })
    const message = req.body?.message || `Hola ${order.customer}, tu vehículo ${order.car} (${order.plate}) está en la etapa: ${order.stage}. Progreso: ${order.progress}%.`
    res.json({ url: `https://wa.me/${order.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, message })
  }))
  return router
}
