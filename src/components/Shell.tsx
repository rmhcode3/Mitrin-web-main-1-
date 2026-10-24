import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import {
  LayoutDashboard, Target, CalendarCheck, GraduationCap, Users, Grid3x3, SearchCheck, CalendarDays, ClipboardCheck, Wallet, Banknote, BarChart3, ShieldCheck, Upload, History,
  Settings as SettingsIcon, Home, BookOpen, UserRound, LogOut, Menu, X, type LucideIcon,
} from 'lucide-react'
import { roleLabel, useAuth, type Perm } from '../lib/auth'
import { cx } from './ui'

interface NavItem { to: string; label: string; icon: LucideIcon; perms?: Perm[]; end?: boolean }
interface NavGroup { title: string; items: NavItem[] }

export const ADMIN_NAV: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/admin/leads', label: 'Leads pipeline', icon: Target, perms: ['coordinator'] },
      { to: '/admin/demos', label: 'Demos & trials', icon: CalendarCheck, perms: ['coordinator'] },
      { to: '/admin/students', label: 'Student roster', icon: GraduationCap, perms: ['coordinator', 'finance'] },
      { to: '/admin/teachers', label: 'Teacher roster', icon: Users, perms: ['coordinator'] },
      { to: '/admin/availability', label: 'Availability matrix', icon: Grid3x3, perms: ['coordinator'] },
      { to: '/admin/slot-finder', label: 'Tutor slot finder', icon: SearchCheck, perms: ['coordinator'] },
      { to: '/admin/scheduler', label: 'Lesson scheduler', icon: CalendarDays, perms: ['coordinator'] },
    ],
  },
  {
    title: 'Accounts & billing',
    items: [
      { to: '/admin/attendance', label: 'Attendance', icon: ClipboardCheck, perms: ['coordinator', 'finance'] },
      { to: '/admin/fees', label: 'Fees & payments', icon: Wallet, perms: ['finance'] },
      { to: '/admin/payouts', label: 'Tutor payouts', icon: Banknote, perms: ['finance'] },
      { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/team', label: 'Team accounts', icon: ShieldCheck, perms: ['super_admin'] },
      { to: '/admin/imports', label: 'Imports', icon: Upload, perms: ['super_admin'] },
      { to: '/admin/audit', label: 'Audit history', icon: History, perms: ['super_admin'] },
      { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
]

export const TUTOR_NAV: NavItem[] = [
  { to: '/tutor', label: 'Home', icon: Home, end: true },
  { to: '/tutor/classes', label: 'My Classes', icon: BookOpen },
  { to: '/tutor/students', label: 'My Students', icon: GraduationCap },
  { to: '/tutor/earnings', label: 'My Earnings', icon: Banknote },
]

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-1">
      <img src="/assets/mitrin-mark.png" alt="" className="h-12 w-auto shrink-0" />
      <div className="leading-none min-w-0">
        <p className="font-extrabold tracking-wide text-[26px] text-white">MITRIN</p>
        <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#cfe0ff] whitespace-nowrap">The Language School</p>
      </div>
    </Link>
  )
}

function UserBox({ onNav }: { onNav?: () => void }) {
  const { profile, signOut } = useAuth()
  return (
    <div className="border-t border-white/10 p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-brand-500 text-white font-extrabold flex items-center justify-center shrink-0">{(profile?.full_name || '?').slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold truncate text-white">{profile?.full_name}</p>
          <p className="text-[12px] text-[#8ea3cc]">{roleLabel(profile)}</p>
        </div>
        {profile?.role === 'teacher' && <NavLink to="/tutor/profile" onClick={onNav} aria-label="Profile" title="Profile" className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"><UserRound size={18} /></NavLink>}
        <button onClick={() => void signOut()} aria-label="Log out" title="Log out" className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"><LogOut size={18} /></button>
      </div>
    </div>
  )
}

function SideLink({ it, onNav }: { it: NavItem; onNav?: () => void }) {
  return (
    <NavLink to={it.to} end={it.end} onClick={onNav}
      className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 min-h-11 text-[15.5px] transition-colors', isActive ? 'bg-brand-500 text-white font-semibold shadow' : 'font-medium text-[#e3e9f7] hover:bg-white/10 hover:text-white')}>
      <it.icon size={20} strokeWidth={1.75} /> {it.label}
    </NavLink>
  )
}

function SideNav({ onNav }: { onNav?: () => void }) {
  const { profile, can } = useAuth()
  const groups = profile?.role === 'teacher'
    ? [{ title: 'My work', items: TUTOR_NAV }]
    : ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perms || i.perms.some((p) => can(p))) })).filter((g) => g.items.length)
  return (
    <div className="flex h-full flex-col bg-[#0a2351] text-white">
      <div className="px-4 pt-5 pb-4"><Brand /></div>
      <nav className="flex-1 overflow-y-auto scroll-side px-3 pb-4 space-y-5" aria-label="Main">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="px-3 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8ea3cc]">{g.title}</p>
            <div className="space-y-0.5">{g.items.map((i) => <SideLink key={i.to} it={i} onNav={onNav} />)}</div>
          </div>
        ))}
      </nav>
      <UserBox onNav={onNav} />
    </div>
  )
}

export function Shell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { profile } = useAuth()
  const loc = useLocation()
  const isTutor = profile?.role === 'teacher'
  return (
    <div className="min-h-full md:flex bg-paper">
      <aside className="hidden md:block w-64 shrink-0 h-screen sticky top-0"><SideNav /></aside>

      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-[#0a2351] text-white px-4 h-14">
        <div className="flex items-center gap-2.5"><img src="/assets/mitrin-mark.png" alt="MITRIN" className="h-8 w-auto" /><span className="font-extrabold tracking-wide">MITRIN</span></div>
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="min-h-11 min-w-11 flex items-center justify-center"><Menu size={24} /></button>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85%] h-full anim-slide"><SideNav onNav={() => setOpen(false)} /></div>
          <button aria-label="Close menu" className="flex-1 bg-ink/50" onClick={() => setOpen(false)}><X className="m-4 ml-auto text-white" /></button>
        </div>
      )}

      <main key={loc.pathname} className={cx('flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5 md:py-7', isTutor && 'pb-24 md:pb-7')}>
        <div className="max-w-[1400px] mx-auto">{children ?? <Outlet />}</div>
      </main>

      {isTutor && (
        <nav aria-label="Tutor" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line grid grid-cols-4">
          {TUTOR_NAV.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('flex flex-col items-center justify-center gap-0.5 min-h-16 text-[11px] font-semibold', isActive ? 'text-brand-600' : 'text-ink-soft')}>
              <i.icon size={21} />{i.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
