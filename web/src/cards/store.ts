/** Accounts, kept in localStorage. No server exists — this is the whole store. */

import type { Template } from './signature';

export interface Account {
  id: string;
  name: string;
  balance: number;
  template: Template;
  /** How many swipes the template was built from. */
  swipes: number;
  createdAt: number;
}

const KEY = 'simon_cone.accounts.v1';

export function loadAccounts(): Account[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Account[];
    // Anything hand-edited or left over from an older shape is dropped rather
    // than allowed to crash the matcher with a malformed template.
    return parsed.filter(
      (account) =>
        account &&
        typeof account.name === 'string' &&
        Array.isArray(account.template?.mean),
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
