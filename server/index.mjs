import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDb, id, readDb, resetDb, updateDb } from './db.mjs'
import { PLANS, findPlan, planAmount } from './plans.mjs'
import { WOMPI_CHECKOUT_URL, integritySignature, paymentReference, verifyWompiEvent } from './wompi.mjs'
import { BRAND } from './brand.mjs'
import { initializeSupabaseIfRequested, supabaseConfigured } from './supabase.mjs'
import { createSupabaseRouter } from './supabase-router.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here,'..')
const uploadDir = path.join(here,'uploads')
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'
const DEMO_JWT_SECRET = 'local-demo-only-secret-change-before-production'
const JWT_SECRET = process.env.JWT_SECRET || DEMO_JWT_SECRET
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'
const app = express()
if(IS_PRODUCTION&&!supabaseConfigured&&JWT_SECRET===DEMO_JWT_SECRET)throw new Error('JWT_SECRET seguro es obligatorio en producción')
const supabaseSetup=supabaseConfigured?await initializeSupabaseIfRequested():null
if(!supabaseConfigured){await ensureDb();await fsp.mkdir(uploadDir,{recursive:true})}

app.disable('x-powered-by')
if(IS_PRODUCTION)app.set('trust proxy',1)
app.use(helmet({
  crossOriginResourcePolicy:{policy:'cross-origin'},
  contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],
    fontSrc:["'self'",'https://fonts.gstatic.com','data:'],imgSrc:["'self'",'data:','blob:','https:'],
    connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'self'"],frameAncestors:["'none'"],
  }},
}))
app.use(express.json({limit:'12mb'}))
app.use('/uploads',express.static(uploadDir))

if(supabaseConfigured){
  app.use(createSupabaseRouter({appBaseUrl:APP_BASE_URL,isProduction:IS_PRODUCTION,setupState:supabaseSetup}))
  console.log(`Supabase conectado (${supabaseSetup?.initialized?'taller inicializado':'falta INITIAL_ADMIN_PASSWORD'})`)
}

const upload = multer({storage:multer.diskStorage({destination:uploadDir,filename:(_req,file,cb)=>cb(null,`${Date.now()}-${Math.random().toString(36).slice(2,7)}${path.extname(file.originalname).toLowerCase()}`)}),limits:{fileSize:10*1024*1024,files:8},fileFilter:(_req,file,cb)=>cb(null,file.mimetype.startsWith('image/'))})

const clients = new Set()
function broadcast(type,data){const msg=`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of clients)res.write(msg)}

function auth(req,res,next){
  const token=req.headers.authorization?.replace(/^Bearer\s+/,'')
  try{req.user=jwt.verify(token,JWT_SECRET);next()}catch{return res.status(401).json({error:'Sesión no válida o vencida'})}
}
const asyncRoute=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.'}})
const apiLimiter=rateLimit({windowMs:15*60*1000,limit:500,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Límite temporal de solicitudes alcanzado.'}})
const adminOnly=(req,res,next)=>['Administrador','Propietario'].includes(req.user?.role)?next():res.status(403).json({error:'Esta acción requiere rol de administrador'})
const assignableRoles=new Set(['Propietario','Administrador','Técnico'])
const notificationTypes=new Set(['order.created','order.updated','order.assigned','order.stage.updated','order.quote.updated','order.note.created','order.evidence.created'])
function localBootstrap(db,user){
  const {users,paymentTransactions,notificationReads,...safe}=db
  const isAdmin=['Administrador','Propietario'].includes(user.role),readAt=notificationReads?.[user.id]||''
  const orders=new Map(db.orders.map(order=>[order.id,order]))
  const notifications=isAdmin?(db.activity||[]).filter(item=>notificationTypes.has(item.type)).slice(0,80).map(item=>{
    const order=orders.get(item.orderId),kind=item.type==='order.created'?'created':item.type==='order.assigned'?'assigned':item.type==='order.stage.updated'?'stage':'updated'
    const title=kind==='created'?`Nueva orden ${item.orderId}`:kind==='assigned'?`Orden asignada · ${item.orderId}`:kind==='stage'?`Cambio de estado · ${item.orderId}`:`Orden modificada · ${item.orderId}`
    return {id:item.id,type:kind,title,message:item.message||item.event||`${order?.plate||'Vehículo'} · ${order?.stage||'En proceso'}`,at:item.at,orderId:item.orderId,unread:!readAt||item.at>readAt}
  }):[]
  return {...safe,currentUser:{id:user.id,name:user.name,email:user.email,role:user.role},operators:users.filter(item=>assignableRoles.has(item.role)).map(({passwordHash,...item})=>item),notifications,unreadNotifications:notifications.filter(item=>item.unread).length}
}

app.get('/api/health',(_req,res)=>res.json({ok:true,service:`${BRAND.name} API`,time:new Date().toISOString()}))
app.get('/api/public/plans',(_req,res)=>res.json(PLANS))
app.post('/api/auth/login',loginLimiter,asyncRoute(async(req,res)=>{
  const {email,password}=req.body||{};const db=await readDb();const user=db.users.find(u=>u.email.toLowerCase()===String(email||'').toLowerCase())
  if(!user||!await bcrypt.compare(String(password||''),user.passwordHash))return res.status(401).json({error:'Correo o contraseña incorrectos'})
  const safe={id:user.id,name:user.name,email:user.email,role:user.role};res.json({token:jwt.sign(safe,JWT_SECRET,{expiresIn:'12h'}),user:safe})
}))
app.post('/api/auth/register',loginLimiter,(_req,res)=>res.status(503).json({error:'El registro de talleres requiere la conexión con Supabase'}))
app.post('/api/auth/forgot-password',loginLimiter,(_req,res)=>res.status(503).json({error:'La recuperación de contraseña requiere la conexión con Supabase'}))
app.post('/api/auth/update-password',loginLimiter,(_req,res)=>res.status(503).json({error:'La recuperación de contraseña requiere la conexión con Supabase'}))
app.get('/api/events',(req,res)=>{const token=req.query.token;try{jwt.verify(token,JWT_SECRET)}catch{return res.status(401).end()}res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();res.write('event: connected\ndata: {"ok":true}\n\n');clients.add(res);req.on('close',()=>clients.delete(res))})

app.post('/api/webhooks/wompi',asyncRoute(async(req,res)=>{
  const secret=process.env.WOMPI_EVENTS_SECRET||''
  if(!verifyWompiEvent(req.body,secret,req.get('X-Event-Checksum')))return res.status(401).json({error:'Firma de evento Wompi no válida'})
  const transaction=req.body?.data?.transaction
  if(!transaction?.reference)return res.status(200).json({received:true,ignored:true})
  await updateDb(db=>{
    db.paymentTransactions=db.paymentTransactions||[]
    const payment=db.paymentTransactions.find(item=>item.reference===transaction.reference)
    if(!payment)return
    payment.providerTransactionId=transaction.id||payment.providerTransactionId
    payment.status=transaction.status||payment.status
    payment.updatedAt=new Date().toISOString()
    payment.lastEventId=req.body?.data?.transaction?.id
    if(transaction.status==='APPROVED'){
      const days=payment.billingPeriod==='annual'?365:30
      payment.paidAt=payment.paidAt||new Date().toISOString()
      db.subscription={...db.subscription,planId:payment.planId,billingPeriod:payment.billingPeriod,status:'active',currentPeriodStartsAt:new Date().toISOString(),currentPeriodEndsAt:new Date(Date.now()+days*86400000).toISOString()}
    }
  })
  broadcast('subscription.updated',{reference:transaction.reference,status:transaction.status})
  res.json({received:true})
}))

app.use('/api',apiLimiter,auth)
app.get('/api/bootstrap',asyncRoute(async(req,res)=>{const db=await readDb();res.json(localBootstrap(db,req.user))}))
app.post('/api/reset',asyncRoute(async(req,res)=>{for(const file of await fsp.readdir(uploadDir)){if(file!=='.gitkeep')await fsp.unlink(path.join(uploadDir,file))}const db=await resetDb();broadcast('reset',{at:new Date().toISOString()});res.json(localBootstrap(db,req.user))}))

app.post('/api/notifications/read',adminOnly,asyncRoute(async(req,res)=>{const readAt=new Date().toISOString();await updateDb(db=>{db.notificationReads=db.notificationReads||{};db.notificationReads[req.user.id]=readAt});res.json({readAt})}))
app.post('/api/locations',adminOnly,asyncRoute(async(req,res)=>{
  const name=String(req.body?.name||'').trim(),address=String(req.body?.address||'').trim(),city=String(req.body?.city||'').trim(),phone=String(req.body?.phone||'').trim()
  if(name.length<3||city.length<2)return res.status(400).json({error:'Nombre de la sede y ciudad son obligatorios'})
  const location=await updateDb(db=>{const plan=findPlan(db.subscription?.planId)||PLANS[0],locations=db.locations||[],limit=Number(plan.limits.locations||1);if(locations.length>=limit)throw Object.assign(new Error(`El plan ${plan.name} permite ${limit} sede${limit===1?'':'s'}. Mejora al plan Empresarial para ampliar esta capacidad.`),{status:409});if(locations.some(item=>item.name.toLowerCase()===name.toLowerCase()))throw Object.assign(new Error('Ya existe una sede con ese nombre'),{status:409});const item={id:id('loc'),name,address,city,phone,isMain:false,createdAt:new Date().toISOString()};locations.push(item);db.locations=locations;return item})
  broadcast('location.created',location);res.status(201).json(location)
}))

app.get('/api/users',adminOnly,asyncRoute(async(_req,res)=>{const db=await readDb();res.json(db.users.map(({passwordHash,...user})=>user))}))
app.post('/api/users',adminOnly,asyncRoute(async(req,res)=>{
  const name=String(req.body?.name||'').trim(),email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||''),role=String(req.body?.role||'Técnico')
  const allowedRoles=['Administrador','Asesor','Técnico','Contador','Consulta']
  if(name.length<3||!/^\S+@\S+\.\S+$/.test(email)||password.length<10||!allowedRoles.includes(role))return res.status(400).json({error:'Nombre, correo válido, rol y contraseña de mínimo 10 caracteres son obligatorios'})
  const created=await updateDb(async db=>{
    if(db.users.some(user=>user.email.toLowerCase()===email))throw Object.assign(new Error('Ya existe un usuario con ese correo'),{status:409})
    const plan=findPlan(db.subscription?.planId)||PLANS[0]
    if(db.users.length>=plan.limits.users)throw Object.assign(new Error(`El plan ${plan.name} permite hasta ${plan.limits.users} usuarios`),{status:409})
    const user={id:id('usr'),name,email,passwordHash:await bcrypt.hash(password,12),role,createdAt:new Date().toISOString()}
    db.users.push(user);db.activity.unshift({id:id('act'),type:'user.created',userId:user.id,at:new Date().toISOString(),author:req.user.name})
    const {passwordHash,...safe}=user;return safe
  })
  res.status(201).json(created)
}))

app.get('/api/billing/subscription',adminOnly,asyncRoute(async(_req,res)=>{
  const db=await readDb(),month=new Date().toISOString().slice(0,7);res.json({subscription:db.subscription,plan:findPlan(db.subscription?.planId)||null,usage:{users:db.users.length,monthlyOrders:db.orders.filter(order=>String(order.createdAt||'').startsWith(month)).length},recentPayments:(db.paymentTransactions||[]).slice(0,10)})
}))
app.post('/api/billing/checkout',adminOnly,asyncRoute(async(req,res)=>{
  const plan=findPlan(String(req.body?.planId||'')),billingPeriod=req.body?.billingPeriod==='annual'?'annual':'monthly'
  if(!plan||plan.monthlyPrice===0)return res.status(400).json({error:'Selecciona un plan de pago válido'})
  const db=await readDb(),reference=paymentReference(db.workshop.id||'motorpro',plan.id),amountInCents=planAmount(plan,billingPeriod)*100,currency='COP'
  const payment={id:id('pay'),reference,planId:plan.id,billingPeriod,amountInCents,currency,status:'PENDING',createdAt:new Date().toISOString()}
  await updateDb(data=>{data.paymentTransactions=data.paymentTransactions||[];data.paymentTransactions.unshift(payment);data.subscription={...data.subscription,planId:plan.id,billingPeriod,status:'pending'}})
  const publicKey=process.env.WOMPI_PUBLIC_KEY,integritySecret=process.env.WOMPI_INTEGRITY_SECRET
  if(!publicKey||!integritySecret)return res.json({mode:'demo',reference,payment,message:'Wompi aún no está configurado; puedes simular la aprobación para la demostración.'})
  const signature=integritySignature(reference,amountInCents,currency,integritySecret)
  const params=new URLSearchParams({'public-key':publicKey,currency,'amount-in-cents':String(amountInCents),reference,'signature:integrity':signature,'redirect-url':process.env.WOMPI_REDIRECT_URL||`${APP_BASE_URL}/?payment=return`})
  res.json({mode:'wompi',reference,payment,checkoutUrl:`${WOMPI_CHECKOUT_URL}?${params}`})
}))
app.post('/api/billing/demo-confirm',adminOnly,asyncRoute(async(req,res)=>{
  if(IS_PRODUCTION)return res.status(404).json({error:'La simulación de pagos está deshabilitada en producción'})
  const reference=String(req.body?.reference||'')
  const subscription=await updateDb(db=>{
    const payment=(db.paymentTransactions||[]).find(item=>item.reference===reference)
    if(!payment)throw Object.assign(new Error('Pago de demostración no encontrado'),{status:404})
    const days=payment.billingPeriod==='annual'?365:30;payment.status='APPROVED';payment.paidAt=new Date().toISOString()
    db.subscription={...db.subscription,planId:payment.planId,billingPeriod:payment.billingPeriod,status:'active',currentPeriodStartsAt:new Date().toISOString(),currentPeriodEndsAt:new Date(Date.now()+days*86400000).toISOString()}
    return db.subscription
  })
  broadcast('subscription.updated',subscription);res.json(subscription)
}))

app.post('/api/customers',asyncRoute(async(req,res)=>{
  const customer={id:id('cli'),type:'Persona natural',documentType:'CC',vehicles:[],...req.body,createdAt:new Date().toISOString()}
  if(!customer.name||!customer.document||!customer.phone)return res.status(400).json({error:'Nombre, documento y teléfono son obligatorios'})
  const created=await updateDb(db=>{if(db.customers.some(c=>c.document===customer.document))throw Object.assign(new Error('Ya existe un cliente con ese documento'),{status:409});db.customers.unshift(customer);return customer})
  broadcast('customer.created',created);res.status(201).json(created)
}))
app.put('/api/customers/:id',asyncRoute(async(req,res)=>{const updated=await updateDb(db=>{const i=db.customers.findIndex(c=>c.id===req.params.id);if(i<0)throw Object.assign(new Error('Cliente no encontrado'),{status:404});db.customers[i]={...db.customers[i],...req.body,id:req.params.id};return db.customers[i]});broadcast('customer.updated',updated);res.json(updated)}))
app.delete('/api/customers/:id',asyncRoute(async(req,res)=>{await updateDb(db=>{if(db.orders.some(o=>o.customerId===req.params.id))throw Object.assign(new Error('El cliente tiene órdenes asociadas'),{status:409});db.customers=db.customers.filter(c=>c.id!==req.params.id)});res.status(204).end()}))

app.post('/api/orders',asyncRoute(async(req,res)=>{
  const db=await readDb();const customer=db.customers.find(c=>c.id===req.body.customerId);if(!customer)return res.status(400).json({error:'Selecciona un cliente válido'})
  const plan=findPlan(db.subscription?.planId)||PLANS[0],month=new Date().toISOString().slice(0,7),monthlyOrders=db.orders.filter(order=>String(order.createdAt||'').startsWith(month)).length
  if(monthlyOrders>=plan.limits.monthlyOrders)return res.status(409).json({error:`El plan ${plan.name} alcanzó el límite de ${plan.limits.monthlyOrders} órdenes del mes`})
  const vehicle=customer.vehicles.find(v=>v.id===req.body.vehicleId)||customer.vehicles[0]
  const operator=db.users.find(user=>user.id===req.body.techId&&assignableRoles.has(user.role));if(!operator)return res.status(400).json({error:'Selecciona un operario responsable para crear la orden'})
  const location=(db.locations||[]).find(item=>item.id===req.body.locationId)||(db.locations||[])[0];if(!location)return res.status(400).json({error:'Selecciona una sede válida'})
  const seq=Math.max(248,...db.orders.map(o=>Number(String(o.id).replace(/\D/g,''))||0))+1
  const arrivalContact=String(req.body.arrivalContact||'').trim().slice(0,180),createdAt=new Date().toISOString()
  const order={id:`OT-${String(seq).padStart(4,'0')}`,customerId:customer.id,vehicleId:vehicle?.id,locationId:location.id,customer:customer.name,phone:customer.phone,car:vehicle?`${vehicle.brand} ${vehicle.model} ${vehicle.year}`:'Vehículo por completar',plate:vehicle?.plate||req.body.plate||'S/P',serviceArea:req.body.serviceArea||'Mecánica general',affectedAreas:req.body.affectedAreas||[],paintColor:req.body.paintColor||'',techId:operator.id,tech:operator.name,stage:'Ingreso',progress:8,value:0,delivery:req.body.delivery||'Por programar',color:'#f05a37',mileage:Number(req.body.mileage||vehicle?.mileage||0),fuel:req.body.fuel||'Por registrar',receivedItems:req.body.receivedItems||'Llave',reason:req.body.reason||'',diagnosis:'',finalDiagnosis:'',arrivalContact,deliveryContact:'',notes:[],evidence:[],quote:{status:'Borrador',taxRate:19,items:[]},createdAt,history:[{id:id('his'),event:'Orden creada y recepción registrada',at:createdAt,author:req.user.name},{id:id('his'),event:`Orden asignada a ${operator.name}`,at:createdAt,author:req.user.name},...(arrivalContact?[{id:id('his'),event:`Vehículo entregado al taller por: ${arrivalContact}`,at:createdAt,author:req.user.name}]:[])]}
  await updateDb(d=>{d.orders.unshift(order);d.activity.unshift({id:id('act'),type:'order.created',orderId:order.id,at:createdAt,message:`${order.plate} · ${order.stage} · ${location.name}`},{id:id('act'),type:'order.assigned',orderId:order.id,at:createdAt,message:`${order.plate} fue asignado a ${operator.name}`});return order});broadcast('order.created',order);res.status(201).json(order)
}))
app.put('/api/orders/:id',asyncRoute(async(req,res)=>{const updated=await updateDb(db=>{
  const i=db.orders.findIndex(o=>o.id===req.params.id);if(i<0)throw Object.assign(new Error('Orden no encontrada'),{status:404})
  const before=db.orders[i],arrivalContact=req.body.arrivalContact===undefined?before.arrivalContact:String(req.body.arrivalContact||'').trim().slice(0,180),deliveryContact=req.body.deliveryContact===undefined?before.deliveryContact:String(req.body.deliveryContact||'').trim().slice(0,180)
  const operator=req.body.techId===undefined?null:db.users.find(user=>user.id===req.body.techId&&assignableRoles.has(user.role));if(req.body.techId!==undefined&&!operator)throw Object.assign(new Error('Selecciona un operario válido'),{status:400})
  db.orders[i]={...before,...req.body,...(operator?{techId:operator.id,tech:operator.name}:{}),arrivalContact,deliveryContact,id:before.id}
  const at=new Date().toISOString()
  if(req.body.stage&&req.body.stage!==before.stage){const event=`Orden avanzó a ${req.body.stage}`;db.orders[i].history.push({id:id('his'),event,at,author:req.user.name});db.activity.unshift({id:id('act'),type:'order.stage.updated',orderId:before.id,at,message:`${before.plate} · ${event}`})}
  const assignedChanged=Boolean(operator&&operator.id!==before.techId)
  if(assignedChanged){const event=`Orden asignada a ${operator.name}`;db.orders[i].history.push({id:id('his'),event,at,author:req.user.name});db.activity.unshift({id:id('act'),type:'order.assigned',orderId:before.id,at,message:`${before.plate} · ${event}`})}
  if(arrivalContact!==(before.arrivalContact||''))db.orders[i].history.push({id:id('his'),event:arrivalContact?`Vehículo entregado al taller por: ${arrivalContact}`:'Se eliminó el registro de quien entregó el vehículo',at,author:req.user.name})
  if(deliveryContact!==(before.deliveryContact||''))db.orders[i].history.push({id:id('his'),event:deliveryContact?`Vehículo retirado del taller por: ${deliveryContact}`:'Se eliminó el registro de quien retiró el vehículo',at,author:req.user.name})
  if(!(req.body.stage&&req.body.stage!==before.stage)&&!assignedChanged)db.activity.unshift({id:id('act'),type:'order.updated',orderId:before.id,at,message:`${before.plate} · Orden modificada por ${req.user.name}`})
  return db.orders[i]
});broadcast('order.updated',updated);res.json(updated)}))
app.post('/api/orders/:id/notes',asyncRoute(async(req,res)=>{if(!String(req.body.text||'').trim())return res.status(400).json({error:'La nota está vacía'});const note={id:id('not'),author:req.user.name,role:req.user.role,at:new Date().toISOString(),text:String(req.body.text).trim()};await updateDb(db=>{const order=db.orders.find(o=>o.id===req.params.id);if(!order)throw Object.assign(new Error('Orden no encontrada'),{status:404});order.notes.push(note);db.activity.unshift({id:id('act'),type:'order.note.created',orderId:order.id,at:note.at,message:`${order.plate} · Nueva nota de ${req.user.name}`})});broadcast('order.note',{orderId:req.params.id,note});res.status(201).json(note)}))
app.post('/api/orders/:id/evidence',upload.array('files',8),asyncRoute(async(req,res)=>{
  const files=req.files||[],db=await readDb(),order=db.orders.find(o=>o.id===req.params.id)
  if(!order)return res.status(404).json({error:'Orden no encontrada'})
  const plan=findPlan(db.subscription?.planId)||PLANS[0],limit=Number(plan.limits.evidencePerOrder||5)
  if(order.evidence.length+files.length>limit){await Promise.all(files.map(file=>fsp.unlink(file.path).catch(()=>{})));return res.status(409).json({error:`El plan ${plan.name} permite hasta ${limit} fotos por orden. Mejora tu plan para guardar más evidencias.`})}
  const items=files.map((f,index)=>({id:id('ev'),url:`/uploads/${f.filename}`,name:f.originalname,type:req.body.type||'Proceso',caption:req.body.caption||'',at:new Date().toISOString(),author:req.user.name,index}))
  await updateDb(data=>{const current=data.orders.find(o=>o.id===req.params.id);if(!current)throw Object.assign(new Error('Orden no encontrada'),{status:404});current.evidence.push(...items);data.activity.unshift({id:id('act'),type:'order.evidence.created',orderId:current.id,at:new Date().toISOString(),message:`${current.plate} · Se agregaron ${items.length} evidencias`})})
  broadcast('order.evidence',{orderId:req.params.id,items});res.status(201).json(items)
}))
app.put('/api/orders/:id/quote',asyncRoute(async(req,res)=>{const quote=await updateDb(db=>{const order=db.orders.find(o=>o.id===req.params.id);if(!order)throw Object.assign(new Error('Orden no encontrada'),{status:404});order.quote={...order.quote,...req.body};const subtotal=order.quote.items.reduce((sum,x)=>sum+Number(x.qty)*Number(x.price),0);order.value=Math.round(subtotal*(1+Number(order.quote.taxRate||0)/100));db.activity.unshift({id:id('act'),type:'order.quote.updated',orderId:order.id,at:new Date().toISOString(),message:`${order.plate} · Cotización actualizada`});return order.quote});broadcast('order.quote',{orderId:req.params.id,quote});res.json(quote)}))

app.get('/api/orders/:id/quote.pdf',asyncRoute(async(req,res)=>{const db=await readDb();const order=db.orders.find(o=>o.id===req.params.id);if(!order)return res.status(404).json({error:'Orden no encontrada'});const doc=new PDFDocument({margin:48,size:'A4'});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="Cotizacion-${order.id}.pdf"`);doc.pipe(res);doc.fontSize(22).fillColor('#ef633f').text(db.workshop.name);doc.fontSize(9).fillColor('#596273').text(`NIT ${db.workshop.nit} · ${db.workshop.address} · ${db.workshop.phone}`);doc.moveDown(2);doc.fontSize(18).fillColor('#172237').text(`COTIZACIÓN ${order.id}`,{align:'right'});doc.moveDown();doc.fontSize(11).text(`Cliente: ${order.customer}`);doc.text(`Vehículo: ${order.car} · Placa ${order.plate}`);doc.text(`Fecha: ${new Date().toLocaleDateString('es-CO')}`);doc.moveDown();doc.fontSize(10).fillColor('#6d7788').text('DESCRIPCIÓN                                  CANT.      UNITARIO       TOTAL');doc.moveTo(48,190).lineTo(547,190).strokeColor('#dfe4e9').stroke();let y=205;for(const item of order.quote.items){doc.fillColor('#172237').text(item.name,48,y,{width:280});doc.text(String(item.qty),340,y);doc.text(formatMoney(item.price),380,y,{width:75,align:'right'});doc.text(formatMoney(item.qty*item.price),465,y,{width:82,align:'right'});y+=30}const subtotal=order.quote.items.reduce((s,x)=>s+x.qty*x.price,0),tax=Math.round(subtotal*(order.quote.taxRate||0)/100);doc.moveTo(330,y).lineTo(547,y).stroke();doc.text(`Subtotal: ${formatMoney(subtotal)}`,330,y+12,{width:217,align:'right'});doc.text(`IVA (${order.quote.taxRate||0}%): ${formatMoney(tax)}`,330,y+30,{width:217,align:'right'});doc.fontSize(13).fillColor('#ef633f').text(`TOTAL: ${formatMoney(subtotal+tax)}`,330,y+52,{width:217,align:'right'});doc.fontSize(9).fillColor('#6d7788').text('Garantía de 6 meses o 10.000 km sobre mano de obra. Esta cotización no representa control de inventario.',48,730,{width:499,align:'center'});doc.end()}))

app.post('/api/expenses',asyncRoute(async(req,res)=>{const expense={id:id('gas'),date:req.body.date||new Date().toISOString().slice(0,10),category:req.body.category||'Otros',description:req.body.description||'',amount:Number(req.body.amount||0)};if(!expense.description||expense.amount<=0)return res.status(400).json({error:'Descripción y valor válido son obligatorios'});await updateDb(db=>db.expenses.unshift(expense));broadcast('expense.created',expense);res.status(201).json(expense)}))
app.post('/api/invoices',asyncRoute(async(req,res)=>{const invoice={id:`FV-${String(Date.now()).slice(-5)}`,date:new Date().toISOString().slice(0,10),status:'Pagada',...req.body,total:Number(req.body.total||0)};await updateDb(db=>db.invoices.unshift(invoice));broadcast('invoice.created',invoice);res.status(201).json(invoice)}))
app.post('/api/orders/:id/whatsapp',asyncRoute(async(req,res)=>{const db=await readDb();const order=db.orders.find(o=>o.id===req.params.id);if(!order)return res.status(404).json({error:'Orden no encontrada'});const phone=order.phone.replace(/\D/g,'');const message=req.body.message||`Hola ${order.customer}, tu vehículo ${order.car} (${order.plate}) está en la etapa: ${order.stage}. Progreso: ${order.progress}%.`;await updateDb(d=>d.activity.unshift({id:id('act'),type:'whatsapp.opened',orderId:order.id,at:new Date().toISOString(),message}));res.json({url:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,message})}))

function formatMoney(value){return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(value)}
const dist=path.join(root,'dist');if(fs.existsSync(dist)){app.use(express.static(dist));app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')))}
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({error:err.message||'Error interno del servidor'})})
app.listen(PORT,HOST,()=>console.log(`${BRAND.name} API lista en http://${HOST}:${PORT}`))
