import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, playRound, loadSession, saveSession, validateSession, STORAGE_KEY } from '../src/session.js';
import { placeBet, totalBet } from '../src/engine.js';
const memory = () => { const values = new Map(); return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };

test('new session starts with a million virtual won and no fabricated history', () => {
  const s = newSession(); assert.equal(s.balance, 1000000); assert.equal(s.history.length, 0); assert.equal(s.totals.rounds, 0); assert.equal(validateSession(s), true);
});
test('settlement persists once and reload cannot duplicate payment', () => {
  const s = newSession(), storage = memory();
  Object.assign(s, placeBet(s.balance, s.bets, 'banker', 5000));
  const record = playRound(s);
  assert.equal(s.balance, 1000000 + record.profit); assert.equal(totalBet(s.bets), 0);
  assert.equal(saveSession(storage, s), true);
  const restored = loadSession(storage).session;
  assert.equal(restored.balance, s.balance); assert.equal(restored.roundNumber, 1);
  assert.equal(restored.history.length, 1); assert.throws(() => playRound(restored));
});
test('unplayed bets and reserved bankroll survive a reload', () => {
  const s = newSession(), storage = memory();
  Object.assign(s, placeBet(s.balance, s.bets, 'tie', 10000));
  saveSession(storage, s);
  const restored = loadSession(storage).session;
  assert.equal(restored.balance, 990000); assert.equal(restored.bets.tie, 10000);
});
test('cut-card threshold starts a new shoe and preserves accumulated history', () => {
  const s = newSession(); s.shoe = s.shoe.slice(0, 14);
  Object.assign(s, placeBet(s.balance, s.bets, 'player', 1000));
  const round = playRound(s);
  assert.equal(s.shoeNumber, 2); assert.equal(round.shoeNumber, 2); assert.equal(s.history.length, 1); assert.ok(s.shoe.length > 390);
});
test('corrupt saved data recovers gracefully with an explicit warning', () => {
  const storage = memory(); storage.setItem(STORAGE_KEY, '{bad json');
  assert.ok(loadSession(storage).warning);
  const s = newSession(); s.shoe = [{ rank: 99, suit: 'spades' }];
  storage.setItem(STORAGE_KEY, JSON.stringify(s)); assert.ok(loadSession(storage).warning);
});
test('invalid nested history is rejected before UI rendering', () => {
  const s = newSession(); s.history = [{ winner: 'player', time: '<script>' }];
  assert.equal(validateSession(s), false);
});
test('storage failures are surfaced without throwing away in-memory progress', () => {
  const s = newSession(); const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
  assert.equal(saveSession(storage, s), false); assert.ok(loadSession(storage).warning); assert.equal(s.balance, 1000000);
});
test('history retention caps details at 2,000 without truncating cumulative totals', () => {
  const s = newSession();
  for (let i = 0; i < 2005; i++) {
    s.balance += 1000;
    Object.assign(s, placeBet(s.balance, s.bets, 'player', 1000));
    playRound(s);
  }
  assert.equal(s.history.length, 2000); assert.equal(s.totals.rounds, 2005);
  assert.equal(s.totals.player + s.totals.banker + s.totals.tie, 2005);
  assert.equal(s.history[0].id, 6); assert.equal(validateSession(s), true);
});
