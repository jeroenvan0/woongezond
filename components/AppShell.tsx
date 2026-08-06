'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import NotificationBell from '@/components/NotificationBell'
import DeviceHealthChip from '@/components/DeviceHealthChip'
import DeviceSwitcher from '@/components/DeviceSwitcher'
import Logo from '@/components/Logo'
import {
  LayoutDashboard,
  LineChart,
  Droplets,
  FlaskConical,
  FileText,
  Building2,
  Moon,
  Sun,
  Monitor,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

type ThemePref = 'system' | 'light' | 'dark'

function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme:dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/trends', label: 'Trends', Icon: LineChart },
  { href: '/schimmelrisico', label: 'Schimmel', Icon: Droplets },
  { href: '/scenarios', label: "Scenario's", Icon: FlaskConical },
  { href: '/report', label: 'Rapport', Icon: FileText },
]
// Fleet (C1) is only shown to corporation members. Appended to NAV once the
// membership check resolves, so residents never see it.
const FLEET_NAV = { href: '/vloot', label: 'Vloot', Icon: Building2 }

interface Props {
  title?: string
  actions?: ReactNode
  children: ReactNode
}

export default function AppShell({ title, actions, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [theme, setTheme] = useState<ThemePref>('system')
  const [collapsed, setCollapsed] = useState(false)
  const [email, setEmail] = useState('')
  const [isOrgMember, setIsOrgMember] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system')
    setCollapsed(localStorage.getItem('wz-sidebar-collapsed') === '1')
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
    // Show the Vloot nav only for corporation members. A single count query; if the
    // org tables aren't deployed yet it errors and we simply keep the item hidden.
    supabase.from('org_members').select('id', { count: 'exact', head: true }).then(({ count }) => {
      if ((count ?? 0) > 0) setIsOrgMember(true)
    })
  }, [supabase])

  const nav = isOrgMember ? [...NAV, FLEET_NAV] : NAV

  // While on "system", follow OS changes live (D8 — the toggle is no longer a
  // one-way door out of system).
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme:dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  // Cycle systeem → licht → donker → systeem (3.6). "systeem" clears the override
  // so it is always reachable again.
  function cycleTheme() {
    const next: ThemePref = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
    if (next === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', next)
    applyTheme(next)
  }

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem('wz-sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => pathname === href

  const logo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
      <Logo size={28} />
      <span className="wz-logo-text" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', whiteSpace: 'nowrap' }}>
        Woongezond
      </span>
    </div>
  )

  const themeLabel = theme === 'system' ? 'Thema: systeem' : theme === 'light' ? 'Thema: licht' : 'Thema: donker'
  const themeBtn = (
    <button onClick={cycleTheme} className="wz-iconbtn" title={`${themeLabel} — klik om te wisselen`} aria-label={themeLabel}>
      {theme === 'system' ? <Monitor /> : theme === 'light' ? <Sun /> : <Moon />}
    </button>
  )

  return (
    <div className={`wz-shell${collapsed ? ' wz-collapsed' : ''}`}>
      <a href="#wz-content" className="wz-skip">Naar de inhoud</a>
      {/* ── Desktop sidebar ── */}
      <aside className="wz-sidebar">
        <div className="wz-sidehead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '2px 4px 18px' }}>
          {!collapsed && logo}
          <button onClick={toggleCollapse} className="wz-iconbtn" style={{ width: 28, height: 28 }} title={collapsed ? 'Uitklappen' : 'Inklappen'} aria-label="Menu in-/uitklappen">
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>

        <nav aria-label="Hoofdnavigatie" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {nav.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} className={`wz-navlink${isActive(href) ? ' active' : ''}`} title={collapsed ? label : undefined}>
              <Icon />
              <span className="wz-navlabel">{label}</span>
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <DeviceHealthChip />
          <div className="wz-footrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationBell placement="side" />
            {themeBtn}
          </div>
          <div className="wz-user">
            <span className="wz-avatar">{(email || 'W').charAt(0).toUpperCase()}</span>
            <div className="wz-user-meta" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email || 'Bewoner'}</div>
            </div>
            <button onClick={logout} className="wz-iconbtn" title="Uitloggen" aria-label="Uitloggen" style={{ flexShrink: 0 }}>
              <LogOut />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <header className="wz-topbar">
        {logo}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotificationBell />
          {themeBtn}
          <button onClick={logout} className="wz-iconbtn" title="Uitloggen" aria-label="Uitloggen">
            <LogOut />
          </button>
        </div>
      </header>

      {/* ── Page content ── */}
      <main id="wz-content" className="wz-main">
        <div className="wz-content">
          {(title || actions) && (
            <div className="wz-pagehead">
              {title ? <h1 className="wz-pagetitle">{title}</h1> : <span />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <DeviceSwitcher />
                {actions}
              </div>
            </div>
          )}
          {children}
        </div>
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav aria-label="Hoofdnavigatie" className="wz-bottombar">
        {nav.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={isActive(href) ? 'active' : ''}>
            <span className="wz-bicon">
              <Icon />
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
