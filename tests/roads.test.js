import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutRoad, bigRoad, derivedRoad } from '../src/roads.js';
const history = (sequence) => [...sequence].map((letter) => ({ winner: { P: 'player', B: 'banker', T: 'tie' }[letter] }));

test('new winners start new columns and streaks descend', () => {
  assert.deepEqual(bigRoad(history('PPBBP')).map(({ column, row }) => [column, row]), [[0,0],[0,1],[1,0],[1,1],[2,0]]);
});
test('dragon tail moves right at row six and does not drop back down', () => {
  const cells = bigRoad(history('PPPPPPPPBB'));
  assert.deepEqual(cells.slice(5).map(({ column, row }) => [column, row]), [[0,5],[1,5],[2,5],[1,0],[1,1]]);
});
test('collision with another tail folds horizontally without overwriting', () => {
  const cells = bigRoad(history('PPPPPPPPBBBBBBBBPPPPPPPPBBBBBBBB'));
  const keys = cells.map((c) => `${c.column},${c.row}`);
  assert.equal(new Set(keys).size, cells.length);
  assert.ok(cells.every((c) => c.row >= 0 && c.row < 6));
});
test('ties annotate the last decisive result without advancing a cell', () => {
  const cells = bigRoad(history('PPTTBTP'));
  assert.equal(cells.length, 4);
  assert.equal(cells[1].ties, 2); assert.equal(cells[2].ties, 1);
});
test('leading ties are retained and attach to the first decisive result', () => {
  assert.equal(bigRoad(history('TT'))[0].value, 'tie');
  const cells = bigRoad(history('TTP'));
  assert.equal(cells.length, 1); assert.equal(cells[0].value, 'player'); assert.equal(cells[0].ties, 2);
});
test('pair indicators survive ties including leading ties', () => {
  const cells = bigRoad([{ winner: 'tie', playerPair: true }, { winner: 'banker' }, { winner: 'tie', bankerPair: true }]);
  assert.equal(cells[0].playerPair, true); assert.equal(cells[0].bankerPair, true);
});
test('derived roads wait for sufficient preceding columns', () => {
  assert.equal(derivedRoad(history('PBP'), 1).length, 1);
  assert.equal(derivedRoad(history('PBP'), 2).length, 0);
  assert.equal(derivedRoad(history('PBPB'), 2).length, 1);
  assert.equal(derivedRoad(history('PBPB'), 3).length, 0);
  assert.equal(derivedRoad(history('PBPBP'), 3).length, 1);
});
test('regular double streaks produce red and differing column depth produces blue', () => {
  assert.deepEqual(derivedRoad(history('PPBBPP'), 1).map((c) => c.value), ['red', 'red', 'red']);
  assert.deepEqual(derivedRoad(history('PBBB'), 1).map((c) => c.value), ['blue', 'red']);
  assert.deepEqual(derivedRoad(history('PPBP'), 1).map((c) => c.value), ['blue']);
});
test('ties never affect derived roads', () => {
  for (const distance of [1,2,3]) assert.deepEqual(derivedRoad(history('PTPBBTPBPPTBB'), distance), derivedRoad(history('PPBBPBPPBB'), distance));
});
test('empty roads render empty arrays without placeholder results', () => {
  assert.deepEqual(layoutRoad([]), []); assert.deepEqual(bigRoad([]), []); assert.deepEqual(derivedRoad([]), []);
});
