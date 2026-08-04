'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import NotificationBell from '@/components/NotificationBell'
import Logo from '@/components/Logo'
import {
  LayoutDashboard,
  LineChart,
  Droplets,
  FlaskConical,
  FileText,
  Moon,
  Sun,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/trends', label: 'Trends', Icon: LineChart },
  { href: '/schimmelrisico', label: 'Schimmel', Icon: Droplets },
  { href: '/scenarios', label: "Scenario's", Icon: FlaskConical },
  { href: '/report', label: 'Rapport', Icon: FileText },
]

interface Props {
  title?: string
  actions?: ReactNode
  children: ReactNode
}

export default function AppShell({ title, actions, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [dark, setDark] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [email, setEmail] = useState('')

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
    setCollapsed(localStorage.getItem('wz-sidebar-collapsed') === '1')
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
  }, [supabase])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
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

  const themeBtn = (
    <button onClick={toggleTheme} className="wz-iconbtn" title="Thema wisselen" aria-label="Thema wisselen">
      {dark ? <Sun /> : <Moon />}
    </button>
  )

  return (
    <div className={`wz-shell${collapsed ? ' wz-collapsed' : ''}`}>
      {/* ── Desktop sidebar ── */}
      <aside className="wz-sidebar">
        <div className="wz-sidehead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '2px 4px 18px' }}>
          {!collapsed && logo}
          <button onClick={toggleCollapse} className="wz-iconbtn" style={{ width: 28, height: 28 }} title={collapsed ? 'Uitklappen' : 'Inklappen'} aria-label="Menu in-/uitklappen">
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={`wz-navlink${isActive(href) ? ' active' : ''}`} title={collapsed ? label : undefined}>
              <Icon />
              <span className="wz-navlabel">{label}</span>
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div className="wz-footrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationBell />
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
      <main className="wz-main">
        <div className="wz-content">
          {(title || actions) && (
            <div className="wz-pagehead">
              {title ? <h1 className="wz-pagetitle">{title}</h1> : <span />}
              {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
            </div>
          )}
          {children}
        </div>
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="wz-bottombar">
        {NAV.map(({ href, label, Icon }) => (
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
