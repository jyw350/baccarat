import test from 'node:test';
import assert from 'node:assert/strict';
import { createShoe, prepareShoe, handTotal, bankerDraws, dealRound, settleBets, placeBet, totalBet, emptyBets, summarize } from '../src/engine.js';

const card = (value, suit = 'spades') => ({ rank: value || 10, suit });
const shoeFor = (...values) => values.map((value) => typeof value === 'object' ? value : card(value)).reverse();

test('eight decks contain 416 cards and eight of each rank/suit', () => {
  const shoe = createShoe(8);
  assert.equal(shoe.length, 416);
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) for (let rank = 1; rank <= 13; rank++) {
    assert.equal(shoe.filter((c) => c.suit === suit && c.rank === rank).length, 8);
  }
});
test('shoe burns exposed card plus its count and never mutates a shared deck', () => {
  assert.equal(prepareShoe((max) => max - 1).length, 405); // Last card is K clubs: 1 + 10 burned.
  assert.equal(createShoe().length, 416);
});
test('face cards are zero, ace is one, hand totals wrap modulo ten', () => {
  assert.equal(handTotal([card(13), card(12), card(11)]), 0);
  assert.equal(handTotal([card(1), card(9), card(8)]), 8);
});
test('banker draw table exhaustively matches all player third-card values', () => {
  const drawValues = [[0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,9], [2,3,4,5,6,7], [4,5,6,7], [6,7], [], [], []];
  for (let total = 0; total <= 9; total++) {
    for (let third = 0; third <= 9; third++) assert.equal(bankerDraws(total, third), drawValues[total].includes(third), `B ${total}, P third ${third}`);
    assert.equal(bankerDraws(total, null), total <= 5);
  }
});
test('either natural stops all third-card draws, including the other hand at zero', () => {
  for (const values of [[8, 0, 0, 0, 1, 2], [0, 9, 0, 0, 1, 2]]) {
    const shoe = shoeFor(...values), round = dealRound(shoe);
    assert.equal(round.natural, true); assert.equal(round.sequence.length, 4); assert.equal(shoe.length, 2);
  }
});
test('deals in alternating order and computes a six-card outcome', () => {
  const round = dealRound(shoeFor(2, 1, 3, 1, 4, 5));
  assert.deepEqual(round.sequence.map((c) => c.side), ['player', 'banker', 'player', 'banker', 'player', 'banker']);
  assert.equal(round.playerTotal, 9); assert.equal(round.bankerTotal, 7); assert.equal(round.winner, 'player');
  assert.equal(round.bankerPair, true); assert.equal(round.playerPair, false);
});
test('banker draws next available card when player stands', () => {
  const round = dealRound(shoeFor(3, 1, 3, 2, 5, 9));
  assert.equal(round.player.length, 2); assert.equal(round.banker.length, 3);
  assert.equal(round.banker[2].rank, 5); assert.equal(round.bankerTotal, 8);
});
test('same point value is not necessarily a pair (J/Q)', () => {
  const round = dealRound(shoeFor(11, 7, 12, 1, 5, 6));
  assert.equal(round.playerPair, false);
});
test('every combination of initial totals and player third card has valid draws', () => {
  const drawValues = [[0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,8,9], [0,1,2,3,4,5,6,7,9], [2,3,4,5,6,7], [4,5,6,7], [6,7], [], [], []];
  for (let p = 0; p < 10; p++) for (let b = 0; b < 10; b++) for (let third = 0; third < 10; third++) {
    const result = dealRound(shoeFor(p, b, 0, 0, third, 2));
    const natural = p >= 8 || b >= 8;
    const pDraw = !natural && p <= 5;
    const bDraw = !natural && (pDraw ? drawValues[b].includes(third) : b <= 5);
    assert.equal(result.player.length, pDraw ? 3 : 2);
    assert.equal(result.banker.length, bDraw ? 3 : 2);
    assert.equal(result.playerTotal, (p + (pDraw ? third : 0)) % 10);
    assert.equal(result.bankerTotal, (b + (bDraw ? pDraw ? 2 : third : 0)) % 10);
  }
});
test('a win returns principal plus correct player / banker / tie profit', () => {
  assert.deepEqual(settleBets({ player: 1000, tie: 0, banker: 0 }, 'player'), { stake: 1000, returned: 2000, profit: 1000 });
  assert.deepEqual(settleBets({ player: 0, tie: 0, banker: 1000 }, 'banker'), { stake: 1000, returned: 1950, profit: 950 });
  assert.deepEqual(settleBets({ player: 0, tie: 1000, banker: 0 }, 'tie'), { stake: 1000, returned: 9000, profit: 8000 });
});
test('tie refunds player and banker bets while paying tie bets', () => {
  assert.deepEqual(settleBets({ player: 5000, tie: 1000, banker: 10000 }, 'tie'), { stake: 16000, returned: 24000, profit: 8000 });
  assert.equal(settleBets({ player: 5000, tie: 0, banker: 10000 }, 'tie').profit, 0);
});
test('mixed bets subtract all stakes and do not pay losing areas', () => {
  assert.equal(settleBets({ player: 1000, tie: 1000, banker: 1000 }, 'player').profit, -1000);
  assert.equal(settleBets({ player: 1000, tie: 1000, banker: 1000 }, 'banker').profit, -1050);
});
test('placing a bet reserves money exactly once and preserves original objects', () => {
  const bets = emptyBets();
  const next = placeBet(1000000, bets, 'player', 100000);
  assert.equal(next.balance, 900000); assert.equal(totalBet(next.bets), 100000); assert.deepEqual(bets, emptyBets());
});
test('insufficient funds and invalid wager data are rejected', () => {
  assert.throws(() => placeBet(500, emptyBets(), 'player', 1000));
  assert.throws(() => placeBet(10000, emptyBets(), 'other', 1000));
  assert.throws(() => placeBet(10000, emptyBets(), 'tie', -1000));
  assert.throws(() => settleBets({ player: NaN, tie: 0, banker: 0 }, 'player'));
  assert.throws(() => settleBets(emptyBets(), 'unknown'));
});
test('pair counts are separate from winner counts', () => {
  const stats = summarize([{ winner: 'player', playerPair: true, bankerPair: true, stake: 1000, profit: 1000 }, { winner: 'tie', playerPair: true, bankerPair: false, stake: 5000, profit: 0 }]);
  assert.deepEqual(stats, { player: 1, banker: 0, tie: 1, playerPair: 2, bankerPair: 1, rounds: 2, wagered: 6000, profit: 1000 });
});
test('seeded 100,000-round simulation preserves cards and plausible outcome distribution', () => {
  let seed = 761929;
  const pick = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * max); };
  let shoe = prepareShoe(pick);
  const counts = { player: 0, banker: 0, tie: 0 };
  for (let i = 0; i < 100000; i++) {
    if (shoe.length <= 14) shoe = prepareShoe(pick);
    const before = shoe.length, result = dealRound(shoe);
    assert.equal(before - shoe.length, result.player.length + result.banker.length);
    counts[result.winner]++;
  }
  assert.ok(Math.abs(counts.player / 100000 - .446) < .01, JSON.stringify(counts));
  assert.ok(Math.abs(counts.banker / 100000 - .459) < .01, JSON.stringify(counts));
  assert.ok(Math.abs(counts.tie / 100000 - .095) < .008, JSON.stringify(counts));
});
