import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as engine from '../src/engine.js';
import * as roads from '../src/roads.js';
import * as sessions from '../src/session.js';

// Run the real UI handlers with a small DOM adapter and a deterministic clock.
// Advancing time also resumes pending async card animations.
function table() {
  let now = 0, nextId = 0;
  const timers = new Map(), nodes = new Map(), saved = new Map();
  function element(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      disabled: false, open: false, textContent: '', innerHTML: '',
      firstElementChild: {}, dataset: {}, clientWidth: 600, clientHeight: 120,
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, addEventListener() {},
      replaceChildren() { this.innerHTML = ''; },
      insertAdjacentHTML(position, html) { this.innerHTML += html; },
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    return nodes.get(selector);
  }
  const storage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const schedule = (fn, ms, repeat = false) => {
    const id = ++nextId; timers.set(id, { fn, at: now + ms, ms, repeat }); return id;
  };
  const context = createContext({
    ...engine, ...roads, ...sessions,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} },
    window: { localStorage: storage, addEventListener() {} },
    matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
  });
  runInContext(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, ''), context);
  return {
    element, storage,
    click(selector) { const node = element(selector); assert.equal(node.disabled, false, `${selector} must be enabled`); node.onclick(); },
    read: expression => runInContext(expression, context),
    async advance(ms) {
      const until = now + ms;
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry; now = timer.at;
        if (timer.repeat) timer.at += timer.ms; else timers.delete(id);
        timer.fn(); await Promise.resolve(); await Promise.resolve();
      }
      now = until;
    },
  };
}

for (const [phase, elapsed] of [['betting', 0], ['dealing', 16000], ['result', 20500]]) {
  test(`settings reset works during ${phase} and cancels the old automatic cycle`, async () => {
    const ui = table(); ui.click('#deal-button');
    await ui.advance(elapsed); assert.equal(ui.read('phase'), phase);
    ui.click('#settings-button');
    assert.equal(ui.element('#panel-dialog').open, true);
    ui.click('#reset-session'); ui.click('#confirm-reset');
    assert.equal(ui.read('session.balance'), 1000000);
    assert.equal(ui.read('session.history.length'), 0);
    // Restart immediately, while a cancelled animation may still have a pending timeout.
    ui.click('#deal-button'); await ui.advance(14999);
    assert.equal(ui.read('session.history.length'), 0);
    assert.equal(ui.element('#hand-player').innerHTML, '');
    await ui.advance(1);
    assert.equal(ui.read('session.history.length'), 1);
    ui.click('#settings-button'); await ui.advance(60000);
    assert.equal(ui.read('phase'), 'idle');
    assert.equal(ui.read('session.history.length'), 1);
    assert.equal(sessions.loadSession(ui.storage).session.history.length, 1);
  });
}

test('opening settings preserves pending wagers; new shoe refunds them only once', async () => {
  const ui = table(); ui.click('#deal-button'); ui.read("addBet('player')");
  ui.click('#settings-button'); await ui.advance(30000);
  assert.equal(ui.read('session.balance'), 995000);
  assert.equal(ui.read('session.bets.player'), 5000);
  assert.equal(ui.read('session.history.length'), 0);
  ui.click('#new-shoe'); ui.click('#new-shoe');
  assert.equal(ui.read('session.balance'), 1000000);
  assert.equal(ui.read('session.bets.player'), 0);
  ui.click('#top-up'); assert.equal(ui.read('session.balance'), 2000000);
  ui.click('#reset-session'); ui.click('#cancel-reset'); ui.click('#close-dialog');
  assert.equal(ui.read('session.balance'), 2000000);
  ui.click('#deal-button'); assert.equal(ui.read('phase'), 'betting');
});

test('UI wager actions enforce limits for clicks, double, repeat and undo', () => {
  const ui = table(); ui.click('#deal-button');
  ui.read("selectChip(1000); addBet('player')");
  assert.equal(ui.read('session.balance'), 1000000);
  ui.read("selectChip(5000); addBet('player')");
  ui.click('#double-button'); assert.equal(ui.read('session.bets.player'), 10000);
  ui.click('#undo-button'); assert.equal(ui.read('session.bets.player'), 5000);
  ui.read("selectChip(10000); addBet('tie'); addBet('tie')");
  assert.equal(ui.read('session.bets.tie'), 10000);
  assert.equal(ui.read('session.balance'), 985000);
  assert.equal(ui.element('#double-button').disabled, true);
  ui.element('#double-button').onclick(); // Handler must reject even without the disabled UI.
  assert.equal(ui.read('session.balance'), 985000);
  assert.equal(ui.read('session.bets.player'), 5000);
  ui.read('session.lastBets = {player:200000, tie:0, banker:0}; renderControls()');
  assert.equal(ui.element('#repeat-button').disabled, true);
  ui.element('#repeat-button').onclick();
  assert.equal(ui.read('session.balance'), 985000);
  ui.read('session.lastBets = {player:0, tie:0, banker:100000}; renderControls()');
  ui.click('#repeat-button'); assert.equal(ui.read('session.balance'), 900000);
  ui.click('#undo-button'); assert.equal(ui.read('session.balance'), 985000);
  ui.click('#clear-button'); assert.equal(ui.read('session.balance'), 1000000);
});

test('independent simulation enforces limits and passes the banker final score to settlement', async () => {
  const ui = table();
  ui.element('#sim-rounds').value = '100'; ui.element('#sim-side').value = 'tie';
  ui.element('#sim-amount').value = '11000';
  await ui.read('runSimulation()');
  assert.equal(ui.read('lastSimulation'), null);
  ui.element('#sim-side').value = 'banker'; ui.element('#sim-amount').value = '1000';
  await ui.read('runSimulation()'); assert.equal(ui.read('lastSimulation'), null);
  ui.element('#sim-amount').value = '10000';
  ui.read("dealRound = () => ({winner:'banker', bankerTotal:6, playerPair:false, bankerPair:false})");
  const finished = ui.read('runSimulation()'); await ui.advance(12); await finished;
  assert.equal(ui.read('lastSimulation.totals.profit'), 500000);
  assert.equal(ui.read('lastSimulation.totals.wagered'), 1000000);
  assert.equal(ui.read('session.balance'), 1000000);
  assert.equal(ui.read('session.history.length'), 0);
});
