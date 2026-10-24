import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { AuthProvider, useAuth, type Perm } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { ConfirmProvider, Empty, Spinner } from './components/ui'
import { Shell } from './components/Shell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Login, Register, ResetPassword, TutorGate, homePath } from './pages/auth/AuthPages'

const page = <T extends { default: React.ComponentType }>(f: () => Promise<T>) => lazy(f)
const Dashboard = page(() => import('./pages/admin/Dashboard'))
const Leads = page(() => import('./pages/admin/Leads'))
const Demos = page(() => import('./pages/admin/Demos'))
const Students = page(() => import('./pages/admin/Students'))
const Teachers = page(() => import('./pages/admin/Teachers'))
const AvailabilityMatrix = page(() => import('./pages/admin/AvailabilityMatrix'))
const SlotFinder = page(() => import('./pages/admin/SlotFinder'))
const Scheduler = page(() => import('./pages/admin/Scheduler'))
const Attendance = page(() => import('./pages/admin/Attendance'))
const Fees = page(() => import('./pages/admin/Fees'))
const Payouts = page(() => import('./pages/admin/Payouts'))
const Reports = page(() => import('./pages/admin/Reports'))
const Team = page(() => import('./pages/admin/Team'))
const Imports = page(() => import('./pages/admin/Imports'))
const Audit = page(() => import('./pages/admin/Audit'))
const Settings = page(() => import('./pages/admin/Settings'))
const TutorHome = page(() => import('./pages/tutor/TutorHome'))
const TutorClasses = page(() => import('./pages/tutor/TutorClasses'))
const TutorStudents = page(() => import('./pages/tutor/TutorStudents'))
const TutorEarnings = page(() => import('./pages/tutor/TutorEarnings'))
const TutorAvailability = page(() => import('./pages/tutor/TutorAvailability'))
const TutorAttendance = page(() => import('./pages/tutor/TutorAttendance'))
const TutorProfile = page(() => import('./pages/tutor/TutorProfile'))

function Boot() { return <div className="h-full flex items-center justify-center"><Spinner text="Loading Mitrin…" /></div> }

function Root() {
  const { profile, loading } = useAuth()
  if (loading) return <Boot />
  return <Navigate to={homePath(profile)} replace />
}

function RequireAdmin() {
  const { profile, loading, isAdmin } = useAuth()
  if (loading) return <Boot />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'teacher') return <Navigate to="/tutor" replace />
  if (!isAdmin) return <div className="p-10"><Empty title="Your account is suspended" hint="Please contact a Super Admin." /></div>
  return <Shell />
}

function RequireTutor() {
  const { profile, loading, tutorApproved } = useAuth()
  if (loading) return <Boot />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== 'teacher') return <Navigate to="/admin" replace />
  if (!tutorApproved) return <TutorGate />
  return <Shell />
}

/** Route-level permission gate. The database enforces the same rule; this keeps people out of empty screens. */
function Need({ perms, children }: { perms?: Perm[]; children: ReactNode }) {
  const { can } = useAuth()
  if (perms && !perms.some((p) => can(p))) {
    return <Empty title="You do not have access to this page" hint="Ask a Super Admin if you need it." action={<Lock size={20} />} />
  }
  return <>{children}</>
}

const C: Perm[] = ['coordinator']
const F: Perm[] = ['finance']
const CF: Perm[] = ['coordinator', 'finance']
const S: Perm[] = ['super_admin']

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <ErrorBoundary>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route path="/" element={<Root />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                <Route path="/admin" element={<RequireAdmin />}>
                  <Route index element={<Dashboard />} />
                  <Route path="leads" element={<Need perms={C}><Leads /></Need>} />
                  <Route path="demos" element={<Need perms={C}><Demos /></Need>} />
                  <Route path="students" element={<Need perms={CF}><Students /></Need>} />
                  <Route path="teachers" element={<Need perms={C}><Teachers /></Need>} />
                  <Route path="availability" element={<Need perms={C}><AvailabilityMatrix /></Need>} />
                  <Route path="slot-finder" element={<Need perms={C}><SlotFinder /></Need>} />
                  <Route path="scheduler" element={<Need perms={C}><Scheduler /></Need>} />
                  <Route path="attendance" element={<Need perms={CF}><Attendance /></Need>} />
                  <Route path="fees" element={<Need perms={F}><Fees /></Need>} />
                  <Route path="payouts" element={<Need perms={F}><Payouts /></Need>} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="team" element={<Need perms={S}><Team /></Need>} />
                  <Route path="imports" element={<Need perms={S}><Imports /></Need>} />
                  <Route path="audit" element={<Need perms={S}><Audit /></Need>} />
                  <Route path="settings" element={<Settings />} />
                </Route>

                <Route path="/tutor" element={<RequireTutor />}>
                  <Route index element={<TutorHome />} />
                  <Route path="classes" element={<TutorClasses />} />
                  <Route path="attendance" element={<TutorAttendance />} />
                  <Route path="students" element={<TutorStudents />} />
                  <Route path="earnings" element={<TutorEarnings />} />
                  <Route path="availability" element={<TutorAvailability />} />
                  <Route path="profile" element={<TutorProfile />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
