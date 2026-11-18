import PDFDocument from 'pdfkit';
import { db } from '../db.js';
import { round2 } from './domain.js';
import { eventStats } from './events.js';

// Builds a PDF of one event's budget and expenses from the database.
// Returns a Buffer. Callers must check the requester may see the event first.
export function buildExpenseReport(ev) {
  const stats = eventStats(ev.id);
  const expenses = db.prepare(`
    SELECT x.spent_on, x.description, x.category, x.vendor, x.amount, x.receipt_name, x.receipt_file
    FROM expenses x WHERE x.event_id = ? ORDER BY x.spent_on, x.id`).all(ev.id);

  const approved = ev.approved_budget ?? null;
  const remaining = approved === null ? null : round2(approved - stats.spent);
  const utilization = approved ? Math.round((stats.spent / approved) * 1000) / 10 : null;

  const byCategory = new Map();
  for (const x of expenses) byCategory.set(x.category, round2((byCategory.get(x.category) ?? 0) + x.amount));

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const money = (n) => (n === null ? '-' : `PKR ${Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`);
  const pkt = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }) + ' PKT';

  doc.fontSize(18).fillColor('#0f172a').text('UniSphere Expense Report', { align: 'left' });
  doc.moveDown(0.3).fontSize(10).fillColor('#64748b').text(`Generated ${pkt(new Date().toISOString())}`);
  doc.moveDown(1);

  doc.fontSize(13).fillColor('#0f172a').text(ev.title);
  doc.fontSize(10).fillColor('#334155')
    .text(`Society: ${ev.society_name}`)
    .text(`Venue: ${ev.venue}`)
    .text(`Event date: ${pkt(ev.start_at)} to ${pkt(ev.end_at)}`)
    .text(`Event status: ${ev.status}`);
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0f172a').text('Budget summary');
  doc.moveDown(0.4).fontSize(10).fillColor('#334155')
    .text(`Proposed budget: ${money(ev.proposed_budget)}`)
    .text(`Approved budget: ${money(approved)}`)
    .text(`Total expenses: ${money(stats.spent)}`)
    .text(`Remaining balance: ${money(remaining)}${remaining !== null && remaining < 0 ? '  (OVER BUDGET)' : ''}`)
    .text(`Budget used: ${utilization === null ? '-' : `${utilization}%`}`);
  doc.moveDown(1);

  if (byCategory.size) {
    doc.fontSize(12).fillColor('#0f172a').text('Expenses by category');
    doc.moveDown(0.4).fontSize(10).fillColor('#334155');
    for (const [category, total] of byCategory) doc.text(`${category}: ${money(total)}`);
    doc.moveDown(1);
  }

  doc.fontSize(12).fillColor('#0f172a').text(`Expense list (${expenses.length})`);
  doc.moveDown(0.4).fontSize(9).fillColor('#334155');
  if (!expenses.length) doc.text('No expenses recorded.');
  for (const x of expenses) {
    const receipt = x.receipt_file ? `Receipt: ${x.receipt_name}` : 'Receipt: none';
    doc.text(`${x.spent_on}  |  ${x.description}  |  ${x.category}${x.vendor ? ` (${x.vendor})` : ''}  |  ${money(x.amount)}  |  ${receipt}`, { width: 500 });
    doc.moveDown(0.3);
  }

  doc.end();
  return done;
}
