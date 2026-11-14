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
  Object.assign(s, placeBet(s.balance, s.bets, 'player', 5000));
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
    s.balance += 5000;
    Object.assign(s, placeBet(s.balance, s.bets, 'player', 5000));
    playRound(s);
  }
  assert.equal(s.history.length, 2000); assert.equal(s.totals.rounds, 2005);
  assert.equal(s.totals.player + s.totals.banker + s.totals.tie, 2005);
  assert.equal(s.history[0].id, 6); assert.equal(validateSession(s), true);
});


test('automatic observation round records results without changing bankroll', () => {
  const s = newSession();
  const before = s.balance;
  const record = playRound(s, new Date().toISOString(), true);
  assert.equal(record.stake, 0); assert.equal(record.profit, 0);
  assert.equal(s.balance, before); assert.equal(s.history.length, 1);
  assert.equal(s.totals.rounds, 1); assert.equal(validateSession(s), true);
});
test('observation round preserves last manual wager without automatically repeating it', () => {
  const s = newSession();
  Object.assign(s, placeBet(s.balance, s.bets, 'banker', 5000));
  playRound(s);
  const before = s.balance;
  for (let i = 0; i < 3; i++) playRound(s, new Date().toISOString(), true);
  assert.equal(s.balance, before); assert.equal(totalBet(s.bets), 0);
  assert.equal(s.lastBets.banker, 5000); assert.equal(s.totals.wagered, 5000);
});

test('two-card and three-card banker six wins settle and persist half profit', () => {
  for (const ranks of [[2, 3, 2, 3, 1], [2, 1, 2, 1, 10, 4]]) {
    const s = newSession(), storage = memory();
    s.shoe = [...Array.from({ length: 20 }, () => ({ rank: 10, suit: 'clubs' })), ...ranks.map(rank => ({ rank, suit: 'spades' })).reverse()];
    Object.assign(s, placeBet(s.balance, s.bets, 'banker', 10000));
    const record = playRound(s);
    assert.equal(record.winner, 'banker'); assert.equal(record.bankerTotal, 6);
    assert.equal(record.banker.length, ranks.length === 5 ? 2 : 3);
    assert.equal(record.returned, 15000); assert.equal(s.balance, 1005000);
    assert.equal(s.totals.profit, 5000); saveSession(storage, s);
    assert.equal(loadSession(storage).session.balance, 1005000);
  }
});

test('legacy pending wagers outside new limits are refunded without rewriting history', () => {
  const s = newSession(), storage = memory();
  Object.assign(s, placeBet(s.balance, s.bets, 'banker', 5000)); playRound(s);
  // A prior commission-era record is preserved exactly, including smaller wagers.
  Object.assign(s.history[0], { bets: { player: 0, tie: 0, banker: 1000 }, stake: 1000, returned: 1950, profit: 950 });
  const history = JSON.stringify(s.history), totals = JSON.stringify(s.totals);
  s.bets = { player: 1000, tie: 20000, banker: 5000 }; s.balance -= 26000;
  s.lastBets = { player: 200000, tie: 0, banker: 0 };
  saveSession(storage, s);
  const loaded = loadSession(storage);
  assert.ok(loaded.warning);
  assert.equal(loaded.session.balance, s.balance + 21000);
  assert.deepEqual(loaded.session.bets, { player: 0, tie: 0, banker: 5000 });
  assert.equal(JSON.stringify(loaded.session.history), history);
  assert.equal(JSON.stringify(loaded.session.totals), totals);
  saveSession(storage, loaded.session);
  assert.equal(loadSession(storage).session.balance, loaded.session.balance);
  assert.equal(loadSession(storage).warning, null);
});

test('a tied round returns both main wagers and leaves accumulated profit unchanged', () => {
  const s = newSession(); s.totals.profit = 300000;
  s.shoe = [...Array.from({ length: 20 }, () => ({ rank: 10, suit: 'clubs' })), ...[4,4,4,4].map(rank => ({rank,suit:'spades'}))];
  Object.assign(s, placeBet(s.balance, s.bets, 'player', 10000));
  Object.assign(s, placeBet(s.balance, s.bets, 'banker', 5000));
  const record = playRound(s);
  assert.equal(record.winner, 'tie'); assert.equal(record.returned, 15000);
  assert.equal(s.balance, 1000000); assert.equal(s.totals.profit, 300000);
});

test('invalid pending wagers are rejected before dealing or changing the shoe', () => {
  const s = newSession(); s.bets.player = 1000;
  const before = JSON.stringify(s);
  assert.throws(() => playRound(s, undefined, true));
  assert.equal(JSON.stringify(s), before);
});
