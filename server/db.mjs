import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { PLANS } from './plans.mjs'
import { BRAND } from './brand.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, 'data')
const dbFile = path.join(dataDir, `${BRAND.slug}.json`)
const legacyDbFile = path.join(dataDir, 'taller360.json')

const now = () => new Date().toISOString()
export const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function seed() {
  const customers = [
    { id:'cli_carlos', type:'Persona natural', documentType:'CC', document:'78.945.231', name:'Carlos Ramírez', phone:'+57 300 456 7890', email:'carlos@example.com', address:'Montería, Córdoba', vehicles:[{id:'veh_mazda',plate:'JTU 427',brand:'Mazda',model:'CX-30 Touring',year:2022,color:'Gris metálico',mileage:48320}] },
    { id:'cli_mariana', type:'Persona natural', documentType:'CC', document:'1.067.821.440', name:'Mariana Torres', phone:'+57 315 220 1144', email:'mariana@example.com', address:'Montería, Córdoba', vehicles:[{id:'veh_duster',plate:'KLP 912',brand:'Renault',model:'Duster',year:2020,color:'Blanco',mileage:61120}] },
    { id:'cli_sinu', type:'Empresa', documentType:'NIT', document:'901.335.421-8', name:'Transportes del Sinú SAS', phone:'+57 312 642 8820', email:'operaciones@transportessinu.co', address:'Cereté, Córdoba', vehicles:[{id:'veh_nhr',plate:'WMN 521',brand:'Chevrolet',model:'NHR',year:2021,color:'Blanco',mileage:114200}] },
    { id:'cli_sofia', type:'Persona natural', documentType:'CC', document:'1.003.882.772', name:'Sofía Gómez', phone:'+57 301 994 3012', email:'sofia@example.com', address:'Montería, Córdoba', vehicles:[{id:'veh_kia',plate:'DQR 608',brand:'Kia',model:'Picanto',year:2019,color:'Rojo',mileage:73200}] },
  ]
  const makeOrder = (o) => ({ serviceArea:'Mecánica general', affectedAreas:[], paintColor:'', mileage:48320, fuel:'½ tanque', receivedItems:'Llave + documentos', reason:'Revisión general solicitada por el cliente.', diagnosis:'', finalDiagnosis:'', arrivalContact:'', deliveryContact:'', createdAt:now(), notes:[], evidence:[], history:[{id:id('his'),event:'Orden creada y recepción registrada',at:now(),author:'Laura Méndez'}], quote:{status:'Borrador',items:[],taxRate:19}, ...o })
  const orders = [
    makeOrder({id:'OT-0248',customerId:'cli_carlos',vehicleId:'veh_mazda',customer:'Carlos Ramírez',phone:'+57 300 456 7890',car:'Mazda CX-30 Touring 2022',plate:'JTU 427',tech:'Andrés López',stage:'Reparación',progress:64,value:1845000,delivery:'Hoy, 4:30 p. m.',color:'#f05a37',reason:'Vibración al frenar y revisión preventiva de los 50.000 km.',notes:[{id:'not_1',author:'Andrés López',role:'Técnico',at:now(),text:'Se confirma desgaste irregular en las pastillas delanteras. Los discos están dentro de tolerancia.'},{id:'not_2',author:'Carlos Ramírez',role:'Cliente',at:now(),text:'Por favor revisar también el ruido que se siente al girar hacia la derecha.'}],quote:{status:'Autorizada',taxRate:19,items:[{id:'q1',name:'Juego pastillas de freno delanteras',type:'Repuesto',qty:1,price:420000},{id:'q2',name:'Rectificación de discos delanteros',type:'Servicio',qty:2,price:130000},{id:'q3',name:'Mano de obra sistema de frenos',type:'Servicio',qty:1,price:260000},{id:'q4',name:'Mantenimiento preventivo 50.000 km',type:'Servicio',qty:1,price:540000}]}}),
    makeOrder({id:'OT-0247',customerId:'cli_mariana',vehicleId:'veh_duster',customer:'Mariana Torres',phone:'+57 315 220 1144',car:'Renault Duster 2020',plate:'KLP 912',tech:'Diego Pérez',stage:'Diagnóstico',progress:26,value:185000,delivery:'Mañana, 10:00 a. m.',color:'#657bdf'}),
    makeOrder({id:'OT-0246',serviceArea:'Latonería y pintura',affectedAreas:['Puerta derecha','Guardabarros delantero'],paintColor:'Blanco',customerId:'cli_sinu',vehicleId:'veh_nhr',customer:'Transportes del Sinú SAS',phone:'+57 312 642 8820',car:'Chevrolet NHR 2021',plate:'WMN 521',tech:'Andrés López',stage:'Control de calidad',progress:88,value:3260000,delivery:'Hoy, 2:00 p. m.',color:'#1bb58f'}),
    makeOrder({id:'OT-0245',serviceArea:'Electricidad automotriz',customerId:'cli_sofia',vehicleId:'veh_kia',customer:'Sofía Gómez',phone:'+57 301 994 3012',car:'Kia Picanto 2019',plate:'DQR 608',tech:'Camilo Ruiz',stage:'Autorización',progress:48,value:730000,delivery:'16 ago., 11:00 a. m.',color:'#e5a437'}),
  ]
  return {
    version:4,
    workshop:{id:'motorpro',name:'Taller Motor Pro',businessType:'Comercial',nit:'90234566',address:'Cra. 6 #32-4',city:'Montería',phone:'+57 300 290 2939',whatsapp:'573002902939',email:'motorpro@gmail.com'},
    users:[{id:'usr_admin',name:'Julián Sánchez',email:'motorpro@gmail.com',passwordHash:bcrypt.hashSync(BRAND.demoPassword,12),role:'Administrador'}],
    plans:PLANS,
    subscription:{planId:'profesional',status:'trialing',billingPeriod:'monthly',trialEndsAt:new Date(Date.now()+14*86400000).toISOString(),currentPeriodEndsAt:null},
    paymentTransactions:[],
    customers, orders,
    expenses:[{id:'gas_1',date:'2026-08-04',category:'Servicios externos',description:'Rectificación de discos',amount:520000},{id:'gas_2',date:'2026-08-06',category:'Servicios públicos',description:'Energía y agua',amount:685000}],
    invoices:[{id:'FV-0108',orderId:'OT-0244',customer:'Ricardo Martínez',date:'2026-08-07',total:920000,status:'Pagada',nextMaintenance:'2027-02-07'}],
    activity:[],
  }
}

export async function ensureDb() {
  await fs.mkdir(dataDir,{recursive:true})
  try { await fs.access(dbFile) } catch {
    try { await fs.rename(legacyDbFile,dbFile) } catch {}
  }
  try {
    const existing=JSON.parse(await fs.readFile(dbFile,'utf8'))
    let changed=false
    if((existing.version||1)<2){
      existing.version=2
      existing.workshop={id:'motorpro',...existing.workshop}
      existing.plans=PLANS
      existing.subscription=existing.subscription||{planId:'profesional',status:'trialing',billingPeriod:'monthly',trialEndsAt:new Date(Date.now()+14*86400000).toISOString(),currentPeriodEndsAt:null}
      existing.paymentTransactions=existing.paymentTransactions||[]
      changed=true
    }
    if((existing.version||1)<3){
      existing.version=3
      const demoAdmin=existing.users?.find(user=>user.email?.toLowerCase()==='motorpro@gmail.com')
      if(demoAdmin)demoAdmin.passwordHash=bcrypt.hashSync(BRAND.demoPassword,12)
      changed=true
    }
    if((existing.version||1)<4){
      existing.version=4
      for(const order of existing.orders||[]){
        order.diagnosis=order.diagnosis||''
        order.finalDiagnosis=order.finalDiagnosis||''
        order.arrivalContact=order.arrivalContact||''
        order.deliveryContact=order.deliveryContact||''
      }
      changed=true
    }
    if(changed)await fs.writeFile(dbFile,JSON.stringify(existing,null,2),'utf8')
  } catch { await fs.writeFile(dbFile,JSON.stringify(seed(),null,2),'utf8') }
}

export async function readDb() {
  await ensureDb()
  return JSON.parse(await fs.readFile(dbFile,'utf8'))
}

let queue = Promise.resolve()
export function updateDb(mutator) {
  const operation = queue.then(async()=>{
    const db = await readDb()
    const result = await mutator(db)
    const temp = `${dbFile}.tmp`
    await fs.writeFile(temp,JSON.stringify(db,null,2),'utf8')
    await fs.rename(temp,dbFile)
    return result
  })
  queue = operation.catch(()=>{})
  return operation
}

export async function resetDb(){
  await fs.mkdir(dataDir,{recursive:true})
  await fs.writeFile(dbFile,JSON.stringify(seed(),null,2),'utf8')
  return readDb()
}
