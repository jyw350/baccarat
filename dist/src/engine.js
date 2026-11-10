// UI-independent, standard commission baccarat. All money is integer virtual KRW.
export const SIDES = ['player', 'tie', 'banker'];
export const CHIP_VALUES = [1000, 5000, 10000, 100000];
export const INITIAL_BALANCE = 1000000;
export const emptyBets = () => ({ player: 0, tie: 0, banker: 0 });
export const totalBet = (bets) => SIDES.reduce((sum, side) => sum + bets[side], 0);
export const cardValue = (card) => Math.min(card.rank, 10) % 10;
export const handTotal = (cards) => cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;

export function randomIndex(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const bytes = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}

export function createShoe(decks = 8, pick = randomIndex) {
  if (!Number.isInteger(decks) || decks < 1 || decks > 8) throw new Error('Invalid deck count');
  const shoe = [];
  for (let deck = 0; deck < decks; deck++) {
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      for (let rank = 1; rank <= 13; rank++) shoe.push({ rank, suit });
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export function prepareShoe(pick = randomIndex) {
  const shoe = createShoe(8, pick);
  const burn = shoe.pop();
  // Burn the exposed card plus its rank count (10/J/Q/K count as ten).
  shoe.splice(-Math.min(burn.rank, 10));
  return shoe;
}

export function bankerDraws(total, playerThird = null) {
  if (playerThird === null) return total <= 5;
  if (total <= 2) return true;
  if (total === 3) return playerThird !== 8;
  if (total === 4) return playerThird >= 2 && playerThird <= 7;
  if (total === 5) return playerThird >= 4 && playerThird <= 7;
  if (total === 6) return playerThird === 6 || playerThird === 7;
  return false;
}

// Mutates only the supplied shoe. Deal order: P B P B [P] [B].
export function dealRound(shoe) {
  if (shoe.length < 6) throw new Error('Not enough cards in shoe');
  const player = [], banker = [], sequence = [];
  const draw = (side, hand) => {
    const card = shoe.pop();
    hand.push(card);
    sequence.push({ side, card });
  };
  draw('player', player); draw('banker', banker);
  draw('player', player); draw('banker', banker);
  const natural = handTotal(player) >= 8 || handTotal(banker) >= 8;
  if (!natural) {
    if (handTotal(player) <= 5) draw('player', player);
    if (bankerDraws(handTotal(banker), player[2] ? cardValue(player[2]) : null)) draw('banker', banker);
  }
  const playerTotal = handTotal(player), bankerTotal = handTotal(banker);
  return {
    player, banker, sequence, playerTotal, bankerTotal, natural,
    winner: playerTotal === bankerTotal ? 'tie' : playerTotal > bankerTotal ? 'player' : 'banker',
    playerPair: player[0].rank === player[1].rank,
    bankerPair: banker[0].rank === banker[1].rank,
  };
}

export function validBets(bets) {
  return bets && SIDES.every((side) => Number.isSafeInteger(bets[side]) && bets[side] >= 0 && bets[side] % 1000 === 0);
}

export function placeBet(balance, bets, side, amount) {
  if (!SIDES.includes(side) || !CHIP_VALUES.includes(amount) || !validBets(bets)) throw new Error('Invalid bet');
  if (balance < amount) throw new Error('가상 잔액이 부족합니다.');
  return { balance: balance - amount, bets: { ...bets, [side]: bets[side] + amount } };
}

export function settleBets(bets, winner) {
  if (!validBets(bets) || !SIDES.includes(winner)) throw new Error('Invalid settlement');
  const stake = totalBet(bets);
  let returned = 0;
  if (winner === 'tie') returned = bets.player + bets.banker + bets.tie * 9;
  if (winner === 'player') returned = bets.player * 2;
  if (winner === 'banker') returned = bets.banker + bets.banker * 95 / 100;
  return { stake, returned, profit: returned - stake };
}

export function summarize(history) {
  const totals = { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0, rounds: history.length, profit: 0, wagered: 0 };
  for (const result of history) {
    totals[result.winner]++;
    if (result.playerPair) totals.playerPair++;
    if (result.bankerPair) totals.bankerPair++;
    totals.profit += result.profit || 0;
    totals.wagered += result.stake || 0;
  }
  return totals;
}
