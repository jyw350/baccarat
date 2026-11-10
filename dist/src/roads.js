// Road coordinates are independent of the view. Ties annotate the last decisive hand.
export function layoutRoad(values, rows = 6) {
  const cells = [], occupied = new Set();
  let previous = null, startColumn = -1, column = 0, row = 0, tail = false;
  for (const entry of values) {
    const value = typeof entry === 'string' ? entry : entry.value;
    if (value !== previous) {
      startColumn++;
      while (occupied.has(`${startColumn},0`)) startColumn++;
      column = startColumn; row = 0; tail = false;
    } else if (!tail && row < rows - 1 && !occupied.has(`${column},${row + 1}`)) {
      row++;
    } else {
      tail = true; column++;
      while (occupied.has(`${column},${row}`)) column++;
    }
    const cell = { ...(typeof entry === 'object' ? entry : {}), value, column, row };
    cells.push(cell); occupied.add(`${column},${row}`); previous = value;
  }
  return cells;
}

export function bigRoad(history) {
  const decisive = [];
  let leadingTies = 0, leadingPlayerPair = false, leadingBankerPair = false;
  for (const hand of history) {
    if (hand.winner === 'tie') {
      if (decisive.length) {
        const last = decisive.at(-1);
        last.ties++;
        last.playerPair ||= hand.playerPair;
        last.bankerPair ||= hand.bankerPair;
      } else {
        leadingTies++;
        leadingPlayerPair ||= hand.playerPair;
        leadingBankerPair ||= hand.bankerPair;
      }
    } else {
      decisive.push({ value: hand.winner, ties: decisive.length ? 0 : leadingTies,
        playerPair: !!hand.playerPair || (!decisive.length && leadingPlayerPair),
        bankerPair: !!hand.bankerPair || (!decisive.length && leadingBankerPair) });
    }
  }
  if (!decisive.length && leadingTies) return [{ value: 'tie', ties: leadingTies, playerPair: leadingPlayerPair, bankerPair: leadingBankerPair, row: 0, column: 0 }];
  return layoutRoad(decisive);
}

// Derived roads compare logical streak columns before six-row display folding.
// First row: compare lengths of the two preceding columns at the selected distance.
// Other rows: equal occupancy immediately left = red; a new gap = blue.
export function derivedRoad(history, distance = 1) {
  if (![1, 2, 3].includes(distance)) throw new Error('Invalid derived road distance');
  const lengths = [], marks = [];
  let previous = null, column = -1, row = 0;
  for (const hand of history) {
    if (hand.winner === 'tie') continue;
    if (hand.winner !== previous) { column++; row = 0; lengths.push(1); }
    else { row++; lengths[column]++; }
    previous = hand.winner;
    if (row === 0) {
      if (column >= distance + 1) marks.push(lengths[column - 1] === lengths[column - distance - 1] ? 'red' : 'blue');
    } else if (column >= distance) {
      const referenceLength = lengths[column - distance];
      marks.push(row === referenceLength ? 'blue' : 'red');
    }
  }
  return layoutRoad(marks);
}
