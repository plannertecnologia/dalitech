import { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef } from 'react'
import { supabase } from './supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// Módulos disponíveis no sistema (usados para controle de permissões)
const ALL_MODULES = [
  {id:'dash',label:'Dashboard',icon:'📊'},
  {id:'products',label:'Produtos',icon:'📦'},
  {id:'inventory',label:'Estoque',icon:'🗄️'},
  {id:'pdv',label:'Frente de Caixa',icon:'🛒'},
  {id:'sales',label:'Histórico Vendas',icon:'🛍️'},
  {id:'customers',label:'Clientes',icon:'👥'},
  {id:'suppliers',label:'Fornecedores',icon:'🏭'},
  {id:'cashflow',label:'Fluxo de Caixa',icon:'💰'},
  {id:'payable',label:'Contas a Pagar',icon:'📤'},
  {id:'receivable',label:'A Receber',icon:'📥'},
  {id:'settings',label:'Configurações',icon:'⚙️'},
]

const C = {
  navy: '#0D2B5E', navyLight: '#1B3E7A', green: '#22C55E', greenLight: '#16A34A',
  greenPale: '#DCFCE7', white: '#FFFFFF', surface: '#F4F6FA', surfaceAlt: '#EEF1F7',
  border: '#E2E7F0', text: '#0F172A', muted: '#64748B', subtle: '#94A3B8',
  danger: '#EF4444', dangerPale: '#FEE2E2', warning: '#F59E0B', warningPale: '#FEF3C7',
  info: '#3B82F6', infoPale: '#DBEAFE',
}

const fmtBRL = (v) => `R$ ${Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`

// ══════════════════════════════════════
// SISTEMA DE PLANOS
// ══════════════════════════════════════
const PLANS = {
  basic: {
    label: 'Basic',
    color: C.muted,
    pale: C.surfaceAlt,
    maxUsers: 2,
    maxProducts: 50,
    maxSalesMonth: 100,
    modules: ['dash','products','inventory','pdv','sales','settings'],
    price: 'R$ 97/mês',
  },
  pro: {
    label: 'Pro',
    color: C.info,
    pale: C.infoPale,
    maxUsers: 10,
    maxProducts: 500,
    maxSalesMonth: 1000,
    modules: ['dash','products','inventory','pdv','sales','customers','suppliers','cashflow','payable','receivable','users','settings'],
    price: 'R$ 197/mês',
  },
  enterprise: {
    label: 'Enterprise',
    color: C.green,
    pale: C.greenPale,
    maxUsers: 999999,
    maxProducts: 999999,
    maxSalesMonth: 999999,
    modules: ['dash','products','inventory','pdv','sales','customers','suppliers','cashflow','payable','receivable','users','settings','reports','fiscal'],
    price: 'R$ 397/mês',
  },
}

function usePlan(companyId) {
  const [plan, setPlan] = useState(null)
  const [usage, setUsage] = useState({ users: 0, products: 0, salesMonth: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) {
      // Sem empresa vinculada ao perfil: libera como Basic em vez de travar "Carregando..." para sempre
      setPlan({ ...PLANS.basic, key: 'basic', inactive: false, expired: false, expiresAt: null })
      setLoading(false)
      return
    }
    let isMounted = true
    const safetyTimer = setTimeout(() => { if (isMounted) setLoading(false) }, 8000)
    ;(async () => {
      try {
        const { data: company } = await supabase.from('companies').select('plan, expires_at, active').eq('id', companyId).single()
        const planKey = company?.plan || 'basic'
        const planData = PLANS[planKey] || PLANS.basic

        // Check expiry
        const expired = company?.expires_at && new Date(company.expires_at) < new Date()
        const inactive = !company?.active || expired

        // Get usage
        const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0,0,0,0)
        const [{ count: userCount }, { count: productCount }, { count: salesCount }] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact' }).eq('company_id', companyId),
          supabase.from('products').select('id', { count: 'exact' }).eq('company_id', companyId).eq('active', true),
          supabase.from('sales').select('id', { count: 'exact' }).eq('company_id', companyId).gte('created_at', startMonth.toISOString()),
        ])

        if (!isMounted) return
        setUsage({ users: userCount || 0, products: productCount || 0, salesMonth: salesCount || 0 })
        setPlan({ ...planData, key: planKey, inactive, expired, expiresAt: company?.expires_at })
      } catch (e) {
        // Em caso de erro de rede/Supabase, libera com plano básico padrão em vez de travar
        if (isMounted) setPlan({ ...PLANS.basic, key: 'basic', inactive: false, expired: false, expiresAt: null })
      } finally {
        if (isMounted) { clearTimeout(safetyTimer); setLoading(false) }
      }
    })()
    return () => { isMounted = false; clearTimeout(safetyTimer) }
  }, [companyId])

  const canAccess = (module) => {
    if (!plan) return false
    if (plan.inactive) return false
    return plan.modules.includes(module)
  }

  // Cada checagem retorna { ok, reason } para permitir mensagens claras na UI
  const canAddUser = () => {
    if (!plan) return { ok: false, reason: 'Carregando informações do plano...' }
    if (plan.inactive) return { ok: false, reason: 'Licença inativa ou expirada. Renove para continuar.' }
    if (usage.users >= plan.maxUsers) return { ok: false, reason: `Limite de usuários do plano ${plan.label} atingido (${plan.maxUsers}). Faça upgrade para adicionar mais.` }
    return { ok: true, reason: null }
  }

  const canAddProduct = () => {
    if (!plan) return { ok: false, reason: 'Carregando informações do plano...' }
    if (plan.inactive) return { ok: false, reason: 'Licença inativa ou expirada. Renove para continuar.' }
    if (usage.products >= plan.maxProducts) return { ok: false, reason: `Limite de produtos do plano ${plan.label} atingido (${plan.maxProducts}). Faça upgrade para cadastrar mais produtos.` }
    return { ok: true, reason: null }
  }

  const canAddSale = () => {
    if (!plan) return { ok: false, reason: 'Carregando informações do plano...' }
    if (plan.inactive) return { ok: false, reason: 'Licença inativa ou expirada. Renove para continuar vendendo.' }
    if (usage.salesMonth >= plan.maxSalesMonth) return { ok: false, reason: `Limite de vendas mensais do plano ${plan.label} atingido (${plan.maxSalesMonth}). Faça upgrade para continuar vendendo este mês.` }
    return { ok: true, reason: null }
  }

  return { plan, usage, loading, canAccess, canAddUser, canAddProduct, canAddSale }
}

// Banner inline de limite de plano atingido (usado em botões/formulários)
function PlanLimitNotice({ check }) {
  if (!check || check.ok) return null
  return (
    <div style={{ background: C.warningPale, border: '1.5px solid #FDE68A', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>🔒</span>
      <p style={{ fontSize: 12, color: '#92400E', margin: 0, fontWeight: 600, lineHeight: 1.4 }}>{check.reason}</p>
    </div>
  )
}

// Componente de aviso de plano bloqueado
function PlanBlock({ plan, feature }) {
  return (
    <div style={{ background: C.warningPale, border: `1.5px solid #FDE68A`, borderRadius: 14, padding: '20px 24px', textAlign: 'center' }}>
      <p style={{ fontSize: 28, margin: 0 }}>🔒</p>
      <p style={{ fontSize: 14, fontWeight: 800, color: '#92400E', margin: '8px 0 4px' }}>
        {feature} não disponível no plano {plan?.label}
      </p>
      <p style={{ fontSize: 12, color: '#92400E', margin: '0 0 14px' }}>
        Faça upgrade para acessar este módulo.
      </p>
      <Badge label={`Plano atual: ${plan?.label} — ${plan?.price}`} color="#FDE68A" text="#92400E" />
    </div>
  )
}

// Barra de uso do plano
function PlanUsageBar({ label, used, max, color = C.navy }) {
  const pct = Math.min((used / max) * 100, 100)
  const warn = pct >= 80
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: warn ? C.danger : C.navy }}>
          {used}/{max === 999999 ? '∞' : max}
        </span>
      </div>
      <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: warn ? C.danger : color, borderRadius: 99, transition: 'width .3s' }} />
      </div>
      {warn && max !== 999999 && (
        <p style={{ fontSize: 10, color: C.danger, margin: '3px 0 0', fontWeight: 600 }}>
          ⚠️ {pct >= 100 ? 'Limite atingido!' : 'Quase no limite!'}
        </p>
      )}
    </div>
  )
}

// Banner de licença expirada
function ExpiredBanner() {
  return (
    <div style={{ background: C.dangerPale, border: `1.5px solid #FCA5A5`, borderRadius: 12, padding: '14px 18px', margin: '0 0 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 24 }}>🚫</span>
      <div>
        <p style={{ fontSize: 13, fontWeight: 800, color: C.danger, margin: 0 }}>Licença expirada!</p>
        <p style={{ fontSize: 11, color: C.danger, margin: '2px 0 0' }}>
          Entre em contato com o suporte para renovar seu acesso.
        </p>
      </div>
    </div>
  )
}

const DEFAULT_PAYMENT_METHODS = [
  {key:'PIX',label:'PIX',days:0,fee:0,instant:true},
  {key:'Dinheiro',label:'Dinheiro',days:0,fee:0,instant:true},
  {key:'Débito',label:'Débito',days:1,fee:0.24,instant:false},
  {key:'Crédito',label:'Crédito',days:30,fee:2.5,instant:false,max_installments:12},
  {key:'Boleto',label:'Boleto',days:3,fee:1.5,instant:false},
]

// Calcula data de vencimento de parcela (mês base + parcela)
function calcInstallmentDueDate(saleDate, pmDays, installmentNumber) {
  const d = new Date(saleDate)
  // Cada parcela cai em: prazo_base + (parcela-1)*30 dias
  d.setDate(d.getDate() + (pmDays || 30) + (installmentNumber - 1) * 30)
  return d.toISOString().split('T')[0]
}

const NAV_CLIENT = [
  {id:'dash',label:'Dashboard',icon:'📊'},
  {id:'products',label:'Produtos',icon:'📦'},
  {id:'inventory',label:'Estoque',icon:'🗄️'},
  {id:'pdv',label:'Frente de Caixa',icon:'🛒'},
  {id:'sales',label:'Histórico Vendas',icon:'🛍️'},
  {id:'customers',label:'Clientes',icon:'👥'},
  {id:'suppliers',label:'Fornecedores',icon:'🏭'},
  {id:'cashflow',label:'Fluxo de Caixa',icon:'💰'},
  {id:'payable',label:'Contas a Pagar',icon:'📤'},
  {id:'receivable',label:'A Receber',icon:'📥'},
  {id:'users',label:'Usuários',icon:'👤'},
  {id:'settings',label:'Configurações',icon:'⚙️'},
]

const NAV_SUPER = [
  {id:'super_dash',label:'Painel Geral',icon:'🌐'},
  {id:'super_companies',label:'Empresas',icon:'🏢'},
  {id:'super_licenses',label:'Licenças',icon:'🔑'},
  {id:'super_users',label:'Usuários',icon:'👥'},
  {id:'super_settings',label:'Configurações',icon:'⚙️'},
]


// ── GTIN-13 / EAN-13 ───────────────────────────────────────────────────────
// Gera um EAN-13 aleatório válido no padrão brasileiro (prefixo 789)
// Usado quando o produto não tem código de barras cadastrado.
function generateGTIN13() {
  const prefix = '789' // GS1 Brasil
  let digits = prefix
  for(let i=0;i<9;i++) digits += Math.floor(Math.random()*10)
  // Calcula dígito verificador
  let sum = 0
  for(let i=0;i<12;i++) sum += parseInt(digits[i]) * (i%2===0?1:3)
  const check = (10 - (sum%10)) % 10
  return digits + check
}

// Valida se um EAN-13 tem dígito verificador correto
function validateGTIN13(code) {
  if(!code || code.length !== 13 || !/^\d{13}$/.test(code)) return false
  let sum = 0
  for(let i=0;i<12;i++) sum += parseInt(code[i]) * (i%2===0?1:3)
  const check = (10-(sum%10))%10
  return check === parseInt(code[12])
}

function DaliLogo({size=32}) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      <circle cx="60" cy="60" r="54" fill="#0D2B5E"/>
      <polyline points="34,72 50,54 64,64 88,40" stroke="#22C55E" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polygon points="83,28 97,42 97,28" fill="#22C55E"/>
    </svg>
  )
}

function Badge({label,color=C.infoPale,text=C.info}) {
  return <span style={{background:color,color:text,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99,letterSpacing:'0.04em',whiteSpace:'nowrap'}}>{label}</span>
}

function Btn({children,onClick,variant='primary',size='md',disabled,full}) {
  const bg={primary:C.navy,success:C.green,ghost:'transparent',danger:C.danger,warning:C.warning}
  const clr={primary:C.white,success:C.white,ghost:C.navy,danger:C.white,warning:C.white}
  const bd={primary:C.navy,success:C.greenLight,ghost:C.border,danger:C.danger,warning:C.warning}
  const pad={sm:'5px 12px',md:'9px 18px',lg:'12px 22px'}
  const fs={sm:12,md:13,lg:14}
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:bg[variant],color:clr[variant],border:`1.5px solid ${bd[variant]}`,
      padding:pad[size],fontSize:fs[size],fontWeight:700,borderRadius:9,
      cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,width:full?'100%':undefined,
    }}>{children}</button>
  )
}

function Input({label,value,onChange,placeholder,type='text',prefix,required}) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      {label && <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}{required&&<span style={{color:C.danger}}> *</span>}</label>}
      <div style={{position:'relative'}}>
        {prefix && <span style={{position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',color:C.muted,fontSize:13,pointerEvents:'none'}}>{prefix}</span>}
        <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
          style={{width:'100%',padding:prefix?'10px 12px 10px 28px':'10px 12px',border:`1.5px solid ${C.border}`,borderRadius:9,fontSize:13,color:C.text,background:C.white,outline:'none',boxSizing:'border-box'}}
          onFocus={e=>e.target.style.borderColor=C.navy} onBlur={e=>e.target.style.borderColor=C.border}/>
      </div>
    </div>
  )
}

function Select({label,value,onChange,options}) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      {label && <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{width:'100%',padding:'10px 12px',border:`1.5px solid ${C.border}`,borderRadius:9,fontSize:13,color:C.text,background:C.white,outline:'none',cursor:'pointer'}}>
        {options.map((o,i)=><option key={o.value??o??i} value={o.value??o}>{o.label??o}</option>)}
      </select>
    </div>
  )
}

function Modal({title,onClose,children}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(13,43,94,0.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:C.white,borderRadius:18,width:'100%',maxWidth:440,maxHeight:'88vh',overflowY:'auto',boxShadow:'0 32px 80px rgba(13,43,94,0.22)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 22px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.white,zIndex:1,borderRadius:'18px 18px 0 0'}}>
          <span style={{fontWeight:800,fontSize:15,color:C.navy}}>{title}</span>
          <button onClick={onClose} style={{background:C.surfaceAlt,border:'none',borderRadius:8,width:30,height:30,fontSize:18,color:C.muted,cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'20px 22px'}}>{children}</div>
      </div>
    </div>
  )
}

function Card({children,style,onClick}) {
  return <div onClick={onClick} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 13px',...style}}>{children}</div>
}

function SectionHeader({title,sub,action}) {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
      <div>
        <h2 style={{fontSize:16,fontWeight:800,color:C.navy,margin:0}}>{title}</h2>
        {sub && <p style={{fontSize:11,color:C.muted,margin:'1px 0 0'}}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

function StatCard({label,value,sub,color=C.navy,icon,pale}) {
  return (
    <Card style={{background:pale||C.white}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}>
        <span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</span>
        <span style={{fontSize:20}}>{icon}</span>
      </div>
      <p style={{fontSize:22,fontWeight:800,color,margin:0}}>{value}</p>
      {sub && <p style={{fontSize:11,color:C.muted,margin:'4px 0 0'}}>{sub}</p>}
    </Card>
  )
}

function Spinner() {
  return (
    <div style={{display:'flex',justifyContent:'center',alignItems:'center',padding:48}}>
      <div style={{width:36,height:36,border:`4px solid ${C.border}`,borderTop:`4px solid ${C.navy}`,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Empty({icon='📭',text='Nenhum registro encontrado'}) {
  return (
    <div style={{textAlign:'center',padding:'40px 20px',color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>{icon}</div>
      <p style={{fontSize:13}}>{text}</p>
    </div>
  )
}

function useToast() {
  const [toast,setToast] = useState(null)
  const show = useCallback((msg,type='success')=>{
    setToast({msg,type})
    setTimeout(()=>setToast(null),3000)
  },[])
  const bg = toast?.type==='error'?C.danger:toast?.type==='warning'?C.warning:C.green
  const el = toast && (
    <div style={{position:'fixed',bottom:90,left:'50%',transform:'translateX(-50%)',background:bg,color:C.white,padding:'10px 20px',borderRadius:99,fontSize:13,fontWeight:700,zIndex:9999,boxShadow:'0 8px 32px rgba(0,0,0,0.18)',whiteSpace:'nowrap'}}>
      {toast.msg}
    </div>
  )
  return {show,el}
}

// ── LOGIN ──────────────────────────────────────────────────────────────────
function LoginPage({onLogin,blockedMsg,onClearBlocked}) {
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')

  const handleLogin = async () => {
    if(onClearBlocked) onClearBlocked()
    if(!email||!password){setError('Preencha e-mail e senha.');return}
    setLoading(true);setError('')
    try {
      const {data,error:err} = await supabase.auth.signInWithPassword({email,password})
      if(err) throw err
      // Verifica se usuário/empresa está ativo antes de liberar acesso
      const {data:p} = await supabase.from('profiles').select('active,is_super_admin,company_id').eq('id',data.user.id).single()
      if(p && !p.is_super_admin) {
        if(p?.active === false) { // null ou undefined = considera ativo
          await supabase.auth.signOut()
          setError('Seu acesso foi desativado. Contate o administrador.')
          setLoading(false); return
        }
        if(p.company_id) {
          const {data:co} = await supabase.from('companies').select('active').eq('id',p.company_id).single()
          if(!co || co.active === false) {
            await supabase.auth.signOut()
            setError('O acesso desta empresa está suspenso. Contate o suporte.')
            setLoading(false); return
          }
        }
      }
      onLogin(data.user)
    } catch(err) {
      setError('E-mail ou senha inválidos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:`linear-gradient(135deg,${C.navy} 0%,${C.navyLight} 100%)`,padding:20}}>
      <div style={{background:C.white,borderRadius:20,padding:'36px 32px',width:'100%',maxWidth:380,boxShadow:'0 32px 80px rgba(0,0,0,0.3)'}}>
        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{display:'flex',justifyContent:'center',marginBottom:12}}><DaliLogo size={56}/></div>
          <h1 style={{fontSize:24,fontWeight:900,color:C.navy,margin:0}}>DALI<span style={{color:C.green}}>Tech</span></h1>
          <p style={{fontSize:12,color:C.muted,margin:'4px 0 0',letterSpacing:'0.08em',textTransform:'uppercase'}}>ERP · Gestão Inteligente</p>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="seu@email.com" required/>
          <Input label="Senha" type="password" value={password} onChange={setPassword} placeholder="••••••••" required/>
          {(blockedMsg||error) && (
            <div style={{background:C.dangerPale,border:`1px solid #FCA5A5`,borderRadius:8,padding:'10px 14px'}}>
              <p style={{fontSize:12,color:C.danger,margin:0,fontWeight:600}}>🚫 {blockedMsg||error}</p>
            </div>
          )}
          <Btn onClick={handleLogin} variant="primary" size="lg" full disabled={loading}>{loading?'Entrando...':'Entrar no Sistema'}</Btn>
        </div>
        <p style={{fontSize:11,color:C.muted,textAlign:'center',marginTop:24}}>© 2026 DALI Tech · Todos os direitos reservados</p>
      </div>
    </div>
  )
}

// ── SUPER ADMIN: DASHBOARD ─────────────────────────────────────────────────
function SuperDash() {
  const [stats,setStats] = useState({companies:0,active:0,expiring:0,users:0})
  const [companies,setCompanies] = useState([])
  const [loading,setLoading] = useState(true)

  useEffect(()=>{
    let isMounted = true;
    const load = async () => {
      setLoading(true)
      try {
        const {data:comps} = await supabase.from('companies').select('*').order('created_at',{ascending:false}).limit(200)
        if (!isMounted) return;
        const list = comps||[]
        const now = new Date()
        const in7 = new Date(); in7.setDate(in7.getDate()+7)
        setStats({
          companies:list.length,
          active:list.filter(c=>c.active).length,
          expiring:list.filter(c=>c.expires_at && new Date(c.expires_at)<=in7 && new Date(c.expires_at)>now).length,
          users:0,
        })
        setCompanies(list.slice(0,5))
      } catch(err) { console.error(err) }
      finally { if (isMounted) setLoading(false) }
    }
    load()
    return () => { isMounted = false }
  },[])

  if(loading) return <Spinner/>
  const inactiveCount = stats.companies - stats.active
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Hero banner */}
      <div style={{background:`linear-gradient(135deg,${C.navy} 0%,${C.navyLight} 100%)`,borderRadius:20,padding:'22px 20px',color:C.white,position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:-20,right:-20,width:120,height:120,background:'rgba(34,197,94,0.12)',borderRadius:999}}/>
        <div style={{position:'absolute',bottom:-30,right:30,width:80,height:80,background:'rgba(34,197,94,0.08)',borderRadius:999}}/>
        <div style={{position:'relative'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
            <DaliLogo size={32}/>
            <div>
              <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',margin:0,letterSpacing:'0.12em',textTransform:'uppercase'}}>Super Admin</p>
              <p style={{fontSize:16,fontWeight:900,color:C.white,margin:0}}>DALI<span style={{color:C.green}}>Tech</span></p>
            </div>
          </div>
          <p style={{fontSize:12,color:'rgba(255,255,255,0.6)',margin:'0 0 16px'}}>Painel de controle geral do sistema</p>
          {/* Big metric */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
            {[
              {label:'Empresas',value:stats.companies,icon:'🏢',color:C.white},
              {label:'Ativas',value:stats.active,icon:'✅',color:C.green},
              {label:'Inativas',value:inactiveCount,icon:'⛔',color:'#FCA5A5'},
            ].map(m=>(
              <div key={m.label} style={{background:'rgba(255,255,255,0.1)',borderRadius:14,padding:'12px 10px',backdropFilter:'blur(10px)'}}>
                <p style={{fontSize:20,margin:'0 0 2px'}}>{m.icon}</p>
                <p style={{fontSize:24,fontWeight:900,color:m.color,margin:0,lineHeight:1}}>{m.value}</p>
                <p style={{fontSize:10,color:'rgba(255,255,255,0.5)',margin:'4px 0 0',textTransform:'uppercase',letterSpacing:'0.06em'}}>{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alertas */}
      {stats.expiring>0&&(
        <div style={{background:C.warningPale,border:`1.5px solid ${C.warning}`,borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:28}}>⚠️</span>
          <div>
            <p style={{fontSize:13,fontWeight:800,color:C.warning,margin:0}}>{stats.expiring} empresa{stats.expiring>1?'s':''} vencendo em 7 dias</p>
            <p style={{fontSize:11,color:C.warning,margin:'2px 0 0',opacity:0.8}}>Renove as licenças em Gerenciar Licenças</p>
          </div>
        </div>
      )}

      {/* Lista empresas recentes */}
      <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,overflow:'hidden'}}>
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.navyLight})`,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <p style={{fontSize:13,fontWeight:800,color:C.white,margin:0}}>🏢 Empresas Recentes</p>
          <Badge label={`${stats.companies} total`} color="rgba(255,255,255,0.15)" text={C.green}/>
        </div>
        {companies.length===0
          ? <Empty icon="🏢" text="Nenhuma empresa cadastrada"/>
          : companies.map((co,i)=>{
            const exp = co.expires_at ? new Date(co.expires_at) : null
            const expired = exp && exp < new Date()
            const expiring = exp && !expired && exp < new Date(Date.now()+7*86400000)
            const statusColor = co.active&&!expired ? C.green : C.danger
            const statusBg    = co.active&&!expired ? C.greenPale : C.dangerPale
            const statusLabel = co.active&&!expired ? (expiring?'⚠️ Vencendo':'Ativa') : 'Inativa'
            return (
              <div key={co.id} style={{padding:'12px 18px',borderBottom:i<companies.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:38,height:38,background:C.navy,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',color:C.green,fontWeight:900,fontSize:14,flexShrink:0}}>
                  {(co.name||'?')[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{co.name}</p>
                  <div style={{display:'flex',gap:6,alignItems:'center',marginTop:3,flexWrap:'wrap'}}>
                    <Badge label={co.plan||'basic'} color={C.infoPale} text={C.info}/>
                    {exp&&<span style={{fontSize:10,color:expired?C.danger:C.muted}}>Vence: {exp.toLocaleDateString('pt-BR')}</span>}
                  </div>
                </div>
                <Badge label={statusLabel} color={expiring?C.warningPale:statusBg} text={expiring?C.warning:statusColor}/>
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

// ── SUPER ADMIN: EMPRESAS ──────────────────────────────────────────────────

// ── Cria usuário via Admin API (oficial) + perfil ──────────────────────────
// Helper: corre uma Promise com timeout, evita travamentos infinitos em chamadas de rede
function withTimeout(promise, ms, timeoutMsg) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMsg || 'Tempo esgotado. Verifique sua conexão e tente novamente.')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function createUserWithInvite({email, name, companyId, role, modules}) {
  // 1. Convida via Admin API — manda email automaticamente
  // ⚠️ Requer permissão de admin (service role) no Supabase. Com a chave anon,
  // esta chamada retorna erro de permissão — tratado abaixo com mensagem clara.
  const {data:authData,error:authErr} = await withTimeout(
    supabase.auth.admin.inviteUserByEmail(
      email.trim(),
      { redirectTo:'https://dalitech.vercel.app',
        data:{ name: name.trim()||email.split('@')[0] } }
    ),
    12000,
    'Tempo esgotado ao convidar usuário. Verifique sua conexão.'
  )
  if(authErr) {
    const msg = authErr.message?.includes('already')
      ? 'E-mail já cadastrado.'
      : authErr.message?.toLowerCase().includes('not allowed') || authErr.status === 403
        ? 'Sem permissão para criar usuários por aqui. Peça ao suporte DALI Tech para criar o acesso.'
        : 'Erro: '+authErr.message
    throw new Error(msg)
  }
  const userId = authData?.user?.id
  if(!userId) throw new Error('ID do usuário não retornado')

  // 2. Cria perfil
  const {error:profErr} = await withTimeout(
    supabase.rpc('create_user_profile',{
      user_id: userId,
      user_email: email.trim(),
      user_name: name.trim()||email.split('@')[0],
      user_company_id: companyId,
      user_role: role,
      user_modules: modules,
    }),
    12000,
    'Tempo esgotado ao salvar perfil do usuário.'
  )
  if(profErr) throw new Error('Erro no perfil: '+profErr.message)
  return userId
}

// ── MODAL EMPRESA (Super Admin) ────────────────────────────────────────────
function ModalSuperEmpresa({company, onClose, onSaved}) {
  const isNew = !company
  const [tab, setTab] = useState('dados') // 'dados' | 'fiscal'
  const emptyDados = {name:'',email:'',cnpj:'',plan:'basic',expires_at:''}
  const emptyFiscal = {regime:'simples',cfop:'5102',ncm:'00000000',aliquota:'',focus_token:'',cnpj:'',razao_social:'',logradouro:'',numero:'',municipio:'',uf:'SP',cep:'',certificado_ok:false}
  const [dados, setDados] = useState(isNew ? emptyDados : {name:company.name||'',email:company.email||'',cnpj:company.cnpj||'',plan:company.plan||'basic',expires_at:company.expires_at?company.expires_at.split('T')[0]:''})
  const [fiscal, setFiscal] = useState(isNew ? emptyFiscal : {...emptyFiscal,...(company.fiscal_config||{}),cnpj:company.fiscal_config?.cnpj||company.cnpj||'',razao_social:company.fiscal_config?.razao_social||company.name||''})
  const [saving, setSaving] = useState(false)
  const [uploadingCert, setUploadingCert] = useState(false)
  const [certPass, setCertPass] = useState('')
  const [certFile, setCertFile] = useState(null)
  const certRef = useRef()
  const toast = useToast()
  const fd = k => v => setDados(p=>({...p,[k]:v}))
  const ff = k => v => setFiscal(p=>({...p,[k]:v}))
  const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

  const save = async()=>{
    if(!dados.name){toast.show('Nome é obrigatório','error');return}
    setSaving(true)
    try {
      const payload = {
        name:dados.name, email:dados.email, cnpj:dados.cnpj,
        plan:dados.plan, expires_at:dados.expires_at||null,
        fiscal_config:fiscal, updated_at:new Date().toISOString(),
      }
      let error
      if(isNew) {
        ({error} = await supabase.from('companies').insert({...payload,active:true,created_at:new Date().toISOString()}))
      } else {
        ({error} = await supabase.from('companies').update(payload).eq('id',company.id))
      }
      if(error){toast.show('Erro: '+error.message,'error');return}
      toast.show(isNew?'Empresa cadastrada!':'Empresa atualizada!')
      onSaved()
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const uploadCert = async()=>{
    if(!certFile||!certPass){toast.show('Selecione o .pfx e informe a senha','error');return}
    if(!fiscal.focus_token){toast.show('Informe o token Focus NFe antes','error');return}
    setUploadingCert(true)
    try {
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target.result)
        reader.onerror = () => reject(new Error('Erro ao ler o arquivo do certificado'))
        reader.readAsArrayBuffer(certFile)
      })
      const b64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
      const cnpjLimpo = (fiscal.cnpj||dados.cnpj||'').replace(/\D/g,'')
      const resp = await withTimeout(
        fetch(`https://homologacao.focusnfe.com.br/v2/empresas/${cnpjLimpo}/certificado`,{
          method:'POST',
          headers:{'Authorization':'Basic '+btoa(fiscal.focus_token+':'),'Content-Type':'application/json'},
          body:JSON.stringify({certificado:b64,senha:certPass})
        }),
        15000,
        'Tempo esgotado ao enviar certificado. Verifique sua conexão.'
      )
      const data = await resp.json()
      if(!resp.ok) throw new Error(data?.mensagem||'Erro ao enviar certificado')
      const newFiscal = {...fiscal,certificado_ok:true}
      setFiscal(newFiscal)
      await supabase.from('companies').update({fiscal_config:newFiscal,updated_at:new Date().toISOString()}).eq('id',company.id)
      toast.show('Certificado enviado!')
      setCertFile(null); setCertPass('')
    } catch(err) {
      toast.show('Erro: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setUploadingCert(false)
    }
  }

  const TABS = [{id:'dados',label:'📋 Dados',},{id:'fiscal',label:'🏷️ Fiscal / NFC-e'}]

  return (
    <Modal title={isNew?'Nova Empresa':`Editar — ${company.name}`} onClose={onClose} maxWidth={500}>
      {toast.el}
      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:`1px solid ${C.border}`,paddingBottom:0}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'8px 14px',border:'none',background:'transparent',cursor:'pointer',fontSize:12,fontWeight:700,color:tab===t.id?C.navy:C.muted,borderBottom:`2px solid ${tab===t.id?C.navy:'transparent'}`,transition:'all .15s',marginBottom:-1}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==='dados'&&(
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <Input label="Nome da Empresa" value={dados.name} onChange={fd('name')} placeholder="Ex: Mercado Silva" required/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Input label="E-mail" type="email" value={dados.email} onChange={fd('email')} placeholder="contato@empresa.com"/>
            <Input label="CNPJ" value={dados.cnpj} onChange={fd('cnpj')} placeholder="00.000.000/0001-00"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Select label="Plano" value={dados.plan} onChange={fd('plan')} options={[{value:'basic',label:'Basic'},{value:'pro',label:'Pro'},{value:'enterprise',label:'Enterprise'}]}/>
            <Input label="Vencimento" type="date" value={dados.expires_at} onChange={fd('expires_at')}/>
          </div>
        </div>
      )}

      {tab==='fiscal'&&(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 12px'}}>
            <p style={{fontSize:11,fontWeight:700,color:C.navy,textTransform:'uppercase',letterSpacing:'0.06em',margin:'0 0 10px'}}>📋 Dados Fiscais</p>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <Input label="CNPJ" value={fiscal.cnpj} onChange={ff('cnpj')} placeholder="00.000.000/0001-00"/>
              <Input label="Razão Social" value={fiscal.razao_social} onChange={ff('razao_social')} placeholder="Empresa LTDA"/>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:8}}>
                <Input label="Logradouro" value={fiscal.logradouro} onChange={ff('logradouro')} placeholder="Rua das Flores"/>
                <Input label="Número" value={fiscal.numero} onChange={ff('numero')} placeholder="123"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:8}}>
                <Input label="Município" value={fiscal.municipio} onChange={ff('municipio')} placeholder="São Paulo"/>
                <Select label="UF" value={fiscal.uf} onChange={ff('uf')} options={UFS}/>
                <Input label="CEP" value={fiscal.cep} onChange={ff('cep')} placeholder="00000-000"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                <Select label="Regime" value={fiscal.regime} onChange={ff('regime')} options={[{value:'simples',label:'Simples'},{value:'mei',label:'MEI'},{value:'lucro_presumido',label:'Presumido'},{value:'lucro_real',label:'Real'}]}/>
                <Input label="CFOP" value={fiscal.cfop} onChange={ff('cfop')} placeholder="5102"/>
                <Input label="NCM" value={fiscal.ncm} onChange={ff('ncm')} placeholder="00000000"/>
              </div>
            </div>
          </div>

          <div style={{background:C.infoPale,border:`1.5px solid ${C.info}`,borderRadius:10,padding:'10px 12px'}}>
            <p style={{fontSize:11,fontWeight:700,color:C.info,textTransform:'uppercase',letterSpacing:'0.06em',margin:'0 0 10px'}}>🔑 Focus NFe</p>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <Input label="Token API" value={fiscal.focus_token} onChange={ff('focus_token')} placeholder="Token de homologação ou produção"/>
              <div style={{display:'flex',alignItems:'center',gap:8,background:C.white,borderRadius:8,padding:'8px 10px'}}>
                <div style={{width:10,height:10,borderRadius:999,background:fiscal.certificado_ok?C.green:C.warning,flexShrink:0}}/>
                <span style={{fontSize:12,color:fiscal.certificado_ok?C.greenLight:C.warning,fontWeight:600}}>
                  {fiscal.certificado_ok?'Certificado configurado ✅':'Certificado pendente ⚠️'}
                </span>
              </div>
              {!isNew&&(
                <div style={{background:C.white,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
                  <p style={{fontSize:11,fontWeight:700,color:C.text,margin:'0 0 8px'}}>📤 Enviar Certificado A1 (.pfx)</p>
                  <div onClick={()=>certRef.current?.click()} style={{border:`2px dashed ${certFile?C.green:C.border}`,borderRadius:8,padding:'10px',textAlign:'center',cursor:'pointer',marginBottom:8}}>
                    <p style={{fontSize:12,color:certFile?C.greenLight:C.muted,margin:0}}>{certFile?'✅ '+certFile.name:'Clique para selecionar .pfx'}</p>
                  </div>
                  <input ref={certRef} type="file" accept=".pfx,.p12" onChange={e=>setCertFile(e.target.files?.[0]||null)} style={{display:'none'}}/>
                  <Input label="Senha do Certificado" type="password" value={certPass} onChange={setCertPass} placeholder="Senha do arquivo .pfx"/>
                  <div style={{marginTop:8}}>
                    <Btn onClick={uploadCert} size="sm" variant="primary" disabled={uploadingCert||!certFile||!certPass}>
                      {uploadingCert?'Enviando...':'Enviar Certificado'}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{background:C.warningPale,borderRadius:8,padding:'8px 12px'}}>
            <p style={{fontSize:11,color:C.warning,margin:0,fontWeight:600}}>⚠️ Consulte o contador antes de alterar configurações fiscais.</p>
          </div>
        </div>
      )}

      <div style={{display:'flex',gap:8,marginTop:16}}>
        <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
        <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':(isNew?'Cadastrar Empresa':'Salvar Alterações')}</Btn></div>
      </div>
    </Modal>
  )
}

function SuperCompanies() {
  const [companies,setCompanies] = useState([])
  const [loading,setLoading] = useState(true)
  const [editCompany,setEditCompany] = useState(undefined) // undefined=fechado, null=novo, obj=editar
  const toast = useToast()

  const fetchCompanies = useCallback(async(isMounted=true)=>{
    setLoading(true)
    try {
      const {data} = await supabase.from('companies').select('*').order('created_at',{ascending:false}).limit(300)
      if(isMounted) setCompanies(data||[])
    } catch(err) { console.error(err) }
    finally { if(isMounted) setLoading(false) }
  },[])

  useEffect(()=>{ let m=true; fetchCompanies(m); return()=>{m=false} },[fetchCompanies])

  const toggle = async(c)=>{
    await supabase.from('companies').update({active:!c.active}).eq('id',c.id)
    toast.show(c.active?'Empresa desativada':'Empresa ativada!')
    fetchCompanies()
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Empresas" sub={`${companies.length} cadastradas`} action={<Btn size="sm" onClick={()=>setEditCompany(null)}>+ Nova Empresa</Btn>}/>
      {loading?<Spinner/>:companies.length===0?<Empty icon="🏢" text="Nenhuma empresa cadastrada"/>:companies.map(c=>{
        const exp = c.expires_at ? new Date(c.expires_at) : null
        const expired = exp && exp < new Date()
        const expiring = exp && !expired && exp < new Date(Date.now()+7*86400000)
        const hasFiscal = !!(c.fiscal_config?.focus_token)
        const hasCert = !!(c.fiscal_config?.certificado_ok)
        const isOk = c.active && !expired
        return (
          <div key={c.id}
            onClick={()=>setEditCompany(c)}
            style={{
              background:C.white,
              border:`2px solid ${expired?C.danger:expiring?C.warning:isOk?C.border:C.danger}`,
              borderRadius:16, overflow:'hidden',
              cursor:'pointer', transition:'box-shadow .15s',
              boxShadow:'0 1px 4px rgba(0,0,0,0.04)',
            }}
            onMouseEnter={e=>e.currentTarget.style.boxShadow='0 6px 24px rgba(13,43,94,0.12)'}
            onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'}>
            {/* Stripe de status */}
            <div style={{height:4,background:expired?C.danger:expiring?C.warning:isOk?C.green:C.danger}}/>
            <div style={{padding:'12px 16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                {/* Avatar letra */}
                <div style={{width:42,height:42,background:`linear-gradient(135deg,${C.navy},${C.navyLight})`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',color:C.green,fontWeight:900,fontSize:16,flexShrink:0}}>
                  {(c.name||'?')[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:14,fontWeight:800,color:C.text,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</p>
                  <p style={{fontSize:11,color:C.muted,margin:'1px 0 0'}}>{c.cnpj||'Sem CNPJ'}</p>
                </div>
                <span style={{fontSize:11,color:C.subtle}}>✏️</span>
              </div>
              {/* Badges */}
              <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
                <Badge label={c.plan||'basic'} color={C.infoPale} text={C.info}/>
                {isOk&&!expiring&&<Badge label="✅ Ativa" color={C.greenPale} text={C.greenLight}/>}
                {expiring&&<Badge label="⚠️ Vencendo" color={C.warningPale} text={C.warning}/>}
                {expired&&<Badge label="❌ Vencida" color={C.dangerPale} text={C.danger}/>}
                {!c.active&&!expired&&<Badge label="⛔ Inativa" color={C.dangerPale} text={C.danger}/>}
                {hasFiscal&&<Badge label={hasCert?'NFC-e ✓':'NFC-e s/cert'} color={hasCert?C.greenPale:C.warningPale} text={hasCert?C.greenLight:C.warning}/>}
              </div>
              {/* Info vencimento */}
              {exp&&(
                <div style={{background:expired?C.dangerPale:expiring?C.warningPale:C.surfaceAlt,borderRadius:8,padding:'6px 10px',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:10,fontWeight:700,color:expired?C.danger:expiring?C.warning:C.muted,textTransform:'uppercase',letterSpacing:'0.05em'}}>Licença</span>
                  <span style={{fontSize:12,fontWeight:700,color:expired?C.danger:expiring?C.warning:C.text}}>{exp.toLocaleDateString('pt-BR')}</span>
                </div>
              )}
              {/* Ações */}
              <div onClick={e=>e.stopPropagation()}>
                <Btn onClick={()=>toggle(c)} variant={c.active?'danger':'success'} size="sm">{c.active?'Desativar Empresa':'Ativar Empresa'}</Btn>
              </div>
            </div>
          </div>
        )
      })}
      {editCompany!==undefined&&(
        <ModalSuperEmpresa
          company={editCompany}
          onClose={()=>setEditCompany(undefined)}
          onSaved={()=>{setEditCompany(undefined);fetchCompanies()}}
        />
      )}
    </div>
  )
}

// ── SUPER ADMIN: LICENÇAS ──────────────────────────────────────────────────
function SuperLicenses() {
  const [companies,setCompanies] = useState([])
  const [loading,setLoading] = useState(true)
  const [editing,setEditing] = useState(null)
  const [newDate,setNewDate] = useState('')
  const toast = useToast()

  useEffect(()=>{
    let isMounted = true;
    const load = async()=>{
      setLoading(true)
      try {
        const {data} = await supabase.from('companies').select('*').order('expires_at',{ascending:true}).limit(300)
        if(isMounted) setCompanies(data||[])
      } catch(err) { console.error(err) }
      finally { if(isMounted) setLoading(false) }
    }
    load()
    return () => { isMounted = false; }
  },[])

  const update = async()=>{
    if(!newDate){toast.show('Selecione uma data','error');return}
    await supabase.from('companies').update({expires_at:newDate}).eq('id',editing.id)
    toast.show('Licença renovada!')
    setEditing(null)
    setCompanies(prev=>prev.map(c=>c.id===editing.id?{...c,expires_at:newDate}:c))
  }

  const now = new Date()
  const expired = companies.filter(c=>c.expires_at && new Date(c.expires_at)<now)
  const expiring = companies.filter(c=>c.expires_at && new Date(c.expires_at)>=now && new Date(c.expires_at)<new Date(Date.now()+7*86400000))
  const ok = companies.filter(c=>!c.expires_at || new Date(c.expires_at)>=new Date(Date.now()+7*86400000))

  const renderGroup = (title,list,badge)=>(
    list.length>0&&(
      <Card>
        <p style={{fontSize:13,fontWeight:700,color:C.navy,margin:'0 0 12px'}}>{title}</p>
        {list.map(c=>(
          <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}`}}>
            <div>
              <p style={{fontSize:13,fontWeight:600,color:C.text,margin:0}}>{c.name}</p>
              <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{c.expires_at?new Date(c.expires_at).toLocaleDateString('pt-BR'):'Sem vencimento'}</p>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {badge}
              <Btn size="sm" onClick={()=>{setEditing(c);setNewDate('')}}>Renovar</Btn>
            </div>
          </div>
        ))}
      </Card>
    )
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Gerenciar Licenças" sub={`${companies.length} empresas`}/>
      {loading?<Spinner/>:<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          <StatCard label="Vencidas" value={expired.length} color={C.danger} icon="❌" pale={C.dangerPale}/>
          <StatCard label="Vencendo" value={expiring.length} color={C.warning} icon="⚠️" pale={C.warningPale}/>
          <StatCard label="OK" value={ok.length} color={C.green} icon="✅" pale={C.greenPale}/>
        </div>
        {renderGroup('❌ Vencidas',expired,<Badge label="Vencida" color={C.dangerPale} text={C.danger}/>)}
        {renderGroup('⚠️ Vencendo em 7 dias',expiring,<Badge label="Urgente" color={C.warningPale} text={C.warning}/>)}
        {renderGroup('✅ Ativas',ok,<Badge label="OK" color={C.greenPale} text={C.greenLight}/>)}
      </>}
      {editing&&(
        <Modal title={`Renovar — ${editing.name}`} onClose={()=>setEditing(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{background:C.surfaceAlt,borderRadius:10,padding:12}}>
              <p style={{fontSize:12,color:C.muted,margin:0}}>Vencimento atual</p>
              <p style={{fontSize:16,fontWeight:700,color:C.navy,margin:'4px 0 0'}}>{editing.expires_at?new Date(editing.expires_at).toLocaleDateString('pt-BR'):'Sem vencimento'}</p>
            </div>
            <Input label="Novo Vencimento" type="date" value={newDate} onChange={setNewDate} required/>
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={()=>setEditing(null)} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={update} variant="success" full disabled={!newDate}>Renovar Licença</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── SUPER ADMIN: USUÁRIOS ──────────────────────────────────────────────────
function SuperUsers() {
  const [users,setUsers] = useState([])
  const [companies,setCompanies] = useState([])
  const [loading,setLoading] = useState(true)
  const [showModal,setShowModal] = useState(false)
  const [saving,setSaving] = useState(false)
  const [permTarget,setPermTarget] = useState(null)
  const [permModules,setPermModules] = useState([])
  const emptyForm = {email:'',name:'',company_id:'',role:'ADMIN'}
  const [form,setForm] = useState(emptyForm)
  const toast = useToast()

  // Módulos que o super admin pode controlar nos ADMINs
  const ADMIN_MODULES = ALL_MODULES.map(m=>m.id).concat(['users'])

  const fetchUsers = useCallback(async (isMounted = true) => {
    setLoading(true)
    try {
      // list_all_profiles: função SQL SECURITY DEFINER que bypassa RLS
      const [{data:u,error:ue},{data:c}] = await Promise.all([
        supabase.rpc('list_all_profiles'),
        supabase.from('companies').select('id,name').limit(300),
      ])
      // Fallback se a função ainda não existir
      const profiles = ue
        ? (await supabase.from('profiles').select('*').order('created_at',{ascending:false}).limit(300)).data
        : u
      if(isMounted) {
        setUsers(profiles||[])
        setCompanies(c||[])
      }
    } catch(err) { console.error(err) }
    finally { if(isMounted) setLoading(false) }
  }, [])

  useEffect(()=>{ 
    let isMounted = true;
    fetchUsers(isMounted);
    return () => { isMounted = false; }
  },[fetchUsers])

  const save = async () => {
    if(!form.email||!form.company_id){toast.show('Preencha e-mail e empresa','error');return}
    setSaving(true)
    try {
      await createUserWithInvite({
        email: form.email,
        name: form.name,
        companyId: form.company_id,
        role: form.role,
        modules: ALL_MODULES.map(m=>m.id),
      })
      toast.show('✅ Usuário criado! Convite enviado por e-mail.')
      setShowModal(false);setForm(emptyForm);fetchUsers()
    } catch(e){ toast.show(e?.message||'Erro ao criar usuário','error') }
    finally { setSaving(false) }
  }

  const f = k => v => setForm(p=>({...p,[k]:v}))
  const coName = id => companies.find(c=>c.id===id)?.name || '—'
  const roleColor = r => r==='ADMIN'?{bg:C.infoPale,text:C.info}:r==='SUPER_ADMIN'?{bg:'#EDE9FE',text:'#7C3AED'}:r==='VENDEDOR'?{bg:C.greenPale,text:C.greenLight}:{bg:C.surfaceAlt,text:C.muted}

  const toggleUser = async (u) => {
    const newActive = !u.active
    const {error} = await supabase.from('profiles').update({active: newActive}).eq('id', u.id)
    if(error){toast.show('Erro: '+error.message,'error');return}
    toast.show(newActive ? 'Usuário ativado!' : 'Usuário inativado!')
    setUsers(prev => prev.map(x => x.id===u.id ? {...x, active: newActive} : x))
  }

  const openPerms = (u) => {
    const current = u.allowed_modules || ALL_MODULES.map(m=>m.id)
    setPermModules(current)
    setPermTarget(u)
  }

  const savePerms = async () => {
    const {error} = await supabase.from('profiles').update({allowed_modules:permModules}).eq('id',permTarget.id)
    if(error){toast.show('Erro ao salvar: '+error.message,'error');return}
    toast.show('Permissões salvas!')
    setUsers(prev=>prev.map(x=>x.id===permTarget.id?{...x,allowed_modules:permModules}:x))
    setPermTarget(null)
  }

  const nonSuperUsers = users.filter(u=>!u.is_super_admin)
  const groupedByCompany = companies.map(c=>({
    company:c,
    users:nonSuperUsers.filter(u=>u.company_id===c.id)
  })).filter(g=>g.users.length>0)
  const noCompany = nonSuperUsers.filter(u=>!u.company_id)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Usuários do Sistema" sub={`${nonSuperUsers.length} usuários em ${companies.length} empresas`} action={<Btn size="sm" onClick={()=>setShowModal(true)}>+ Novo Usuário</Btn>}/>
      {loading?<Spinner/>:(
        <>
          {groupedByCompany.map(({company,users:cu})=>(
            <div key={company.id}>
              <p style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',margin:'4px 0 8px',paddingLeft:4}}>🏢 {company.name}</p>
              {cu.map(u=>{
                const rc = roleColor(u.role)
                const isActive = u.active !== false
                const modCount = u.allowed_modules ? u.allowed_modules.length : ALL_MODULES.length
                return (
                  <Card key={u.id} style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
                    <div style={{width:40,height:40,background:isActive?C.navy:C.border,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',color:C.white,fontWeight:800,fontSize:13,flexShrink:0}}>
                      {(u.name||u.email||'U')[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,fontWeight:700,color:isActive?C.text:C.muted,margin:0}}>{u.name||'Sem nome'}</p>
                      <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{u.email}</p>
                      {!isActive && <Badge label="Inativo" color={C.dangerPale} text={C.danger}/>}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5}}>
                      <Badge label={u.role||'USER'} color={rc.bg} text={rc.text}/>
                      <div style={{display:'flex',gap:5}}>
                        <Btn size="sm" variant="ghost" onClick={()=>openPerms(u)}>🔧 {modCount} módulos</Btn>
                        <Btn size="sm" variant={isActive?'danger':'success'} onClick={()=>toggleUser(u)}>
                          {isActive?'Inativar':'Ativar'}
                        </Btn>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          ))}
          {noCompany.length>0&&(
            <div>
              <p style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:'uppercase',margin:'4px 0 8px',paddingLeft:4}}>⚠️ Sem empresa</p>
              {noCompany.map(u=>(
                <Card key={u.id} style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
                  <div style={{flex:1}}><p style={{margin:0,fontSize:13,fontWeight:700}}>{u.name||u.email}</p></div>
                  <Btn size="sm" variant="ghost" onClick={()=>openPerms(u)}>🔧 Permissões</Btn>
                </Card>
              ))}
            </div>
          )}
          {nonSuperUsers.length===0&&<Empty icon="👤" text="Nenhum usuário"/>}
        </>
      )}

      {/* Modal novo usuário */}
      {showModal&&(
        <Modal title="Novo Usuário" onClose={()=>setShowModal(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <Input label="Nome" value={form.name} onChange={f('name')} placeholder="Nome completo"/>
            <Input label="E-mail" type="email" value={form.email} onChange={f('email')} placeholder="usuario@empresa.com" required/>
            <div style={{background:C.infoPale,borderRadius:10,padding:'10px 12px',display:'flex',gap:8,alignItems:'center'}}>
              <span>📧</span><p style={{fontSize:11,color:C.info,margin:0,fontWeight:600}}>O usuário receberá um e-mail de convite para definir a própria senha.</p>
            </div>
            <Select label="Empresa" value={form.company_id} onChange={f('company_id')}
              options={[{value:'',label:'Selecione a empresa...'},...companies.map(c=>({value:c.id,label:c.name}))]}/>
            <Select label="Perfil" value={form.role} onChange={f('role')}
              options={[{value:'ADMIN',label:'Admin da Empresa'},{value:'VENDEDOR',label:'Vendedor'},{value:'USER',label:'Usuário'}]}/>
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={()=>setShowModal(false)} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Criando...':'Criar Usuário'}</Btn></div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de permissões */}
      {permTarget&&(
        <Modal title={`🔧 Permissões — ${permTarget.name||permTarget.email}`} onClose={()=>setPermTarget(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{background:C.infoPale,borderRadius:10,padding:10}}>
              <p style={{fontSize:11,color:C.info,margin:0,fontWeight:600}}>
                Empresa: {coName(permTarget.company_id)} · Perfil: {permTarget.role}
              </p>
              <p style={{fontSize:11,color:C.info,margin:'4px 0 0'}}>
                Defina quais módulos este usuário pode acessar.
              </p>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {ALL_MODULES.map(m=>{
                const has = permModules.includes(m.id)
                return (
                  <button key={m.id} onClick={()=>setPermModules(prev=>has?prev.filter(x=>x!==m.id):[...prev,m.id])}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',border:`2px solid ${has?C.navy:C.border}`,borderRadius:10,background:has?C.navy:C.white,cursor:'pointer',textAlign:'left'}}>
                    <span style={{fontSize:18}}>{m.icon}</span>
                    <span style={{fontSize:13,fontWeight:700,color:has?C.white:C.text,flex:1}}>{m.label}</span>
                    <span style={{fontSize:16,color:has?C.green:C.border}}>{has?'✓':'○'}</span>
                  </button>
                )
              })}
            </div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <Btn size="sm" variant="ghost" onClick={()=>setPermModules(ALL_MODULES.map(m=>m.id))}>Todos</Btn>
              <Btn size="sm" variant="ghost" onClick={()=>setPermModules([])}>Nenhum</Btn>
              <div style={{flex:1}}/>
              <Btn onClick={()=>setPermTarget(null)} variant="ghost">Cancelar</Btn>
              <Btn onClick={savePerms} variant="primary">Salvar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── DASHBOARD CLIENTE ──────────────────────────────────────────────────────
function PageDash({user,companyId,setPage,setStockFilter,setSalesFilter}) {
  const [stats,setStats] = useState({salesTotal:0,salesCount:0,products:0,stockAlerts:0,cancelledTotal:0,cancelledCount:0,totalStock:0,totalCostValue:0,totalSaleValue:0})
  const [prevStats,setPrevStats] = useState({salesTotal:0,salesCount:0})
  const [recentSales,setRecentSales] = useState([])
  const [chartData,setChartData] = useState([])
  const [loading,setLoading] = useState(true)

  // ── Filtro de período ──────────────────────────────────────────────────
  const now = new Date()
  const [filterMode,setFilterMode] = useState('month') // 'month' | 'year' | 'custom'
  const [filterMonth,setFilterMonth] = useState(now.getMonth())       // 0-11
  const [filterYear,setFilterYear]   = useState(now.getFullYear())
  const [customStart,setCustomStart] = useState('')
  const [customEnd,setCustomEnd]     = useState('')

  // Calcula início/fim do período selecionado
  const getPeriodRange = useCallback(() => {
    if(filterMode === 'custom' && customStart && customEnd) {
      return {
        start: new Date(customStart + 'T00:00:00').toISOString(),
        end:   new Date(customEnd   + 'T23:59:59').toISOString(),
        label: `${new Date(customStart+'T00:00:00').toLocaleDateString('pt-BR')} – ${new Date(customEnd+'T00:00:00').toLocaleDateString('pt-BR')}`,
      }
    }
    if(filterMode === 'year') {
      return {
        start: new Date(filterYear, 0, 1).toISOString(),
        end:   new Date(filterYear, 11, 31, 23, 59, 59).toISOString(),
        label: `Ano ${filterYear}`,
      }
    }
    // month (default)
    const s = new Date(filterYear, filterMonth, 1)
    const e = new Date(filterYear, filterMonth + 1, 0, 23, 59, 59)
    return {
      start: s.toISOString(),
      end:   e.toISOString(),
      label: s.toLocaleDateString('pt-BR', {month:'long', year:'numeric'}),
    }
  }, [filterMode, filterMonth, filterYear, customStart, customEnd])

  useEffect(()=>{
    let isMounted = true;
    const loadDash = async () => {
      setLoading(true)
      try {
        const {start, end} = getPeriodRange()

        let qp = supabase.from('products').select('id,stock_quantity,min_stock,price,cost_price',{count:'exact'}).eq('active',true)
        if(companyId) qp = qp.eq('company_id',companyId)
        const {data:prods,count:prodCount} = await qp
        if(!isMounted) return;
        const stockAlerts = (prods||[]).filter(p=>(p.stock_quantity||0)>0&&(p.stock_quantity||0)<=(p.min_stock||5)).length
        const totalStock = (prods||[]).reduce((a,p)=>a+(p.stock_quantity||0),0)
        const totalCostValue = (prods||[]).reduce((a,p)=>a+((p.cost_price||0)*(p.stock_quantity||0)),0)
        const totalSaleValue = (prods||[]).reduce((a,p)=>a+((p.price||0)*(p.stock_quantity||0)),0)

        let qs = supabase.from('sales').select('total,created_at,customer_name,payment_method,status')
          .gte('created_at',start).lte('created_at',end)
          .order('created_at',{ascending:false}).limit(200)
        if(companyId) qs = qs.eq('company_id',companyId)
        const {data:allPeriodSales} = await qs
        if(!isMounted) return;

        const activeSales = (allPeriodSales||[]).filter(s=>s.status!=='cancelled')
        const cancelledTotal = (allPeriodSales||[]).filter(s=>s.status==='cancelled').reduce((a,s)=>a+(s.total||0),0)
        const cancelledCount = (allPeriodSales||[]).filter(s=>s.status==='cancelled').length

        setStats({salesTotal:activeSales.reduce((a,s)=>a+(s.total||0),0),salesCount:activeSales.length,products:prodCount||0,stockAlerts,cancelledTotal,cancelledCount,totalStock,totalCostValue,totalSaleValue})

        // Busca período anterior para comparativo (apenas modo mês)
        if(filterMode==='month') {
          const prevDate = new Date(filterYear, filterMonth-1, 1)
          const prevStart = new Date(prevDate.getFullYear(), prevDate.getMonth(), 1)
          const prevEnd   = new Date(prevDate.getFullYear(), prevDate.getMonth()+1, 0, 23, 59, 59)
          let qprev = supabase.from('sales').select('total,status').gte('created_at',prevStart.toISOString()).lte('created_at',prevEnd.toISOString())
          if(companyId) qprev = qprev.eq('company_id',companyId)
          const {data:prevSales} = await qprev
          const prevActive = (prevSales||[]).filter(s=>s.status!=='cancelled')
          if(isMounted) setPrevStats({salesTotal:prevActive.reduce((a,s)=>a+(s.total||0),0),salesCount:prevActive.length})
        } else {
          if(isMounted) setPrevStats({salesTotal:0,salesCount:0})
        }
        setRecentSales(activeSales.slice(0,5))

        // Gráfico: últimos 6 meses sempre (independente do filtro)
        const months=[]
        for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);months.push({label:d.toLocaleDateString('pt-BR',{month:'short'}),m:d.getMonth(),y:d.getFullYear()})}
        const sixAgo = new Date(); sixAgo.setMonth(sixAgo.getMonth()-6)
        let qc = supabase.from('sales').select('total,created_at,status').gte('created_at',sixAgo.toISOString()).limit(2000)
        if(companyId) qc = qc.eq('company_id',companyId)
        const {data:allSales} = await qc
        if(!isMounted) return;
        setChartData(months.map(m=>({name:m.label,receita:(allSales||[]).filter(s=>s.status!=='cancelled'&&(()=>{const d=new Date(s.created_at);return d.getMonth()===m.m&&d.getFullYear()===m.y})()).reduce((a,s)=>a+(s.total||0),0)})))
      } catch(err) { console.error(err) }
      finally { if(isMounted) setLoading(false) }
    }
    loadDash()
    return () => { isMounted = false; }
  },[companyId, getPeriodRange])

  const {label: periodLabel} = getPeriodRange()

  const years = []
  for(let y = now.getFullYear(); y >= now.getFullYear()-3; y--) years.push(y)

  const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

  const today = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})
  const ticketMedio = stats.salesCount ? stats.salesTotal/stats.salesCount : 0

  // Helper de card de métrica estilo dashboard profissional
  const MCard = ({label,value,sub,icon,accent=C.navy,bg='#fff',onClick,fullWidth}) => (
    <div onClick={onClick} style={{
      background:bg, borderRadius:14, padding:'14px 14px 12px',
      boxShadow:'0 2px 10px rgba(13,43,94,0.07)',
      border:`1px solid rgba(13,43,94,0.08)`,
      cursor:onClick?'pointer':'default',
      transition:'transform .15s, box-shadow .15s',
      position:'relative', overflow:'hidden',
      gridColumn: fullWidth?'1/-1':undefined,
    }}
      onMouseEnter={e=>{if(onClick){e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(13,43,94,0.14)'}}}
      onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 2px 10px rgba(13,43,94,0.07)'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:accent,borderRadius:'14px 14px 0 0'}}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
        <span style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</span>
        <span style={{fontSize:20}}>{icon}</span>
      </div>
      <p style={{fontSize:24,fontWeight:900,color:accent,margin:'0 0 2px',letterSpacing:'-0.02em',lineHeight:1}}>{value}</p>
      {sub&&<p style={{fontSize:9,color:C.muted,margin:0,fontWeight:500,lineHeight:1.3}}>{sub}</p>}
      {onClick&&<p style={{fontSize:9,color:accent,margin:'5px 0 0',fontWeight:700,opacity:0.6}}>▶ detalhes</p>}
    </div>
  )

  if(loading) return <Spinner/>
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* ── HERO ── */}
      <div style={{background:`linear-gradient(135deg,${C.navy} 0%,#1a3d80 100%)`,borderRadius:18,padding:'18px 18px',color:'#fff',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:-24,right:-24,width:120,height:120,background:'rgba(34,197,94,0.1)',borderRadius:'50%'}}/>
        <div style={{position:'absolute',bottom:-16,right:56,width:72,height:72,background:'rgba(255,255,255,0.05)',borderRadius:'50%'}}/>
        <p style={{fontSize:9,opacity:0.5,margin:'0 0 2px',textTransform:'capitalize',letterSpacing:'0.04em'}}>{today}</p>
        <h1 style={{fontSize:17,fontWeight:900,margin:'0 0 2px',letterSpacing:'-0.01em'}}>Olá, {user?.email?.split('@')[0]}! 👋</h1>
        <p style={{fontSize:10,opacity:0.55,margin:'0 0 14px'}}>Resumo do período selecionado.</p>
        <div style={{display:'flex',gap:0,background:'rgba(255,255,255,0.08)',borderRadius:12,overflow:'hidden'}}>
          {[
            {label:'Faturamento',value:fmtBRL(stats.salesTotal)},
            {label:'Pedidos',value:stats.salesCount},
            {label:'Ticket Médio',value:fmtBRL(ticketMedio)},
            ...(stats.cancelledCount>0?[{label:'Cancelados',value:stats.cancelledCount,red:true}]:[])
          ].map((m,i,arr)=>(
            <div key={m.label} style={{flex:1,padding:'10px 10px',borderRight:i<arr.length-1?'1px solid rgba(255,255,255,0.1)':'none'}}>
              <p style={{fontSize:8,opacity:0.5,margin:0,textTransform:'uppercase',letterSpacing:'0.05em'}}>{m.label}</p>
              <p style={{fontSize:15,fontWeight:900,margin:'2px 0 0',letterSpacing:'-0.02em',color:m.red?'#FCA5A5':'#fff'}}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── FILTRO DE PERÍODO ── */}
      <div style={{background:'#fff',borderRadius:13,padding:'11px 13px',border:`1px solid ${C.border}`,boxShadow:'0 1px 4px rgba(13,43,94,0.05)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
          <span style={{fontSize:11}}>📅</span>
          <span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em',flex:1}}>Período</span>
          <span style={{fontSize:10,color:C.navy,fontWeight:800,background:C.surfaceAlt,padding:'3px 8px',borderRadius:6}}>{periodLabel}</span>
        </div>
        <div style={{display:'flex',gap:4,marginBottom:8}}>
          {[{v:'month',l:'Mês'},{v:'year',l:'Ano'},{v:'custom',l:'Custom'}].map(t=>(
            <button key={t.v} onClick={()=>setFilterMode(t.v)} style={{flex:1,padding:'5px 0',fontSize:10,fontWeight:700,borderRadius:7,cursor:'pointer',border:`1.5px solid ${filterMode===t.v?C.navy:C.border}`,background:filterMode===t.v?C.navy:'#fff',color:filterMode===t.v?'#fff':C.muted,transition:'all .15s'}}>{t.l}</button>
          ))}
        </div>
        {filterMode==='month'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            <select value={filterMonth} onChange={e=>setFilterMonth(+e.target.value)} style={{padding:'6px 8px',border:`1.5px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:'#fff',outline:'none'}}>
              {MONTHS_PT.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
            <select value={filterYear} onChange={e=>setFilterYear(+e.target.value)} style={{padding:'6px 8px',border:`1.5px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:'#fff',outline:'none'}}>
              {years.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
        {filterMode==='year'&&<select value={filterYear} onChange={e=>setFilterYear(+e.target.value)} style={{width:'100%',padding:'6px 8px',border:`1.5px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:'#fff',outline:'none'}}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select>}
        {filterMode==='custom'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            <div><label style={{fontSize:9,fontWeight:700,color:C.muted,display:'block',marginBottom:3}}>De</label><input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} style={{width:'100%',padding:'6px 8px',border:`1.5px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:9,fontWeight:700,color:C.muted,display:'block',marginBottom:3}}>Até</label><input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} style={{width:'100%',padding:'6px 8px',border:`1.5px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,outline:'none',boxSizing:'border-box'}}/></div>
          </div>
        )}
      </div>

      {/* ── MÉTRICAS GRID ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        {(()=>{
          const diff = prevStats.salesTotal>0 ? ((stats.salesTotal-prevStats.salesTotal)/prevStats.salesTotal*100) : null
          const diffStr = diff!==null ? `  ${diff>=0?'▲':'▼'}${Math.abs(diff).toFixed(1)}% vs mês ant.` : ''
          const diffColor = diff===null?undefined:diff>=0?C.greenLight:C.danger
          return <MCard label="Faturamento" value={fmtBRL(stats.salesTotal)} sub={`${stats.salesCount} pedidos${diffStr}`} subColor={diffColor} icon="💰" accent={C.navy} onClick={()=>{setSalesFilter({mode:'month',month:now.getMonth(),year:now.getFullYear()});setPage('sales')}}/>
        })()}
        <MCard label="Ticket Médio" value={fmtBRL(ticketMedio)} sub="por pedido" icon="🎯" accent={C.greenLight}/>
        <MCard label="Cancelamentos" value={stats.cancelledCount} sub={stats.cancelledCount>0?fmtBRL(stats.cancelledTotal)+' perdidos':'nenhum no período'} icon="🚫" accent={stats.cancelledCount>0?C.danger:C.greenLight} bg={stats.cancelledCount>0?C.dangerPale:'#fff'}/>
        <MCard label="Alertas Estoque" value={stats.stockAlerts} sub={stats.stockAlerts>0?'abaixo do mínimo':'tudo ok'} icon="⚠️" accent={stats.stockAlerts>0?C.danger:C.greenLight} bg={stats.stockAlerts>0?C.dangerPale:'#fff'} onClick={stats.stockAlerts>0?()=>{setStockFilter('alert');setPage('products')}:undefined}/>
      </div>

      {/* ── CARD ESTOQUE GRANDE ── */}
      <div onClick={()=>{setStockFilter(null);setPage('products')}} style={{background:C.navy,borderRadius:16,padding:'16px 16px',cursor:'pointer',boxShadow:'0 4px 20px rgba(13,43,94,0.2)',position:'relative',overflow:'hidden',transition:'transform .15s'}}
        onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
        onMouseLeave={e=>e.currentTarget.style.transform='none'}>
        <div style={{position:'absolute',top:-16,right:-16,width:90,height:90,background:'rgba(34,197,94,0.1)',borderRadius:'50%'}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
          <div>
            <p style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.45)',textTransform:'uppercase',letterSpacing:'0.07em',margin:0}}>Produtos · ▶ ver todos</p>
            <p style={{fontSize:26,fontWeight:900,color:'#fff',margin:'3px 0 0',letterSpacing:'-0.02em'}}>{stats.products} <span style={{fontSize:13,fontWeight:500,opacity:0.6}}>cadastrados</span></p>
          </div>
          <span style={{fontSize:26}}>📦</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:7}}>
          {[{label:'Qtd Estoque',v:`${stats.totalStock} un`,c:'rgba(255,255,255,0.85)'},{label:'Valor Custo',v:fmtBRL(stats.totalCostValue),c:'#FCD34D'},{label:'Valor Venda',v:fmtBRL(stats.totalSaleValue),c:C.green}].map(m=>(
            <div key={m.label} style={{background:'rgba(255,255,255,0.07)',borderRadius:9,padding:'7px 8px'}}>
              <p style={{fontSize:8,color:'rgba(255,255,255,0.45)',margin:0,textTransform:'uppercase',letterSpacing:'0.05em'}}>{m.label}</p>
              <p style={{fontSize:12,fontWeight:800,color:m.c,margin:'2px 0 0'}}>{m.v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── GRÁFICO ── */}
      {chartData.length>0&&(
        <div style={{background:'#fff',borderRadius:14,padding:'14px 12px',border:`1px solid ${C.border}`,boxShadow:'0 2px 10px rgba(13,43,94,0.06)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <p style={{fontSize:12,fontWeight:800,color:C.navy,margin:0}}>📈 Receita — Últimos 6 Meses</p>
            <Badge label="6 meses" color={C.surfaceAlt} text={C.muted}/>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} barSize={24}>
              <XAxis dataKey="name" tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false}/>
              <YAxis hide/>
              <Tooltip formatter={v=>[fmtBRL(v),'Receita']} contentStyle={{border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}/>
              <Bar dataKey="receita" fill={C.navy} radius={[5,5,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── ÚLTIMAS VENDAS ── */}
      <div style={{background:'#fff',borderRadius:14,padding:'14px 13px',border:`1px solid ${C.border}`,boxShadow:'0 2px 10px rgba(13,43,94,0.06)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <p style={{fontSize:12,fontWeight:800,color:C.navy,margin:0}}>🛍️ Últimas Vendas</p>
          <button onClick={()=>{setSalesFilter({mode:'month',month:now.getMonth(),year:now.getFullYear()});setPage('sales')}} style={{fontSize:10,color:C.navy,fontWeight:700,background:'none',border:'none',cursor:'pointer',padding:0}}>Ver todas ›</button>
        </div>
        {recentSales.length===0?<Empty icon="🛍️" text="Nenhuma venda neste período"/>:recentSales.map((s,i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:i<recentSales.length-1?`1px solid ${C.border}`:'none'}}>
            <div style={{display:'flex',alignItems:'center',gap:9}}>
              <div style={{width:32,height:32,background:C.surfaceAlt,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>
                {s.payment_method==='PIX'?'🔵':s.payment_method==='Dinheiro'?'💵':s.payment_method==='Crédito'?'💳':'🏦'}
              </div>
              <div>
                <p style={{fontSize:12,fontWeight:700,color:C.text,margin:0}}>{s.customer_name||'Balcão'}</p>
                <p style={{fontSize:9,color:C.muted,margin:'1px 0 0'}}>{new Date(s.created_at).toLocaleDateString('pt-BR')} · {s.payment_method||'PIX'}</p>
              </div>
            </div>
            <p style={{fontSize:13,fontWeight:800,color:C.green,margin:0}}>{fmtBRL(s.total)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── IMPORTAÇÃO EM LOTE (XLSX) ──────────────────────────────────────────────
// Importa xlsx via CDN em runtime; fallback para CSV se CDN falhar.

function BatchImportModal({companyId, onClose, onDone, toast}) {
  const [rows,     setRows    ] = useState([])
  const [parsing,  setParsing ] = useState(false)
  const [saving,   setSaving  ] = useState(false)
  const [errors,   setErrors  ] = useState([])
  const [fileType, setFileType] = useState(null) // 'xlsx' | 'csv'
  const fileRef = useRef()

  // Gera e baixa planilha XLSX de exemplo usando a lib SheetJS via CDN
  const downloadExample = async () => {
    try {
      // Tenta usar XLSX global (carregado via CDN no index.html ou importado)
      let XLSX = window.XLSX
      if(!XLSX) {
        // Carrega dinamicamente
        await new Promise((res,rej)=>{
          const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)
        })
        XLSX = window.XLSX
      }
      const data = [
        {Nome:'Café Espresso 500g',SKU:'CAF001',Categoria:'Bebidas','Preço Venda':29.90,'Custo':12.00,'Estoque':100,'Estoque Mínimo':10,'Unidade':'un'},
        {Nome:'Açúcar Cristal 1kg',SKU:'ACU001',Categoria:'Mercearia','Preço Venda':5.50,'Custo':2.80,'Estoque':200,'Estoque Mínimo':20,'Unidade':'kg'},
        {Nome:'Leite Integral 1L',SKU:'LEI001',Categoria:'Laticínios','Preço Venda':6.90,'Custo':4.20,'Estoque':80,'Estoque Mínimo':15,'Unidade':'un'},
      ]
      const ws = XLSX.utils.json_to_sheet(data)
      // Largura das colunas
      ws['!cols'] = [{wch:30},{wch:12},{wch:16},{wch:14},{wch:12},{wch:10},{wch:15},{wch:10}]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Produtos')
      XLSX.writeFile(wb, 'modelo_produtos.xlsx')
      toast.show('Planilha modelo baixada!')
    } catch(e) {
      toast.show('Erro ao gerar xlsx, baixando CSV...','warning')
      // Fallback CSV
      const csv='Nome,SKU,Categoria,Preço Venda,Custo,Estoque,Estoque Mínimo,Unidade\nCafé Espresso 500g,CAF001,Bebidas,29.90,12.00,100,10,un'
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'})
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='modelo_produtos.csv';a.click();URL.revokeObjectURL(url)
    }
  }

  const parseXLSX = async(file) => {
    let XLSX = window.XLSX
    if(!XLSX) {
      await new Promise((res,rej)=>{
        const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)
      })
      XLSX = window.XLSX
    }
    return new Promise((resolve)=>{
      const reader = new FileReader()
      reader.onload = ev => {
        const wb = XLSX.read(ev.target.result, {type:'array'})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json(ws, {defval:''})
        resolve(json)
      }
      reader.readAsArrayBuffer(file)
    })
  }

  const normalizeRow = (raw, i) => {
    // Suporta cabeçalhos em PT e EN
    const g = (...keys) => { for(const k of keys){const v=raw[k];if(v!=null&&v!=='')return String(v)} return '' }
    return {
      _line: i+2,
      name:           g('Nome','nome','name','NOME'),
      sku:            g('SKU','sku'),
      category:       g('Categoria','categoria','category'),
      price:          parseFloat(String(g('Preço Venda','preco','price','Preco Venda','PREÇO VENDA')).replace(',','.'))||0,
      cost_price:     parseFloat(String(g('Custo','custo','cost')).replace(',','.'))||null,
      stock_quantity: parseInt(g('Estoque','estoque','stock'))||0,
      min_stock:      parseInt(g('Estoque Mínimo','estoque_minimo','min_stock','Estoque Minimo'))||5,
      unit:           g('Unidade','unidade','unit')||'un',
      ean: (()=>{
        const v = String(g('EAN','ean','Código de Barras','codigo_barras','codigobarras')).replace(/\D/g,'')
        return (v.length===13 && validateGTIN13(v)) ? v : generateGTIN13()
      })(),
    }
  }

  const parseCSV = (text) => {
    const lines = text.trim().split('\n').filter(Boolean)
    if(lines.length < 2) return []
    const header = lines[0].split(',').map(h=>h.trim())
    return lines.slice(1).map((line,i) => {
      const vals = line.split(',').map(v=>v.trim())
      const raw = {}
      header.forEach((h,j)=>raw[h]=vals[j]||'')
      return normalizeRow(raw, i)
    })
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if(!file) return
    setParsing(true)
    setRows([]);setErrors([])
    try {
      let parsed = []
      if(file.name.endsWith('.xlsx')||file.name.endsWith('.xls')) {
        setFileType('xlsx')
        const json = await parseXLSX(file)
        parsed = json.map((raw,i)=>normalizeRow(raw,i))
      } else {
        setFileType('csv')
        const text = await file.text()
        parsed = parseCSV(text)
      }
      const errs = parsed.filter(r=>!r.name||!r.price||isNaN(r.price)).map(r=>`Linha ${r._line}: nome e preço obrigatórios`)
      setErrors(errs)
      setRows(parsed.filter(r=>r.name&&r.price&&!isNaN(r.price)))
    } catch(err) {
      toast.show('Erro ao ler arquivo: '+err.message,'error')
    }
    setParsing(false)
    e.target.value = ''
  }

  const importAll = async() => {
    if(!rows.length) return
    setSaving(true)
    try {
      // Verifica SKUs duplicados antes de importar
      const skus = rows.filter(r=>r.sku).map(r=>r.sku)
      if(skus.length && companyId) {
        const {data:existing} = await supabase.from('products').select('sku').in('sku',skus).eq('company_id',companyId).eq('active',true)
        if(existing?.length) {
          const dups = existing.map(e=>e.sku).join(', ')
          if(!window.confirm(`SKUs já existem: ${dups}\n\nImportar mesmo assim?`)) {
            return
          }
        }
      }
      // Gera EAN automático para produtos sem código
      const payload = rows.map(r=>({
        ...r, active:true, company_id:companyId,
        updated_at:new Date().toISOString(),
        ean: (r.ean && validateGTIN13(r.ean)) ? r.ean : generateGTIN13(),
      }))
      // Remove campo ean se der erro de coluna (fallback)
      let totalInserted = 0
      for(let i=0;i<payload.length;i+=50) {
        const chunk = payload.slice(i,i+50)
        let {error} = await supabase.from('products').insert(chunk)
        if(error?.message?.includes('ean')) {
          const chunkSemEan = chunk.map(({ean:_,...rest})=>rest)
          const {error:e2} = await supabase.from('products').insert(chunkSemEan)
          if(e2){toast.show('Erro: '+e2.message,'error');return}
        } else if(error){
          toast.show('Erro: '+error.message,'error');return
        }
        totalInserted += chunk.length
      }
      toast.show(`✅ ${totalInserted} produtos importados!`)
      onDone()
    } catch(err) {
      toast.show('Erro ao importar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="📥 Importar Produtos em Lote" onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {/* Instruções */}
        <div style={{background:C.infoPale,border:`1.5px solid ${C.info}`,borderRadius:10,padding:'10px 12px'}}>
          <p style={{fontSize:12,fontWeight:700,color:C.info,margin:'0 0 6px'}}>📋 Como usar</p>
          <p style={{fontSize:11,color:C.info,margin:'0 0 10px',lineHeight:1.6}}>
            1. Baixe a planilha modelo Excel (.xlsx)<br/>
            2. Preencha os dados (não altere os cabeçalhos)<br/>
            3. Salve e faça o upload abaixo
          </p>
          <button onClick={downloadExample} style={{background:C.info,color:C.white,border:'none',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:700,cursor:'pointer'}}>
            ⬇️ Baixar Planilha Modelo (.xlsx)
          </button>
        </div>

        {/* Colunas esperadas */}
        <div style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 14px'}}>
          <p style={{fontSize:11,fontWeight:700,color:C.navy,margin:'0 0 6px'}}>📊 Colunas da planilha</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
            {['Nome *','SKU','Categoria','Preço Venda *','Custo','Estoque','Estoque Mínimo','Unidade'].map(col=>(
              <div key={col} style={{fontSize:10,color:C.muted,display:'flex',alignItems:'center',gap:4}}>
                <span style={{color:col.includes('*')?C.danger:C.green,fontWeight:700}}>{col.includes('*')?'●':'○'}</span>{col.replace(' *','')}
                {col.includes('*')&&<span style={{color:C.danger,fontSize:9}}>(obrigatório)</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Upload */}
        <div>
          <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:8}}>
            Selecionar Arquivo
          </label>
          <div
            onClick={()=>fileRef.current?.click()}
            style={{border:`2px dashed ${C.border}`,borderRadius:12,padding:'24px 16px',textAlign:'center',cursor:'pointer',transition:'border-color .15s'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.navy}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
          >
            <p style={{fontSize:28,margin:'0 0 8px'}}>📂</p>
            <p style={{fontSize:13,fontWeight:600,color:C.navy,margin:'0 0 4px'}}>{parsing?'Processando...':'Clique para selecionar'}</p>
            <p style={{fontSize:11,color:C.muted,margin:0}}>.xlsx (recomendado) ou .csv</p>
            {fileType&&<p style={{fontSize:11,color:C.info,margin:'4px 0 0',fontWeight:700}}>Formato: {fileType.toUpperCase()}</p>}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} style={{display:'none'}}/>
        </div>

        {/* Erros */}
        {errors.length>0&&(
          <div style={{background:C.dangerPale,border:`1.5px solid #FCA5A5`,borderRadius:10,padding:'10px 14px'}}>
            <p style={{fontSize:12,fontWeight:700,color:C.danger,margin:'0 0 6px'}}>⚠️ {errors.length} linha(s) ignorada(s):</p>
            {errors.map((e,i)=><p key={i} style={{fontSize:11,color:C.danger,margin:'2px 0'}}>{e}</p>)}
          </div>
        )}

        {/* Preview */}
        {rows.length>0&&(
          <div>
            <p style={{fontSize:12,fontWeight:700,color:C.navy,margin:'0 0 8px'}}>✅ {rows.length} produto(s) prontos para importar:</p>
            <div style={{maxHeight:220,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:10}}>
              {/* Header */}
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',padding:'6px 12px',background:C.navy,borderRadius:'10px 10px 0 0'}}>
                {['Produto','Estoque','Custo','Venda'].map(h=><span key={h} style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.7)',textTransform:'uppercase'}}>{h}</span>)}
              </div>
              {rows.map((r,i)=>(
                <div key={i} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',padding:'8px 12px',borderBottom:i<rows.length-1?`1px solid ${C.border}`:'none',background:i%2===0?C.white:C.surface,alignItems:'center'}}>
                  <div style={{minWidth:0}}>
                    <p style={{fontSize:12,fontWeight:700,color:C.text,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</p>
                    <p style={{fontSize:10,color:C.muted,margin:0}}>{r.sku||'—'} · {r.category||'—'}</p>
                  </div>
                  <span style={{fontSize:12,color:C.text}}>{r.stock_quantity} {r.unit}</span>
                  <span style={{fontSize:12,color:C.warning}}>{r.cost_price?fmtBRL(r.cost_price):'—'}</span>
                  <span style={{fontSize:12,fontWeight:800,color:C.navy}}>{fmtBRL(r.price)}</span>
                </div>
              ))}
            </div>
            {/* Totais do preview */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
              <Card style={{padding:'8px 10px',textAlign:'center'}}>
                <p style={{fontSize:18,fontWeight:800,color:C.navy,margin:0}}>{rows.length}</p>
                <p style={{fontSize:10,color:C.muted,margin:0}}>produtos</p>
              </Card>
              <Card style={{padding:'8px 10px',textAlign:'center'}}>
                <p style={{fontSize:13,fontWeight:800,color:C.warning,margin:0}}>{fmtBRL(rows.reduce((a,r)=>a+(r.cost_price||0)*r.stock_quantity,0))}</p>
                <p style={{fontSize:10,color:C.muted,margin:0}}>custo total</p>
              </Card>
              <Card style={{padding:'8px 10px',textAlign:'center'}}>
                <p style={{fontSize:13,fontWeight:800,color:C.green,margin:0}}>{fmtBRL(rows.reduce((a,r)=>a+r.price*r.stock_quantity,0))}</p>
                <p style={{fontSize:10,color:C.muted,margin:0}}>valor venda</p>
              </Card>
            </div>
          </div>
        )}

        <div style={{display:'flex',gap:8}}>
          <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
          <div style={{flex:1}}>
            <Btn onClick={importAll} variant="primary" full disabled={!rows.length||saving}>
              {saving?'Importando...':`Importar ${rows.length} produto(s)`}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── PRODUTOS ───────────────────────────────────────────────────────────────
function useEscConfirm(isOpen, isDirty, onClose) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (isDirty) {
        if (window.confirm('Tem certeza que deseja fechar? As alterações não salvas serão perdidas.')) onClose()
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, isDirty, onClose])
}

function PageProducts({companyId, stockFilter, setStockFilter, canAddProduct}) {
  const [products,setProducts] = useState([])
  const [loading,setLoading] = useState(true)
  const [search,setSearch] = useState('')
  const [categoryFilter,setCategoryFilter] = useState('') // categoria selecionada nos filtros rápidos
  const [sortBy,setSortBy] = useState('name') // name | margin | stock_critical | best_sellers
  const [showFilters,setShowFilters] = useState(false)
  const [salesByProduct,setSalesByProduct] = useState({}) // {product_id: qtyVendida} para "Mais vendidos"
  const [showModal,setShowModal] = useState(false)
  const [showBatch,setShowBatch] = useState(false)
  const [editProduct,setEditProduct] = useState(null)
  const [saving,setSaving] = useState(false)
  const [deleting,setDeleting] = useState(false)
  const emptyForm = {name:'',sku:'',category:'',price:'',cost:'',stock:'',min_stock:'5',unit:'un',ean:'',image_url:''}
  const [form,setForm] = useState(emptyForm)
  const toast = useToast()

  const deferredSearch = useDeferredValue(search)

  // Detecta se o form tem dados preenchidos (para confirmação no ESC)
  const isFormDirty = showModal && (form.name||form.price||form.cost||form.sku||form.category) !== ''
  const closeModal = useCallback(() => { setShowModal(false); setEditProduct(null); setForm(emptyForm) }, [])
  useEscConfirm(showModal, !!editProduct || isFormDirty, closeModal)

  const fetchProducts = useCallback(async (isMounted = true) => {
    setLoading(true)
    try {
      let q = supabase.from('products').select('*').eq('active',true).order('name').limit(500)
      if(companyId) q = q.eq('company_id',companyId)
      const {data} = await q
      if(isMounted) setProducts(data||[])
    } catch(err) { console.error(err) }
    finally { if(isMounted) setLoading(false) }
  }, [companyId])

  useEffect(()=>{ 
    let isMounted = true;
    fetchProducts(isMounted);
    return () => { isMounted = false; }
  },[fetchProducts])

  // Busca quantidade vendida por produto (últimos 30 dias) — usado no filtro "Mais vendidos"
  useEffect(()=>{
    let isMounted = true
    ;(async()=>{
      try {
        const since = new Date(); since.setDate(since.getDate()-30)
        let q = supabase.from('sale_items').select('product_id, quantity').gte('created_at', since.toISOString())
        if(companyId) q = q.eq('company_id', companyId)
        const {data, error} = await q
        if(error) return // tabela pode não existir ainda — falha silenciosa
        const totals = {}
        ;(data||[]).forEach(i=>{ totals[i.product_id] = (totals[i.product_id]||0) + (i.quantity||0) })
        if(isMounted) setSalesByProduct(totals)
      } catch(e) { /* sale_items pode não existir — ok ignorar */ }
    })()
    return ()=>{ isMounted=false }
  },[companyId])

  // Lista de categorias únicas para o filtro rápido
  const categories = useMemo(() => {
    const set = new Set(products.map(p=>p.category).filter(Boolean))
    return Array.from(set).sort()
  }, [products])

  const filtered = useMemo(() => {
    const term = deferredSearch.toLowerCase().trim()
    let list = products.filter(p=>
      p.name?.toLowerCase().includes(term) ||
      p.sku?.toLowerCase().includes(term) ||
      p.ean?.toLowerCase().includes(term)
    )
    if(stockFilter==='alert') list = list.filter(p=>(p.stock_quantity||0)<=(p.min_stock||5))
    if(categoryFilter) list = list.filter(p=>p.category===categoryFilter)

    // Ordenação estilo varejo
    const margin = p => p.cost_price&&p.price?((p.price-p.cost_price)/p.price):-Infinity
    list = [...list]
    switch(sortBy) {
      case 'margin':
        list.sort((a,b)=>margin(b)-margin(a))
        break
      case 'stock_critical':
        list.sort((a,b)=>{
          const aCrit = (a.stock_quantity||0)<=(a.min_stock||5) ? 0 : 1
          const bCrit = (b.stock_quantity||0)<=(b.min_stock||5) ? 0 : 1
          if(aCrit!==bCrit) return aCrit-bCrit
          return (a.stock_quantity||0)-(b.stock_quantity||0)
        })
        break
      case 'best_sellers':
        list.sort((a,b)=>(salesByProduct[b.id]||0)-(salesByProduct[a.id]||0))
        break
      default:
        list.sort((a,b)=>(a.name||'').localeCompare(b.name||''))
    }
    return list
  }, [products, deferredSearch, stockFilter, categoryFilter, sortBy, salesByProduct])

  const stockTag = p => {
    if(!(p.stock_quantity||0)) return {label:'Sem Estoque',bg:C.dangerPale,text:C.danger}
    if((p.stock_quantity||0)<=(p.min_stock||5)) return {label:'Crítico',bg:C.warningPale,text:C.warning}
    return {label:'Normal',bg:C.greenPale,text:C.greenLight}
  }

  const openNew = () => {
    const check = canAddProduct ? canAddProduct() : { ok: true }
    if(!check.ok) { toast.show(check.reason, 'error'); return }
    setEditProduct(null); setForm(emptyForm); setShowModal(true)
  }

  const openEdit = (p) => {
    setEditProduct(p)
    setForm({name:p.name||'',sku:p.sku||'',category:p.category||'',price:p.price!=null?String(p.price):'',cost:p.cost_price!=null?String(p.cost_price):'',stock:p.stock_quantity!=null?String(p.stock_quantity):'',min_stock:p.min_stock!=null?String(p.min_stock):'5',unit:p.unit||'un',ean:p.ean||'',image_url:p.image_url||''})
    setShowModal(true)
  }

  const save = async()=>{
    if(!form.name||!form.price){toast.show('Nome e preço obrigatórios','error');return}
    setSaving(true)
    try {
      // EAN: gera automaticamente se vazio
      const eanValue = (form.ean && validateGTIN13(form.ean)) ? form.ean : generateGTIN13()
      const payload = {
        name:form.name, sku:form.sku||null, category:form.category||null,
        price:parseFloat(form.price), cost_price:parseFloat(form.cost)||null,
        stock_quantity:parseInt(form.stock)||0, min_stock:parseInt(form.min_stock)||5,
        unit:form.unit, updated_at:new Date().toISOString(),
        ean: eanValue,
        image_url: form.image_url||null,
      }
      let error
      if(editProduct) {
        ({error} = await supabase.from('products').update(payload).eq('id',editProduct.id))
      } else {
        ({error} = await supabase.from('products').insert({...payload,active:true,company_id:companyId}))
      }
      // Se erro for sobre coluna ean inexistente, salva sem ela
      if(error?.message?.includes('ean')) {
        const {ean:_ean,...payloadSemEan} = payload
        const {error:e2} = editProduct
          ? await supabase.from('products').update(payloadSemEan).eq('id',editProduct.id)
          : await supabase.from('products').insert({...payloadSemEan,active:true,company_id:companyId})
        if(e2){toast.show('Erro: '+e2.message,'error');return}
      } else if(error){toast.show('Erro: '+error.message,'error');return}
      // Atualiza o ean no form para mostrar o gerado
      setForm(p=>({...p,ean:eanValue}))
      toast.show(editProduct?'Produto atualizado!':'Produto cadastrado!')
      closeModal();fetchProducts()
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = async()=>{
    if(!editProduct) return
    if(!window.confirm(`Desativar "${editProduct.name}"? Ele não aparecerá mais no sistema.`)) return
    setDeleting(true)
    try {
      await supabase.from('products').update({active:false,updated_at:new Date().toISOString()}).eq('id',editProduct.id)
      toast.show('Produto removido!')
      closeModal();fetchProducts()
    } catch(err) {
      toast.show('Erro ao remover: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setDeleting(false)
    }
  }

  const f = k => v => setForm(p=>({...p,[k]:v}))
  const margin = p => p.cost_price&&p.price?Math.round(((p.price-p.cost_price)/p.price)*100):null
  const formMargin = (form.price&&form.cost&&+form.price>0&&+form.cost>0) ? Math.round(((+form.price-+form.cost)/+form.price)*100) : null

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Produtos" sub={`${products.length} cadastrados`} action={
        <div style={{display:'flex',gap:6}}>
          <Btn size="sm" variant="ghost" onClick={()=>setShowBatch(true)}>📥 Importar</Btn>
          <Btn size="sm" onClick={openNew}>+ Novo</Btn>
        </div>
      }/>

      {/* Banner de filtro ativo vindo do Dashboard */}
      {stockFilter==='alert'&&(
        <div style={{background:C.warningPale,border:`1.5px solid ${C.warning}`,borderRadius:10,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:12,fontWeight:700,color:C.warning}}>⚠️ Exibindo apenas produtos com estoque crítico ou zerado</span>
          <button onClick={()=>setStockFilter(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:700,color:C.warning,textDecoration:'underline'}}>Limpar filtro</button>
        </div>
      )}

      <PlanLimitNotice check={canAddProduct ? canAddProduct() : null} />

      <Input value={search} onChange={setSearch} placeholder="🔍 Buscar por nome, SKU ou EAN..."/>

      {/* Filtros avançados — estilo Microvix */}
      <div>
        <button onClick={()=>setShowFilters(v=>!v)} style={{background:'none',border:'none',cursor:'pointer',fontSize:11,fontWeight:700,color:C.navy,padding:0,display:'flex',alignItems:'center',gap:4}}>
          🎛️ Filtros avançados {showFilters?'▲':'▼'}
        </button>
        {showFilters&&(
          <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:8}}>
            {categories.length>0&&(
              <div>
                <p style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.05em',margin:'0 0 4px'}}>Categoria</p>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  <button onClick={()=>setCategoryFilter('')} style={{padding:'4px 10px',borderRadius:99,border:`1.5px solid ${!categoryFilter?C.navy:C.border}`,background:!categoryFilter?C.navy:C.white,color:!categoryFilter?C.white:C.text,fontSize:11,fontWeight:600,cursor:'pointer'}}>Todas</button>
                  {categories.map(cat=>(
                    <button key={cat} onClick={()=>setCategoryFilter(cat)} style={{padding:'4px 10px',borderRadius:99,border:`1.5px solid ${categoryFilter===cat?C.navy:C.border}`,background:categoryFilter===cat?C.navy:C.white,color:categoryFilter===cat?C.white:C.text,fontSize:11,fontWeight:600,cursor:'pointer'}}>{cat}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.05em',margin:'0 0 4px'}}>Ordenar por</p>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[
                  {key:'name',label:'Nome (A-Z)'},
                  {key:'best_sellers',label:'🔥 Mais vendidos'},
                  {key:'stock_critical',label:'⚠️ Estoque crítico'},
                  {key:'margin',label:'💰 Maior margem'},
                ].map(opt=>(
                  <button key={opt.key} onClick={()=>setSortBy(opt.key)} style={{padding:'4px 10px',borderRadius:99,border:`1.5px solid ${sortBy===opt.key?C.green:C.border}`,background:sortBy===opt.key?C.greenPale:C.white,color:sortBy===opt.key?C.greenLight:C.text,fontSize:11,fontWeight:600,cursor:'pointer'}}>{opt.label}</button>
                ))}
              </div>
            </div>
            {(categoryFilter||sortBy!=='name')&&(
              <button onClick={()=>{setCategoryFilter('');setSortBy('name')}} style={{alignSelf:'flex-start',background:'none',border:'none',cursor:'pointer',fontSize:11,fontWeight:700,color:C.muted,textDecoration:'underline',padding:0}}>Limpar filtros</button>
            )}
          </div>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
        {[{label:'Sem Estoque',val:products.filter(p=>!(p.stock_quantity||0)).length,c:C.danger},{label:'Crítico',val:products.filter(p=>(p.stock_quantity||0)>0&&(p.stock_quantity||0)<=(p.min_stock||5)).length,c:C.warning},{label:'Normal',val:products.filter(p=>(p.stock_quantity||0)>(p.min_stock||5)).length,c:C.green}].map(s=>(
          <Card key={s.label} style={{textAlign:'center',padding:'10px 8px'}}>
            <p style={{fontSize:20,fontWeight:800,color:s.c,margin:0}}>{s.val}</p>
            <p style={{fontSize:10,color:C.muted,margin:'2px 0 0',fontWeight:700}}>{s.label}</p>
          </Card>
        ))}
      </div>
      {loading?<Spinner/>:filtered.length===0?<Empty icon="📦" text="Nenhum produto"/>:filtered.map(p=>{
        const st=stockTag(p)
        return (
          <Card key={p.id} onClick={()=>openEdit(p)} style={{cursor:'pointer',transition:'box-shadow 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(13,43,94,0.10)'}
            onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
              {p.image_url&&<img src={p.image_url} alt={p.name} style={{width:48,height:48,borderRadius:10,objectFit:'cover',flexShrink:0,border:`1px solid ${C.border}`}} onError={e=>e.target.style.display='none'}/>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:3}}>
                  <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{p.name}</p>
                  {p.sku&&<Badge label={p.sku} color={C.surfaceAlt} text={C.muted}/>}
                </div>
                <p style={{fontSize:11,color:C.muted,margin:'0 0 6px'}}>{p.category||'—'}</p>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:15,fontWeight:800,color:C.navy}}>{fmtBRL(p.price)}</span>
                  {p.cost_price&&<span style={{fontSize:11,color:C.muted}}>Custo: {fmtBRL(p.cost_price)}</span>}
                  {margin(p)!==null&&<Badge label={`Margem ${margin(p)}%`} color={C.greenPale} text={C.greenLight}/>}
                  <Badge label={st.label} color={st.bg} text={st.text}/>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                <div style={{textAlign:'right'}}>
                  <p style={{fontSize:10,color:C.muted,margin:0}}>Estoque</p>
                  <p style={{fontSize:18,fontWeight:800,color:st.text,margin:'2px 0 0'}}>{p.stock_quantity||0}</p>
                  <p style={{fontSize:10,color:C.muted,margin:0}}>{p.unit||'un'}</p>
                </div>
                <span style={{fontSize:10,color:C.subtle,fontWeight:600}}>✏️ editar</span>
              </div>
            </div>
          </Card>
        )
      })}

      {/* ── MODAL IMPORTAÇÃO EM LOTE ─────────────────────────────────── */}
      {showBatch&&<BatchImportModal companyId={companyId} onClose={()=>setShowBatch(false)} onDone={()=>{setShowBatch(false);fetchProducts()}} toast={toast}/>}

      {showModal&&(
        <Modal title={editProduct?`Editar — ${editProduct.name}`:'Novo Produto'} onClose={closeModal}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <Input label="Nome" value={form.name} onChange={f('name')} placeholder="Ex: Café Espresso 500g" required/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="SKU" value={form.sku} onChange={f('sku')} placeholder="CAF001"/>
              <Input label="Categoria" value={form.category} onChange={f('category')} placeholder="Bebidas"/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="Preço Venda" type="number" value={form.price} onChange={f('price')} prefix="R$" required/>
              <Input label="Custo" type="number" value={form.cost} onChange={f('cost')} prefix="R$"/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
              <Input label="Estoque" type="number" value={form.stock} onChange={f('stock')} placeholder="0"/>
              <Input label="Mínimo" type="number" value={form.min_stock} onChange={f('min_stock')} placeholder="5"/>
              <Select label="Unidade" value={form.unit} onChange={f('unit')} options={['un','kg','g','L','ml','cx','pct','sc']}/>
            </div>
            {/* EAN / Código de Barras */}
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:5}}>
                <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>EAN / Código de Barras</label>
                <button type="button" onClick={()=>f('ean')(generateGTIN13())} style={{fontSize:10,fontWeight:700,color:C.info,background:'none',border:'none',cursor:'pointer',padding:0}}>
                  🔄 Gerar automático
                </button>
              </div>
              <div style={{position:'relative'}}>
                <input type="text" value={form.ean} onChange={e=>f('ean')(e.target.value)} placeholder="Ex: 7891234567890 (13 dígitos)"
                  maxLength={13}
                  style={{width:'100%',padding:'10px 12px',border:`1.5px solid ${form.ean&&!validateGTIN13(form.ean)?C.danger:C.border}`,borderRadius:9,fontSize:13,color:C.text,background:C.white,outline:'none',boxSizing:'border-box',fontFamily:'monospace',letterSpacing:'0.1em'}}
                  onFocus={e=>e.target.style.borderColor=C.navy} onBlur={e=>e.target.style.borderColor=form.ean&&!validateGTIN13(form.ean)?C.danger:C.border}/>
                {form.ean&&(
                  <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',fontSize:11,fontWeight:700,color:validateGTIN13(form.ean)?C.green:C.danger}}>
                    {validateGTIN13(form.ean)?'✓ Válido':'✗ Inválido'}
                  </span>
                )}
              </div>
              <p style={{fontSize:10,color:C.muted,margin:'3px 0 0'}}>Deixe em branco para gerar automaticamente ao salvar (GTIN-13 padrão GS1 Brasil)</p>
            </div>
            {/* Foto do Produto */}
            <div>
              <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:5}}>Foto do Produto (URL)</label>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input value={form.image_url||''} onChange={e=>setForm(p=>({...p,image_url:e.target.value}))} placeholder="https://... ou deixe vazio"
                  style={{flex:1,padding:'9px 12px',border:`1.5px solid ${C.border}`,borderRadius:9,fontSize:12,color:C.text,outline:'none',boxSizing:'border-box'}}
                  onFocus={e=>e.target.style.borderColor=C.navy} onBlur={e=>e.target.style.borderColor=C.border}/>
                {form.image_url&&<img src={form.image_url} alt="" style={{width:44,height:44,borderRadius:8,objectFit:'cover',border:`1px solid ${C.border}`,flexShrink:0}} onError={e=>e.target.style.display='none'}/>}
              </div>
            </div>
            {formMargin!==null&&(
              <div style={{background:C.surfaceAlt,borderRadius:10,padding:12}}>
                <p style={{fontSize:11,fontWeight:700,color:C.navy,margin:'0 0 8px',textTransform:'uppercase'}}>📊 Formação de Preço</p>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:12,color:C.muted}}>Margem Bruta</span>
                  <span style={{fontSize:13,fontWeight:700,color:formMargin<0?C.danger:C.green}}>{formMargin}%</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontSize:12,color:C.muted}}>Lucro Unitário</span>
                  <span style={{fontSize:13,fontWeight:700,color:C.navy}}>{fmtBRL(+form.price-+form.cost)}</span>
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:8,marginTop:4}}>
              {editProduct&&<Btn onClick={deleteProduct} variant="danger" disabled={deleting}>{deleting?'Removendo...':'🗑 Remover'}</Btn>}
              <Btn onClick={closeModal} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':(editProduct?'Salvar Alterações':'Salvar Produto')}</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── ESTOQUE ────────────────────────────────────────────────────────────────
function PageInventory({companyId}) {
  const [products,setProducts] = useState([])
  const [loading,setLoading] = useState(true)
  const [selected,setSelected] = useState(null)
  const [type,setType] = useState('in')
  const [qty,setQty] = useState('')
  const [note,setNote] = useState('')
  const [saving,setSaving] = useState(false)
  const toast = useToast()

  const closeInventoryModal = useCallback(() => { setSelected(null); setQty(''); setNote('') }, [])
  useEscConfirm(!!selected, !!(qty||note), closeInventoryModal)

  useEffect(()=>{
    let isMounted = true;
    const loadInventory = async()=>{
      setLoading(true)
      try {
        let q = supabase.from('products').select('*').eq('active',true).order('name').limit(500)
        if(companyId) q = q.eq('company_id',companyId)
        const {data} = await q
        if(isMounted) setProducts(data||[])
      } catch(err) { console.error(err) }
      finally { if(isMounted) setLoading(false) }
    }
    loadInventory()
    return () => { isMounted = false; }
  },[companyId])

  const register = async()=>{
    if(!qty||+qty<=0){toast.show('Informe a quantidade','error');return}
    setSaving(true)
    try {
      const delta = type==='in'?+qty:-+qty
      const newStock = Math.max(0,(selected.stock_quantity||0)+delta)
      await Promise.all([
        supabase.from('products').update({stock_quantity:newStock,updated_at:new Date().toISOString()}).eq('id',selected.id),
        supabase.from('inventory_movements').insert({product_id:selected.id,company_id:companyId,type,quantity:+qty,notes:note||'Ajuste manual',created_at:new Date().toISOString()}),
      ])
      toast.show(`Novo estoque: ${newStock} ${selected.unit||'un'}`)
      setProducts(prev=>prev.map(p=>p.id===selected.id?{...p,stock_quantity:newStock}:p))
      closeInventoryModal()
    } catch(err) {
      toast.show('Erro ao registrar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const tag = p => {
    if(!(p.stock_quantity||0)) return {label:'Sem Estoque',bg:C.dangerPale,text:C.danger}
    if((p.stock_quantity||0)<=(p.min_stock||5)) return {label:'Crítico',bg:C.warningPale,text:C.warning}
    return {label:'Normal',bg:C.greenPale,text:C.greenLight}
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Controle de Estoque" sub={`${products.length} produtos`}
        action={<Btn size="sm" variant="ghost" onClick={()=>{
          const rows=[['Produto','SKU','Unidade','Qtd','Mínimo','Custo Unit.','Venda Unit.','Val.Custo Total','Val.Venda Total','Status']]
          products.forEach(p=>{
            const st=(p.stock_quantity||0)===0?'Sem estoque':(p.stock_quantity||0)<=(p.min_stock||5)?'Crítico':'Normal'
            rows.push([p.name,p.sku||'',p.unit||'un',p.stock_quantity||0,p.min_stock||5,(p.cost_price||0).toFixed(2).replace('.',','),(p.price||0).toFixed(2).replace('.',','),((p.cost_price||0)*(p.stock_quantity||0)).toFixed(2).replace('.',','),((p.price||0)*(p.stock_quantity||0)).toFixed(2).replace('.',','),st])
          })
          const csv=rows.map(r=>r.map(c=>`"${c}"`).join(';')).join('\n')
          const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})
          const url=URL.createObjectURL(blob)
          const a=document.createElement('a'); a.href=url; a.download='estoque.csv'; a.click()
          URL.revokeObjectURL(url)
        }}>📥 Relatório CSV</Btn>}
      />
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
        {[{label:'Sem Estoque',val:products.filter(p=>!(p.stock_quantity||0)).length,c:C.danger},{label:'Crítico',val:products.filter(p=>(p.stock_quantity||0)>0&&(p.stock_quantity||0)<=(p.min_stock||5)).length,c:C.warning},{label:'Normal',val:products.filter(p=>(p.stock_quantity||0)>(p.min_stock||5)).length,c:C.green}].map(s=>(
          <Card key={s.label} style={{textAlign:'center',padding:'10px 8px'}}>
            <p style={{fontSize:20,fontWeight:800,color:s.c,margin:0}}>{s.val}</p>
            <p style={{fontSize:10,color:C.muted,margin:'2px 0 0',fontWeight:700}}>{s.label}</p>
          </Card>
        ))}
      </div>
      {loading?<Spinner/>:products.map(p=>{
        const t=tag(p)
        return (
          <Card key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px'}}>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{p.name}</p>
              <div style={{display:'flex',gap:6,alignItems:'center',marginTop:5}}>
                <Badge label={t.label} color={t.bg} text={t.text}/>
                <span style={{fontSize:11,color:C.muted}}>Mín: {p.min_stock||5} {p.unit}</span>
              </div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <p style={{fontSize:20,fontWeight:800,color:t.text,margin:0}}>{p.stock_quantity||0}</p>
              <p style={{fontSize:10,color:C.muted,margin:0}}>{p.unit||'un'}</p>
            </div>
            <button onClick={()=>setSelected(p)} style={{background:C.navy,color:C.white,border:'none',borderRadius:8,padding:'7px 11px',fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0}}>Movimentar</button>
          </Card>
        )
      })}
      {selected&&(
        <Modal title={`Movimentar — ${selected.name}`} onClose={closeInventoryModal}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{background:C.surfaceAlt,borderRadius:10,padding:14}}>
              <p style={{fontSize:12,color:C.muted,margin:0}}>Estoque Atual</p>
              <p style={{fontSize:28,fontWeight:800,color:C.navy,margin:'4px 0 0'}}>{selected.stock_quantity||0} <span style={{fontSize:14,fontWeight:500}}>{selected.unit}</span></p>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Tipo</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:6}}>
                <button onClick={()=>setType('in')} style={{padding:12,border:`2px solid ${type==='in'?C.green:C.border}`,borderRadius:10,background:type==='in'?C.greenPale:C.white,color:type==='in'?C.greenLight:C.text,fontSize:13,fontWeight:700,cursor:'pointer'}}>📥 Entrada</button>
                <button onClick={()=>setType('out')} style={{padding:12,border:`2px solid ${type==='out'?C.danger:C.border}`,borderRadius:10,background:type==='out'?C.dangerPale:C.white,color:type==='out'?C.danger:C.text,fontSize:13,fontWeight:700,cursor:'pointer'}}>📤 Saída</button>
              </div>
            </div>
            <Input label="Quantidade" type="number" value={qty} onChange={setQty} placeholder="0" required/>
            <Input label="Observação" value={note} onChange={setNote} placeholder="Ex: Compra do fornecedor"/>
            {qty&&+qty>0&&(
              <div style={{background:C.surfaceAlt,borderRadius:10,padding:12}}>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontSize:13,color:C.muted}}>Novo estoque</span>
                  <span style={{fontSize:15,fontWeight:800,color:C.navy}}>{Math.max(0,(selected.stock_quantity||0)+(type==='in'?+qty:-+qty))} {selected.unit}</span>
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={closeInventoryModal} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={register} variant="primary" full disabled={saving||!qty}>{saving?'Registrando...':'Registrar'}</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ── CLIENTES ────────────────────────────────────────────────────────────────
function PageCustomers({companyId}) {
  const [items,setItems] = useState([])
  const [loading,setLoading] = useState(true)
  const [editItem,setEditItem] = useState(undefined)
  const emptyForm = {name:'',phone:'',email:'',cpf_cnpj:'',address:'',notes:''}
  const [form,setForm] = useState(emptyForm)
  const [saving,setSaving] = useState(false)
  const [search,setSearch] = useState('')
  const toast = useToast()
  const f = k => v => setForm(p=>({...p,[k]:v}))

  const fetch = useCallback(async(m=true)=>{
    setLoading(true)
    let q = supabase.from('customers').select('*').order('name').limit(500)
    if(companyId) q = q.eq('company_id',companyId)
    const {data} = await q
    if(m) setItems(data||[])
    if(m) setLoading(false)
  },[companyId])

  useEffect(()=>{ let m=true; fetch(m); return()=>{m=false} },[fetch])

  const filtered = useMemo(()=>items.filter(i=>i.name?.toLowerCase().includes(search.toLowerCase())||i.phone?.includes(search)||i.cpf_cnpj?.includes(search)),[items,search])

  const openNew = () => { setEditItem(null); setForm(emptyForm) }
  const openEdit = (it) => { setEditItem(it); setForm({name:it.name||'',phone:it.phone||'',email:it.email||'',cpf_cnpj:it.cpf_cnpj||'',address:it.address||'',notes:it.notes||''}) }
  const closeModal = () => setEditItem(undefined)

  const save = async()=>{
    if(!form.name){toast.show('Nome obrigatório','error');return}
    setSaving(true)
    try {
      const payload = {name:form.name,phone:form.phone||null,email:form.email||null,cpf_cnpj:form.cpf_cnpj||null,address:form.address||null,notes:form.notes||null,company_id:companyId,updated_at:new Date().toISOString()}
      let error
      if(editItem) ({error} = await supabase.from('customers').update(payload).eq('id',editItem.id))
      else ({error} = await supabase.from('customers').insert({...payload,created_at:new Date().toISOString()}))
      if(error){toast.show('Erro: '+error.message,'error');return}
      toast.show(editItem?'Cliente atualizado!':'Cliente cadastrado!')
      closeModal(); fetch()
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const del = async()=>{
    if(!editItem||!window.confirm(`Excluir cliente "${editItem.name}"?`)) return
    await supabase.from('customers').delete().eq('id',editItem.id)
    toast.show('Cliente removido!'); closeModal(); fetch()
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Clientes" sub={`${items.length} cadastrados`} action={<Btn size="sm" onClick={openNew}>+ Novo Cliente</Btn>}/>
      <Input value={search} onChange={setSearch} placeholder="🔍 Buscar por nome, telefone ou CPF/CNPJ..."/>
      {loading?<Spinner/>:filtered.length===0?<Empty icon="👥" text="Nenhum cliente"/>:filtered.map(it=>(
        <Card key={it.id} onClick={()=>openEdit(it)} style={{cursor:'pointer'}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(13,43,94,0.1)'}
          onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,background:C.navy,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:800,fontSize:15,flexShrink:0}}>{(it.name||'C')[0].toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{it.name}</p>
              <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{[it.phone,it.cpf_cnpj,it.email].filter(Boolean).join(' · ')||'Sem contato'}</p>
            </div>
            <span style={{fontSize:10,color:C.subtle}}>✏️</span>
          </div>
        </Card>
      ))}
      {editItem!==undefined&&(
        <Modal title={editItem?`Editar — ${editItem.name}`:'Novo Cliente'} onClose={closeModal}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="Nome completo"/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="Telefone" value={form.phone} onChange={f('phone')} placeholder="(11) 99999-9999"/>
              <Input label="CPF/CNPJ" value={form.cpf_cnpj} onChange={f('cpf_cnpj')} placeholder="000.000.000-00"/>
            </div>
            <Input label="E-mail" value={form.email} onChange={f('email')} placeholder="email@exemplo.com"/>
            <Input label="Endereço" value={form.address} onChange={f('address')} placeholder="Rua, número, bairro"/>
            <Input label="Observações" value={form.notes} onChange={f('notes')} placeholder="Notas internas"/>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              {editItem&&<Btn onClick={del} variant="danger">🗑 Excluir</Btn>}
              <Btn onClick={closeModal} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':(editItem?'Salvar':'Cadastrar')}</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── FORNECEDORES ─────────────────────────────────────────────────────────────
function PageSuppliers({companyId}) {
  const [items,setItems] = useState([])
  const [loading,setLoading] = useState(true)
  const [editItem,setEditItem] = useState(undefined)
  const emptyForm = {name:'',phone:'',email:'',cnpj:'',contact_name:'',address:'',notes:''}
  const [form,setForm] = useState(emptyForm)
  const [saving,setSaving] = useState(false)
  const [search,setSearch] = useState('')
  const toast = useToast()
  const f = k => v => setForm(p=>({...p,[k]:v}))

  const fetch = useCallback(async(m=true)=>{
    setLoading(true)
    let q = supabase.from('suppliers').select('*').order('name').limit(500)
    if(companyId) q = q.eq('company_id',companyId)
    const {data} = await q
    if(m) setItems(data||[])
    if(m) setLoading(false)
  },[companyId])

  useEffect(()=>{ let m=true; fetch(m); return()=>{m=false} },[fetch])

  const filtered = useMemo(()=>items.filter(i=>i.name?.toLowerCase().includes(search.toLowerCase())||i.cnpj?.includes(search)||i.contact_name?.toLowerCase().includes(search.toLowerCase())),[items,search])

  const openNew = () => { setEditItem(null); setForm(emptyForm) }
  const openEdit = (it) => { setEditItem(it); setForm({name:it.name||'',phone:it.phone||'',email:it.email||'',cnpj:it.cnpj||'',contact_name:it.contact_name||'',address:it.address||'',notes:it.notes||''}) }
  const closeModal = () => setEditItem(undefined)

  const save = async()=>{
    if(!form.name){toast.show('Nome obrigatório','error');return}
    setSaving(true)
    try {
      const payload = {name:form.name,phone:form.phone||null,email:form.email||null,cnpj:form.cnpj||null,contact_name:form.contact_name||null,address:form.address||null,notes:form.notes||null,company_id:companyId,updated_at:new Date().toISOString()}
      let error
      if(editItem) ({error} = await supabase.from('suppliers').update(payload).eq('id',editItem.id))
      else ({error} = await supabase.from('suppliers').insert({...payload,created_at:new Date().toISOString()}))
      if(error){toast.show('Erro: '+error.message,'error');return}
      toast.show(editItem?'Fornecedor atualizado!':'Fornecedor cadastrado!')
      closeModal(); fetch()
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const del = async()=>{
    if(!editItem||!window.confirm(`Excluir fornecedor "${editItem.name}"?`)) return
    await supabase.from('suppliers').delete().eq('id',editItem.id)
    toast.show('Fornecedor removido!'); closeModal(); fetch()
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Fornecedores" sub={`${items.length} cadastrados`} action={<Btn size="sm" onClick={openNew}>+ Novo Fornecedor</Btn>}/>
      <Input value={search} onChange={setSearch} placeholder="🔍 Buscar por nome, CNPJ ou contato..."/>
      {loading?<Spinner/>:filtered.length===0?<Empty icon="🏭" text="Nenhum fornecedor"/>:filtered.map(it=>(
        <Card key={it.id} onClick={()=>openEdit(it)} style={{cursor:'pointer'}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(13,43,94,0.1)'}
          onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,background:C.navyLight,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:800,fontSize:15,flexShrink:0}}>{(it.name||'F')[0].toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{it.name}</p>
              <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{[it.cnpj,it.contact_name,it.phone].filter(Boolean).join(' · ')||'Sem contato'}</p>
            </div>
            <span style={{fontSize:10,color:C.subtle}}>✏️</span>
          </div>
        </Card>
      ))}
      {editItem!==undefined&&(
        <Modal title={editItem?`Editar — ${editItem.name}`:'Novo Fornecedor'} onClose={closeModal}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Input label="Nome / Razão Social *" value={form.name} onChange={f('name')} placeholder="Empresa XYZ Ltda"/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="CNPJ" value={form.cnpj} onChange={f('cnpj')} placeholder="00.000.000/0001-00"/>
              <Input label="Contato" value={form.contact_name} onChange={f('contact_name')} placeholder="Nome do responsável"/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="Telefone" value={form.phone} onChange={f('phone')} placeholder="(11) 99999-9999"/>
              <Input label="E-mail" value={form.email} onChange={f('email')} placeholder="contato@empresa.com"/>
            </div>
            <Input label="Endereço" value={form.address} onChange={f('address')} placeholder="Rua, número, bairro"/>
            <Input label="Observações" value={form.notes} onChange={f('notes')} placeholder="Notas internas"/>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              {editItem&&<Btn onClick={del} variant="danger">🗑 Excluir</Btn>}
              <Btn onClick={closeModal} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':(editItem?'Salvar':'Cadastrar')}</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── PDV ────────────────────────────────────────────────────────────────────

// ── CUPOM NÃO FISCAL ──────────────────────────────────────────────────────
function printCupom({cart, total, payment, customer, installments, companyName, companyDoc}) {
  const now = new Date()
  const dtStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
  const lines = cart.map(i=>`
    <tr>
      <td style="padding:2px 0;font-size:12px">${i.name}</td>
      <td style="padding:2px 0;font-size:12px;text-align:center">${i.qty}</td>
      <td style="padding:2px 0;font-size:12px;text-align:right">R$${(i.price*i.qty).toFixed(2)}</td>
    </tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cupom</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:monospace;width:280px;padding:12px;font-size:12px;color:#000}
    .center{text-align:center} .bold{font-weight:bold} .line{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse}
    th{font-size:10px;text-transform:uppercase;padding:2px 0;text-align:left}
    th:nth-child(2){text-align:center} th:last-child{text-align:right}
    .total{font-size:16px;font-weight:bold;text-align:right;padding:6px 0}
    @media print{body{width:280px}}
  </style></head><body>
  <div class="center bold" style="font-size:14px;margin-bottom:4px">${companyName||'Estabelecimento'}</div>
  ${companyDoc?`<div class="center" style="font-size:10px">CNPJ: ${companyDoc}</div>`:''}
  <div class="center" style="font-size:10px;margin-bottom:6px">${dtStr}</div>
  <div class="line"></div>
  <div class="center bold" style="font-size:10px;margin:4px 0">*** NÃO É DOCUMENTO FISCAL ***</div>
  <div class="line"></div>
  <table>
    <thead><tr><th>Produto</th><th>Qtd</th><th>Total</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="line"></div>
  <div class="total">TOTAL: R$${total.toFixed(2)}</div>
  <div class="line"></div>
  <div style="font-size:11px;margin:4px 0"><b>Pagamento:</b> ${payment}${payment==='Crédito'&&installments>1?' ('+installments+'x R$'+(total/installments).toFixed(2)+')':''}</div>
  ${customer&&customer!=='Balcão'?`<div style="font-size:11px"><b>Cliente:</b> ${customer}</div>`:''}
  <div class="line"></div>
  <div class="center" style="font-size:10px;margin-top:6px">Obrigado pela preferência!</div>
  </body></html>`

  const win = window.open('','_blank','width=320,height=600')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(()=>{win.print();win.close()},400)
}

// ── NFC-e via Focus NFe ────────────────────────────────────────────────────
const FOCUS_URL = 'https://homologacao.focusnfe.com.br/v2'

async function emitirNFCe({cart, total, payment, customer, cpfCnpj='', fiscalConfig, companyId, saleRef}) {
  if(!fiscalConfig?.focus_token) throw new Error('Token Focus NFe não configurado.')
  if(!fiscalConfig?.cnpj)        throw new Error('CNPJ da empresa não configurado.')
  if(!fiscalConfig?.certificado_ok) throw new Error('Certificado digital não configurado. Contate o administrador.')

  const ref = saleRef || `${companyId?.slice(0,8)}-${Date.now()}`

  const paymentCode = {
    'Dinheiro':'01','PIX':'17','Débito':'04','Crédito':'03','Boleto':'15'
  }[payment] || '99'

  const body = {
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    forma_pagamento: '0',
    tipo_emissao: '1',
    finalidade_emissao: '1',
    consumidor_final: '1',
    presenca_comprador: '1',
    modalidade_frete: '9',
    cnpj_emitente: fiscalConfig.cnpj.replace(/\D/g,''),
    nome_emitente: fiscalConfig.razao_social || 'Empresa',
    regime_tributario_emitente: fiscalConfig.regime === 'simples' ? '1' : fiscalConfig.regime === 'mei' ? '1' : '3',
    logradouro_emitente: fiscalConfig.logradouro || 'Rua Teste',
    numero_emitente: fiscalConfig.numero || 'S/N',
    municipio_emitente: fiscalConfig.municipio || 'São Paulo',
    uf_emitente: fiscalConfig.uf || 'SP',
    cep_emitente: (fiscalConfig.cep||'01310100').replace(/\D/g,''),
    cpf_destinatario: cpfCnpj ? cpfCnpj.replace(/\D/g,'') : '',
    nome_destinatario: customer && customer !== 'Balcão' ? customer : '',
    items: cart.map((item, i) => ({
      numero_item: String(i+1),
      codigo_produto: item.sku || String(item.id).slice(0,8),
      descricao: item.name,
      cfop: fiscalConfig.cfop || '5102',
      unidade_comercial: item.unit || 'UN',
      quantidade_comercial: String(item.qty),
      valor_unitario_comercial: item.price.toFixed(2),
      valor_unitario_tributavel: item.price.toFixed(2),
      unidade_tributavel: item.unit || 'UN',
      quantidade_tributavel: String(item.qty),
      valor_bruto: (item.price * item.qty).toFixed(2),
      ncm: fiscalConfig.ncm || '00000000',
      icms_situacao_tributaria: fiscalConfig.regime === 'simples' ? '400' : '102',
      icms_modalidade_base_calculo: '3',
      pis_situacao_tributaria: '07',
      cofins_situacao_tributaria: '07',
      inclui_no_total: '1',
    })),
    formas_pagamento: [{
      forma_pagamento: paymentCode,
      valor_pagamento: total.toFixed(2),
    }],
  }

  const resp = await fetch(`${FOCUS_URL}/nfce?ref=${ref}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(fiscalConfig.focus_token + ':'),
    },
    body: JSON.stringify(body),
  })

  const data = await resp.json()
  if(!resp.ok) throw new Error(data?.mensagem || data?.erros?.[0]?.mensagem || 'Erro ao emitir NFC-e')
  return data
}

async function consultarNFCe(ref, token) {
  const resp = await fetch(`${FOCUS_URL}/nfce/${ref}`, {
    headers: { 'Authorization': 'Basic ' + btoa(token + ':') }
  })
  return await resp.json()
}

function PagePDV({companyId, canAddSale}) {
  const [products,setProducts] = useState([])
  const [cart,setCart] = useState([])
  const [search,setSearch] = useState('')
  const [barcodeInput,setBarcodeInput] = useState('')
  const [payment,setPayment] = useState('PIX')
  const [customer,setCustomer] = useState('')
  const [discount,setDiscount] = useState('') // desconto em R$
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [success,setSuccess] = useState(false)
  const [lastSaleRef,setLastSaleRef] = useState(null)
  const [fiscalConfig,setFiscalConfig] = useState(null)
  const [emittingNFCe,setEmittingNFCe] = useState(false)
  const [nfceResult,setNfceResult] = useState(null)
  const [companyName,setCompanyName] = useState('')
  const [companyDoc,setCompanyDoc] = useState('')
  const [inputMode,setInputMode] = useState('search') // 'search' | 'barcode'
  // Snapshot para tela de sucesso
  const [successCart,setSuccessCart] = useState([])
  const [successTotal,setSuccessTotal] = useState(0)
  const [successPayment,setSuccessPayment] = useState('PIX')
  const [successCustomer,setSuccessCustomer] = useState('Balcão')
  const [successInstallments,setSuccessInstallments] = useState(1)
  const [successCpf,setSuccessCpf] = useState('')
  const [cpfNota,setCpfNota] = useState('')
  const searchRef = useRef()
  const barcodeRef = useRef()
  const toast = useToast()

  const deferredSearch = useDeferredValue(search)

  // Leitor de código de barras: captura EAN e adiciona produto
  const handleBarcodeScan = (ean) => {
    const cleaned = ean.replace(/\D/g,'')
    if(cleaned.length < 8) return
    const found = products.find(p=>p.ean===cleaned||p.sku===cleaned)
    if(found) {
      addToCart(found)
      toast.show(`✅ ${found.name} adicionado`)
      setBarcodeInput('')
    } else {
      toast.show('Produto não encontrado: '+cleaned,'error')
      setBarcodeInput('')
    }
  }

  useEffect(()=>{
    let isMounted = true;
    const load = async()=>{
      setLoading(true)
      try {
        let q = supabase.from('products').select('*').eq('active',true).order('name').limit(500)
        if(companyId) q = q.eq('company_id',companyId)
        const {data} = await q
        if(isMounted) setProducts(data||[])
        // Load fiscal config & company info
        if(companyId) {
          const {data:comp} = await supabase.from('companies').select('name,cnpj,fiscal_config').eq('id',companyId).maybeSingle()
          if(isMounted && comp) {
            setCompanyName(comp.name||'')
            setCompanyDoc(comp.cnpj||'')
            setFiscalConfig(comp.fiscal_config||null)
          }
        }
      } catch(err) { console.error(err) }
      finally { if(isMounted) setLoading(false) }
    }
    load()
    return () => { isMounted = false; }
  },[companyId])

  // Atalhos de teclado
  useEffect(()=>{
    const handler = (e) => {
      if(e.key==='F2') { e.preventDefault(); if(success){setSuccess(false);setNfceResult(null)} else setCart([]); setSearch(''); setTimeout(()=>searchRef.current?.focus(),50) }
      if(e.key==='F10') { e.preventDefault(); if(!saving && cart.length > 0) finalize() }
      if(e.key==='Escape' && !success && cart.length===0) setSearch('')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  },[cart, saving, success])

  const filtered = useMemo(() => {
    return products.filter(p=>p.name?.toLowerCase().includes(deferredSearch.toLowerCase())&&(p.stock_quantity||0)>0)
  }, [products, deferredSearch])

  const addToCart = p => setCart(prev=>{
    const ex=prev.find(i=>i.id===p.id)
    if(ex){if(ex.qty>=(p.stock_quantity||999)){toast.show('Estoque insuficiente!','error');return prev}return prev.map(i=>i.id===p.id?{...i,qty:i.qty+1}:i)}
    return [...prev,{...p,qty:1}]
  })
  const changeQty = (id,delta) => setCart(prev=>prev.map(i=>i.id===id?{...i,qty:i.qty+delta}:i).filter(i=>i.qty>0))
  const subtotal = cart.reduce((a,i)=>a+i.price*i.qty,0)
  const discountVal = Math.min(parseFloat(discount)||0, subtotal)
  const total = Math.max(0, subtotal - discountVal)

  const [installments,setInstallments] = useState(1)

  const finalize = async()=>{
    if(!cart.length){toast.show('Carrinho vazio!','error');return}
    // Verifica limite de vendas mensais do plano
    if(canAddSale) {
      const check = canAddSale()
      if(!check.ok) { toast.show(check.reason, 'error'); return }
    }
    setSaving(true)
    try {
      const now = new Date()

      // Busca configuração do método de pagamento
      let pmConfig = DEFAULT_PAYMENT_METHODS.find(m=>m.key===payment)||{days:0,fee:0,instant:true}
      if(companyId) {
        const {data:pm,error:pmErr} = await supabase.from('payment_methods').select('*').eq('company_id',companyId).eq('key',payment).maybeSingle()
        if(!pmErr && pm) pmConfig = {...pmConfig,...pm}
      }

      const {error} = await supabase.from('sales').insert({
        company_id:companyId, customer_name:customer||'Balcão',
        total, payment_method:payment,
        installments: payment==='Crédito'? installments : 1,
        items_count:cart.reduce((a,i)=>a+i.qty,0),
        cpf_cnpj: cpfNota||null,
        created_at:now.toISOString(),
      })
      if(error){toast.show('Erro ao registrar venda: '+error.message,'error');return}

      const daysToReceive = +pmConfig.days||0
      const netValue = Math.round(total*(1-(+pmConfig.fee||0)/100)*100)/100
      // PIX e Dinheiro = recebimento imediato (instant=true ou days=0)
      const isInstant = payment==='PIX'||payment==='Dinheiro'

      if(isInstant) {
        // À vista: lança direto no Fluxo de Caixa
        // Usa um reference único da venda para evitar duplicatas
        const saleRef = `venda-${companyId?.slice(0,8)}-${now.getTime()}`
        await supabase.from('cashflow').insert({
          company_id:companyId,
          description:`Venda ${payment} — ${customer||'Balcão'}`,
          type:'income', value:netValue, category:'Vendas',
          created_at:now.toISOString(),
          notes: saleRef,
        })
      } else if(payment==='Crédito' && installments>1) {
        // Crédito parcelado: gera uma conta a receber por parcela
        const installmentValue = Math.round((netValue/installments)*100)/100
        const inserts = []
        for(let i=1;i<=installments;i++){
          inserts.push({
            company_id:companyId,
            description:`Venda Crédito ${i}/${installments}x — ${customer||'Balcão'}`,
            value:i===installments?netValue-installmentValue*(installments-1):installmentValue,
            due_date:calcInstallmentDueDate(now,daysToReceive,i),
            category:'Vendas', status:'pending', created_at:now.toISOString(),
          })
        }
        await supabase.from('accounts_receivable').insert(inserts)
      } else {
        // Prazo normal (Débito, Crédito 1x, Boleto): gera Contas a Receber
        const dueDate = new Date(now)
        dueDate.setDate(dueDate.getDate()+daysToReceive)
        await supabase.from('accounts_receivable').insert({
          company_id:companyId,
          description:`Venda ${payment} — ${customer||'Balcão'}`,
          value:netValue,
          due_date:dueDate.toISOString().split('T')[0],
          category:'Vendas', status:'pending', created_at:now.toISOString(),
        })
      }

      // Baixa estoque
      await Promise.all(cart.map(item=>
        supabase.from('products').update({stock_quantity:Math.max(0,(item.stock_quantity||0)-item.qty),updated_at:now.toISOString()}).eq('id',item.id)
      ))

      const ref = `sale-${companyId?.slice(0,8)}-${Date.now()}`
      setLastSaleRef(ref)
      setNfceResult(null)
      // Salva snapshot da venda para cupom/NFC-e na tela de sucesso
      setSuccessCart([...cart])
      setSuccessTotal(total)
      setSuccessPayment(payment)
      setSuccessCustomer(customer||'Balcão')
      setSuccessInstallments(installments)
      setSuccessCpf(cpfNota||'')
      setCart([]);setCustomer('');setSearch('');setInstallments(1);setDiscount('');setCpfNota('')
      setSuccess(true)
    } catch(err) {
      toast.show('Erro ao finalizar venda: '+(err?.message||'falha de conexão. Tente novamente.'),'error')
    } finally {
      setSaving(false)
    }
  }

  const handleCupom = () => {
    printCupom({cart:successCart, total:successTotal, payment:successPayment, customer:successCustomer, installments:successInstallments, companyName, companyDoc})
  }

  const handleNFCe = async() => {
    if(!fiscalConfig?.focus_token) { toast.show('NFC-e não configurada. Contate o administrador.','error'); return }
    if(!fiscalConfig?.certificado_ok) { toast.show('Certificado digital pendente. Configure em Configurações → Fiscal.','error'); return }
    setEmittingNFCe(true)
    try {
      const result = await emitirNFCe({cart:successCart,total:successTotal,payment:successPayment,customer:successCustomer,cpfCnpj:successCpf,fiscalConfig,companyId,saleRef:lastSaleRef})
      setNfceResult(result)
      toast.show('NFC-e emitida com sucesso!')
    } catch(err) {
      toast.show('Erro NFC-e: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setEmittingNFCe(false)
    }
  }

  if(success) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:300,gap:14,padding:28}}>
      {toast.el}
      <div style={{width:72,height:72,background:C.greenPale,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',fontSize:36}}>✅</div>
      <h2 style={{fontSize:20,fontWeight:800,color:C.navy,margin:0,textAlign:'center'}}>Venda Registrada!</h2>
      <p style={{color:C.muted,fontSize:13,textAlign:'center',margin:0}}>{fmtBRL(successTotal)} · {successPayment}{successPayment==='Crédito'&&successInstallments>1?` ${successInstallments}x`:''}</p>
      <div style={{display:'flex',flexDirection:'column',gap:10,width:'100%',maxWidth:280}}>
        <Btn onClick={handleCupom} variant="ghost" full>🖨️ Imprimir Cupom Não Fiscal</Btn>
        {fiscalConfig?.focus_token ? (
          <div>
            <Btn onClick={handleNFCe} variant="primary" full disabled={emittingNFCe||!!nfceResult}>
              {emittingNFCe?'Emitindo NFC-e...':nfceResult?'✅ NFC-e Emitida':'📄 Emitir NFC-e'}
            </Btn>
            {!fiscalConfig?.certificado_ok&&<p style={{fontSize:10,color:C.warning,textAlign:'center',margin:'4px 0 0'}}>⚠️ Certificado pendente — NFC-e indisponível</p>}
            {nfceResult?.caminho_danfe&&(
              <div style={{marginTop:8,background:C.greenPale,borderRadius:10,padding:10,textAlign:'center'}}>
                <p style={{fontSize:11,color:C.greenLight,fontWeight:700,margin:'0 0 6px'}}>NFC-e autorizada!</p>
                <a href={nfceResult.caminho_danfe} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.info,fontWeight:600}}>📄 Ver DANFE</a>
              </div>
            )}
            {nfceResult&&!nfceResult?.caminho_danfe&&(
              <div style={{marginTop:8,background:C.warningPale,borderRadius:10,padding:10}}>
                <p style={{fontSize:11,color:C.warning,margin:0}}>Status: {nfceResult?.status||'processando...'}</p>
              </div>
            )}
          </div>
        ) : (
          <div style={{background:C.warningPale,border:`1px solid ${C.warning}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
            <p style={{fontSize:11,color:C.warning,margin:0,fontWeight:600}}>📄 NFC-e não configurada</p>
            <p style={{fontSize:10,color:C.muted,margin:'3px 0 0'}}>Configure em Configurações → Fiscal</p>
          </div>
        )}
        <Btn variant="success" onClick={()=>{setSuccess(false);setNfceResult(null)}} full>+ Nova Venda</Btn>
      </div>
    </div>
  )

  const pmIcon = {'PIX':'⚡','Dinheiro':'💵','Crédito':'💳','Débito':'🏦','Boleto':'📄'}

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {toast.el}

      {/* ── HEADER ── */}
      <div style={{background:C.navy,borderRadius:16,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',margin:0,letterSpacing:'0.08em',textTransform:'uppercase'}}>Frente de Caixa</p>
          <p style={{fontSize:15,fontWeight:900,color:C.white,margin:'1px 0 0'}}>FC <span style={{color:C.green}}>DALITech</span></p>
        </div>
        <div style={{display:'flex',gap:16,alignItems:'center'}}>
          {cart.length>0&&(
            <div style={{textAlign:'center'}}>
              <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',margin:0}}>Subtotal</p>
              <p style={{fontSize:14,fontWeight:800,color:'#fff',margin:0}}>{fmtBRL(subtotal)}</p>
            </div>
          )}
          <div style={{textAlign:'center'}}>
            <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',margin:0,textAlign:'right'}}>F2 Nova · F10 Finalizar</p>
          <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',margin:0}}>Itens</p>
            <p style={{fontSize:20,fontWeight:900,color:C.green,margin:0}}>{cart.reduce((a,i)=>a+i.qty,0)}</p>
          </div>
        </div>
      </div>

      {/* ── INPUT MODE TOGGLE + BUSCA/LEITOR ── */}
      <div style={{background:C.white,borderRadius:14,border:`1px solid ${C.border}`,overflow:'hidden'}}>
        {/* Toggle */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderBottom:`1px solid ${C.border}`}}>
          {[{id:'search',label:'🔍 Busca',sub:'por nome'},{id:'barcode',label:'📷 Leitor',sub:'código de barras'}].map(m=>(
            <button key={m.id} onClick={()=>{setInputMode(m.id);setTimeout(()=>(m.id==='barcode'?barcodeRef:searchRef).current?.focus(),50)}}
              style={{padding:'10px 8px',border:'none',cursor:'pointer',background:inputMode===m.id?C.navy:'#fff',transition:'all .15s'}}>
              <p style={{fontSize:12,fontWeight:800,color:inputMode===m.id?'#fff':C.muted,margin:0}}>{m.label}</p>
              <p style={{fontSize:9,color:inputMode===m.id?'rgba(255,255,255,0.5)':C.muted,margin:0}}>{m.sub}</p>
            </button>
          ))}
        </div>
        <div style={{padding:'10px 12px'}}>
          {inputMode==='search'?(
            <input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Digite o nome do produto..."
              style={{width:'100%',padding:'9px 12px',border:`1.5px solid ${C.border}`,borderRadius:9,fontSize:13,color:C.text,outline:'none',boxSizing:'border-box'}}
              onFocus={e=>e.target.style.borderColor=C.navy} onBlur={e=>e.target.style.borderColor=C.border}
            />
          ):(
            <div>
              <input ref={barcodeRef} value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&barcodeInput.trim()){handleBarcodeScan(barcodeInput.trim())}}}
                placeholder="📷 Aponte o leitor ou digite o EAN..."
                autoFocus
                style={{width:'100%',padding:'9px 12px',border:`2px solid ${C.green}`,borderRadius:9,fontSize:13,color:C.text,outline:'none',boxSizing:'border-box',fontFamily:'monospace',letterSpacing:'0.08em'}}
              />
              <p style={{fontSize:10,color:C.muted,margin:'5px 0 0',textAlign:'center'}}>Bipie o produto ou pressione <strong>Enter</strong> após digitar o código</p>
            </div>
          )}
        </div>
      </div>

      {/* ── GRID DE PRODUTOS ── */}
      {loading?<Spinner/>:(
        <div>
          <div style={{maxHeight:320,overflowY:filtered.length>6?'auto':'visible',borderRadius:12}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
              {filtered.map(p=>{
                const inCart = cart.find(i=>i.id===p.id)
                const low = (p.stock_quantity||0)<=(p.min_stock||5)
                const noStock = (p.stock_quantity||0)===0
                return (
                  <div key={p.id} style={{
                    background:inCart?C.navy:noStock?'#f8f8f8':C.white,
                    border:`2px solid ${inCart?C.green:noStock?C.border:C.border}`,
                    borderRadius:12,padding:'9px 8px 7px',
                    position:'relative',transition:'all .15s',
                    display:'flex',flexDirection:'column',gap:2,
                    opacity:noStock?0.5:1,
                  }}>
                    {inCart&&<div style={{position:'absolute',top:5,right:5,width:17,height:17,background:C.green,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:900,color:'#fff'}}>{inCart.qty}</div>}
                    <button onClick={()=>!noStock&&addToCart(p)} disabled={noStock} style={{background:'none',border:'none',padding:0,cursor:noStock?'not-allowed':'pointer',textAlign:'left'}}>
                      <p style={{fontSize:10,fontWeight:700,color:inCart?'rgba(255,255,255,0.9)':C.text,margin:'0 0 2px',lineHeight:1.3,paddingRight:inCart?14:0,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{p.name}</p>
                      <p style={{fontSize:13,fontWeight:900,color:inCart?C.green:C.navy,margin:'0 0 1px'}}>{fmtBRL(p.price)}</p>
                      <p style={{fontSize:8,color:noStock?C.danger:low?(inCart?'#FCA5A5':C.warning):(inCart?'rgba(255,255,255,0.4)':C.muted),margin:0,fontWeight:low||noStock?700:400}}>
                        {noStock?'Sem estoque':low?`⚠️ ${p.stock_quantity} ${p.unit}`:`${p.stock_quantity} ${p.unit}`}
                      </p>
                    </button>
                    {inCart&&(
                      <div style={{display:'flex',gap:3,marginTop:3}}>
                        <button onClick={()=>changeQty(p.id,-1)} style={{flex:1,background:'rgba(255,255,255,0.12)',border:'none',borderRadius:5,padding:'2px 0',cursor:'pointer',fontSize:13,fontWeight:900,color:'#fff'}}>−</button>
                        <button onClick={()=>changeQty(p.id,1)} disabled={inCart.qty>=(p.stock_quantity||999)} style={{flex:1,background:'rgba(34,197,94,0.2)',border:'none',borderRadius:5,padding:'2px 0',cursor:'pointer',fontSize:13,fontWeight:900,color:C.green,opacity:inCart.qty>=(p.stock_quantity||999)?0.4:1}}>+</button>
                        <button onClick={()=>setCart(prev=>prev.filter(i=>i.id!==p.id))} style={{flex:1,background:'rgba(239,68,68,0.15)',border:'none',borderRadius:5,padding:'2px 0',cursor:'pointer',fontSize:10,fontWeight:700,color:'#FCA5A5'}}>✕</button>
                      </div>
                    )}
                  </div>
                )
              })}
              {filtered.length===0&&!loading&&(
                <div style={{gridColumn:'1/-1',textAlign:'center',padding:'24px 16px',color:C.muted}}>
                  <p style={{fontSize:24,margin:'0 0 6px'}}>{inputMode==='barcode'?'📷':'🔍'}</p>
                  <p style={{fontSize:12}}>{inputMode==='barcode'?'Aguardando leitura...':'Nenhum produto encontrado'}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CARRINHO ── */}
      {cart.length>0&&(
        <div style={{background:C.white,borderRadius:16,border:`1px solid ${C.border}`,overflow:'hidden'}}>
          <div style={{background:C.navy,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:13,fontWeight:800,color:C.white}}>🛒 Carrinho</span>
            <button onClick={()=>setCart([])} style={{fontSize:10,fontWeight:700,color:'#FCA5A5',background:'rgba(239,68,68,0.15)',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>Limpar</button>
          </div>
          <div style={{padding:'6px 12px',display:'flex',flexDirection:'column',gap:4,maxHeight:200,overflowY:'auto'}}>
            {cart.map(item=>(
              <div key={item.id} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:11,fontWeight:700,color:C.text,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</p>
                  <p style={{fontSize:10,color:C.muted,margin:'1px 0 0'}}>{fmtBRL(item.price)} × {item.qty}</p>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:3}}>
                  <button onClick={()=>changeQty(item.id,-1)} style={{width:22,height:22,border:`1px solid ${C.border}`,borderRadius:5,background:C.surfaceAlt,cursor:'pointer',fontSize:13,fontWeight:800,color:C.danger,display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
                  <span style={{fontSize:12,fontWeight:800,minWidth:18,textAlign:'center'}}>{item.qty}</span>
                  <button onClick={()=>changeQty(item.id,1)} disabled={item.qty>=(item.stock_quantity||999)} style={{width:22,height:22,border:`1px solid ${C.border}`,borderRadius:5,background:C.surfaceAlt,cursor:'pointer',fontSize:13,fontWeight:800,color:C.green,display:'flex',alignItems:'center',justifyContent:'center',opacity:item.qty>=(item.stock_quantity||999)?0.4:1}}>+</button>
                </div>
                <span style={{fontSize:12,fontWeight:800,color:C.navy,minWidth:52,textAlign:'right'}}>{fmtBRL(item.price*item.qty)}</span>
                <button onClick={()=>setCart(prev=>prev.filter(i=>i.id!==item.id))} style={{width:20,height:20,background:C.dangerPale,border:'none',borderRadius:5,cursor:'pointer',fontSize:11,color:C.danger,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>✕</button>
              </div>
            ))}
          </div>
          {/* Subtotal + Desconto + Total */}
          <div style={{padding:'10px 14px',background:C.surfaceAlt,display:'flex',flexDirection:'column',gap:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:12,color:C.muted}}>Subtotal</span>
              <span style={{fontSize:13,fontWeight:700,color:C.text}}>{fmtBRL(subtotal)}</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:12,color:C.muted,whiteSpace:'nowrap'}}>Desconto R$</span>
              <input type="number" value={discount} onChange={e=>setDiscount(e.target.value)} min="0" max={subtotal} step="0.01"
                placeholder="0,00"
                style={{flex:1,padding:'5px 8px',border:`1.5px solid ${discountVal>0?C.warning:C.border}`,borderRadius:7,fontSize:12,color:C.text,outline:'none',background:'#fff',textAlign:'right'}}
              />
            </div>
            {discountVal>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:11,color:C.warning,fontWeight:700}}>Desconto</span>
              <span style={{fontSize:12,fontWeight:700,color:C.warning}}>−{fmtBRL(discountVal)}</span>
            </div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:4,borderTop:`1px solid ${C.border}`}}>
              <span style={{fontSize:14,fontWeight:800,color:C.navy}}>Total</span>
              <span style={{fontSize:20,fontWeight:900,color:C.navy}}>{fmtBRL(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── CHECKOUT ── */}
      {cart.length>0&&(
        <div style={{background:C.white,borderRadius:16,border:`1px solid ${C.border}`,overflow:'hidden'}}>
          <div style={{background:`linear-gradient(135deg,${C.navy},${C.navyLight})`,padding:'10px 14px'}}>
            <p style={{fontSize:12,fontWeight:800,color:C.white,margin:0}}>💳 Pagamento</p>
          </div>
          <div style={{padding:'10px 12px',display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {['PIX','Dinheiro','Crédito','Débito','Boleto'].map(pm=>(
                <button key={pm} onClick={()=>{setPayment(pm);if(pm!=='Crédito')setInstallments(1)}}
                  style={{padding:'10px 6px',border:`2px solid ${payment===pm?C.green:C.border}`,borderRadius:11,background:payment===pm?C.navy:C.white,color:payment===pm?C.white:C.text,fontSize:11,fontWeight:700,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:2,transition:'all .15s'}}>
                  <span style={{fontSize:16}}>{pmIcon[pm]}</span>
                  <span>{pm}</span>
                </button>
              ))}
            </div>
            {payment==='Crédito'&&(
              <div>
                <label style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Parcelamento</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:3,marginTop:6}}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(n=>(
                    <button key={n} onClick={()=>setInstallments(n)}
                      style={{padding:'6px 3px',border:`2px solid ${installments===n?C.green:C.border}`,borderRadius:7,background:installments===n?C.navy:C.white,cursor:'pointer',textAlign:'center',transition:'all .12s'}}>
                      <p style={{fontSize:10,fontWeight:800,color:installments===n?C.green:C.text,margin:0}}>{n}x</p>
                      <p style={{fontSize:8,color:installments===n?'rgba(255,255,255,0.55)':C.muted,margin:0}}>{fmtBRL(total/n)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <Input label="Cliente (opcional)" value={customer} onChange={setCustomer} placeholder="Nome"/>
              <Input label="CPF/CNPJ (NFC-e)" value={cpfNota} onChange={setCpfNota} placeholder="000.000.000-00"/>
            </div>
            <PlanLimitNotice check={canAddSale ? canAddSale() : null} />
            <button onClick={finalize} disabled={saving||!cart.length||(canAddSale&&!canAddSale().ok)}
              style={{background:saving?C.muted:`linear-gradient(135deg,${C.green},${C.greenLight})`,color:'#fff',border:'none',borderRadius:13,padding:'15px',fontSize:14,fontWeight:900,cursor:(saving||(canAddSale&&!canAddSale().ok))?'not-allowed':'pointer',opacity:(canAddSale&&!canAddSale().ok)?0.5:1,boxShadow:'0 4px 20px rgba(34,197,94,0.3)',transition:'all .15s'}}>
              {saving?'Finalizando...':`✅ Finalizar — ${fmtBRL(total)}`}
            </button>
          </div>
        </div>
      )}

      {cart.length===0&&!loading&&(
        <div style={{background:C.surfaceAlt,borderRadius:14,padding:'28px 20px',textAlign:'center'}}>
          <p style={{fontSize:36,margin:'0 0 8px'}}>🛒</p>
          <p style={{fontSize:13,fontWeight:700,color:C.navy,margin:'0 0 3px'}}>Carrinho vazio</p>
          <p style={{fontSize:11,color:C.muted,margin:0}}>Busque um produto ou use o leitor de código de barras.</p>
        </div>
      )}
    </div>
  )
}

// ── HISTÓRICO VENDAS ───────────────────────────────────────────────────────
function PageSales({companyId, userRole, userEmail, salesFilter}) {
  const [sales,setSales] = useState([])
  const [loading,setLoading] = useState(true)
  const [cancelTarget,setCancelTarget] = useState(null)
  const [adminPass,setAdminPass] = useState('')
  const [cancelling,setCancelling] = useState(false)
  const toast = useToast()
  const now = new Date()
  const [filterMonth,setFilterMonth] = useState(salesFilter?.month??now.getMonth())
  const [filterYear,setFilterYear] = useState(salesFilter?.year??now.getFullYear())
  const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const years=[];for(let y=now.getFullYear();y>=now.getFullYear()-3;y--)years.push(y)

  const isAdmin = userRole === 'ADMIN'

  const load = useCallback(async(isMounted=true)=>{
    setLoading(true)
    try {
      const start = new Date(filterYear, filterMonth, 1)
      const end = new Date(filterYear, filterMonth+1, 0, 23, 59, 59)
      let q = supabase.from('sales').select('*').gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).order('created_at',{ascending:false}).limit(200)
      if(companyId) q = q.eq('company_id',companyId)
      const {data} = await q
      if(isMounted) setSales(data||[])
    } catch(err) { console.error(err) }
    finally { if(isMounted) setLoading(false) }
  },[companyId, filterMonth, filterYear])

  useEffect(()=>{
    let isMounted = true;
    load(isMounted)
    return () => { isMounted = false; }
  },[load])

  const total = useMemo(() => sales.filter(s=>s.status!=='cancelled').reduce((a,s)=>a+(s.total||0),0), [sales])

  const openCancel = (s) => {
    setCancelTarget(s)
    setAdminPass('')
  }

  const confirmCancel = async () => {
    if(!cancelTarget) return
    setCancelling(true)
    // Usuário não-admin precisa validar senha do admin
    if(!isAdmin) {
      const {error} = await supabase.auth.signInWithPassword({email: userEmail, password: adminPass})
      if(error) {
        toast.show('Senha incorreta!', 'error')
        setCancelling(false)
        return
      }
    }
    const {error} = await supabase.from('sales').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',cancelTarget.id)
    setCancelling(false)
    if(error){toast.show('Erro ao cancelar: '+error.message,'error');return}
    toast.show('Venda cancelada!')
    setSales(prev=>prev.map(s=>s.id===cancelTarget.id?{...s,status:'cancelled'}:s))
    setCancelTarget(null)
    setAdminPass('')
  }

  const statusBadge = (s) => {
    if(s.status==='cancelled') return <Badge label="Cancelada" color={C.dangerPale} text={C.danger}/>
    return <Badge label="Concluída" color={C.greenPale} text={C.greenLight}/>
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Histórico de Vendas" sub={`${sales.filter(s=>s.status!=='cancelled').length} vendas · ${MONTHS_PT[filterMonth]} ${filterYear}`}
        action={
          <Btn size="sm" variant="ghost" onClick={()=>{
            const rows = [['Data','Cliente','Pagamento','Parcelas','Total','Status']]
            sales.forEach(s=>rows.push([
              new Date(s.created_at).toLocaleDateString('pt-BR'),
              s.customer_name||'Balcão',
              s.payment_method||'PIX',
              s.installments||1,
              (s.total||0).toFixed(2).replace('.',','),
              s.status==='cancelled'?'Cancelada':'Concluída'
            ]))
            const csv = rows.map(r=>r.map(c=>`"${c}"`).join(';')).join('\n')
            const bom = '\uFEFF'
            const blob = new Blob([bom+csv],{type:'text/csv;charset=utf-8'})
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href=url; a.download=`vendas-${MONTHS_PT[filterMonth]}-${filterYear}.csv`; a.click()
            URL.revokeObjectURL(url)
          }}>📥 Exportar</Btn>
        }
      />
      {/* Filtro de mês */}
      <Card style={{padding:'10px 14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <select value={filterMonth} onChange={e=>setFilterMonth(+e.target.value)}
            style={{padding:'8px 10px',border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,background:C.white,outline:'none'}}>
            {MONTHS_PT.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <select value={filterYear} onChange={e=>setFilterYear(+e.target.value)}
            style={{padding:'8px 10px',border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,background:C.white,outline:'none'}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </Card>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <StatCard label="Total Vendas" value={fmtBRL(total)} icon="💰"/>
        <StatCard label="Ticket Médio" icon="🎯" value={sales.filter(s=>s.status!=='cancelled').length?fmtBRL(total/sales.filter(s=>s.status!=='cancelled').length):'R$ 0,00'}/>
      </div>
      {loading?<Spinner/>:sales.length===0?<Empty icon="🛍️" text="Nenhuma venda registrada"/>:sales.map(s=>(
        <Card key={s.id}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:s.status!=='cancelled'?10:0}}>
            <div>
              <p style={{fontSize:13,fontWeight:700,color:s.status==='cancelled'?C.muted:C.text,margin:0,textDecoration:s.status==='cancelled'?'line-through':'none'}}>{s.customer_name||'Balcão'}</p>
              <p style={{fontSize:11,color:C.muted,margin:'3px 0 4px'}}>{new Date(s.created_at).toLocaleDateString('pt-BR')} · {s.items_count||'—'} itens · {s.payment_method||'PIX'}</p>
              {statusBadge(s)}
            </div>
            <div style={{textAlign:'right'}}>
              <p style={{fontSize:15,fontWeight:800,color:s.status==='cancelled'?C.muted:C.green,margin:0}}>{fmtBRL(s.total)}</p>
            </div>
          </div>
          {s.status!=='cancelled' && (
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
              <Btn size="sm" variant="danger" onClick={()=>openCancel(s)}>✕ Cancelar Venda</Btn>
            </div>
          )}
        </Card>
      ))}

      {/* Modal de cancelamento */}
      {cancelTarget&&(
        <Modal title="Cancelar Venda" onClose={()=>setCancelTarget(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{background:C.dangerPale,border:`1px solid #FCA5A5`,borderRadius:10,padding:'10px 12px'}}>
              <p style={{fontSize:13,fontWeight:700,color:C.danger,margin:'0 0 4px'}}>⚠️ Confirmar cancelamento</p>
              <p style={{fontSize:12,color:C.danger,margin:0}}>
                {cancelTarget.customer_name||'Balcão'} — {fmtBRL(cancelTarget.total)} — {cancelTarget.payment_method}
              </p>
            </div>
            {isAdmin ? (
              <div style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 12px'}}>
                <p style={{fontSize:12,color:C.muted,margin:0}}>Como Admin, você pode cancelar diretamente sem senha.</p>
              </div>
            ) : (
              <Input
                label="Senha do Admin para autorizar"
                type="password"
                value={adminPass}
                onChange={setAdminPass}
                placeholder="Digite a senha do administrador"
                required
              />
            )}
            <div style={{display:'flex',gap:8}}>
              <Btn variant="ghost" onClick={()=>setCancelTarget(null)}>Voltar</Btn>
              <div style={{flex:1}}>
                <Btn variant="danger" full onClick={confirmCancel} disabled={cancelling||(!isAdmin&&!adminPass)}>
                  {cancelling?'Cancelando...':'Confirmar Cancelamento'}
                </Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── FLUXO DE CAIXA ─────────────────────────────────────────────────────────
function PageCashflow({companyId}) {
  const [entries,setEntries] = useState([])
  const [loading,setLoading] = useState(true)
  const [showModal,setShowModal] = useState(false)
  const [editEntry,setEditEntry] = useState(null)
  const [form,setForm] = useState({desc:'',type:'income',value:'',category:'',date:new Date().toISOString().split('T')[0]})
  const [saving,setSaving] = useState(false)
  const [deleting,setDeleting] = useState(false)
  const toast = useToast()
  const now = new Date()
  const [filterMonth,setFilterMonth] = useState(now.getMonth())
  const [filterYear,setFilterYear] = useState(now.getFullYear())
  const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const years=[];for(let y=now.getFullYear();y>=now.getFullYear()-3;y--)years.push(y)

  const fetchCashflow = useCallback(async(isMounted = true)=>{
    setLoading(true)
    try {
      const start = new Date(filterYear, filterMonth, 1)
      const end = new Date(filterYear, filterMonth+1, 0, 23, 59, 59)
      let q = supabase.from('cashflow').select('*').gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).order('created_at',{ascending:false}).limit(200)
      if(companyId) q = q.eq('company_id',companyId)
      const {data} = await q
      if(isMounted) setEntries(data||[])
    } catch(err) { console.error(err) }
    finally { if(isMounted) setLoading(false) }
  }, [companyId, filterMonth, filterYear])

  useEffect(()=>{ 
    let isMounted = true;
    fetchCashflow(isMounted);
    return () => { isMounted = false; }
  },[fetchCashflow])

  const income = entries.filter(e=>e.type==='income').reduce((a,e)=>a+(e.value||0),0)
  const expense = entries.filter(e=>e.type==='expense').reduce((a,e)=>a+(e.value||0),0)
  const balance = income-expense

  const openNew = () => {
    setEditEntry(null)
    setForm({desc:'',type:'income',value:'',category:'',date:new Date().toISOString().split('T')[0]})
    setShowModal(true)
  }
  const openEdit = (e) => {
    setEditEntry(e)
    setForm({desc:e.description||'',type:e.type||'income',value:String(e.value||''),category:e.category||'',date:(e.created_at||'').slice(0,10)})
    setShowModal(true)
  }

  const save = async()=>{
    if(!form.desc||!form.value){toast.show('Preencha descrição e valor','error');return}
    setSaving(true)
    try {
      const payload = {company_id:companyId,description:form.desc,type:form.type,value:parseFloat(form.value),category:form.category||'Geral',created_at:form.date?new Date(form.date+'T12:00:00').toISOString():new Date().toISOString()}
      if(editEntry) {
        const {error} = await supabase.from('cashflow').update(payload).eq('id',editEntry.id)
        if(error){toast.show('Erro: '+error.message,'error');return}
        toast.show('Lançamento atualizado!')
      } else {
        const {error} = await supabase.from('cashflow').insert(payload)
        if(error){toast.show('Erro: '+error.message,'error');return}
        toast.show('Lançamento registrado!')
      }
      setShowModal(false);setEditEntry(null);setForm({desc:'',type:'income',value:'',category:'',date:new Date().toISOString().split('T')[0]});fetchCashflow()
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async()=>{
    if(!editEntry) return
    if(!window.confirm('Remover este lançamento?')) return
    setDeleting(true)
    try {
      await supabase.from('cashflow').delete().eq('id',editEntry.id)
      toast.show('Lançamento removido!')
      setShowModal(false);setEditEntry(null);fetchCashflow()
    } catch(err) {
      toast.show('Erro ao remover: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setDeleting(false)
    }
  }

  const periodLabel = `${MONTHS_PT[filterMonth]} ${filterYear}`

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Fluxo de Caixa" sub={periodLabel} action={<Btn size="sm" onClick={openNew}>+ Lançamento</Btn>}/>

      {/* Filtro de mês */}
      <Card style={{padding:'10px 14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <select value={filterMonth} onChange={e=>setFilterMonth(+e.target.value)}
            style={{padding:'8px 10px',border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,background:C.white,outline:'none'}}>
            {MONTHS_PT.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <select value={filterYear} onChange={e=>setFilterYear(+e.target.value)}
            style={{padding:'8px 10px',border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,background:C.white,outline:'none'}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </Card>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <StatCard label="Entradas" value={fmtBRL(income)} color={C.green} icon="📥" pale={C.greenPale}/>
        <StatCard label="Saídas" value={fmtBRL(expense)} color={C.danger} icon="📤" pale={C.dangerPale}/>
      </div>
      <div style={{background:balance>=0?C.greenPale:C.dangerPale,border:`1.5px solid ${balance>=0?'#86EFAC':'#FCA5A5'}`,borderRadius:12,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontWeight:700,fontSize:14,color:balance>=0?C.greenLight:C.danger}}>Saldo do Período</span>
        <span style={{fontSize:20,fontWeight:800,color:balance>=0?C.greenLight:C.danger}}>{fmtBRL(balance)}</span>
      </div>
      {loading?<Spinner/>:entries.length===0?<Empty icon="💰" text="Nenhum lançamento"/>:entries.map(e=>(
        <Card key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>openEdit(e)}>
          <div style={{flex:1,minWidth:0}}>
            <p style={{fontSize:13,fontWeight:600,color:C.text,margin:0}}>{e.description}</p>
            <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{new Date(e.created_at).toLocaleDateString('pt-BR')} · {e.category} · <span style={{color:C.info}}>✏️ editar</span></p>
          </div>
          <span style={{fontSize:15,fontWeight:800,color:e.type==='income'?C.green:C.danger,flexShrink:0,marginLeft:10}}>{e.type==='income'?'+':'−'}{fmtBRL(e.value)}</span>
        </Card>
      ))}
      {showModal&&(
        <Modal title={editEntry?'Editar Lançamento':'Novo Lançamento'} onClose={()=>{setShowModal(false);setEditEntry(null)}}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Tipo</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:6}}>
                <button onClick={()=>setForm(f=>({...f,type:'income'}))} style={{padding:12,border:`2px solid ${form.type==='income'?C.green:C.border}`,borderRadius:10,background:form.type==='income'?C.greenPale:C.white,color:form.type==='income'?C.greenLight:C.text,fontSize:13,fontWeight:700,cursor:'pointer'}}>📥 Entrada</button>
                <button onClick={()=>setForm(f=>({...f,type:'expense'}))} style={{padding:12,border:`2px solid ${form.type==='expense'?C.danger:C.border}`,borderRadius:10,background:form.type==='expense'?C.dangerPale:C.white,color:form.type==='expense'?C.danger:C.text,fontSize:13,fontWeight:700,cursor:'pointer'}}>📤 Saída</button>
              </div>
            </div>
            <Input label="Descrição" value={form.desc} onChange={v=>setForm(f=>({...f,desc:v}))} placeholder="Ex: Venda de produtos" required/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="Valor" type="number" value={form.value} onChange={v=>setForm(f=>({...f,value:v}))} prefix="R$" required/>
              <Input label="Categoria" value={form.category} onChange={v=>setForm(f=>({...f,category:v}))} placeholder="Vendas"/>
            </div>
            <Input label="Data" type="date" value={form.date} onChange={v=>setForm(f=>({...f,date:v}))}/>
            <div style={{display:'flex',gap:8}}>
              {editEntry&&<Btn onClick={deleteEntry} variant="danger" disabled={deleting}>{deleting?'Removendo...':'🗑 Remover'}</Btn>}
              <Btn onClick={()=>{setShowModal(false);setEditEntry(null)}} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':(editEntry?'Salvar Alterações':'Salvar')}</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── CONTAS A PAGAR / RECEBER ───────────────────────────────────────────────
function PageAccounts({companyId,type}) {
  const [items,setItems] = useState([])
  const [loading,setLoading] = useState(true)
  const [showModal,setShowModal] = useState(false)
  const [editItem,setEditItem] = useState(null)
  const [form,setForm] = useState({desc:'',value:'',due_date:'',category:'',entity_name:''})
  const [saving,setSaving] = useState(false)
  const [deleting,setDeleting] = useState(false)
  const toast = useToast()
  const table = type==='payable'?'accounts_payable':'accounts_receivable'
  const title = type==='payable'?'Contas a Pagar':'Contas a Receber'

  const fetchItems = useCallback(async(isMounted = true)=>{
    setLoading(true)
    try {
      let q = supabase.from(table).select('*').order('due_date',{ascending:true}).limit(200)
      if(companyId) q = q.eq('company_id',companyId)
      const {data} = await q
      if(isMounted) setItems(data||[])
    } catch(err) { console.error(err) }
    finally { if(isMounted) setLoading(false) }
  }, [companyId, type, table])

  useEffect(()=>{ 
    let isMounted = true;
    fetchItems(isMounted);
    return () => { isMounted = false; }
  },[fetchItems])

  const openNew = () => {
    setEditItem(null)
    setForm({desc:'',value:'',due_date:'',category:'',entity_name:''})
    setShowModal(true)
  }
  const openEdit = (item) => {
    setEditItem(item)
    setForm({desc:item.description||'',value:String(item.value||''),due_date:item.due_date||'',category:item.category||'',entity_name:item.entity_name||''})
    setShowModal(true)
  }

  const save = async()=>{
    if(!form.desc||!form.value){toast.show('Preencha descrição e valor','error');return}
    setSaving(true)
    try {
      const payload = {company_id:companyId,description:form.desc,value:parseFloat(form.value),due_date:form.due_date||null,category:form.category||'Geral',entity_name:form.entity_name||null}
      if(editItem) {
        const {error} = await supabase.from(table).update(payload).eq('id',editItem.id)
        if(error){toast.show('Erro: '+error.message,'error');return}
        toast.show('Lançamento atualizado!')
      } else {
        const {error} = await supabase.from(table).insert({...payload,status:'pending',created_at:new Date().toISOString()})
        if(error){toast.show('Erro ao salvar: '+error.message,'error');return}
        toast.show('Lançamento salvo!')
      }
      setShowModal(false);setEditItem(null);setForm({desc:'',value:'',due_date:'',category:'',entity_name:''});fetchItems()
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async()=>{
    if(!editItem) return
    if(!window.confirm('Remover este lançamento?')) return
    setDeleting(true)
    try {
      await supabase.from(table).delete().eq('id',editItem.id)
      toast.show('Lançamento removido!')
      setShowModal(false);setEditItem(null);fetchItems()
    } catch(err) {
      toast.show('Erro ao remover: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setDeleting(false)
    }
  }

  // Ao marcar como pago/recebido: atualiza status E lança no Fluxo de Caixa
  const pay = async(item)=>{
    try {
      const now = new Date()
      const {error} = await supabase.from(table).update({status:'paid',paid_at:now.toISOString()}).eq('id',item.id)
      if(error) { toast.show('Erro: '+error.message,'error'); return }
      // Lança no fluxo de caixa automaticamente
      await supabase.from('cashflow').insert({
        company_id:companyId,
        description:item.description,
        type:type==='payable'?'expense':'income',
        value:item.value,
        category:item.category||'Geral',
        created_at:now.toISOString(),
      })
      toast.show(type==='payable'?'Marcado como pago! Lançado no caixa.':'Marcado como recebido! Lançado no caixa.')
      setItems(prev=>prev.map(i=>i.id===item.id?{...i,status:'paid'}:i))
    } catch(err) {
      toast.show('Erro: '+(err?.message||'falha de conexão'),'error')
    }
  }

  const pending = items.filter(i=>i.status==='pending').reduce((a,i)=>a+(i.value||0),0)
  const paid = items.filter(i=>i.status==='paid').reduce((a,i)=>a+(i.value||0),0)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title={title} sub={`${items.length} lançamentos`} action={<Btn size="sm" onClick={openNew}>+ Novo</Btn>}/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <StatCard label="Pendente" value={fmtBRL(pending)} color={C.warning} icon="⏳" pale={C.warningPale}/>
        <StatCard label={type==='payable'?'Pago':'Recebido'} value={fmtBRL(paid)} color={C.green} icon="✅" pale={C.greenPale}/>
      </div>
      {loading?<Spinner/>:items.length===0?<Empty icon={type==='payable'?'📤':'📥'} text="Nenhum lançamento"/>:items.map(item=>{
        const overdue = item.status==='pending'&&item.due_date&&new Date(item.due_date)<new Date()
        return (
          <Card key={item.id}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
              <div style={{flex:1,minWidth:0}}>
                <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{item.description}</p>
                <p style={{fontSize:11,color:C.muted,margin:'3px 0 0'}}>{item.due_date?new Date(item.due_date+'T00:00:00').toLocaleDateString('pt-BR'):'Sem vencimento'} · {item.category||'Geral'}{item.entity_name?' · '+item.entity_name:''}</p>
                {overdue&&<Badge label="⚠️ Vencido" color={C.dangerPale} text={C.danger}/>}
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginLeft:10}}>
                <p style={{fontSize:15,fontWeight:800,color:overdue?C.danger:item.status==='paid'?C.green:C.navy,margin:0}}>{fmtBRL(item.value)}</p>
                <Badge label={item.status==='paid'?(type==='payable'?'Pago':'Recebido'):'Pendente'} color={item.status==='paid'?C.greenPale:C.warningPale} text={item.status==='paid'?C.greenLight:C.warning}/>
              </div>
            </div>
            <div style={{display:'flex',gap:8}}>
              {item.status==='pending'&&<Btn size="sm" variant="success" onClick={()=>pay(item)}>✓ {type==='payable'?'Marcar Pago':'Marcar Recebido'}</Btn>}
              <Btn size="sm" variant="ghost" onClick={()=>openEdit(item)}>✏️ Editar</Btn>
            </div>
          </Card>
        )
      })}
      {showModal&&(
        <Modal title={editItem?`Editar — ${title}`:`Novo — ${title}`} onClose={()=>{setShowModal(false);setEditItem(null)}}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <Input label="Descrição" value={form.desc} onChange={v=>setForm(f=>({...f,desc:v}))} placeholder="Ex: Fornecedor XYZ" required/>
            <Input label={type==='payable'?'Fornecedor':'Cliente'} value={form.entity_name} onChange={v=>setForm(f=>({...f,entity_name:v}))} placeholder={type==='payable'?'Nome do fornecedor':'Nome do cliente'}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Input label="Valor" type="number" value={form.value} onChange={v=>setForm(f=>({...f,value:v}))} prefix="R$" required/>
              <Input label="Vencimento" type="date" value={form.due_date} onChange={v=>setForm(f=>({...f,due_date:v}))}/>
            </div>
            <Input label="Categoria" value={form.category} onChange={v=>setForm(f=>({...f,category:v}))} placeholder="Ex: Fornecedores, Aluguel..."/>
            <div style={{display:'flex',gap:8}}>
              {editItem&&<Btn onClick={deleteItem} variant="danger" disabled={deleting}>{deleting?'Removendo...':'🗑 Remover'}</Btn>}
              <Btn onClick={()=>{setShowModal(false);setEditItem(null)}} variant="ghost">Cancelar</Btn>
              <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':(editItem?'Salvar Alterações':'Salvar')}</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── USUÁRIOS DA EMPRESA ────────────────────────────────────────────────────
function PageUsers({companyId, canAddUser}) {
  const [users,setUsers] = useState([])
  const [loading,setLoading] = useState(true)
  const [showModal,setShowModal] = useState(false)
  const [saving,setSaving] = useState(false)
  const [permTarget,setPermTarget] = useState(null) // usuário para editar permissões
  const emptyForm = {name:'',email:'',role:'USER'}
  const [form,setForm] = useState(emptyForm)
  const [permModules,setPermModules] = useState([])
  const toast = useToast()

  const fetchUsers = useCallback(async(isMounted=true)=>{
    setLoading(true)
    try {
      if(!companyId){if(isMounted)setLoading(false);return}
      const {data} = await supabase.from('profiles')
        .select('*')
        .eq('company_id',companyId)
        .eq('is_super_admin',false)
        .order('created_at',{ascending:false})
        .limit(100)
      if(isMounted) setUsers(data||[])
    } catch(err){console.error(err)}
    finally{if(isMounted)setLoading(false)}
  },[companyId])

  useEffect(()=>{
    let isMounted=true
    fetchUsers(isMounted)
    return ()=>{isMounted=false}
  },[fetchUsers])

  const save = async()=>{
    if(!form.email){toast.show('E-mail obrigatório','error');return}
    setSaving(true)
    try {
      await createUserWithInvite({
        email: form.email,
        name: form.name,
        companyId,
        role: form.role,
        modules: ALL_MODULES.map(m=>m.id),
      })
      toast.show('✅ Usuário criado! Convite enviado por e-mail.')
      setShowModal(false);setForm(emptyForm);fetchUsers()
    } catch(e){ toast.show(e?.message||'Erro ao criar usuário','error') }
    finally { setSaving(false) }
  }

  const toggleActive = async(u) => {
    const newActive = u.active === false ? true : false
    await supabase.from('profiles').update({active:newActive}).eq('id',u.id)
    toast.show(newActive ? 'Usuário ativado!' : 'Usuário desativado!')
    setUsers(prev=>prev.map(x=>x.id===u.id?{...x,active:newActive}:x))
  }

  const openPerms = (u) => {
    // Se não tem allowed_modules, dá acesso a tudo
    const current = u.allowed_modules || ALL_MODULES.map(m=>m.id)
    setPermModules(current)
    setPermTarget(u)
  }

  const savePerms = async() => {
    const {error} = await supabase.from('profiles').update({allowed_modules:permModules}).eq('id',permTarget.id)
    if(error){toast.show('Erro: '+error.message,'error');return}
    toast.show('Permissões salvas!')
    // Atualiza lista local imediatamente
    setUsers(prev=>prev.map(x=>x.id===permTarget.id?{...x,allowed_modules:permModules}:x))
    setPermTarget(null)
  }

  const toggleModule = (id) => {
    setPermModules(prev=>prev.includes(id)?prev.filter(m=>m!==id):[...prev,id])
  }

  const roleColor = r => r==='ADMIN'?{bg:C.infoPale,text:C.info}:r==='VENDEDOR'?{bg:C.greenPale,text:C.greenLight}:{bg:C.surfaceAlt,text:C.muted}
  const f = k => v => setForm(p=>({...p,[k]:v}))

  const openNewUser = () => {
    const check = canAddUser ? canAddUser() : { ok: true }
    if(!check.ok) { toast.show(check.reason, 'error'); return }
    setShowModal(true)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toast.el}
      <SectionHeader title="Usuários" sub={`${users.length} cadastrados`}
        action={<Btn size="sm" onClick={openNewUser}>+ Novo Usuário</Btn>}/>

      <PlanLimitNotice check={canAddUser ? canAddUser() : null} />

      {loading?<Spinner/>:users.length===0?<Empty icon="👤" text="Nenhum usuário"/>:users.map(u=>{
        const c=roleColor(u.role)
        const isActive = u.active !== false
        const modCount = u.allowed_modules ? u.allowed_modules.length : ALL_MODULES.length
        return (
          <Card key={u.id}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
              <div style={{width:42,height:42,background:isActive?C.navy:C.border,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',color:C.white,fontWeight:800,fontSize:14,flexShrink:0}}>
                {(u.name||u.email||'U')[0].toUpperCase()}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <p style={{fontSize:13,fontWeight:700,color:isActive?C.text:C.muted,margin:0}}>{u.name||'Sem nome'}</p>
                <p style={{fontSize:11,color:C.muted,margin:'2px 0 3px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</p>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  <Badge label={u.role||'USER'} color={c.bg} text={c.text}/>
                  {!isActive&&<Badge label="Inativo" color={C.dangerPale} text={C.danger}/>}
                  <Badge label={`${modCount} módulos`} color={C.surfaceAlt} text={C.muted}/>
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
              <Btn size="sm" variant="ghost" onClick={()=>openPerms(u)}>🔧 Permissões</Btn>
              <Btn size="sm" variant={isActive?'danger':'success'} onClick={()=>toggleActive(u)}>
                {isActive?'🚫 Desativar':'✅ Ativar'}
              </Btn>
            </div>
          </Card>
        )
      })}

      {/* Modal novo usuário */}
      {showModal&&(
        <Modal title="Novo Usuário" onClose={()=>setShowModal(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <Input label="Nome Completo" value={form.name} onChange={f('name')} placeholder="João da Silva"/>
            <Input label="E-mail" type="email" value={form.email} onChange={f('email')} placeholder="joao@empresa.com" required/>
            <div style={{background:C.infoPale,borderRadius:10,padding:'10px 12px',display:'flex',gap:8,alignItems:'center'}}>
              <span>📧</span><p style={{fontSize:11,color:C.info,margin:0,fontWeight:600}}>O usuário receberá um e-mail de convite para definir a própria senha.</p>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              <label style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Nível de Acesso</label>
              <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}
                style={{width:'100%',padding:'10px 12px',border:`1.5px solid ${C.border}`,borderRadius:9,fontSize:13,color:C.text,background:C.white,outline:'none'}}>
                <option value="USER">👤 Usuário — PDV + visualização básica</option>
                <option value="VENDEDOR">🛒 Vendedor — PDV + estoque + histórico</option>
                <option value="ADMIN">👑 Admin — acesso total da empresa</option>
              </select>
            </div>
            <div style={{background:C.infoPale,borderRadius:9,padding:'10px 14px',fontSize:12,color:C.info,fontWeight:600}}>
              ℹ️ Após criar, você pode ajustar os módulos acessíveis clicando em "Permissões".
            </div>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancelar</Btn>
              <div style={{flex:1}}><Btn variant="primary" full onClick={save} disabled={saving}>{saving?'Criando...':'Criar Usuário'}</Btn></div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de permissões */}
      {permTarget&&(
        <Modal title={`Permissões — ${permTarget.name||permTarget.email}`} onClose={()=>setPermTarget(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 14px'}}>
              <p style={{fontSize:12,color:C.muted,margin:0}}>Selecione os módulos que este usuário pode acessar:</p>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {ALL_MODULES.map(m=>{
                const on = permModules.includes(m.id)
                return (
                  <button key={m.id} onClick={()=>toggleModule(m.id)} style={{
                    display:'flex',alignItems:'center',gap:12,padding:'11px 14px',
                    border:`2px solid ${on?C.navy:C.border}`,borderRadius:10,
                    background:on?C.infoPale:C.white,cursor:'pointer',textAlign:'left',
                  }}>
                    <span style={{fontSize:18}}>{m.icon}</span>
                    <span style={{fontSize:13,fontWeight:700,color:on?C.navy:C.muted,flex:1}}>{m.label}</span>
                    <div style={{width:20,height:20,borderRadius:999,border:`2px solid ${on?C.navy:C.border}`,background:on?C.navy:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      {on&&<span style={{color:C.white,fontSize:11,fontWeight:800}}>✓</span>}
                    </div>
                  </button>
                )
              })}
            </div>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="ghost" size="sm" onClick={()=>setPermModules(ALL_MODULES.map(m=>m.id))}>Selecionar Todos</Btn>
              <Btn variant="ghost" size="sm" onClick={()=>setPermModules([])}>Remover Todos</Btn>
            </div>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="ghost" onClick={()=>setPermTarget(null)}>Cancelar</Btn>
              <div style={{flex:1}}><Btn variant="primary" full onClick={savePerms}>Salvar Permissões</Btn></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── CONFIGURAÇÕES ──────────────────────────────────────────────────────────
function ModalEmpresa({onClose,companyId}) {
  const [form,setForm] = useState({name:'',cnpj:'',phone:'',address:'',city:'',state:''})
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const toast = useToast()
  useEffect(()=>{
    if(!companyId){setLoading(false);return}
    let isMounted = true
    const load = async()=>{
      setLoading(true)
      try {
        const {data:co} = await supabase.from('companies').select('*').eq('id',companyId).single()
        if(isMounted && co) setForm({name:co.name||'',cnpj:co.cnpj||'',phone:co.phone||'',address:co.address||'',city:co.city||'',state:co.state||''})
      } catch(err) { console.error(err) }
      finally { if(isMounted) setLoading(false) }
    }
    load()
    return () => { isMounted = false }
  },[companyId])
  const save = async()=>{
    if(!companyId){toast.show('Empresa não encontrada','error');return}
    setSaving(true)
    try {
      const {error} = await supabase.from('companies').update({name:form.name,cnpj:form.cnpj,phone:form.phone,address:form.address,city:form.city,state:form.state}).eq('id',companyId)
      if(error) toast.show('Erro ao salvar: '+error.message,'error')
      else { toast.show('Dados salvos!'); setTimeout(onClose,1200) }
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }
  const f = k => v => setForm(p=>({...p,[k]:v}))
  return (
    <Modal title="🏢 Dados da Empresa" onClose={onClose}>
      {toast.el}
      {loading?<Spinner/>:(
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <Input label="Razão Social" value={form.name} onChange={f('name')} placeholder="Nome da empresa" required/>
          <Input label="CNPJ" value={form.cnpj} onChange={f('cnpj')} placeholder="00.000.000/0001-00"/>
          <Input label="Telefone" value={form.phone} onChange={f('phone')} placeholder="(00) 00000-0000"/>
          <Input label="Endereço" value={form.address} onChange={f('address')} placeholder="Rua, número, bairro"/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Input label="Cidade" value={form.city} onChange={f('city')} placeholder="São Paulo"/>
            <Input label="Estado" value={form.state} onChange={f('state')} placeholder="SP"/>
          </div>
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
            <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':'Salvar'}</Btn></div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ModalPerfil({user,onClose}) {
  const [name,setName] = useState('')
  const [newPass,setNewPass] = useState('')
  const [saving,setSaving] = useState(false)
  const toast = useToast()
  useEffect(()=>{
    let isMounted = true
    const load = async()=>{
      try {
        const {data:p} = await supabase.from('profiles').select('name').eq('id',user.id).single()
        if(isMounted && p) setName(p.name||'')
      } catch(err) { console.error(err) }
    }
    load()
    return () => { isMounted = false }
  },[user])
  const save = async()=>{
    setSaving(true)
    try {
      const {error:pe} = await supabase.from('profiles').update({name}).eq('id',user.id)
      if(pe){toast.show('Erro: '+pe.message,'error');return}
      if(newPass){
        const {error:ae} = await supabase.auth.updateUser({password:newPass})
        if(ae){toast.show('Erro na senha: '+ae.message,'error');return}
      }
      toast.show('Perfil atualizado!')
      setTimeout(onClose,1200)
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title="👤 Meu Perfil" onClose={onClose}>
      {toast.el}
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{background:C.surfaceAlt,borderRadius:10,padding:12,textAlign:'center'}}>
          <div style={{width:56,height:56,background:C.navy,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',color:C.white,fontWeight:800,fontSize:20,margin:'0 auto 8px'}}>{(user?.email||'A')[0].toUpperCase()}</div>
          <p style={{fontSize:12,color:C.muted,margin:0}}>{user?.email}</p>
        </div>
        <Input label="Nome Completo" value={name} onChange={setName} placeholder="Seu nome"/>
        <Input label="Nova Senha" type="password" value={newPass} onChange={setNewPass} placeholder="Deixe em branco para não alterar"/>
        <div style={{display:'flex',gap:8}}>
          <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
          <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':'Salvar'}</Btn></div>
        </div>
      </div>
    </Modal>
  )
}

function ModalNotificacoes({onClose}) {
  const [prefs,setPrefs] = useState({stockAlert:true,expiryAlert:true,dailySummary:false})
  const toast = useToast()
  const toggle = k => setPrefs(p=>({...p,[k]:!p[k]}))
  const items = [
    {key:'stockAlert',label:'Alertas de Estoque Baixo',desc:'Notificar quando produto abaixo do mínimo'},
    {key:'expiryAlert',label:'Vencimentos Próximos',desc:'Avisar 7 dias antes do vencimento de licença'},
    {key:'dailySummary',label:'Resumo Diário',desc:'Receber resumo de vendas por e-mail'},
  ]
  return (
    <Modal title="🔔 Notificações" onClose={onClose}>
      {toast.el}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {items.map(it=>(
          <div key={it.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:`1px solid ${C.border}`}}>
            <div>
              <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{it.label}</p>
              <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{it.desc}</p>
            </div>
            <button onClick={()=>toggle(it.key)} style={{width:44,height:24,borderRadius:99,border:'none',cursor:'pointer',background:prefs[it.key]?C.green:C.border,position:'relative',transition:'background .2s'}}>
              <div style={{position:'absolute',top:2,left:prefs[it.key]?22:2,width:20,height:20,background:C.white,borderRadius:99,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
            </button>
          </div>
        ))}
        <Btn onClick={()=>{toast.show('Preferências salvas!');setTimeout(onClose,1000)}} variant="primary" full>Salvar Preferências</Btn>
      </div>
    </Modal>
  )
}

function ModalTributacao({onClose, companyId, isSuperAdmin}) {
  const emptyForm = {
    regime:'simples', cfop:'5102', ncm:'00000000', aliquota:'',
    focus_token:'', cnpj:'', razao_social:'', logradouro:'', numero:'',
    municipio:'', uf:'SP', cep:'', certificado_ok:false,
  }
  const [form,setForm] = useState(emptyForm)
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [uploadingCert,setUploadingCert] = useState(false)
  const [certPass,setCertPass] = useState('')
  const [certFile,setCertFile] = useState(null)
  const certRef = useRef()
  const toast = useToast()
  const f = k => v => setForm(p=>({...p,[k]:v}))

  useEffect(()=>{
    const load = async()=>{
      if(!companyId){setLoading(false);return}
      try {
        const {data} = await supabase.from('companies').select('fiscal_config,cnpj,name').eq('id',companyId).maybeSingle()
        if(data){
          const fc = data.fiscal_config||{}
          setForm(prev=>({...prev,...fc, cnpj:fc.cnpj||data.cnpj||'', razao_social:fc.razao_social||data.name||''}))
        }
      } catch(err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  },[companyId])

  const save = async()=>{
    if(!companyId){toast.show('Empresa não identificada','error');return}
    setSaving(true)
    try {
      const fiscal_config = {...form}
      const {error} = await supabase.from('companies').update({fiscal_config,updated_at:new Date().toISOString()}).eq('id',companyId)
      if(error){toast.show('Erro: '+error.message,'error');return}
      toast.show('Configurações fiscais salvas!')
      setTimeout(onClose,1000)
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  const uploadCert = async()=>{
    if(!certFile||!certPass){toast.show('Selecione o arquivo .pfx e informe a senha','error');return}
    if(!isSuperAdmin){toast.show('Apenas super admin pode configurar certificado','error');return}
    setUploadingCert(true)
    try {
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target.result)
        reader.onerror = () => reject(new Error('Erro ao ler o arquivo do certificado'))
        reader.readAsArrayBuffer(certFile)
      })
      const b64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
      // Envia para Focus NFe via API
      const resp = await withTimeout(
        fetch(`${FOCUS_URL}/empresas/${form.cnpj?.replace(/\D/g,'')}/certificado`, {
          method:'POST',
          headers:{'Authorization':'Basic '+btoa(form.focus_token+':'),'Content-Type':'application/json'},
          body:JSON.stringify({certificado:b64,senha:certPass})
        }),
        15000,
        'Tempo esgotado ao enviar certificado. Verifique sua conexão.'
      )
      const data = await resp.json()
      if(!resp.ok) throw new Error(data?.mensagem||'Erro ao enviar certificado')
      // Marca certificado como ok
      setForm(p=>({...p,certificado_ok:true}))
      await supabase.from('companies').update({
        fiscal_config:{...form,certificado_ok:true},
        updated_at:new Date().toISOString()
      }).eq('id',companyId)
      toast.show('Certificado enviado com sucesso!')
      setCertFile(null); setCertPass('')
    } catch(err) {
      toast.show('Erro: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setUploadingCert(false)
    }
  }

  const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

  return (
    <Modal title="🏷️ Configuração Fiscal / NFC-e" onClose={onClose} maxWidth={500}>
      {toast.el}
      {loading?<Spinner/>:(
        <div style={{display:'flex',flexDirection:'column',gap:14}}>

          {/* Dados fiscais básicos */}
          <div style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 12px'}}>
            <p style={{fontSize:11,fontWeight:700,color:C.navy,textTransform:'uppercase',letterSpacing:'0.06em',margin:'0 0 10px'}}>📋 Dados da Empresa</p>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <Input label="CNPJ" value={form.cnpj} onChange={f('cnpj')} placeholder="00.000.000/0001-00"/>
              <Input label="Razão Social" value={form.razao_social} onChange={f('razao_social')} placeholder="Empresa LTDA"/>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:8}}>
                <Input label="Logradouro" value={form.logradouro} onChange={f('logradouro')} placeholder="Rua das Flores"/>
                <Input label="Número" value={form.numero} onChange={f('numero')} placeholder="123"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:8}}>
                <Input label="Município" value={form.municipio} onChange={f('municipio')} placeholder="São Paulo"/>
                <Select label="UF" value={form.uf} onChange={f('uf')} options={UFS}/>
                <Input label="CEP" value={form.cep} onChange={f('cep')} placeholder="00000-000"/>
              </div>
            </div>
          </div>

          {/* Regime e parâmetros fiscais */}
          <div style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 12px'}}>
            <p style={{fontSize:11,fontWeight:700,color:C.navy,textTransform:'uppercase',letterSpacing:'0.06em',margin:'0 0 10px'}}>⚙️ Parâmetros Fiscais</p>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <Select label="Regime Tributário" value={form.regime} onChange={f('regime')} options={[{value:'simples',label:'Simples Nacional'},{value:'lucro_presumido',label:'Lucro Presumido'},{value:'lucro_real',label:'Lucro Real'},{value:'mei',label:'MEI'}]}/>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <Input label="CFOP Padrão" value={form.cfop} onChange={f('cfop')} placeholder="5102"/>
                <Input label="NCM Padrão" value={form.ncm} onChange={f('ncm')} placeholder="00000000"/>
              </div>
            </div>
          </div>

          {/* Focus NFe — só super admin */}
          {isSuperAdmin ? (
            <div style={{background:C.infoPale,border:`1.5px solid ${C.info}`,borderRadius:10,padding:'10px 12px'}}>
              <p style={{fontSize:11,fontWeight:700,color:C.info,textTransform:'uppercase',letterSpacing:'0.06em',margin:'0 0 10px'}}>🔑 Integração Focus NFe</p>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <Input label="Token API Focus NFe" value={form.focus_token} onChange={f('focus_token')} placeholder="Cole o token aqui"/>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:10,height:10,borderRadius:999,background:form.certificado_ok?C.green:C.warning,flexShrink:0}}/>
                  <span style={{fontSize:12,color:form.certificado_ok?C.greenLight:C.warning,fontWeight:600}}>
                    {form.certificado_ok ? 'Certificado digital configurado ✅' : 'Certificado digital pendente ⚠️'}
                  </span>
                </div>
                {/* Upload certificado */}
                <div style={{background:C.white,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
                  <p style={{fontSize:11,fontWeight:700,color:C.text,margin:'0 0 8px'}}>📤 Enviar Certificado A1 (.pfx)</p>
                  <div
                    onClick={()=>certRef.current?.click()}
                    style={{border:`2px dashed ${certFile?C.green:C.border}`,borderRadius:8,padding:'10px',textAlign:'center',cursor:'pointer',marginBottom:8}}
                  >
                    <p style={{fontSize:12,color:certFile?C.greenLight:C.muted,margin:0}}>{certFile?'✅ '+certFile.name:'Clique para selecionar .pfx'}</p>
                  </div>
                  <input ref={certRef} type="file" accept=".pfx,.p12" onChange={e=>setCertFile(e.target.files?.[0]||null)} style={{display:'none'}}/>
                  <Input label="Senha do Certificado" type="password" value={certPass} onChange={setCertPass} placeholder="Senha do .pfx"/>
                  <div style={{marginTop:8}}>
                    <Btn onClick={uploadCert} size="sm" variant="primary" disabled={uploadingCert||!certFile||!certPass}>
                      {uploadingCert?'Enviando...':'Enviar Certificado'}
                    </Btn>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{background:C.warningPale,border:`1px solid ${C.warning}`,borderRadius:10,padding:'10px 14px'}}>
              <p style={{fontSize:12,color:C.warning,margin:0,fontWeight:600}}>🔑 Configuração do token e certificado digital: somente Super Admin.</p>
            </div>
          )}

          <div style={{background:C.warningPale,borderRadius:10,padding:10}}>
            <p style={{fontSize:11,color:C.warning,margin:0,fontWeight:600}}>⚠️ Consulte seu contador antes de alterar as configurações fiscais.</p>
          </div>
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
            <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':'Salvar Configurações'}</Btn></div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ModalPagamentos({onClose,companyId}) {
  const [methods,setMethods] = useState(DEFAULT_PAYMENT_METHODS)
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const toast = useToast()

  useEffect(()=>{
    const load = async()=>{
      if(!companyId){setLoading(false);return}
      try {
        const {data} = await supabase.from('payment_methods').select('*').eq('company_id',companyId)
        if(data&&data.length>0){
          // Merge defaults com os salvos
          setMethods(DEFAULT_PAYMENT_METHODS.map(def=>{
            const saved = data.find(d=>d.key===def.key)
            return saved ? {...def,days:saved.days,fee:saved.fee} : def
          }))
        }
      } catch(err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  },[companyId])

  const update = (key,field,val) => setMethods(prev=>prev.map(m=>m.key===key?{...m,[field]:val}:m))

  const save = async()=>{
    if(!companyId){toast.show('Empresa não identificada','error');return}
    setSaving(true)
    try {
      // Upsert todos os métodos
      const rows = methods.map(m=>({company_id:companyId,key:m.key,label:m.label,days:+m.days||0,fee:+m.fee||0}))
      const {error} = await supabase.from('payment_methods').upsert(rows,{onConflict:'company_id,key'})
      if(error){toast.show('Erro: '+error.message,'error');return}
      toast.show('Configurações salvas!')
      setTimeout(onClose,1200)
    } catch(err) {
      toast.show('Erro ao salvar: '+(err?.message||'falha de conexão'),'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="💳 Meios de Pagamento" onClose={onClose}>
      {toast.el}
      {loading?<Spinner/>:(
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <p style={{fontSize:11,color:C.muted,margin:'0 0 10px'}}>Configure prazo (dias para receber) e taxa (%) por forma de pagamento. O contas a receber será gerado automaticamente nas vendas.</p>
          {methods.map(m=>(
            <div key={m.key} style={{background:C.surfaceAlt,borderRadius:10,padding:'10px 12px',marginBottom:6}}>
              <p style={{fontSize:13,fontWeight:700,color:C.navy,margin:'0 0 8px'}}>{m.label}</p>
              <div style={{display:'grid',gridTemplateColumns:m.key==='Crédito'?'1fr 1fr 1fr':'1fr 1fr',gap:8}}>
                <Input label="Prazo (dias)" type="number" value={String(m.days)} onChange={v=>update(m.key,'days',v)} placeholder="0"/>
                <Input label="Taxa (%)" type="number" value={String(m.fee)} onChange={v=>update(m.key,'fee',v)} placeholder="0.00"/>
                {m.key==='Crédito'&&<Input label="Parcelas máx." type="number" value={String(m.max_installments||12)} onChange={v=>update(m.key,'max_installments',v)} placeholder="12"/>}
              </div>
              <p style={{fontSize:10,color:C.muted,margin:'6px 0 0'}}>
                Ex: venda de R$100 hoje → recebe {fmtBRL(100*(1-m.fee/100))} em {m.days} {m.days===1?'dia':'dias'}
                {m.key==='Crédito'&&` · até ${m.max_installments||12}x`}
              </p>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:6}}>
            <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
            <div style={{flex:1}}><Btn onClick={save} variant="primary" full disabled={saving}>{saving?'Salvando...':'Salvar'}</Btn></div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ModalSeguranca({onClose}) {
  return (
    <Modal title="🔒 Segurança" onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{background:C.infoPale,borderRadius:10,padding:14}}>
          <p style={{fontSize:13,fontWeight:700,color:C.info,margin:'0 0 4px'}}>🔐 Autenticação em 2 Fatores</p>
          <p style={{fontSize:12,color:C.muted,margin:'0 0 10px'}}>Adicione uma camada extra de segurança à sua conta.</p>
          <Btn size="sm" variant="primary">Ativar 2FA</Btn>
        </div>
        <div style={{background:C.surfaceAlt,borderRadius:10,padding:14}}>
          <p style={{fontSize:13,fontWeight:700,color:C.text,margin:'0 0 4px'}}>📋 Logs de Acesso</p>
          <p style={{fontSize:12,color:C.muted,margin:'0 0 10px'}}>Veja os últimos acessos à sua conta.</p>
          <div style={{background:C.white,borderRadius:8,padding:10}}>
            <p style={{fontSize:11,color:C.muted,margin:0,textAlign:'center'}}>Nenhum registro de acesso suspeito.</p>
          </div>
        </div>
        <Btn onClick={onClose} variant="ghost" full>Fechar</Btn>
      </div>
    </Modal>
  )
}

function PageSettings({user,onLogout,companyId,isSuperAdmin}) {
  const [activeModal,setActiveModal] = useState(null)
  const sections = [
    {id:'empresa',icon:'🏢',title:'Dados da Empresa',desc:'CNPJ, razão social, endereço'},
    {id:'perfil',icon:'👤',title:'Meu Perfil',desc:'Nome, e-mail, senha'},
    {id:'notificacoes',icon:'🔔',title:'Notificações',desc:'Alertas de estoque e vencimentos'},
    {id:'tributacao',icon:'🏷️',title:'Tributação / Fiscal',desc:'Regime tributário, CFOP, NCM'},
    {id:'pagamentos',icon:'💳',title:'Meios de Pagamento',desc:'Prazos e taxas por forma de pagamento'},
    {id:'seguranca',icon:'🔒',title:'Segurança',desc:'Autenticação 2FA, logs de acesso'},
  ]
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <SectionHeader title="Configurações" sub="Gerencie seu sistema"/>
      <Card>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:48,height:48,background:C.navy,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',color:C.white,fontWeight:800,fontSize:16}}>{(user?.email||'A')[0].toUpperCase()}</div>
          <div>
            <p style={{fontSize:14,fontWeight:700,color:C.text,margin:0}}>{user?.email}</p>
            <Badge label="Admin" color={C.infoPale} text={C.info}/>
          </div>
        </div>
      </Card>
      {sections.map(s=>(
        <Card key={s.id} style={{display:'flex',alignItems:'center',gap:14,cursor:'pointer'}} onClick={()=>setActiveModal(s.id)}>
          <div style={{width:44,height:44,background:C.surfaceAlt,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{s.icon}</div>
          <div style={{flex:1}}>
            <p style={{fontSize:13,fontWeight:700,color:C.text,margin:0}}>{s.title}</p>
            <p style={{fontSize:11,color:C.muted,margin:'2px 0 0'}}>{s.desc}</p>
          </div>
          <span style={{color:C.muted,fontSize:20}}>›</span>
        </Card>
      ))}
      <button onClick={onLogout} style={{background:C.dangerPale,border:`1.5px solid #FCA5A5`,color:C.danger,borderRadius:12,padding:13,fontSize:14,fontWeight:700,cursor:'pointer',width:'100%'}}>🚪 Sair do Sistema</button>
      {activeModal==='empresa'&&<ModalEmpresa companyId={companyId} onClose={()=>setActiveModal(null)}/>}
      {activeModal==='perfil'&&<ModalPerfil user={user} onClose={()=>setActiveModal(null)}/>}
      {activeModal==='notificacoes'&&<ModalNotificacoes onClose={()=>setActiveModal(null)}/>}
      {activeModal==='tributacao'&&<ModalTributacao onClose={()=>setActiveModal(null)} companyId={companyId} isSuperAdmin={isSuperAdmin}/>}
      {activeModal==='pagamentos'&&<ModalPagamentos companyId={companyId} onClose={()=>setActiveModal(null)}/>}
      {activeModal==='seguranca'&&<ModalSeguranca onClose={()=>setActiveModal(null)}/>}
    </div>
  )
}

// ── SIDEBAR ────────────────────────────────────────────────────────────────
function Sidebar({page, setPage, nav, companyName, isSuperAdmin, canAccess}) {
  const [expanded,setExpanded] = useState(false)
  const timerRef = useRef(null)

  const handleMouseEnter = () => {
    clearTimeout(timerRef.current)
    setExpanded(true)
  }
  const handleMouseLeave = () => {
    timerRef.current = setTimeout(()=>setExpanded(false), 3000)
  }
  useEffect(()=>()=>clearTimeout(timerRef.current),[])

  const W_EXPANDED = 224
  const W_COLLAPSED = 62

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={()=>{ if(!expanded){ setExpanded(true); clearTimeout(timerRef.current); timerRef.current=setTimeout(()=>setExpanded(false),5000) } }}
      style={{
        width: expanded ? W_EXPANDED : W_COLLAPSED,
        minHeight:'100vh', background:C.navy,
        display:'flex', flexDirection:'column', flexShrink:0,
        transition:'width 0.25s cubic-bezier(.4,0,.2,1)',
        overflow:'hidden', position:'relative', zIndex:10,
      }}
    >
      {/* Logo */}
      <div style={{padding:'18px 12px 14px',borderBottom:'1px solid rgba(255,255,255,0.1)',display:'flex',alignItems:'center',gap:10,minHeight:72,flexShrink:0}}>
        <div style={{width:36,height:36,background:C.white,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <DaliLogo size={28}/>
        </div>
        <div style={{opacity:expanded?1:0,transition:'opacity 0.2s',whiteSpace:'nowrap',overflow:'hidden'}}>
          <p style={{fontSize:15,fontWeight:900,color:C.white,margin:0}}>DALI<span style={{color:C.green}}>Tech</span></p>
          <p style={{fontSize:9,color:'rgba(255,255,255,0.45)',margin:0,letterSpacing:'0.08em',textTransform:'uppercase'}}>{isSuperAdmin?'Super Admin':'ERP Sistema'}</p>
        </div>
      </div>

      {/* Company chip */}
      {expanded&&companyName&&(
        <div style={{margin:'10px 10px 0',background:'rgba(255,255,255,0.08)',borderRadius:8,padding:'7px 10px'}}>
          <p style={{fontSize:10,color:'rgba(255,255,255,0.45)',margin:0,textTransform:'uppercase',letterSpacing:'0.06em'}}>Empresa</p>
          <p style={{fontSize:12,fontWeight:700,color:C.white,margin:'2px 0 0',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{companyName}</p>
        </div>
      )}
      {expanded&&isSuperAdmin&&(
        <div style={{margin:'8px 10px 0'}}><Badge label="⭐ Super Admin" color="rgba(255,255,255,0.15)" text={C.green}/></div>
      )}

      {/* Nav items */}
      <nav style={{flex:1,padding:'10px 8px',overflowY:'auto',overflowX:'hidden'}}>
        {nav.map(item=>{
          const active = page===item.id
          return (
            <button key={item.id} onClick={()=>setPage(item.id)}
              title={!expanded?item.label:''}
              style={{
                width:'100%', display:'flex', alignItems:'center',
                gap: expanded?10:0, justifyContent: expanded?'flex-start':'center',
                padding: expanded?'9px 10px':'10px 0',
                borderRadius:9, border:'none', cursor:'pointer',
                marginBottom:2, textAlign:'left',
                background: active?'rgba(255,255,255,0.13)':'transparent',
                borderLeft: expanded?`3px solid ${active?C.green:'transparent'}`:'3px solid transparent',
                transition:'all .15s',
                position:'relative',
              }}>
              <span style={{fontSize:16,flexShrink:0}}>{item.icon}</span>
              <span style={{
                fontSize:12, fontWeight:active?700:400,
                color:active?C.white:'rgba(255,255,255,0.6)',
                whiteSpace:'nowrap', overflow:'hidden',
                maxWidth: expanded?120:0,
                opacity: expanded?1:0,
                transition:'max-width 0.2s, opacity 0.15s',
              }}>{item.label}</span>
              {active&&!expanded&&(
                <div style={{position:'absolute',left:0,top:'50%',transform:'translateY(-50%)',width:3,height:20,background:C.green,borderRadius:'0 2px 2px 0'}}/>
              )}
            </button>
          )
        })}
      </nav>

      {/* Expand hint when collapsed */}
      {!expanded&&(
        <div style={{padding:'10px 0',display:'flex',justifyContent:'center',opacity:0.3}}>
          <span style={{fontSize:10,color:C.white,writingMode:'vertical-rl',letterSpacing:'0.1em'}}>›</span>
        </div>
      )}
    </div>
  )
}


// ── BOTTOM NAV MOBILE ──────────────────────────────────────────────────────
function BottomNav({page, setPage, onMenu, isSuperAdmin, canAccess}) {
  const quick = isSuperAdmin
    ? [{id:'super_dash',label:'Painel',icon:'🌐'},{id:'super_companies',label:'Empresas',icon:'🏢'},{id:'super_licenses',label:'Licenças',icon:'🔑'},{id:'super_users',label:'Usuários',icon:'👥'}]
    : [{id:'dash',label:'Home',icon:'📊'},{id:'pdv',label:'PDV',icon:'🛒'},{id:'products',label:'Produtos',icon:'📦'},{id:'cashflow',label:'Caixa',icon:'💰'}]
  return (
    <div style={{position:'fixed',bottom:0,left:0,right:0,background:C.white,borderTop:`1px solid ${C.border}`,display:'flex',alignItems:'center',zIndex:100,paddingBottom:'env(safe-area-inset-bottom,0px)'}}>
      {quick.map(item=>(
        <button key={item.id} onClick={()=>setPage(item.id)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'10px 4px 8px',border:'none',background:'transparent',cursor:'pointer'}}>
          <span style={{fontSize:20}}>{item.icon}</span>
          <span style={{fontSize:9,fontWeight:700,color:page===item.id?C.navy:C.subtle,textTransform:'uppercase',letterSpacing:'0.04em'}}>{item.label}</span>
{page===item.id&&<div style={{width:18,height:2.5,background:C.navy,borderRadius:2}}/>}
        </button>
      ))}
      <button onClick={onMenu} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'10px 4px 8px',border:'none',background:'transparent',cursor:'pointer'}}>
        <span style={{fontSize:20}}>☰</span>
        <span style={{fontSize:9,fontWeight:700,color:C.subtle,textTransform:'uppercase',letterSpacing:'0.04em'}}>Menu</span>
      </button>
    </div>
  )
}
function MobileDrawer({page, setPage, onClose, nav, companyName, isSuperAdmin, canAccess}) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:300}}>
      <div onClick={onClose} style={{position:'absolute',inset:0,background:'rgba(13,43,94,0.5)'}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,background:C.white,borderRadius:'20px 20px 0 0',maxHeight:'80vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'14px 0 8px'}}><div style={{width:40,height:4,background:C.border,borderRadius:2}}/></div>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'0 18px 14px',borderBottom:`1px solid ${C.border}`}}>
          <div style={{width:34,height:34,background:C.navy,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center'}}><DaliLogo size={26}/></div>
          <div>
            <p style={{fontSize:14,fontWeight:900,color:C.navy,margin:0}}>DALI<span style={{color:C.green}}>Tech</span></p>
            {isSuperAdmin?<Badge label="⭐ Super Admin" color={C.infoPale} text={C.info}/>:<p style={{fontSize:10,color:C.muted,margin:0}}>{companyName}</p>}
          </div>
        </div>
        <div style={{padding:'8px 12px 36px'}}>
          {nav.map(item=>(
            <button key={item.id} onClick={()=>{setPage(item.id);onClose()}} style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 12px',border:'none',background:page===item.id?C.surfaceAlt:'transparent',borderRadius:12,cursor:'pointer',marginBottom:2,textAlign:'left'}}>
              <span style={{fontSize:19}}>{item.icon}</span>
              <span style={{fontSize:14,fontWeight:page===item.id?700:500,color:page===item.id?C.navy:C.text}}>{item.label}</span>
              {page===item.id&&<div style={{marginLeft:'auto',width:7,height:7,background:C.green,borderRadius:999}}/>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════
// NAV COM CONTROLE DE PLANO
// ══════════════════════════════════════
function NavItem({ item, active, onClick, locked }) {
  return (
    <button onClick={() => !locked && onClick(item.id)} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 10px', borderRadius: 9, border: 'none', cursor: locked ? 'not-allowed' : 'pointer',
      marginBottom: 1, textAlign: 'left',
      background: active ? 'rgba(255,255,255,0.13)' : 'transparent',
      borderLeft: `3px solid ${active ? C.green : 'transparent'}`,
      opacity: locked ? 0.4 : 1, transition: 'all .15s',
    }}>
      <span style={{ fontSize: 15 }}>{item.icon}</span>
      <span style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.white : 'rgba(255,255,255,0.6)' }}>
        {item.label}
      </span>
      {locked && <span style={{ marginLeft: 'auto', fontSize: 10 }}>🔒</span>}
    </button>
  )
}


// ══════════════════════════════════════
// PAINEL DE USO DO PLANO
// ══════════════════════════════════════
function PlanPanel({ plan, usage }) {
  if (!plan) return null
  const p = PLANS[plan.key] || PLANS.basic
  return (
    <Card style={{ marginBottom: 16, background: plan.inactive ? C.dangerPale : C.white }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 11, color: C.muted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Seu Plano</p>
          <p style={{ fontSize: 16, fontWeight: 800, color: plan.inactive ? C.danger : C.navy, margin: '2px 0 0' }}>
            {p.label} {plan.inactive ? '— EXPIRADO' : ''}
          </p>
        </div>
        <Badge label={p.label} color={p.pale} text={p.color} />
      </div>
      <PlanUsageBar label="Usuários" used={usage.users} max={p.maxUsers} color={C.info} />
      <PlanUsageBar label="Produtos" used={usage.products} max={p.maxProducts} color={C.green} />
      <PlanUsageBar label="Vendas no Mês" used={usage.salesMonth} max={p.maxSalesMonth} color={C.navy} />
      {plan.expiresAt && (
        <p style={{ fontSize: 11, color: plan.inactive ? C.danger : C.muted, margin: '8px 0 0', fontWeight: plan.inactive ? 700 : 400 }}>
          {plan.inactive ? '🚫 Licença expirada em ' : '📅 Vence em '}
          {new Date(plan.expiresAt).toLocaleDateString('pt-BR')}
        </p>
      )}
    </Card>
  )
}

// ══════════════════════════════════════
// APP PRINCIPAL
// ══════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [companyName, setCompanyName] = useState('')
  const [page, setPage] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  // Filtros de navegação rápida (drill-down a partir do Dashboard)
  const [stockFilter, setStockFilter] = useState(null) // 'alert' | null
  const [salesFilter, setSalesFilter] = useState(null) // {mode,month,year} | null

  const isSuperAdmin = profile?.is_super_admin === true
  const companyId = profile?.company_id || null
  const userRole = profile?.role || 'USER'
  const userEmail = user?.email || ''

  // Sistema de planos
  const { plan, usage, canAccess, canAddUser, canAddProduct, canAddSale } = usePlan(
    isSuperAdmin ? null : companyId
  )

  useEffect(() => {
    let resolved = false

    // Rede de segurança: se o Supabase não responder em 8s (rede ruim, instabilidade),
    // libera a tela de login em vez de travar para sempre em "Carregando..."
    const safetyTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        setAuthLoading(false)
      }
    }, 8000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        try {
          const { data: p, error: profileError } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
          if (profileError) throw profileError
          setProfile(p || null)
          setPage(p?.is_super_admin ? 'super_dash' : 'dash')
          if (p?.company_id) {
            try {
              const { data: c } = await supabase.from('companies').select('name').eq('id', p.company_id).single()
              setCompanyName(c?.name || '')
            } catch (e2) {
              setCompanyName('')
            }
          } else {
            setCompanyName('')
          }
        } catch (e) {
          setProfile(null)
          setPage('dash')
        }
      }
      resolved = true
      clearTimeout(safetyTimer)
      setAuthLoading(false)
    }).catch(() => {
      // Se a chamada falhar de vez (sem rede, erro de CORS, etc), não trava a tela
      resolved = true
      clearTimeout(safetyTimer)
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      window.__lastAuthEvent = _event + ' | hasSession: ' + !!session
      setUser(session?.user ?? null)
      if (session?.user) {
        try {
          const { data: p, error: profileError } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
          if (profileError) throw profileError
          setProfile(p || null)
          setPage(p?.is_super_admin ? 'super_dash' : 'dash')
          if (p?.company_id) {
            try {
              const { data: c } = await supabase.from('companies').select('name').eq('id', p.company_id).single()
              setCompanyName(c?.name || '')
            } catch (e2) {
              setCompanyName('')
            }
          } else {
            setCompanyName('')
          }
        } catch (e) {
          setProfile(null)
          setPage('dash')
        }
      } else if (_event === 'SIGNED_OUT') {
        // Só limpa o estado em logout explícito — outros eventos sem sessão
        // (ex: INITIAL_SESSION durante restauração, TOKEN_REFRESHED transitório)
        // não devem derrubar um profile já carregado.
        setProfile(null); setPage(null)
      }
      resolved = true
      clearTimeout(safetyTimer)
      setAuthLoading(false)
    })
    return () => { subscription.unsubscribe(); clearTimeout(safetyTimer) }
  }, [])

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setPage(null)
  }

  if (authLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.navy }}>
      <div style={{ textAlign: 'center' }}>
        <DaliLogo size={56} />
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 16 }}>Carregando...</p>
      </div>
    </div>
  )

  if (!user) return <LoginPage onLogin={setUser} />

  const nav = isSuperAdmin ? NAV_SUPER : NAV_CLIENT
  const pageTitles = Object.fromEntries([...NAV_CLIENT, ...NAV_SUPER].map(n => [n.id, n.label]))
  const props = {
    user, companyId, canAddProduct, canAddSale, canAddUser, plan, usage,
    setPage, stockFilter, setStockFilter, salesFilter, setSalesFilter,
    userRole, userEmail,
  }

  const renderPage = () => {
    // Verifica se módulo está bloqueado pelo plano
    if (!isSuperAdmin && plan && !canAccess(page)) {
      return (
        <div>
          <div style={{background:'#1a1a2e',color:'#0f0',fontFamily:'monospace',fontSize:11,padding:12,borderRadius:8,marginBottom:12,whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
            {'[DIAGNÓSTICO TEMPORÁRIO]\n'}
            {'user.email: ' + JSON.stringify(userEmail) + '\n'}
            {'profile: ' + JSON.stringify(profile) + '\n'}
            {'isSuperAdmin: ' + JSON.stringify(isSuperAdmin) + '\n'}
            {'companyId: ' + JSON.stringify(companyId) + '\n'}
            {'plan: ' + JSON.stringify(plan) + '\n'}
            {'page: ' + JSON.stringify(page) + '\n'}
            {'lastAuthEvent: ' + JSON.stringify(typeof window !== 'undefined' ? window.__lastAuthEvent : 'n/a')}
          </div>
          <PlanBlock plan={plan} feature={pageTitles[page] || 'Este módulo'} />
        </div>
      )
    }
    switch (page) {
      case 'super_dash':      return <SuperDash />
      case 'super_companies': return <SuperCompanies />
      case 'super_licenses':  return <SuperLicenses />
      case 'super_users':     return <SuperUsers />
      case 'super_settings':  return <PageSettings user={user} onLogout={logout} />
      case 'dash':            return <PageDash {...props} />
      case 'products':        return <PageProducts {...props} />
      case 'inventory':       return <PageInventory {...props} />
      case 'pdv':             return <PagePDV {...props} />
      case 'sales':           return <PageSales {...props} />
      case 'customers':       return <PageCustomers {...props} />
      case 'suppliers':       return <PageSuppliers {...props} />
      case 'cashflow':        return <PageCashflow {...props} />
      case 'payable':         return <PageAccounts type="payable" {...props} />
      case 'receivable':      return <PageAccounts type="receivable" {...props} />
      case 'users':           return <PageUsers {...props} />
      case 'settings':        return <PageSettings user={user} onLogout={logout} />
      default:                return <PageDash {...props} />
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.surface }}>
      {!isMobile && <Sidebar page={page} setPage={setPage} nav={nav} companyName={companyName} isSuperAdmin={isSuperAdmin} canAccess={canAccess} />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Bar */}
        <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: isMobile ? '12px 16px' : '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
          {isMobile ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, background: C.navy, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DaliLogo size={24} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 900, color: C.navy }}>DALI<span style={{ color: C.green }}>Tech</span></span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{pageTitles[page]}</span>
            </>
          ) : (
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 800, color: C.navy, margin: 0 }}>{pageTitles[page]}</h1>
              <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
                {isSuperAdmin ? 'Super Admin · DALI Tech' : `${companyName ? companyName + ' · ' : ''}DALI Tech ERP`}
              </p>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isSuperAdmin && <Badge label="⭐ Super Admin" color={C.infoPale} text={C.info} />}
            {!isSuperAdmin && plan && (
              <Badge
                label={`Plano ${PLANS[plan.key]?.label || 'Basic'}`}
                color={PLANS[plan.key]?.pale || C.surfaceAlt}
                text={PLANS[plan.key]?.color || C.muted}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.greenPale, padding: '5px 12px', borderRadius: 99 }}>
              <div style={{ width: 7, height: 7, background: C.green, borderRadius: 999 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.greenLight }}>Online</span>
            </div>
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, padding: isMobile ? '16px 14px 96px' : '24px 28px', overflowY: 'auto' }}>
          <div style={{ maxWidth: isMobile ? '100%' : 760, margin: '0 auto' }}>
            {/* Banner de licença expirada */}
            {!isSuperAdmin && plan?.inactive && <ExpiredBanner />}
            {/* Painel de uso do plano na página de configurações */}
            {!isSuperAdmin && page === 'settings' && plan && <PlanPanel plan={plan} usage={usage} />}
            {renderPage()}
          </div>
        </div>
      </div>

      {isMobile && <BottomNav page={page} setPage={setPage} onMenu={() => setDrawerOpen(true)} isSuperAdmin={isSuperAdmin} canAccess={canAccess} />}
      {isMobile && drawerOpen && <MobileDrawer page={page} setPage={setPage} onClose={() => setDrawerOpen(false)} nav={nav} companyName={companyName} isSuperAdmin={isSuperAdmin} canAccess={canAccess} />}
    </div>
  )
}
