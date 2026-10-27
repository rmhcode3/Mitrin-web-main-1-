import { fmtDate } from './format'

export type EnrollmentPdf = {
  learner: string
  course: string
  tutor: string
  term: string
  timing: string
  classes: { allocated: number; booked: number; delivered: number; remaining: number }
  // undefined = not allowed to see fees (section left out); null = Finance, but no fee plan exists yet.
  fees?: null | { total: number; paid: number; outstanding: number; installments: { due: string; amount: number; paid: number }[] }
}

// jsPDF's built-in font has no rupee sign, so amounts are written as "Rs."
const rs = (n: number) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Builds the learner's enrollment summary and downloads it. jsPDF is loaded on demand to keep the main bundle small. */
export async function downloadEnrollmentPdf(d: EnrollmentPdf) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 18
  let y = 20
  const line = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(90); doc.text(label, L, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20); doc.text(value || '-', L + 55, y); y += 7
  }
  const heading = (t: string) => {
    y += 4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(10, 35, 81); doc.text(t, L, y)
    doc.setDrawColor(218); doc.line(L, y + 2, 192, y + 2); y += 9
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(10, 35, 81); doc.text('MITRIN The Language School', L, y); y += 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90); doc.text('Enrollment confirmation', L, y); y += 4

  heading('Course information')
  line('Learner', d.learner); line('Course', d.course); line('Tutor', d.tutor); line('Term', d.term); line('Preferred timing', d.timing)
  line('Classes allocated', String(d.classes.allocated)); line('Classes booked', String(d.classes.booked))
  line('Classes delivered', String(d.classes.delivered)); line('Classes remaining', String(d.classes.remaining))

  if (d.fees === null) {
    heading('Fee information')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20); doc.text('Fees have not been set for this enrollment yet.', L, y); y += 7
  } else if (d.fees) {
    heading('Fee information')
    line('Total fee', rs(d.fees.total)); line('Paid so far', rs(d.fees.paid)); line('Outstanding', rs(d.fees.outstanding))
    if (d.fees.installments.length) {
      y += 3
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(90)
      doc.text('Installment due', L, y); doc.text('Amount', L + 60, y); doc.text('Paid', L + 105, y); y += 6
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20)
      for (const i of d.fees.installments) {
        if (y > 275) { doc.addPage(); y = 20 }
        doc.text(fmtDate(i.due), L, y); doc.text(rs(i.amount), L + 60, y); doc.text(rs(i.paid), L + 105, y); y += 6
      }
    }
  }

  doc.setFontSize(9); doc.setTextColor(120)
  doc.text(`Prepared on ${fmtDate(new Date())}`, L, 287)
  doc.save(`Enrollment-${d.learner.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`)
}
