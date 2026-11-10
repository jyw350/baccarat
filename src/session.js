import { INITIAL_BALANCE, CHIP_VALUES, emptyBets, totalBet, validBets, prepareShoe, dealRound, settleBets, summarize } from './engine.js';

export const STORAGE_KEY = 'baccarat-table.session.v1';
export function newSession() {
  return { version: 1, balance: INITIAL_BALANCE, bets: emptyBets(), lastBets: emptyBets(),
    selectedChip: 1000, shoe: prepareShoe(), shoeNumber: 1, history: [], roundNumber: 0,
    totals: summarize([]), lastProfit: 0, settings: { fast: false, sound: false } };
}

const validCard = (c) => c && Number.isInteger(c.rank) && c.rank >= 1 && c.rank <= 13 && ['spades', 'hearts', 'diamonds', 'clubs'].includes(c.suit);
export function validateSession(s) {
  return !!(s && s.version === 1 && Number.isSafeInteger(s.balance) && s.balance >= 0 &&
    validBets(s.bets) && validBets(s.lastBets) && CHIP_VALUES.includes(s.selectedChip) &&
    Array.isArray(s.shoe) && s.shoe.length <= 416 && s.shoe.every(validCard) &&
    Number.isSafeInteger(s.shoeNumber) && s.shoeNumber >= 1 &&
    Number.isSafeInteger(s.roundNumber) && s.roundNumber >= 0 &&
    Number.isSafeInteger(s.lastProfit) && Array.isArray(s.history) && s.history.length <= 2000 &&
    s.history.every((h) => ['player', 'banker', 'tie'].includes(h.winner) && Number.isSafeInteger(h.id) &&
      Number.isSafeInteger(h.shoeNumber) && typeof h.time === 'string' && !Number.isNaN(Date.parse(h.time)) &&
      Number.isSafeInteger(h.profit) && Number.isSafeInteger(h.stake) && validBets(h.bets) &&
      Array.isArray(h.player) && Array.isArray(h.banker) && h.player.length >= 2 && h.player.length <= 3 &&
      h.banker.length >= 2 && h.banker.length <= 3 && h.player.every(validCard) && h.banker.every(validCard) &&
      Number.isInteger(h.playerTotal) && h.playerTotal >= 0 && h.playerTotal <= 9 &&
      Number.isInteger(h.bankerTotal) && h.bankerTotal >= 0 && h.bankerTotal <= 9) &&
    s.totals && ['player', 'banker', 'tie', 'playerPair', 'bankerPair', 'rounds', 'wagered'].every((key) => Number.isSafeInteger(s.totals[key]) && s.totals[key] >= 0) &&
    Number.isSafeInteger(s.totals.profit) && s.settings && typeof s.settings.fast === 'boolean' && typeof s.settings.sound === 'boolean');
}

export function loadSession(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { session: newSession(), warning: null };
    const parsed = JSON.parse(raw);
    if (!validateSession(parsed)) throw new Error('Invalid session');
    return { session: parsed, warning: null };
  } catch {
    return { session: newSession(), warning: '저장된 기록을 불러오지 못해 새 세션을 시작했습니다.' };
  }
}

export function saveSession(storage, session) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(session)); return true; }
  catch { return false; }
}

// Complete settlement once, before visual animation starts. Reloading cannot pay twice.
export function playRound(session, now = new Date().toISOString(), allowEmpty = false) {
  if (!allowEmpty && !totalBet(session.bets)) throw new Error('먼저 배팅할 영역을 선택해주세요.');
  if (session.shoe.length <= 14) {
    session.shoe = prepareShoe(); session.shoeNumber++;
  }
  const result = dealRound(session.shoe);
  const settlement = settleBets(session.bets, result.winner);
  const record = { ...result, ...settlement, bets: { ...session.bets },
    id: ++session.roundNumber, shoeNumber: session.shoeNumber, time: now };
  session.balance += settlement.returned;
  session.lastProfit = settlement.profit;
  if (settlement.stake) session.lastBets = { ...session.bets };
  session.bets = emptyBets();
  session.history.push(record);
  if (session.history.length > 2000) session.history.splice(0, session.history.length - 2000);
  const delta = summarize([record]);
  for (const key of Object.keys(delta)) session.totals[key] += delta[key];
  return record;
}
