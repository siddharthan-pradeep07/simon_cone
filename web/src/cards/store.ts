/** Accounts, kept in localStorage. No server exists — this is the whole store. */

export interface Account {
  id: string;
  name: string;
  balance: number;
  /**
   * The dataset: one colour list per enrolment swipe. Several rather than one
   * because two swipes of the same card never read identically, and the spread
   * between them is the variation the matcher has to tolerate. Storing them all
   * means that variation is covered by example rather than guessed at.
   */
  recordings: string[][];
  createdAt: number;
}

// v3: colour-name datasets. v1 held numeric signature templates and v2 held
// fixed six-colour passcodes; neither can be turned into a set of swipe
// recordings, so those accounts are left under their own keys rather than
// half-converted into something that would not match.
const KEY = 'simon_cone.accounts.v3';

export function loadAccounts(): Account[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Account[];
    return parsed.filter(
      (account) =>
        account &&
        typeof account.name === 'string' &&
        Array.isArray(account.recordings) &&
        account.recordings.length > 0 &&
        account.recordings.every((recording) => Array.isArray(recording)),
    );
  } catch {
    return [];
  }
}

function persist(accounts: Account[]) {
  window.localStorage.setItem(KEY, JSON.stringify(accounts));
}

export function saveAccount(account: Account): Account[] {
  const next = [...loadAccounts().filter((a) => a.id !== account.id), account];
  persist(next);
  return next;
}

export function deleteAccount(id: string): Account[] {
  const next = loadAccounts().filter((account) => account.id !== id);
  persist(next);
  return next;
}

export function newId(): string {
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const money = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
