import { BRAND } from './brand'

const TOKEN_KEY = `${BRAND.slug}-token`
const LEGACY_TOKEN_KEYS = ['t360-token','t360-auth']

export const session = {
  token: () => {
    const current=localStorage.getItem(TOKEN_KEY)
    if(current)return current
    const legacy=LEGACY_TOKEN_KEYS.map(key=>localStorage.getItem(key)).find(Boolean)
    if(legacy){localStorage.setItem(TOKEN_KEY,legacy);LEGACY_TOKEN_KEYS.forEach(key=>localStorage.removeItem(key))}
    return legacy||null
  },
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => { localStorage.removeItem(TOKEN_KEY); LEGACY_TOKEN_KEYS.forEach(key=>localStorage.removeItem(key)) },
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(session.token() ? { Authorization: `Bearer ${session.token()}` } : {}),
      ...options.headers,
    },
  })
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) throw new Error(data?.error || data || 'No fue posible completar la operación')
  return data as T
}

export async function login(email: string, password: string) {
  const result = await request<{token:string;user:{id:string;name:string;email:string;role:string}}>('/api/auth/login', { method:'POST', body:JSON.stringify({email,password}) })
  session.set(result.token)
  return result
}

export const api = {
  plans: () => request<any[]>('/api/public/plans'),
  bootstrap: () => request<any>('/api/bootstrap'),
  reset: () => request<any>('/api/reset', {method:'POST'}),
  createCustomer: (data: unknown) => request<any>('/api/customers', {method:'POST',body:JSON.stringify(data)}),
  updateCustomer: (id:string,data:unknown) => request<any>(`/api/customers/${id}`, {method:'PUT',body:JSON.stringify(data)}),
  createOrder: (data: unknown) => request<any>('/api/orders', {method:'POST',body:JSON.stringify(data)}),
  updateOrder: (id:string,data:unknown) => request<any>(`/api/orders/${id}`, {method:'PUT',body:JSON.stringify(data)}),
  addNote: (id:string,text:string) => request<any>(`/api/orders/${id}/notes`, {method:'POST',body:JSON.stringify({text})}),
  updateQuote: (id:string,data:unknown) => request<any>(`/api/orders/${id}/quote`, {method:'PUT',body:JSON.stringify(data)}),
  whatsapp: (id:string,message?:string) => request<{url:string;message:string}>(`/api/orders/${id}/whatsapp`, {method:'POST',body:JSON.stringify({message})}),
  addExpense: (data:unknown) => request<any>('/api/expenses',{method:'POST',body:JSON.stringify(data)}),
  addInvoice: (data:unknown) => request<any>('/api/invoices',{method:'POST',body:JSON.stringify(data)}),
  users: () => request<any[]>('/api/users'),
  createUser: (data:unknown) => request<any>('/api/users',{method:'POST',body:JSON.stringify(data)}),
  subscription: () => request<any>('/api/billing/subscription'),
  checkout: (planId:string,billingPeriod:'monthly'|'annual') => request<any>('/api/billing/checkout',{method:'POST',body:JSON.stringify({planId,billingPeriod})}),
  confirmDemoPayment: (reference:string) => request<any>('/api/billing/demo-confirm',{method:'POST',body:JSON.stringify({reference})}),
  uploadEvidence: async (id:string,files:File[],type='Proceso') => {
    const form = new FormData(); files.forEach(file=>form.append('files',file)); form.append('type',type)
    return request<any[]>(`/api/orders/${id}/evidence`,{method:'POST',body:form})
  },
  downloadQuote: async (id:string) => {
    const response = await fetch(`/api/orders/${id}/quote.pdf`,{headers:{Authorization:`Bearer ${session.token()}`}})
    if(!response.ok) throw new Error('No fue posible generar el PDF')
    const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download=`Cotizacion-${id}.pdf`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  },
}

export function subscribe(onChange:()=>void){
  const token=session.token();if(!token)return()=>{}
  const source=new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
  ;['order.created','order.updated','order.note','order.evidence','customer.created','customer.updated','expense.created','invoice.created','subscription.updated','reset'].forEach(event=>source.addEventListener(event,onChange))
  return()=>source.close()
}
