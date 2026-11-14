import { CHIP_VALUES, SIDES, BET_LIMITS, assertBetLimits, validTableBets, replaceBets, emptyBets, totalBet, placeBet, handTotal, prepareShoe, dealRound, settleBets, summarize } from './engine.js';
import { bigRoad, derivedRoad } from './roads.js';
import { loadSession, saveSession, newSession, playRound, STORAGE_KEY } from './session.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `₩${Math.abs(value).toLocaleString('ko-KR')}`;
const signedMoney = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(value)}`;
const names = { player: '플레이어', banker: '뱅커', tie: '타이' };
const suits = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const suitNames = { spades: '스페이드', hearts: '하트', diamonds: '다이아몬드', clubs: '클로버' };
const rankName = (rank) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank] || String(rank));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } }; }
const loaded = loadSession(storage);
let session = loaded.session;
let running = false, bettingDeadline = 0, bettingTimer, lifecycle = 0;
let phase = 'idle', betSteps = [], activeRecord = null, resultTimer, toastTimer;
let displayedBalance = session.balance, displayedProfit = session.totals.profit;
let simulationRunning = false, cancelSimulation = false, lastSimulation = null;
let audioContext;
let storageNoticeShown = false;
const motionReduced = matchMedia('(prefers-reduced-motion: reduce)');

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3300);
}

function persist() {
  const success = saveSession(storage, session);
  $('#save-indicator').textContent = success ? '이 기기에 자동 저장' : '저장 불가 · 현재 창에서만 유지';
  if (!success && !storageNoticeShown) { toast('브라우저 저장소를 사용할 수 없어 새로고침하면 기록이 사라집니다.'); storageNoticeShown = true; }
}

function playSound(kind = 'chip') {
  if (!session.settings.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume().catch(() => {});
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'result' ? 660 : kind === 'card' ? 330 : 950, audioContext.currentTime);
    gain.gain.setValueAtTime(.035, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .11);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .12);
  } catch { /* Sound is optional and must never block play. */ }
}

function setStatus(text, detail = '') {
  $('#status-text').textContent = text;
  $('#status-detail').textContent = detail;
  $('.status-dot').style.background = phase === 'dealing' ? '#dfc084' : phase === 'result' ? '#e9cf95' : '#96d98e';
}

function visibleHistory() {
  return phase === 'dealing' && activeRecord ? session.history.slice(0, -1) : session.history;
}

function renderRoad(element, cells, type, label) {
  const cellSize = Math.max(6, element.clientHeight / 6);
  const columns = Math.max(1, Math.floor(element.clientWidth / cellSize));
  const lastColumn = cells.reduce((max, c) => Math.max(max, c.column), 0);
  const offset = Math.max(0, lastColumn - columns + 1);
  element.style.setProperty('--cell', `${cellSize}px`);
  element.innerHTML = cells.filter((c) => c.column >= offset).map((c) => {
    const cls = `road-mark ${c.value} ${type} ${c.ties ? 'with-tie' : ''}`;
    return `<span class="${cls}" style="--column:${c.column - offset};--row:${c.row}">${c.ties > 1 ? `<span class="tie-count">${c.ties}</span>` : ''}${c.playerPair ? '<i class="pair-dot pp"></i>' : ''}${c.bankerPair ? '<i class="pair-dot bp"></i>' : ''}</span>`;
  }).join('');
  element.setAttribute('aria-label', `${label}: ${cells.length ? `${cells.length}개 표시, 최근 ${columns}열` : '기록 없음'}`);
}

function renderRoads() {
  const history = visibleHistory().filter((h) => h.shoeNumber === session.shoeNumber);
  const totals = summarize(history);
  for (const key of ['player', 'banker', 'tie', 'playerPair', 'bankerPair', 'rounds']) $(`#count-${key}`).textContent = totals[key];
  $('#shoe-label').textContent = `SHOE ${String(session.shoeNumber).padStart(3, '0')}`;
  renderRoad($('#big-road'), bigRoad(history), '', '대로드');
  renderRoad($('#eye-road'), derivedRoad(history, 1), '', '빅아이 로드');
  renderRoad($('#small-road'), derivedRoad(history, 2), 'solid', '스몰 로드');
  renderRoad($('#roach-road'), derivedRoad(history, 3), 'slash', '코크로치 로드');
}

function renderWagers() {
  const bets = phase === 'betting' ? session.bets : activeRecord?.bets || session.bets;
  for (const side of SIDES) {
    const amount = bets[side];
    const target = $(`#wager-${side}`);
    if (!amount) { target.replaceChildren(); continue; }
    const denomination = [...CHIP_VALUES].reverse().find((chip) => amount >= chip) || 1000;
    const layers = Math.min(3, Math.ceil(amount / denomination));
    target.innerHTML = `<span class="chip-stack" aria-hidden="true">${Array.from({ length: layers }, (_, i) => `<i class="mini-chip chip-${denomination}" style="--stack:${i}"></i>`).join('')}</span><strong class="wager-amount">${money(amount)}</strong>`;
  }
}

function renderWallet() {
  const dealing = phase === 'dealing';
  $('#balance').textContent = money(dealing ? displayedBalance : session.balance);
  const bets = phase === 'betting' ? session.bets : activeRecord?.bets || session.bets;
  $('#total-bet').textContent = money(totalBet(bets));
  const profit = dealing ? displayedProfit : session.totals.profit;
  $('#last-profit').textContent = signedMoney(profit);
  $('#last-profit').className = profit > 0 ? 'positive' : profit < 0 ? 'negative' : '';
  $('#bet-availability').textContent = phase === 'idle' ? '시작 대기' : phase === 'betting' ? (session.balance >= 1000 ? '배팅 가능' : '잔액 부족') : phase === 'dealing' ? '배팅 마감' : '정산 완료';
  $('#round-label').textContent = `ROUND ${String(dealing ? session.roundNumber - 1 : session.roundNumber).padStart(3, '0')}`;
  $('#deck-info').textContent = `8 DECKS · ${session.shoe.length} CARDS LEFT`;
}

function renderControls() {
  const open = phase === 'betting', stake = totalBet(session.bets);
  const displayedBets = open ? session.bets : activeRecord?.bets || session.bets;
  $$('.bet-zone').forEach((button) => {
    button.disabled = !open;
    button.setAttribute('aria-label', `${names[button.dataset.side]}${open ? `에 ${money(session.selectedChip)} 배팅` : ' 배팅 마감'}, 현재 ${money(displayedBets[button.dataset.side])}`);
  });
  $$('.casino-chip').forEach((button) => {
    const selected = Number(button.dataset.chip) === session.selectedChip;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = !open;
  });
  $('#selected-chip-label').textContent = `선택한 칩 ${money(session.selectedChip)}`;
  $('#undo-button').disabled = !open || !betSteps.length;
  $('#clear-button').disabled = !open || !stake;
  $('#double-button').disabled = !open || !stake || session.balance < stake || !validTableBets(doubledBets());
  $('#repeat-button').disabled = !open || !totalBet(session.lastBets) || session.balance + stake < totalBet(session.lastBets) || !validTableBets(session.lastBets);
  $('#deal-button').disabled = running;
  $('#deal-button').firstElementChild.textContent = phase === 'dealing' ? '카드 배분 중' : phase === 'result' ? '다음 판 준비 중' : running ? '자동 진행 중' : '게임 시작';
  $('#settings-button').disabled = false;
  for (const id of ['simulation-button', 'history-button', 'stats-button']) $(`#${id}`).disabled = id === 'simulation-button' ? running : !['idle', 'betting'].includes(phase);
}

function renderAll() { renderWallet(); renderControls(); renderWagers(); renderRoads(); }

function clearTableCards() {
  for (const side of ['player', 'banker']) {
    $(`#hand-${side}`).replaceChildren(); $(`#score-${side}`).textContent = '';
  }
  $$('.bet-zone').forEach((button) => button.classList.remove('winning'));
  $('#tie-emblem').textContent = '8 : 1';
}

function addBet(side) {
  if (!bettingOpen()) return;
  try {
    const next = placeBet(session.balance, session.bets, side, session.selectedChip);
    betSteps.push({ balance: session.balance, bets: { ...session.bets } });
    Object.assign(session, next);
    persist(); renderWallet(); renderControls(); renderWagers(); playSound();
  } catch (error) { toast(error.message); }
}

function selectChip(chip) {
  if (!bettingOpen()) return;
  session.selectedChip = chip; persist(); renderControls(); playSound();
}

function doubledBets() { return Object.fromEntries(SIDES.map(side => [side, session.bets[side] * 2])); }
function updateBets(nextBets) {
  if (!bettingOpen()) return;
  try {
    const next = replaceBets(session.balance, session.bets, nextBets);
    betSteps.push({ balance: session.balance, bets: { ...session.bets } });
    Object.assign(session, next);
    persist(); renderWallet(); renderControls(); renderWagers(); playSound();
  } catch (error) { toast(error.message); }
}

function cardMarkup(card) {
  const rank = rankName(card.rank), suit = suits[card.suit];
  return `<span class="playing-card ${['hearts', 'diamonds'].includes(card.suit) ? 'red-suit' : ''}" role="img" aria-label="${suitNames[card.suit]} ${rank}"><span class="card-corner">${rank}<span>${suit}</span></span><span class="card-center">${suit}</span><span class="card-corner bottom">${rank}<span>${suit}</span></span></span>`;
}

function bettingOpen() {
  if (running && phase === 'betting' && Date.now() >= bettingDeadline) tickBetting();
  return running && phase === 'betting' && Date.now() < bettingDeadline;
}
function tickBetting() {
  if (!running || phase !== 'betting') return;
  const seconds = Math.max(0, Math.ceil((bettingDeadline - Date.now()) / 1000));
  setStatus(`배팅하십시오 · ${seconds}초`);
  $('#deal-button').firstElementChild.textContent = `자동 진행 · ${seconds}초`;
  if (!seconds) { clearInterval(bettingTimer); void startRound(); }
}
function startAutomatic() {
  if (running || phase !== 'idle') return;
  running = true;
  nextRound();
}
function stopAutomatic() {
  running = false; lifecycle++;
  clearInterval(bettingTimer); clearTimeout(resultTimer);
  phase = 'idle'; activeRecord = null;
  clearTableCards(); setStatus('게임 시작을 눌러주세요'); renderAll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickBetting(); });
window.addEventListener('pagehide', stopAutomatic);
function nextRound() {
  if (!running || phase === 'dealing') return;
  clearTimeout(resultTimer); phase = 'betting'; activeRecord = null;
  bettingDeadline = Date.now() + 15000;
  clearTableCards(); renderAll(); tickBetting();
  clearInterval(bettingTimer); bettingTimer = setInterval(tickBetting, 100);
  if (session.balance < 1000) toast('가상 잔액이 부족합니다. 설정에서 가상 금액을 충전할 수 있습니다.');
}

async function startRound() {
  if (!running || phase !== 'betting' || Date.now() < bettingDeadline) return;
  const currentLifecycle = lifecycle;
  clearInterval(bettingTimer);
  if ($('#panel-dialog').open) $('#panel-dialog').close();
  clearTableCards();
  displayedBalance = session.balance; displayedProfit = session.totals.profit;
  phase = 'dealing';
  try { activeRecord = playRound(session, new Date().toISOString(), true); }
  catch (error) { stopAutomatic(); toast(error.message); return; }
  betSteps = []; persist();
  setStatus('배팅 마감', '카드를 배분하고 있습니다'); renderWallet(); renderControls(); renderWagers();
  const speed = motionReduced.matches ? 370 : session.settings.fast ? 460 : 770;
  const hands = { player: [], banker: [] };
  await delay(speed);
  if (!running || lifecycle !== currentLifecycle) return;
  for (const { side, card } of activeRecord.sequence) {
    hands[side].push(card);
    $(`#hand-${side}`).insertAdjacentHTML('beforeend', cardMarkup(card));
    $(`#score-${side}`).textContent = handTotal(hands[side]);
    playSound('card');
    await delay(speed);
    if (!running || lifecycle !== currentLifecycle) return;
  }
  phase = 'result';
  const resultText = activeRecord.winner === 'tie' ? '타이' : `${names[activeRecord.winner]} 승리`;
  setStatus(resultText, `${activeRecord.playerTotal} : ${activeRecord.bankerTotal}`);
  $(`#bet-${activeRecord.winner}`).classList.add('winning');
  if (activeRecord.winner === 'tie') $('#tie-emblem').textContent = 'TIE';
  renderAll(); playSound('result');
  resultTimer = setTimeout(nextRound, session.settings.fast ? 1800 : 4500);
}

function openPanel(title, html, eyebrow = 'BACCARAT · TABLE 01') {
  $('#dialog-title').textContent = title; $('#dialog-eyebrow').textContent = eyebrow;
  $('#dialog-body').innerHTML = html;
  if (!$('#panel-dialog').open) $('#panel-dialog').showModal();
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showHistory(limit = 100) {
  const records = [...session.history].reverse().slice(0, limit);
  openPanel('게임 기록', `<div class="dialog-toolbar"><span>전체 ${session.roundNumber.toLocaleString()}판 · 최근 ${records.length}판 표시</span><button class="secondary-button" id="export-history" ${!records.length ? 'disabled' : ''}>CSV 내보내기 ↓</button></div>${records.length ? `<div class="table-wrap"><table><thead><tr><th>회차</th><th>시간</th><th>결과</th><th>P : B</th><th>배팅</th><th>손익</th></tr></thead><tbody>${records.map((r) => `<tr><td>#${r.id}</td><td>${new Date(r.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</td><td><span class="result-pill ${r.winner}">${names[r.winner]}</span></td><td>${r.playerTotal} : ${r.bankerTotal}</td><td>${money(r.stake)}</td><td class="${r.profit > 0 ? 'positive' : r.profit < 0 ? 'negative' : ''}">${signedMoney(r.profit)}</td></tr>`).join('')}</tbody></table></div>${session.history.length > limit ? '<button class="secondary-button" id="more-history" style="margin-top:16px">기록 더 보기</button>' : ''}` : '<div class="empty-state"><strong>아직 게임 기록이 없습니다</strong>칩을 선택하고 첫 게임을 시작해보세요.</div>'}<p class="note">최근 2,000판의 상세 기록을 이 브라우저에 보관합니다. 누적 통계는 모든 판을 포함합니다. CSV에는 보관 중인 모든 상세 기록이 포함됩니다.</p>`);
  $('#export-history').onclick = () => {
    const header = 'round,shoe,time,winner,player_score,banker_score,player_pair,banker_pair,player_bet,tie_bet,banker_bet,total_bet,profit';
    const rows = session.history.map((r) => [r.id, r.shoeNumber, r.time, r.winner, r.playerTotal, r.bankerTotal, !!r.playerPair, !!r.bankerPair, r.bets.player, r.bets.tie, r.bets.banker, r.stake, r.profit].join(','));
    downloadFile('baccarat-history.csv', [header, ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  };
  if ($('#more-history')) $('#more-history').onclick = () => showHistory(limit + 100);
}

function statsMarkup(totals) {
  const percent = (side) => totals.rounds ? (totals[side] / totals.rounds * 100).toFixed(1) : '0.0';
  return `<div class="distribution" aria-label="플레이어 ${percent('player')}%, 뱅커 ${percent('banker')}%, 타이 ${percent('tie')}%"><span style="width:${percent('player')}%;background:#3d8aca"></span><span style="width:${percent('tie')}%;background:#6eab70"></span><span style="width:${percent('banker')}%;background:#d25d59"></span></div><div class="distribution-labels"><span>플레이어 ${percent('player')}%</span><span>타이 ${percent('tie')}%</span><span>뱅커 ${percent('banker')}%</span></div><div class="stats-grid"><div class="stat-box"><span>누적 게임</span><strong>${totals.rounds.toLocaleString()}</strong></div><div class="stat-box"><span>총 배팅 금액</span><strong>${money(totals.wagered)}</strong></div><div class="stat-box"><span>누적 손익</span><strong class="${totals.profit > 0 ? 'positive' : totals.profit < 0 ? 'negative' : ''}">${signedMoney(totals.profit)}</strong></div></div><table><thead><tr><th>결과</th><th>누적 횟수</th><th>비율</th></tr></thead><tbody>${['player', 'banker', 'tie', 'playerPair', 'bankerPair'].map((key) => `<tr><td>${names[key] || (key === 'playerPair' ? '플레이어 페어' : '뱅커 페어')}</td><td>${totals[key].toLocaleString()}</td><td>${totals.rounds ? (totals[key] / totals.rounds * 100).toFixed(2) : '0.00'}%</td></tr>`).join('')}</tbody></table>`;
}

function showStats() {
  openPanel('누적 통계', `${statsMarkup(session.totals)}<p class="note">현재 세션 전체 게임의 통계입니다. 상단 기록판은 현재 슈의 결과만 표시합니다. 페어는 승패와 별도로 집계됩니다. 별도 시뮬레이션 결과는 포함하지 않습니다.</p>`);
}

function simulationChart(points) {
  const min = Math.min(0, ...points), max = Math.max(0, ...points), spread = max - min || 1;
  const y = (value) => 140 - (value - min) / spread * 120;
  const path = points.map((value, i) => `${i === 0 ? 'M' : 'L'}${(i / Math.max(1, points.length - 1) * 660 + 10).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return `<svg class="sim-chart" viewBox="0 0 680 160" role="img" aria-label="시뮬레이션 누적 손익 그래프, 최종 ${signedMoney(points.at(-1))}"><path d="M10 ${y(0)}H670" stroke="#7e9a8050" stroke-dasharray="4 4"/><path d="${path}" fill="none" stroke="#d5c18b" stroke-width="2"/></svg><div class="chart-labels"><span>START</span><span>MIN ${signedMoney(min)} · MAX ${signedMoney(max)}</span><span>END</span></div>`;
}

function showSimulation() {
  openPanel('시뮬레이션', `<p>같은 금액을 한 영역에 반복 배팅했을 때의 결과를 확인합니다.<br>테이블 잔액·카드 슈·게임 기록과 분리된 독립 시뮬레이션입니다.</p><form id="simulation-form"><div class="form-row"><label>게임 횟수<select id="sim-rounds"><option value="100">100판</option><option value="1000" selected>1,000판</option><option value="10000">10,000판</option></select></label><label>배팅 영역<select id="sim-side"><option value="banker">뱅커 · 6점 승리만 절반 지급</option><option value="player">플레이어 · 1대1</option><option value="tie">타이 · 8대1</option></select></label><label>판당 가상 금액<input id="sim-amount" type="number" min="5000" max="100000" step="1000" value="5000" required></label></div><div class="form-actions"><button class="primary-button" id="run-simulation" type="submit">시뮬레이션 실행</button><button class="secondary-button" id="cancel-simulation" type="button" hidden>중지</button><span id="sim-progress-label" role="status"></span></div></form><progress id="sim-progress" value="0" max="100" hidden aria-label="시뮬레이션 진행률"></progress><div id="simulation-result">${lastSimulation ? `<h2>직전 시뮬레이션 · ${names[lastSimulation.side]} / ${money(lastSimulation.amount)}</h2>${simulationChart(lastSimulation.points)}${statsMarkup(lastSimulation.totals)}` : ''}</div><p class="note">매 판 고정 금액을 투입하는 모형으로, 자금 소진 제한을 적용하지 않습니다. 무작위 결과이며 다음 게임의 승패를 예측하지 않습니다.</p>`, 'INDEPENDENT SIMULATION');
  $('#simulation-form').onsubmit = (event) => { event.preventDefault(); runSimulation(); };
  $('#sim-side').onchange = () => {
    const { min, max } = BET_LIMITS[$('#sim-side').value];
    const input = $('#sim-amount'); input.min = min; input.max = max;
    input.value = Math.max(min, Math.min(max, Number(input.value) || min));
  };
  $('#cancel-simulation').onclick = () => { cancelSimulation = true; };
}

async function runSimulation() {
  if (simulationRunning) return;
  const count = Number($('#sim-rounds').value), side = $('#sim-side').value, amount = Number($('#sim-amount').value);
  if (![100, 1000, 10000].includes(count) || !SIDES.includes(side) || !Number.isInteger(amount) || amount <= 0) { toast('게임 횟수와 배팅 금액을 확인해주세요.'); return; }
  try { assertBetLimits({ ...emptyBets(), [side]: amount }); }
  catch (error) { toast(error.message); return; }
  simulationRunning = true; cancelSimulation = false;
  $('#run-simulation').disabled = true; $('#cancel-simulation').hidden = false; $('#sim-progress').hidden = false;
  for (const selector of ['#sim-rounds', '#sim-side', '#sim-amount']) $(selector).disabled = true;
  $('#simulation-result').replaceChildren();
  const totals = summarize([]), bets = { ...emptyBets(), [side]: amount }, points = [0];
  let shoe = prepareShoe(), completed = 0;
  try {
    for (let i = 0; i < count; i++) {
      if (cancelSimulation) break;
      if (shoe.length <= 14) shoe = prepareShoe();
      const result = dealRound(shoe), settlement = settleBets(bets, result.winner, result.bankerTotal);
      const delta = summarize([{ ...result, ...settlement }]);
      for (const key of Object.keys(delta)) totals[key] += delta[key];
      completed++;
      if (completed % Math.max(1, Math.floor(count / 200)) === 0) points.push(totals.profit);
      if (completed % 100 === 0 || completed === count) {
        $('#sim-progress').value = completed / count * 100;
        $('#sim-progress-label').textContent = `${completed.toLocaleString()} / ${count.toLocaleString()}`;
        await delay(12);
      }
    }
    if (points.at(-1) !== totals.profit) points.push(totals.profit);
    lastSimulation = { totals, points, side, amount };
    if ($('#simulation-result')) {
      $('#simulation-result').innerHTML = `<h2>${cancelSimulation ? '중지됨' : '실행 완료'} · ${completed.toLocaleString()}판 · ${names[side]} / ${money(amount)}</h2>${simulationChart(points)}${statsMarkup(totals)}`;
      $('#sim-progress-label').textContent = cancelSimulation ? `${completed.toLocaleString()}판에서 중지` : '완료';
    }
  } catch { toast('시뮬레이션을 완료하지 못했습니다. 다시 실행해주세요.'); }
  finally {
    simulationRunning = false;
    if ($('#run-simulation')) {
      $('#run-simulation').disabled = false; $('#cancel-simulation').hidden = true;
      for (const selector of ['#sim-rounds', '#sim-side', '#sim-amount']) $(selector).disabled = false;
    }
  }
}

function showSettings() {
  // Cancel the countdown and invalidate pending card animations before any settings mutations.
  if (running) stopAutomatic();
  openPanel('테이블 설정', `<label class="setting-row"><span>빠른 카드 애니메이션<small>빠른 모드도 이전보다 카드마다 0.3초 느리게 배분합니다.</small></span><input type="checkbox" id="setting-fast" ${session.settings.fast ? 'checked' : ''}></label><label class="setting-row"><span>테이블 효과음<small>칩 선택, 카드 배분, 결과 알림에 짧은 효과음을 사용합니다.</small></span><input type="checkbox" id="setting-sound" ${session.settings.sound ? 'checked' : ''}></label><div class="setting-row"><span>새 카드 슈<small>현재 배팅을 취소하고 새 8덱 슈를 시작합니다.<br>누적 기록과 통계는 유지됩니다.</small></span><button id="new-shoe" class="secondary-button">새 슈</button></div><div class="setting-row"><span>가상 금액 충전<small>현금 가치가 없는 연습용 금액 ₩1,000,000을 추가합니다.</small></span><button id="top-up" class="secondary-button">충전</button></div><h2>데이터 관리</h2><p>기록은 이 브라우저에만 저장됩니다. 다른 기기나 브라우저에는 동기화되지 않습니다.</p><button id="reset-session" class="danger-button">기록과 잔액 초기화</button><div id="reset-confirm"></div>`);
  $('#setting-fast').onchange = (event) => { session.settings.fast = event.target.checked; persist(); };
  $('#dialog-body').insertAdjacentHTML('afterbegin', '<p class="note">설정을 여는 동안 자동 진행은 중지됩니다. 설정을 닫고 게임 시작을 누르면 15초 배팅부터 다시 진행합니다. 이미 정산된 판의 기록은 유지됩니다.</p>');
  $('#setting-sound').onchange = (event) => { session.settings.sound = event.target.checked; persist(); playSound(); };
  $('#new-shoe').onclick = () => {
    session.balance += totalBet(session.bets); session.bets = emptyBets(); betSteps = [];
    session.shoe = prepareShoe(); session.shoeNumber++; persist(); renderAll(); toast('새 8덱 슈를 시작했습니다.');
  };
  $('#top-up').onclick = () => {
    if (session.balance > Number.MAX_SAFE_INTEGER - 2000000) { toast('최대 가상 잔액에 도달했습니다.'); return; }
    session.balance += 1000000; betSteps = []; persist(); renderAll(); toast('가상 금액 ₩1,000,000을 충전했습니다.');
  };
  $('#reset-session').onclick = () => {
    $('#reset-confirm').innerHTML = '<p style="margin-top:16px">모든 기록·통계·배팅이 삭제되고 가상 금액이 ₩1,000,000으로 초기화됩니다.</p><button class="danger-button" id="confirm-reset">전체 초기화 확인</button> <button class="secondary-button" id="cancel-reset">취소</button>';
    $('#cancel-reset').onclick = () => $('#reset-confirm').replaceChildren();
    $('#confirm-reset').onclick = () => {
      stopAutomatic();
      session = newSession(); betSteps = []; lastSimulation = null; clearTableCards(); persist(); renderAll(); $('#panel-dialog').close(); toast('새 세션을 시작했습니다.');
    };
  };
}

function showHelp() {
  openPanel('테이블 이용 안내', `<p>사진 속 전자식 바카라 테이블에서 영감을 받은 개인용 가상 시뮬레이터입니다. 모든 금액은 현금 가치가 없는 가상 칩입니다.</p><h2>플레이 방법</h2><ol><li>먼저 게임 시작을 누르고, 15초 안에 하단에서 원하는 금액의 칩을 선택합니다.</li><li>플레이어·타이·뱅커 영역을 누를 때마다 선택한 칩 금액이 추가됩니다.</li><li>게임 시작을 누르면 매 판 15초 배팅 시간이 시작됩니다. 0초에 배팅이 잠기고 카드가 자동 배분됩니다.</li><li>배팅하지 않아도 진행되며 정산 후 다시 15초 배팅을 시작합니다. 창을 닫거나 새로고침하면 자동 진행은 종료됩니다. 직전 배팅은 자동 반복하지 않습니다. 이전 배팅 반복으로 같은 금액을 다시 놓을 수 있습니다.</li></ol><h2>뱅커 6점 절반 지급 바카라</h2><p>플레이어·뱅커는 각 영역당 ₩5,000~₩100,000, 타이는 ₩1,000~₩10,000까지 배팅할 수 있습니다. 첫 플레이어·뱅커 배팅은 5,000원 이상 칩을 선택해주세요. 이후에는 1,000원 단위로 추가할 수 있습니다. 두 배·이전 배팅 반복에도 같은 한도가 적용됩니다.</p><table><thead><tr><th>영역</th><th>순이익 지급</th><th>타이 발생 시</th></tr></thead><tbody><tr><td>플레이어</td><td>1 : 1</td><td>원금 반환</td></tr><tr><td>뱅커</td><td>1 : 1 (6점 승리 시 1 : 0.5)</td><td>원금 반환</td></tr><tr><td>타이</td><td>8 : 1</td><td>배팅액의 9배 반환</td></tr></tbody></table><p class="note">뱅커에 10,000원을 배팅하면 6점 승리 시 원금 포함 15,000원, 다른 점수 승리 시 20,000원을 반환합니다. 수수료는 없습니다. 타이 시 플레이어·뱅커 원금은 반환됩니다. 페어는 기록만 집계하며 배팅은 지원하지 않습니다.</p><h2>카드 규칙</h2><p>A는 1점, 2~9는 숫자 값, 10·J·Q·K는 0점이며 합계의 일의 자리를 사용합니다. 초기 8·9점은 내추럴로 추가 배분을 하지 않습니다. 그 외에는 표준 플레이어·뱅커 세 번째 카드 규칙에 따라 자동 배분합니다.</p><p class="note">8덱을 섞고 첫 카드와 해당 값만큼의 카드를 번합니다. 남은 카드가 14장 이하이면 다음 판부터 새 슈로 전환합니다.</p><h2>기록판 읽기</h2><p>대로드의 파랑은 플레이어, 빨강은 뱅커입니다. 타이는 마지막 결과에 초록 사선으로 표시됩니다. 분홍·보라 점은 페어입니다. 같은 승자가 이어지면 아래로, 승자가 바뀌면 새 열로 이동합니다. 하단 세 로드는 빅아이·스몰·코크로치로, 과거 결과의 규칙성을 빨강과 파랑으로 나타냅니다. 미래 승패를 예측하는 표시가 아닙니다.</p><h2>단축키와 데이터</h2><p>숫자 1~4: 칩 선택 · Enter: 게임 시작 · Esc: 창 닫기.<br>기록은 이 기기에 자동 저장되며 최근 2,000판은 CSV로 내보낼 수 있습니다. 시뮬레이션은 테이블 데이터와 별도로 실행됩니다.</p><p class="note">카드 규칙 참고: <a href="https://assets.contentstack.io/v3/assets/bltc6ce635bc4868eb2/bltd134a58a42453532/mgm-national-harbor-casino-table-games-baccarat-royal-9.pdf" target="_blank" rel="noopener noreferrer">MGM National Harbor Baccarat Gaming Guide</a>. 로고·상표·사진 자산은 사용하지 않았습니다.</p>`);
}

$$('.bet-zone').forEach((button) => button.addEventListener('click', () => addBet(button.dataset.side)));
$$('.casino-chip').forEach((button) => button.addEventListener('click', () => selectChip(Number(button.dataset.chip))));
$('#undo-button').onclick = () => {
  if (!bettingOpen() || !betSteps.length) return;
  Object.assign(session, betSteps.pop()); persist(); renderWallet(); renderControls(); renderWagers();
};
$('#clear-button').onclick = () => {
  if (!bettingOpen() || !totalBet(session.bets)) return;
  betSteps.push({ balance: session.balance, bets: { ...session.bets } });
  session.balance += totalBet(session.bets); session.bets = emptyBets(); persist(); renderWallet(); renderControls(); renderWagers();
};
$('#double-button').onclick = () => {
  if (totalBet(session.bets)) updateBets(doubledBets());
};
$('#repeat-button').onclick = () => {
  if (totalBet(session.lastBets)) updateBets(session.lastBets);
};
$('#deal-button').onclick = startAutomatic;
$('#history-button').onclick = () => showHistory();
$('#stats-button').onclick = showStats;
$('#simulation-button').onclick = showSimulation;
$('#settings-button').onclick = showSettings;
$('#help-button').onclick = showHelp;
$('#close-dialog').onclick = () => $('#panel-dialog').close();
$('#panel-dialog').addEventListener('close', () => { cancelSimulation = true; });
$('#panel-dialog').addEventListener('click', (event) => {
  if (event.target !== $('#panel-dialog')) return;
  const bounds = $('#panel-dialog').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('#panel-dialog').close();
});
$('#fullscreen-button').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('이 브라우저에서는 전체 화면을 사용할 수 없습니다.'); }
};
document.addEventListener('keydown', (event) => {
  if ($('#panel-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (['1', '2', '3', '4'].includes(event.key)) selectChip(CHIP_VALUES[Number(event.key) - 1]);
  if (event.key === 'Enter') { event.preventDefault(); startAutomatic(); }
});
// A second tab must not overwrite a newer bankroll while this tab is mid-deal.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  stopAutomatic();
  toast('다른 탭에서 기록이 변경되었습니다. 이 탭을 새로고침해 최신 기록을 불러오세요.');
  $$('.bet-zone, .casino-chip, .play-controls button, .utility-actions button').forEach((button) => { button.disabled = true; });
  // Block stale mutations for the rest of this tab's life; reload restores consistency.
  document.addEventListener('click', blockStaleClick, true);
  document.addEventListener('keydown', blockStaleClick, true);
});
function blockStaleClick(event) {
  if (event.type === 'keydown' && (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r'))) return;
  event.preventDefault(); event.stopImmediatePropagation(); toast('다른 탭의 최신 기록을 불러오려면 이 탭을 새로고침해주세요.');
}

new ResizeObserver(() => renderRoads()).observe($('.roads'));
setStatus('게임 시작을 눌러주세요'); renderAll(); persist();
if (loaded.warning) toast(loaded.warning);
