/** RV-9: the submissions tracker: labels, ordering and a per-book summary. Dates are real-world "YYYY-MM-DD". */
import type { Id, Submission, World } from '../model';
import { daysBetween } from '../writing/goals';

export const SUBMISSION_KINDS: { id: Submission['kind']; label: string }[] = [
  { id: 'agent', label: 'Agent' }, { id: 'publisher', label: 'Publisher' }, { id: 'contest', label: 'Contest' },
  { id: 'magazine', label: 'Magazine' }, { id: 'other', label: 'Other' },
];
export const SUBMISSION_SENT: { id: Submission['sent']; label: string }[] = [
  { id: 'query', label: 'Query' }, { id: 'partial', label: 'Partial' }, { id: 'full', label: 'Full manuscript' }, { id: 'other', label: 'Other' },
];
/** open = still waiting for an answer. "Asked for more" is an answer: the pages they asked for go in a new row. */
export const SUBMISSION_ANSWERS: { id: Submission['answer']; label: string; open: boolean }[] = [
  { id: 'waiting', label: 'Waiting', open: true },
  { id: 'requested', label: 'Asked for more', open: false },
  { id: 'offer', label: 'Offer', open: false },
  { id: 'rejected', label: 'Rejected', open: false },
  { id: 'no-answer', label: 'No answer', open: false },
  { id: 'withdrawn', label: 'Withdrawn', open: false },
];
export const answerLabel = (a: Submission['answer']) => SUBMISSION_ANSWERS.find((x) => x.id === a)?.label ?? a;
export const submissionOpen = (s: Submission) => SUBMISSION_ANSWERS.find((x) => x.id === s.answer)?.open ?? false;

/** Days since it was sent while it is still open (undefined when answered or not dated). */
export function daysWaiting(s: Submission, today: string): number | undefined {
  if (!submissionOpen(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s.sentOn)) return undefined;
  return Math.max(0, daysBetween(s.sentOn, today));
}

/** Newest first; open ones before answered ones on the same day. */
export function sortedSubmissions(world: World, bookId?: Id): Submission[] {
  return world.submissions.filter((s) => !bookId || s.bookId === bookId)
    .sort((a, b) => b.sentOn.localeCompare(a.sentOn) || Number(submissionOpen(b)) - Number(submissionOpen(a)) || a.to.localeCompare(b.to));
}

export interface SubmissionSummary { sent: number; open: number; requests: number; offers: number; rejections: number }

export function submissionSummary(list: Submission[]): SubmissionSummary {
  return {
    sent: list.length,
    open: list.filter(submissionOpen).length,
    requests: list.filter((s) => s.answer === 'requested').length,
    offers: list.filter((s) => s.answer === 'offer').length,
    rejections: list.filter((s) => s.answer === 'rejected').length,
  };
}
