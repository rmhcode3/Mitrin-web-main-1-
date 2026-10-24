import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const rpc = vi.fn()
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), rpc: (...a: unknown[]) => rpc(...a) }))

import { AttendanceMarker } from './scheduling'
import { ConfirmProvider, DataTable, Empty } from './ui'
import { ToastProvider } from '../lib/toast'

const session = {
  id: 's1',
  session_participants: [
    { enrollment_id: 'e1', attendance: 'unmarked', absence_reason: null, enrollments: { students: { full_name: 'Asha' }, languages: { name: 'Hindi' } } },
    { enrollment_id: 'e2', attendance: 'unmarked', absence_reason: null, enrollments: { students: { full_name: 'Ben' }, languages: { name: 'Hindi' } } },
  ],
}
const wrap = (ui: React.ReactNode) => render(<MemoryRouter><ToastProvider><ConfirmProvider>{ui}</ConfirmProvider></ToastProvider></MemoryRouter>)

describe('AttendanceMarker', () => {
  beforeEach(() => { rpc.mockReset() })

  it('starts unmarked (never assumes present) and cannot be saved empty', () => {
    wrap(<AttendanceMarker session={session} onSaved={() => {}} />)
    expect(screen.getAllByText(/Not marked yet/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /save attendance/i })).toBeDisabled()
  })

  it('requires a reason for every absent learner, then marks each learner independently', async () => {
    rpc.mockResolvedValue({ completed: true, missing_rate: 0 })
    const saved = vi.fn()
    wrap(<AttendanceMarker session={session} onSaved={saved} />)
    const groups = screen.getAllByRole('group')
    fireEvent.click(groups[0].querySelector('button[aria-pressed]')!) // Asha: Present
    fireEvent.click(groups[1].querySelectorAll('button')[1]) // Ben: Absent
    const save = screen.getByRole('button', { name: /save attendance/i })
    expect(save).toBeDisabled() // absent without a reason
    fireEvent.change(screen.getByLabelText('Absence reason'), { target: { value: 'Student unwell' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('mark_attendance', { p_session: 's1', p_marks: [{ enrollment_id: 'e1', attendance: 'present', reason: '' }, { enrollment_id: 'e2', attendance: 'absent', reason: 'Student unwell' }] })
  })

  it('shows the server message when the attendance is locked by a finalized payout', async () => {
    rpc.mockRejectedValue(new Error('This attendance is locked because its payout was finalized.'))
    wrap(<AttendanceMarker session={session} onSaved={() => {}} />)
    fireEvent.click(screen.getAllByRole('group')[0].querySelector('button')!)
    fireEvent.click(screen.getByRole('button', { name: /save attendance/i }))
    expect(await screen.findByText(/locked because its payout was finalized/)).toBeInTheDocument()
  })
})

describe('DataTable', () => {
  const rows = [{ id: '1', name: 'Asha', course: 'Hindi' }, { id: '2', name: 'Ben', course: 'Tamil' }]
  const columns = [{ h: 'Student', primary: true, cell: (r: (typeof rows)[0]) => r.name }, { h: 'Course', cell: (r: (typeof rows)[0]) => r.course }]

  it('renders a table for desktop and stacked cards for mobile from the same data', () => {
    const { container } = wrap(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />)
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(2)
    expect(container.querySelector('.md\\:hidden')?.querySelectorAll('dl')).toHaveLength(2)
  })
  it('makes rows clickable and shows an empty state', () => {
    const open = vi.fn()
    wrap(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={open} />)
    fireEvent.click(screen.getAllByText('Ben')[0])
    expect(open).toHaveBeenCalledWith(rows[1])
    wrap(<DataTable rows={[] as typeof rows} columns={columns} rowKey={(r) => r.id} empty={<Empty title="Nothing here" />} />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})

