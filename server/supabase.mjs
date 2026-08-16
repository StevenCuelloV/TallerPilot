import { createClient } from '@supabase/supabase-js'
import { PLANS } from './plans.mjs'

const url = process.env.SUPABASE_URL?.trim()
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim()
const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
const bucket = process.env.SUPABASE_EVIDENCE_BUCKET || 'order-evidence'

export const supabaseConfigured = Boolean(url && publishableKey && secretKey)

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
export const supabasePublic = supabaseConfigured ? createClient(url, publishableKey, clientOptions) : null
export const supabaseAdmin = supabaseConfigured ? createClient(url, secretKey, clientOptions) : null

const ROLE_TO_DB = {
  Propietario: 'owner', Administrador: 'admin', Asesor: 'advisor',
  'Técnico': 'technician', Tecnico: 'technician', Contador: 'accountant', Consulta: 'viewer',
}
const ROLE_FROM_DB = {
  owner: 'Propietario', admin: 'Administrador', advisor: 'Asesor',
  technician: 'Técnico', accountant: 'Contador', viewer: 'Consulta',
}
const QUOTE_TO_DB = { Borrador: 'draft', Enviada: 'sent', Autorizada: 'approved', Rechazada: 'rejected', Vencida: 'expired' }
const QUOTE_FROM_DB = { draft: 'Borrador', sent: 'Enviada', approved: 'Autorizada', rejected: 'Rechazada', expired: 'Vencida' }
const PHASE_TO_DB = { Ingreso: 'entry', Diagnóstico: 'diagnosis', Diagnostico: 'diagnosis', Proceso: 'process', Antes: 'before', Después: 'after', Despues: 'after', Entrega: 'delivery' }
const PHASE_FROM_DB = { entry: 'Ingreso', diagnosis: 'Diagnóstico', process: 'Proceso', before: 'Antes', after: 'Después', delivery: 'Entrega' }

function databaseError(error, fallback = 'No fue posible completar la operación') {
  if (!error) return
  const status = error.code === '23505' ? 409 : error.status || 500
  const message = error.code === '23505' ? 'Ya existe un registro con esos datos' : error.message || fallback
  throw Object.assign(new Error(message), { status })
}

async function syncPlanCatalog() {
  const rows = PLANS.map(plan => ({
    id: plan.id, name: plan.name, description: plan.description,
    monthly_price_cop: plan.monthlyPrice, annual_price_cop: plan.annualPrice,
    limits: plan.limits, features: plan.features, active: true,
  }))
  const { error } = await supabaseAdmin.from('plans').upsert(rows, { onConflict: 'id' })
  databaseError(error, 'No fue posible sincronizar el catálogo de planes')
}

async function currentPlan(context) {
  const { data: subscription, error: subscriptionError } = await supabaseAdmin.from('subscriptions').select('plan_id').eq('workshop_id', context.workshopId).maybeSingle()
  databaseError(subscriptionError)
  const planId = subscription?.plan_id || 'gratis'
  const { data: plan, error: planError } = await supabaseAdmin.from('plans').select('id,name,limits').eq('id', planId).maybeSingle()
  databaseError(planError)
  return plan || { id: 'gratis', name: 'Gratis', limits: PLANS.find(item => item.id === 'gratis').limits }
}

function publicOrderId(orderNumber) {
  return `OT-${String(orderNumber).padStart(4, '0')}`
}

function orderNumberFromId(value) {
  const result = Number(String(value || '').replace(/\D/g, ''))
  if (!Number.isInteger(result) || result <= 0) throw Object.assign(new Error('Orden no válida'), { status: 400 })
  return result
}

async function selectOne(table, filters) {
  let query = supabaseAdmin.from(table).select('*')
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value)
  const { data, error } = await query.maybeSingle()
  databaseError(error)
  return data
}

export async function authenticateSupabase(token) {
  if (!token) throw Object.assign(new Error('Sesión no válida o vencida'), { status: 401 })
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user) throw Object.assign(new Error('Sesión no válida o vencida'), { status: 401 })

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('memberships').select('*').eq('user_id', authData.user.id).eq('active', true).limit(1).maybeSingle()
  databaseError(membershipError)
  if (!membership) throw Object.assign(new Error('Tu usuario no tiene un taller activo asignado'), { status: 403 })

  const [profile, workshop] = await Promise.all([
    selectOne('profiles', { id: authData.user.id }),
    selectOne('workshops', { id: membership.workshop_id }),
  ])
  if (!workshop) throw Object.assign(new Error('El taller asignado no existe'), { status: 403 })
  return {
    id: authData.user.id,
    name: profile?.full_name || authData.user.user_metadata?.full_name || authData.user.email,
    email: authData.user.email,
    role: ROLE_FROM_DB[membership.role] || 'Consulta',
    roleDb: membership.role,
    workshopId: membership.workshop_id,
    workshop,
  }
}

export async function signInSupabase(email, password) {
  const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw Object.assign(new Error('Correo o contraseña incorrectos'), { status: 401 })
  const user = await authenticateSupabase(data.session.access_token)
  return { token: data.session.access_token, user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

function validateNewAccount(input) {
  const result = {
    workshopName: String(input?.workshopName || '').trim(),
    nit: String(input?.nit || '').replace(/\D/g, ''),
    city: String(input?.city || '').trim(),
    phone: String(input?.phone || '').replace(/[^\d+]/g, ''),
    fullName: String(input?.fullName || '').trim(),
    email: String(input?.email || '').trim().toLowerCase(),
    password: String(input?.password || ''),
  }
  if (result.workshopName.length < 3 || result.fullName.length < 3 || result.city.length < 2) {
    throw Object.assign(new Error('Completa el nombre del taller, la ciudad y el nombre del propietario'), { status: 400 })
  }
  if (result.nit.length < 7 || result.nit.length > 15) throw Object.assign(new Error('Ingresa un NIT o documento válido'), { status: 400 })
  if (!/^\S+@\S+\.\S+$/.test(result.email)) throw Object.assign(new Error('Ingresa un correo electrónico válido'), { status: 400 })
  if (result.phone.replace(/\D/g, '').length < 7) throw Object.assign(new Error('Ingresa un teléfono válido'), { status: 400 })
  if (result.password.length < 12 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(result.password) || !/\d/.test(result.password)) {
    throw Object.assign(new Error('La contraseña debe tener mínimo 12 caracteres e incluir letras y números'), { status: 400 })
  }
  return result
}

export async function registerSupabaseWorkshop(input, appBaseUrl) {
  const account = validateNewAccount(input)
  const [workshopResult, usersResult] = await Promise.all([
    supabaseAdmin.from('workshops').select('id').eq('nit', account.nit).maybeSingle(),
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])
  databaseError(workshopResult.error)
  databaseError(usersResult.error)
  if (workshopResult.data) throw Object.assign(new Error('Ya existe un taller registrado con ese NIT o documento'), { status: 409 })
  if (usersResult.data.users.some(user => user.email?.toLowerCase() === account.email)) {
    throw Object.assign(new Error('Ya existe una cuenta con ese correo. Intenta iniciar sesión o restablecer la contraseña.'), { status: 409 })
  }

  const requireEmailConfirmation = process.env.AUTH_REQUIRE_EMAIL_CONFIRMATION === 'true'
  let authUser, accessToken = null
  if (requireEmailConfirmation) {
    const signup = await supabasePublic.auth.signUp({
      email: account.email,
      password: account.password,
      options: { emailRedirectTo: `${appBaseUrl}/?auth=confirmed`, data: { full_name: account.fullName } },
    })
    databaseError(signup.error, 'No fue posible enviar la confirmación de correo')
    authUser = signup.data.user
    accessToken = signup.data.session?.access_token || null
  } else {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    })
    databaseError(created.error, 'No fue posible crear la cuenta')
    authUser = created.data.user
  }
  if (!authUser) throw Object.assign(new Error('No fue posible crear la cuenta'), { status: 500 })

  let workshop = null
  try {
    const createdWorkshop = await supabaseAdmin.from('workshops').insert({
      name: account.workshopName,
      legal_name: 'Taller automotor',
      nit: account.nit,
      email: account.email,
      phone: account.phone,
      whatsapp: account.phone.replace(/\D/g, ''),
      city: account.city,
      status: 'active',
      trial_ends_at: null,
    }).select().single()
    databaseError(createdWorkshop.error); workshop = createdWorkshop.data
    const profile = await supabaseAdmin.from('profiles').insert({ id: authUser.id, full_name: account.fullName, phone: account.phone }).select().single()
    databaseError(profile.error)
    const membership = await supabaseAdmin.from('memberships').insert({ workshop_id: workshop.id, user_id: authUser.id, role: 'owner' }).select().single()
    databaseError(membership.error)
    const subscription = await supabaseAdmin.from('subscriptions').insert({ workshop_id: workshop.id, plan_id: 'gratis', status: 'active', billing_period: 'monthly' }).select().single()
    databaseError(subscription.error)
  } catch (error) {
    if (workshop) await supabaseAdmin.from('workshops').delete().eq('id', workshop.id)
    await supabaseAdmin.auth.admin.deleteUser(authUser.id)
    throw error
  }

  if (!requireEmailConfirmation) {
    const signedIn = await signInSupabase(account.email, account.password)
    accessToken = signedIn.token
  }
  return {
    token: accessToken,
    requiresEmailConfirmation: requireEmailConfirmation && !accessToken,
    message: requireEmailConfirmation && !accessToken
      ? 'Cuenta creada. Revisa tu correo para confirmar el acceso.'
      : 'Tu taller fue creado con el plan Gratis y ya puedes comenzar.',
  }
}

export async function requestSupabasePasswordReset(email, appBaseUrl) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw Object.assign(new Error('Ingresa un correo electrónico válido'), { status: 400 })
  const { error } = await supabasePublic.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${appBaseUrl}/?auth=recovery` })
  if (error) {
    console.error('Supabase password reset:', error.message)
    if (error.status === 429) throw Object.assign(new Error('Espera un minuto antes de solicitar otro correo'), { status: 429 })
    throw Object.assign(new Error('El servicio de correo todavía no pudo enviar el enlace. Verifica la configuración SMTP de Supabase.'), { status: 503 })
  }
  return { message: 'Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.' }
}

export async function updateSupabasePassword(recoveryToken, password) {
  const token = String(recoveryToken || '')
  const nextPassword = String(password || '')
  if (nextPassword.length < 12 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(nextPassword) || !/\d/.test(nextPassword)) {
    throw Object.assign(new Error('La contraseña debe tener mínimo 12 caracteres e incluir letras y números'), { status: 400 })
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('El enlace de recuperación es inválido o ya venció'), { status: 401 })
  const updated = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password: nextPassword })
  databaseError(updated.error, 'No fue posible actualizar la contraseña')
  return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' }
}

async function getOrder(context, value) {
  const orderNumber = orderNumberFromId(value)
  const { data, error } = await supabaseAdmin.from('work_orders').select('*')
    .eq('workshop_id', context.workshopId).eq('order_number', orderNumber).maybeSingle()
  databaseError(error)
  if (!data) throw Object.assign(new Error('Orden no encontrada'), { status: 404 })
  return data
}

function mapVehicle(row) {
  return {
    id: row.id, plate: row.plate, brand: row.brand || '', model: row.model || '',
    year: row.model_year || '', color: row.color || '', mileage: row.mileage || 0, vin: row.vin || '',
  }
}

function mapCustomer(row, vehicles = []) {
  return {
    id: row.id,
    type: row.kind === 'company' ? 'Empresa' : 'Persona natural',
    documentType: row.document_type,
    document: row.document_number,
    name: row.name,
    phone: row.phone,
    email: row.email || '',
    address: row.address || '',
    vehicles: vehicles.filter(vehicle => vehicle.customer_id === row.id).map(mapVehicle),
    createdAt: row.created_at,
  }
}

function mapQuote(row, items = []) {
  if (!row) return { status: 'Borrador', taxRate: 19, items: [] }
  return {
    status: QUOTE_FROM_DB[row.status] || 'Borrador',
    taxRate: Number(row.tax_rate || 0),
    items: items.filter(item => item.quote_id === row.id).map(item => ({
      id: item.id,
      name: item.description,
      type: item.kind === 'part' ? 'Repuesto' : item.kind === 'material' ? 'Material' : 'Servicio',
      qty: Number(item.quantity),
      price: Number(item.unit_price_cop),
    })),
  }
}

async function signedEvidenceUrls(evidence) {
  if (!evidence.length) return new Map()
  const paths = evidence.map(item => item.storage_path)
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrls(paths, 60 * 60)
  databaseError(error, 'No fue posible autorizar las fotografías')
  return new Map(paths.map((path, index) => [path, data?.[index]?.signedUrl || '']))
}

export async function bootstrapSupabase(context) {
  const workshopId = context.workshopId
  const canViewAccounting = ['owner', 'admin', 'accountant'].includes(context.roleDb)
  const queries = await Promise.all([
    supabaseAdmin.from('customers').select('*').eq('workshop_id', workshopId).order('created_at', { ascending: false }),
    supabaseAdmin.from('vehicles').select('*').eq('workshop_id', workshopId),
    supabaseAdmin.from('work_orders').select('*').eq('workshop_id', workshopId).order('created_at', { ascending: false }),
    supabaseAdmin.from('order_notes').select('*').eq('workshop_id', workshopId).order('created_at'),
    supabaseAdmin.from('order_evidence').select('*').eq('workshop_id', workshopId).order('created_at'),
    supabaseAdmin.from('quotes').select('*').eq('workshop_id', workshopId).order('created_at', { ascending: false }),
    supabaseAdmin.from('quote_items').select('*').eq('workshop_id', workshopId),
    canViewAccounting ? supabaseAdmin.from('invoices').select('*').eq('workshop_id', workshopId).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canViewAccounting ? supabaseAdmin.from('expenses').select('*').eq('workshop_id', workshopId).order('expense_date', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canViewAccounting ? supabaseAdmin.from('subscriptions').select('*').eq('workshop_id', workshopId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabaseAdmin.from('audit_logs').select('*').eq('workshop_id', workshopId).eq('entity_type', 'work_order').order('created_at'),
    supabaseAdmin.from('memberships').select('user_id,role').eq('workshop_id', workshopId).eq('active', true),
  ])
  for (const result of queries) databaseError(result.error)
  const [customers, vehicles, orders, notes, evidence, quotes, quoteItems, invoices, expenses, subscription, audit, memberships] = queries.map(result => result.data || [])
  const profileIds = [...new Set([
    context.id,
    ...memberships.map(item => item.user_id),
    ...orders.map(item => item.assigned_user_id),
    ...notes.map(item => item.author_user_id),
    ...evidence.map(item => item.author_user_id),
  ].filter(Boolean))]
  const profileResult = profileIds.length
    ? await supabaseAdmin.from('profiles').select('*').in('id', profileIds)
    : { data: [], error: null }
  databaseError(profileResult.error)
  const profiles = new Map((profileResult.data || []).map(profile => [profile.id, profile]))
  const evidenceUrls = await signedEvidenceUrls(evidence)
  const customerMap = new Map(customers.map(customer => [customer.id, customer]))
  const vehicleMap = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]))

  const mappedOrders = orders.map(order => {
    const customer = customerMap.get(order.customer_id) || {}
    const vehicle = vehicleMap.get(order.vehicle_id) || {}
    const quoteRow = quotes.find(quote => quote.order_id === order.id)
    const quote = mapQuote(quoteRow, quoteItems)
    const subtotal = quote.items.reduce((sum, item) => sum + item.qty * item.price, 0)
    const historyRows = audit.filter(item => item.entity_id === order.id)
    return {
      id: publicOrderId(order.order_number),
      customerId: order.customer_id,
      vehicleId: order.vehicle_id,
      customer: customer.name || 'Cliente',
      phone: customer.phone || '',
      car: [vehicle.brand, vehicle.model, vehicle.model_year].filter(Boolean).join(' ') || 'Vehículo',
      plate: vehicle.plate || 'S/P',
      serviceArea: order.service_area,
      affectedAreas: order.affected_areas || [],
      paintColor: order.paint_color || '',
      tech: profiles.get(order.assigned_user_id)?.full_name || 'Por asignar',
      stage: order.stage,
      progress: Number(order.progress),
      value: Math.round(subtotal * (1 + Number(quote.taxRate || 0) / 100)),
      delivery: order.estimated_delivery_at || 'Por programar',
      color: '#f05a37',
      mileage: Number(order.mileage || 0),
      fuel: order.fuel_level || 'Por registrar',
      receivedItems: order.received_items || '',
      reason: order.reason || '',
      diagnosis: order.diagnosis || '',
      finalDiagnosis: order.final_diagnosis || '',
      createdAt: order.created_at,
      notes: notes.filter(note => note.order_id === order.id).map(note => ({
        id: note.id, author: profiles.get(note.author_user_id)?.full_name || 'Equipo del taller',
        role: ROLE_FROM_DB[memberships.find(item => item.user_id === note.author_user_id)?.role] || 'Taller',
        at: note.created_at, text: note.body,
      })),
      evidence: evidence.filter(item => item.order_id === order.id).map((item, index) => ({
        id: item.id, url: evidenceUrls.get(item.storage_path), name: item.storage_path.split('/').pop(),
        type: PHASE_FROM_DB[item.phase] || 'Proceso', caption: item.caption || '', at: item.created_at,
        author: profiles.get(item.author_user_id)?.full_name || 'Equipo del taller', index,
      })),
      quote,
      history: historyRows.length ? historyRows.map(item => ({
        id: String(item.id), event: item.metadata?.event || item.action,
        at: item.created_at, author: item.metadata?.author || 'Equipo del taller',
      })) : [{ id: `created-${order.id}`, event: 'Orden creada y recepción registrada', at: order.created_at, author: 'Equipo del taller' }],
    }
  })

  const orderByUuid = new Map(orders.map(order => [order.id, mappedOrders.find(item => item.id === publicOrderId(order.order_number))]))
  return {
    currentUser: { id: context.id, name: context.name, email: context.email, role: context.role },
    workshop: {
      id: context.workshop.id, name: context.workshop.name,
      businessType: context.workshop.legal_name || 'Comercial automotor', nit: context.workshop.nit,
      address: context.workshop.address || '', city: context.workshop.city || '',
      phone: context.workshop.phone || '', whatsapp: context.workshop.whatsapp || '', email: context.workshop.email,
    },
    customers: customers.map(customer => mapCustomer(customer, vehicles)),
    orders: mappedOrders,
    expenses: expenses.map(item => ({ id: item.id, date: item.expense_date, category: item.category, description: item.description, amount: Number(item.amount_cop) })),
    invoices: invoices.map(item => {
      const order = orderByUuid.get(item.order_id)
      return { id: item.number, orderId: order?.id || '', customer: order?.customer || 'Cliente', date: item.created_at.slice(0, 10), total: Number(item.total_cop), status: item.status === 'paid' ? 'Pagada' : item.status, nextMaintenance: item.next_maintenance_at || '' }
    }),
    subscription: subscription && !Array.isArray(subscription) ? {
      planId: subscription.plan_id, status: subscription.status, billingPeriod: subscription.billing_period,
      trialEndsAt: context.workshop.trial_ends_at, currentPeriodStartsAt: subscription.current_period_starts_at,
      currentPeriodEndsAt: subscription.current_period_ends_at,
    } : null,
    activity: [],
  }
}

export async function listSupabaseUsers(context) {
  const { data: memberships, error } = await supabaseAdmin.from('memberships').select('*')
    .eq('workshop_id', context.workshopId).eq('active', true).order('created_at')
  databaseError(error)
  const profilesResult = memberships.length
    ? await supabaseAdmin.from('profiles').select('*').in('id', memberships.map(item => item.user_id))
    : { data: [], error: null }
  databaseError(profilesResult.error)
  const profiles = new Map((profilesResult.data || []).map(profile => [profile.id, profile]))
  return Promise.all(memberships.map(async membership => {
    const { data } = await supabaseAdmin.auth.admin.getUserById(membership.user_id)
    return { id: membership.user_id, name: profiles.get(membership.user_id)?.full_name || data?.user?.email, email: data?.user?.email || '', role: ROLE_FROM_DB[membership.role], createdAt: membership.created_at }
  }))
}

export async function createSupabaseUser(context, input) {
  const name = String(input?.name || '').trim()
  const email = String(input?.email || '').trim().toLowerCase()
  const password = String(input?.password || '')
  const role = ROLE_TO_DB[String(input?.role || 'Técnico')]
  if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || !role) {
    throw Object.assign(new Error('Nombre, correo válido, rol y contraseña de mínimo 10 caracteres son obligatorios'), { status: 400 })
  }
  const planRow = await currentPlan(context)
  const existingUsers = await listSupabaseUsers(context)
  if (existingUsers.length >= Number(planRow.limits?.users || 1)) {
    throw Object.assign(new Error(`El plan ${planRow.name} permite ${planRow.limits.users} usuario. Mejora a Esencial para agregar a tu equipo.`), { status: 409, code: 'PLAN_LIMIT' })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } })
  databaseError(authError)
  try {
    const profile = await supabaseAdmin.from('profiles').insert({ id: authData.user.id, full_name: name }).select().single()
    databaseError(profile.error)
    const membership = await supabaseAdmin.from('memberships').insert({ workshop_id: context.workshopId, user_id: authData.user.id, role }).select().single()
    databaseError(membership.error)
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    throw error
  }
  return { id: authData.user.id, name, email, role: ROLE_FROM_DB[role], createdAt: new Date().toISOString() }
}

export async function createSupabaseCustomer(context, input) {
  const row = {
    workshop_id: context.workshopId,
    kind: input.type === 'Empresa' ? 'company' : 'person',
    document_type: input.documentType || 'CC', document_number: String(input.document || '').trim(),
    name: String(input.name || '').trim(), phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim() || null, address: String(input.address || '').trim() || null,
  }
  if (!row.name || !row.document_number || !row.phone) throw Object.assign(new Error('Nombre, documento y teléfono son obligatorios'), { status: 400 })
  const { data: customer, error } = await supabaseAdmin.from('customers').insert(row).select().single()
  databaseError(error)
  const vehicleInputs = Array.isArray(input.vehicles) ? input.vehicles.filter(item => item.plate) : []
  let vehicles = []
  if (vehicleInputs.length) {
    const result = await supabaseAdmin.from('vehicles').insert(vehicleInputs.map(vehicle => ({
      workshop_id: context.workshopId, customer_id: customer.id, plate: String(vehicle.plate).toUpperCase().trim(),
      brand: vehicle.brand || null, model: vehicle.model || null, model_year: Number(vehicle.year) || null,
      color: vehicle.color || null, mileage: Number(vehicle.mileage) || 0,
    }))).select()
    if (result.error) {
      await supabaseAdmin.from('customers').delete().eq('id', customer.id)
      databaseError(result.error)
    }
    vehicles = result.data
  }
  return mapCustomer(customer, vehicles)
}

export async function updateSupabaseCustomer(context, customerId, input) {
  const updates = {
    kind: input.type === 'Empresa' ? 'company' : 'person', document_type: input.documentType,
    document_number: input.document, name: input.name, phone: input.phone,
    email: input.email || null, address: input.address || null, updated_at: new Date().toISOString(),
  }
  Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key])
  const { data, error } = await supabaseAdmin.from('customers').update(updates).eq('id', customerId).eq('workshop_id', context.workshopId).select().maybeSingle()
  databaseError(error)
  if (!data) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 })
  const { data: vehicles } = await supabaseAdmin.from('vehicles').select('*').eq('customer_id', customerId).eq('workshop_id', context.workshopId)
  return mapCustomer(data, vehicles || [])
}

export async function deleteSupabaseCustomer(context, customerId) {
  const { count } = await supabaseAdmin.from('work_orders').select('*', { count: 'exact', head: true }).eq('customer_id', customerId).eq('workshop_id', context.workshopId)
  if (count) throw Object.assign(new Error('El cliente tiene órdenes asociadas'), { status: 409 })
  const { error } = await supabaseAdmin.from('customers').delete().eq('id', customerId).eq('workshop_id', context.workshopId)
  databaseError(error)
}

export async function createSupabaseOrder(context, input) {
  const [customer, vehicle] = await Promise.all([
    selectOne('customers', { id: input.customerId, workshop_id: context.workshopId }),
    selectOne('vehicles', { id: input.vehicleId, workshop_id: context.workshopId }),
  ])
  if (!customer || !vehicle || vehicle.customer_id !== customer.id) throw Object.assign(new Error('Selecciona un cliente y vehículo válidos'), { status: 400 })
  const startOfMonth = new Date(); startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin.from('work_orders').select('*', { count: 'exact', head: true }).eq('workshop_id', context.workshopId).gte('created_at', startOfMonth.toISOString())
  const plan = await currentPlan(context)
  if ((count || 0) >= Number(plan.limits?.monthlyOrders || 20)) {
    throw Object.assign(new Error(`Alcanzaste las ${plan.limits.monthlyOrders} órdenes mensuales del plan ${plan.name}. Mejora tu plan para seguir creando órdenes.`), { status: 409, code: 'PLAN_LIMIT' })
  }

  let assignedUserId = null
  if (input.tech && input.tech !== 'Por asignar') {
    const users = await listSupabaseUsers(context)
    assignedUserId = users.find(user => user.name === input.tech)?.id || null
  }
  const { data: order, error } = await supabaseAdmin.from('work_orders').insert({
    workshop_id: context.workshopId, customer_id: customer.id, vehicle_id: vehicle.id,
    assigned_user_id: assignedUserId, service_area: input.serviceArea || 'Mecánica general',
    stage: 'Ingreso', progress: 8, reason: input.reason || '', mileage: Number(input.mileage || vehicle.mileage || 0),
    fuel_level: input.fuel || 'Por registrar', received_items: input.receivedItems || 'Llave',
    affected_areas: input.affectedAreas || [], paint_color: input.paintColor || null,
  }).select().single()
  databaseError(error)
  await supabaseAdmin.from('audit_logs').insert({ workshop_id: context.workshopId, actor_user_id: context.id, action: 'order.created', entity_type: 'work_order', entity_id: order.id, metadata: { event: 'Orden creada y recepción registrada', author: context.name } })
  return (await bootstrapSupabase(context)).orders.find(item => item.id === publicOrderId(order.order_number))
}

export async function updateSupabaseOrder(context, orderId, input) {
  const order = await getOrder(context, orderId)
  const updates = {
    stage: input.stage, progress: input.progress == null ? undefined : Number(input.progress), reason: input.reason,
    diagnosis: input.diagnosis, final_diagnosis: input.finalDiagnosis, mileage: input.mileage == null ? undefined : Number(input.mileage),
    fuel_level: input.fuel, received_items: input.receivedItems, affected_areas: input.affectedAreas,
    paint_color: input.paintColor || null, updated_at: new Date().toISOString(),
  }
  Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key])
  if (input.tech) {
    if (input.tech === 'Por asignar') updates.assigned_user_id = null
    else {
      const users = await listSupabaseUsers(context)
      updates.assigned_user_id = users.find(user => user.name === input.tech)?.id || order.assigned_user_id
    }
  }
  const { error } = await supabaseAdmin.from('work_orders').update(updates).eq('id', order.id).eq('workshop_id', context.workshopId)
  databaseError(error)
  if (input.stage && input.stage !== order.stage) await supabaseAdmin.from('audit_logs').insert({
    workshop_id: context.workshopId, actor_user_id: context.id, action: 'order.stage.updated', entity_type: 'work_order', entity_id: order.id,
    metadata: { event: `Orden avanzó a ${input.stage}`, author: context.name, previous: order.stage, current: input.stage },
  })
  return (await bootstrapSupabase(context)).orders.find(item => item.id === orderId)
}

export async function addSupabaseNote(context, orderId, text) {
  const body = String(text || '').trim()
  if (!body) throw Object.assign(new Error('La nota está vacía'), { status: 400 })
  const order = await getOrder(context, orderId)
  const { data, error } = await supabaseAdmin.from('order_notes').insert({ workshop_id: context.workshopId, order_id: order.id, author_user_id: context.id, audience: 'both', body }).select().single()
  databaseError(error)
  return { id: data.id, author: context.name, role: context.role, at: data.created_at, text: data.body }
}

export async function addSupabaseEvidence(context, orderId, files, type, caption = '') {
  const order = await getOrder(context, orderId)
  const plan = await currentPlan(context)
  const evidenceLimit = Number(plan.limits?.evidencePerOrder || 5)
  const { count, error: countError } = await supabaseAdmin.from('order_evidence').select('*', { count: 'exact', head: true }).eq('workshop_id', context.workshopId).eq('order_id', order.id)
  databaseError(countError)
  if ((count || 0) + files.length > evidenceLimit) {
    throw Object.assign(new Error(`El plan ${plan.name} permite hasta ${evidenceLimit} fotos por orden. Mejora tu plan para guardar más evidencias.`), { status: 409, code: 'PLAN_LIMIT' })
  }
  const uploaded = []
  try {
    for (const [index, file] of files.entries()) {
      const extension = (file.originalname.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      const storagePath = `${context.workshopId}/${order.id}/${Date.now()}-${index}.${extension}`
      const upload = await supabaseAdmin.storage.from(bucket).upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false })
      databaseError(upload.error, 'No fue posible subir una fotografía')
      uploaded.push({ storagePath, originalname: file.originalname })
    }
    const { data, error } = await supabaseAdmin.from('order_evidence').insert(uploaded.map(item => ({
      workshop_id: context.workshopId, order_id: order.id, author_user_id: context.id,
      phase: PHASE_TO_DB[type] || 'process', storage_path: item.storagePath, caption,
    }))).select()
    databaseError(error)
    const urls = await signedEvidenceUrls(data)
    return data.map((item, index) => ({ id: item.id, url: urls.get(item.storage_path), name: uploaded[index].originalname, type: PHASE_FROM_DB[item.phase], caption: item.caption || '', at: item.created_at, author: context.name, index }))
  } catch (error) {
    if (uploaded.length) await supabaseAdmin.storage.from(bucket).remove(uploaded.map(item => item.storagePath))
    throw error
  }
}

export async function updateSupabaseQuote(context, orderId, input) {
  const order = await getOrder(context, orderId)
  let { data: quote, error } = await supabaseAdmin.from('quotes').select('*').eq('order_id', order.id).eq('workshop_id', context.workshopId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  databaseError(error)
  const values = { status: QUOTE_TO_DB[input.status] || 'draft', tax_rate: Number(input.taxRate || 0), updated_at: new Date().toISOString() }
  if (quote) {
    const result = await supabaseAdmin.from('quotes').update(values).eq('id', quote.id).select().single(); databaseError(result.error); quote = result.data
    const removed = await supabaseAdmin.from('quote_items').delete().eq('quote_id', quote.id).eq('workshop_id', context.workshopId); databaseError(removed.error)
  } else {
    const result = await supabaseAdmin.from('quotes').insert({ workshop_id: context.workshopId, order_id: order.id, ...values }).select().single(); databaseError(result.error); quote = result.data
  }
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length) {
    const result = await supabaseAdmin.from('quote_items').insert(items.map(item => ({
      workshop_id: context.workshopId, quote_id: quote.id,
      kind: item.type === 'Repuesto' ? 'part' : item.type === 'Material' ? 'material' : 'service',
      description: item.name, quantity: Number(item.qty), unit_price_cop: Number(item.price),
    }))).select()
    databaseError(result.error)
    return mapQuote(quote, result.data)
  }
  return mapQuote(quote, [])
}

export async function createSupabaseExpense(context, input) {
  const amount = Number(input.amount || 0)
  if (!String(input.description || '').trim() || amount <= 0) throw Object.assign(new Error('Descripción y valor válido son obligatorios'), { status: 400 })
  const { data, error } = await supabaseAdmin.from('expenses').insert({ workshop_id: context.workshopId, expense_date: input.date || new Date().toISOString().slice(0, 10), category: input.category || 'Otros', description: String(input.description).trim(), amount_cop: amount }).select().single()
  databaseError(error)
  return { id: data.id, date: data.expense_date, category: data.category, description: data.description, amount: Number(data.amount_cop) }
}

export async function createSupabaseInvoice(context, input) {
  const order = await getOrder(context, input.orderId)
  const number = `FV-${String(Date.now()).slice(-6)}`
  const { data, error } = await supabaseAdmin.from('invoices').insert({ workshop_id: context.workshopId, order_id: order.id, number, status: 'paid', total_cop: Number(input.total || 0), next_maintenance_at: input.nextMaintenance || null }).select().single()
  databaseError(error)
  return { id: data.number, orderId: input.orderId, customer: input.customer, date: data.created_at.slice(0, 10), total: Number(data.total_cop), status: 'Pagada', nextMaintenance: data.next_maintenance_at || '' }
}

export async function subscriptionSupabase(context) {
  const startOfMonth = new Date(); startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0)
  const [{ data: subscription, error }, { data: payments, error: paymentError }, usersResult, ordersResult] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').eq('workshop_id', context.workshopId).maybeSingle(),
    supabaseAdmin.from('payment_transactions').select('*').eq('workshop_id', context.workshopId).order('created_at', { ascending: false }).limit(10),
    supabaseAdmin.from('memberships').select('*', { count: 'exact', head: true }).eq('workshop_id', context.workshopId).eq('active', true),
    supabaseAdmin.from('work_orders').select('*', { count: 'exact', head: true }).eq('workshop_id', context.workshopId).gte('created_at', startOfMonth.toISOString()),
  ])
  databaseError(error)
  databaseError(paymentError)
  databaseError(usersResult.error); databaseError(ordersResult.error)
  return {
    subscription: subscription ? { planId: subscription.plan_id, status: subscription.status, billingPeriod: subscription.billing_period, currentPeriodStartsAt: subscription.current_period_starts_at, currentPeriodEndsAt: subscription.current_period_ends_at } : null,
    usage: { users: usersResult.count || 0, monthlyOrders: ordersResult.count || 0 },
    recentPayments: (payments || []).map(item => ({ id: item.id, reference: item.reference, planId: subscription?.plan_id, billingPeriod: item.billing_period, amountInCents: Number(item.amount_in_cents), currency: item.currency, status: item.status, createdAt: item.created_at })),
  }
}

export async function createSupabasePayment(context, plan, billingPeriod, reference, amountInCents) {
  const { data: subscription, error } = await supabaseAdmin.from('subscriptions').upsert({ workshop_id: context.workshopId, plan_id: plan.id, billing_period: billingPeriod, status: 'pending', provider: 'wompi', updated_at: new Date().toISOString() }, { onConflict: 'workshop_id' }).select().single()
  databaseError(error)
  const { data, error: paymentError } = await supabaseAdmin.from('payment_transactions').insert({ workshop_id: context.workshopId, subscription_id: subscription.id, reference, amount_in_cents: amountInCents, currency: 'COP', status: 'PENDING', billing_period: billingPeriod }).select().single()
  databaseError(paymentError)
  return { id: data.id, reference, planId: plan.id, billingPeriod, amountInCents, currency: 'COP', status: data.status, createdAt: data.created_at }
}

export async function processSupabaseWompiEvent(event) {
  const transaction = event?.data?.transaction
  if (!transaction?.reference) return null
  const { data: payment, error } = await supabaseAdmin.from('payment_transactions').select('*').eq('reference', transaction.reference).maybeSingle()
  databaseError(error)
  if (!payment) return null
  const updates = { provider_transaction_id: transaction.id || payment.provider_transaction_id, status: transaction.status || payment.status, raw_event: event, updated_at: new Date().toISOString() }
  if (transaction.status === 'APPROVED') updates.paid_at = payment.paid_at || new Date().toISOString()
  const updated = await supabaseAdmin.from('payment_transactions').update(updates).eq('id', payment.id); databaseError(updated.error)
  if (transaction.status === 'APPROVED') {
    const days = payment.billing_period === 'annual' ? 365 : 30
    const starts = new Date(), ends = new Date(Date.now() + days * 86400000)
    const subscription = await supabaseAdmin.from('subscriptions').update({ status: 'active', current_period_starts_at: starts.toISOString(), current_period_ends_at: ends.toISOString(), updated_at: starts.toISOString() }).eq('id', payment.subscription_id)
    databaseError(subscription.error)
  }
  return payment
}

async function seedInitialWorkshop(workshopId, ownerId) {
  const customerResult = await supabaseAdmin.from('customers').upsert([
    { workshop_id: workshopId, kind: 'person', document_type: 'CC', document_number: '78945231', name: 'Carlos Ramírez', phone: '3004567890', email: 'carlos@example.com', address: 'Montería, Córdoba' },
    { workshop_id: workshopId, kind: 'company', document_type: 'NIT', document_number: '901335421-8', name: 'Transportes del Sinú SAS', phone: '3126428820', email: 'operaciones@transportessinu.co', address: 'Cereté, Córdoba' },
  ], { onConflict: 'workshop_id,document_number' }).select()
  databaseError(customerResult.error)
  const carlos = customerResult.data.find(customer => customer.document_number === '78945231')
  const transportes = customerResult.data.find(customer => customer.document_number === '901335421-8')
  const vehicleResult = await supabaseAdmin.from('vehicles').upsert([
    { workshop_id: workshopId, customer_id: carlos.id, plate: 'JTU427', brand: 'Mazda', model: 'CX-30 Touring', model_year: 2022, color: 'Gris metálico', mileage: 48320 },
    { workshop_id: workshopId, customer_id: transportes.id, plate: 'WMN521', brand: 'Chevrolet', model: 'NHR', model_year: 2021, color: 'Blanco', mileage: 114200 },
  ], { onConflict: 'workshop_id,plate' }).select()
  databaseError(vehicleResult.error)
  const mazda = vehicleResult.data.find(vehicle => vehicle.plate === 'JTU427')
  const nhr = vehicleResult.data.find(vehicle => vehicle.plate === 'WMN521')
  const { count: orderCount, error: orderCountError } = await supabaseAdmin.from('work_orders').select('*', { count: 'exact', head: true }).eq('workshop_id', workshopId)
  databaseError(orderCountError)
  if (orderCount) return
  const orderResult = await supabaseAdmin.from('work_orders').insert([
    { workshop_id: workshopId, customer_id: carlos.id, vehicle_id: mazda.id, assigned_user_id: ownerId, service_area: 'Mecánica general', stage: 'Diagnóstico', progress: 26, reason: 'Vibración al frenar y revisión preventiva.', mileage: 48320, fuel_level: '½ tanque', received_items: 'Llave + documentos', affected_areas: [] },
    { workshop_id: workshopId, customer_id: transportes.id, vehicle_id: nhr.id, assigned_user_id: ownerId, service_area: 'Latonería y pintura', stage: 'Control de calidad', progress: 88, reason: 'Reparación de golpe lateral y pintura.', mileage: 114200, fuel_level: '¼ tanque', received_items: 'Llave', affected_areas: ['Puerta derecha', 'Guardabarros delantero'], paint_color: 'Blanco' },
  ]).select()
  databaseError(orderResult.error)
  const [mechanicOrder] = orderResult.data
  const quoteResult = await supabaseAdmin.from('quotes').insert({ workshop_id: workshopId, order_id: mechanicOrder.id, status: 'approved', tax_rate: 19 }).select().single()
  databaseError(quoteResult.error)
  const itemsResult = await supabaseAdmin.from('quote_items').insert([
    { workshop_id: workshopId, quote_id: quoteResult.data.id, kind: 'part', description: 'Juego de pastillas delanteras', quantity: 1, unit_price_cop: 420000 },
    { workshop_id: workshopId, quote_id: quoteResult.data.id, kind: 'service', description: 'Mano de obra sistema de frenos', quantity: 1, unit_price_cop: 260000 },
  ])
  databaseError(itemsResult.error)
  const noteResult = await supabaseAdmin.from('order_notes').insert({ workshop_id: workshopId, order_id: mechanicOrder.id, author_user_id: ownerId, audience: 'both', body: 'Se confirma desgaste irregular en las pastillas delanteras.' })
  databaseError(noteResult.error)
  const expenseResult = await supabaseAdmin.from('expenses').insert({ workshop_id: workshopId, category: 'Servicios externos', description: 'Rectificación de discos', amount_cop: 520000 })
  databaseError(expenseResult.error)
}

export async function initializeSupabaseIfRequested() {
  if (!supabaseConfigured) return { configured: false, initialized: false }
  await syncPlanCatalog()
  const nit = process.env.INITIAL_WORKSHOP_NIT || '90234566'
  const email = (process.env.INITIAL_ADMIN_EMAIL || 'motorpro@gmail.com').toLowerCase()
  const fullName = process.env.INITIAL_ADMIN_NAME || 'Administrador Taller Motor Pro'
  let { data: workshop, error } = await supabaseAdmin.from('workshops').select('*').eq('nit', nit).maybeSingle()
  databaseError(error)
  if (workshop) {
    const { data: owner, error: ownerError } = await supabaseAdmin.from('memberships').select('id,user_id').eq('workshop_id', workshop.id).eq('role', 'owner').eq('active', true).limit(1).maybeSingle()
    databaseError(ownerError)
    if (owner) {
      await seedInitialWorkshop(workshop.id, owner.user_id)
      return { configured: true, initialized: true, workshopId: workshop.id }
    }
  }

  const password = process.env.INITIAL_ADMIN_PASSWORD
  if (!password) return { configured: true, initialized: false, reason: 'INITIAL_ADMIN_PASSWORD pendiente' }
  if (password.length < 12) throw new Error('INITIAL_ADMIN_PASSWORD debe tener mínimo 12 caracteres')

  const usersResult = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  databaseError(usersResult.error)
  let authUser = usersResult.data.users.find(user => user.email?.toLowerCase() === email)
  let createdUser = false, createdWorkshop = false
  if (!authUser) {
    const createdAuth = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
    databaseError(createdAuth.error); authUser = createdAuth.data.user; createdUser = true
  } else {
    const updatedAuth = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password, email_confirm: true, user_metadata: { ...authUser.user_metadata, full_name: fullName } })
    databaseError(updatedAuth.error); authUser = updatedAuth.data.user
  }

  try {
    if (!workshop) {
      const workshopResult = await supabaseAdmin.from('workshops').insert({ name: 'Taller Motor Pro', legal_name: 'Comercial automotor', nit, email, phone: '3002902939', whatsapp: '573002902939', address: 'Cra. 6 #32-4', city: 'Montería' }).select().single()
      databaseError(workshopResult.error); workshop = workshopResult.data; createdWorkshop = true
    }
    const profile = await supabaseAdmin.from('profiles').upsert({ id: authUser.id, full_name: fullName }, { onConflict: 'id' }); databaseError(profile.error)
    const membership = await supabaseAdmin.from('memberships').upsert({ workshop_id: workshop.id, user_id: authUser.id, role: 'owner', active: true }, { onConflict: 'workshop_id,user_id' }); databaseError(membership.error)
    const subscription = await supabaseAdmin.from('subscriptions').upsert({ workshop_id: workshop.id, plan_id: 'profesional', status: 'trialing', billing_period: 'monthly', provider: 'wompi', updated_at: new Date().toISOString() }, { onConflict: 'workshop_id' }); databaseError(subscription.error)
    await seedInitialWorkshop(workshop.id, authUser.id)
    return { configured: true, initialized: true, workshopId: workshop.id, ownerCreated: true }
  } catch (setupError) {
    if (createdWorkshop) await supabaseAdmin.from('workshops').delete().eq('id', workshop.id)
    if (createdUser) await supabaseAdmin.auth.admin.deleteUser(authUser.id)
    throw setupError
  }
}
