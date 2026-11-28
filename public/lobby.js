// 大廳、建立房間、輸入密碼、等待室的畫面邏輯
import { hex } from './figure.js';
import { go } from './menu.js';
import { uiClick, uiBack } from './audio.js';
import { profile } from './settings.js';

const $ = (id) => document.getElementById(id);
const TEAMS = window.GAME_MAP.teams;
const MODE_NAMES = { tdm: '團隊死鬥', elim: '回合殲滅', bomb: '爆破模式', comp: '爆破競賽', zombie: '生化模式', hero: '生化英雄' };
const isZMode = (m) => m === 'zombie' || m === 'hero';
const MODE_DESC = {
  tdm: '死了 3 秒後重生，先達到目標擊殺數，或時間到時擊殺比較多的隊伍獲勝。',
  elim: '死了要等下一回合才能復活，把對面全部擊倒就贏一回合，先贏到指定回合數的隊伍獲勝。',
  bomb: '一隊進攻、一隊防守，半場交換。進攻方把炸彈埋在 A 或 B 包點並讓它爆炸；防守方阻止或拆彈。死了等下一回合，可以用投擲物。地圖：霓虹地鐵站。',
  comp: '跟爆破模式一樣，但要用錢買裝備：擊殺、贏回合、埋包拆包都有錢，連輸會有連敗獎金。可以買槍、投擲物、三種護甲和拆彈器；死了身上的東西會掉在地上，大家都能撿。先贏 13 回合獲勝（12:12 之後要領先 2 回合）。地圖：霓虹地鐵站。',
  zombie: '最多 12 人，開局大家都是人類。20 秒後隨機一人變成母體殭屍，被殭屍抓兩下就會被感染。人類撐過 3 分鐘就贏；子彈有限，撿彈藥箱補充。殭屍撿生化箱回血升級。',
  hero: '跟生化模式一樣，但人類剩下最後 1～2 個時會變成英雄：拿發光長刀、600 血、最高傷害加成，被英雄砍死的殭屍不能復活。',
};

let send = () => {};
let myId = () => 0;
let room = null;
let pendingCode = '';
let createMode = 'tdm';
let pickTeam = 0; // 機器人要加到哪一隊（-1 = 自動補滿兩隊）
const LEVEL_NAMES = { easy: '新手', normal: '普通', hard: '老手' };

export function modeName(m) { return MODE_NAMES[m] || m; }
export function mapName(id) { return window.GAME_MAP.get(id).name; }
export function rulesText(r) {
  return `${mapName(r.rules.map)} · ` + (r.mode === 'tdm'
    ? `${MODE_NAMES.tdm} · 目標 ${r.rules.scoreLimit} 殺 · ${r.rules.timeLimit} 分鐘`
    : isZMode(r.mode) ? `${MODE_NAMES[r.mode]} · 共 ${r.rules.rounds} 回合`
    : r.mode === 'comp' ? `${MODE_NAMES.comp} · 先贏 13 回合 · 有經濟系統`
    : `${MODE_NAMES[r.mode]} · 先贏 ${r.rules.rounds} 回合`);
}

// ---------- 大廳 ----------
export function renderRooms(list) {
  const box = $('roomList');
  box.replaceChildren();
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = '目前沒有房間，建立一個吧！';
    box.append(p);
    return;
  }
  list.sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1) || b.count - a.count);
  for (const r of list) {
    const row = document.createElement('button');
    row.className = 'roomrow';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'rn';
    name.textContent = (r.locked ? '🔒 ' : '') + r.name;
    const sub = document.createElement('div');
    sub.className = 'rs';
    sub.textContent = `${r.map ? r.map + ' · ' : ''}${modeName(r.mode)} · 房主 ${r.host} · #${r.code}`;
    info.append(name, sub);
    const count = document.createElement('div');
    count.className = 'rc';
    count.textContent = `${r.count}/${r.max}`;
    const badge = document.createElement('span');
    badge.className = 'badge ' + (r.state === 'playing' ? 'play' : 'wait');
    badge.textContent = r.state === 'playing' ? '對戰中' : r.state === 'results' ? '結算中' : '等待中';
    row.append(info, count, badge);
    row.addEventListener('click', () => {
      if (r.count >= r.max) { $('lobbyStatus').textContent = '這個房間已經滿了'; return; }
      tryJoin(r.code, r.locked);
    });
    box.append(row);
  }
}

function tryJoin(code, locked) {
  pendingCode = code;
  $('lobbyStatus').textContent = '';
  if (locked) { askPassword(code); return; }
  uiClick();
  send({ t: 'join', code });
}
function askPassword(code, wrong = false) {
  pendingCode = code;
  $('passInfo').textContent = `房號 ${code}`;
  $('passStatus').textContent = wrong ? '密碼錯誤，請再試一次' : '';
  $('joinPass').value = '';
  go('scrPass');
  setTimeout(() => $('joinPass').focus(), 50);
}

// 伺服器回傳的錯誤
export function lobbyError(e) {
  if (e.code === 'password') return askPassword(e.room);
  if (e.code === 'badpassword') return askPassword(e.room, true);
  const target = !$('scrRoom').classList.contains('hidden') ? 'roomStatus'
    : !$('scrPass').classList.contains('hidden') ? 'passStatus' : 'lobbyStatus';
  $(target).textContent = e.msg;
  if (target === 'lobbyStatus' && $('scrLobby').classList.contains('hidden')) go('scrLobby', true);
}

// ---------- 等待室 ----------
export function renderRoom(r) {
  room = r;
  const me = myId();
  const isHost = r.hostId === me;
  const mine = r.players.find((p) => p.id === me);
  $('roomTitle').textContent = r.name;
  $('roomCode').textContent = r.code;
  $('roomRules').textContent = (r.locked ? '🔒 ' : '') + rulesText(r);

  // 生化模式：不分隊，12 個位置分成左右兩欄
  const zm = isZMode(r.mode);
  document.querySelector('#scrRoom .teams').classList.toggle('zmode', zm);
  for (const team of [0, 1]) {
    const members = zm ? r.players.slice(team * 6, team * 6 + 6) : r.players.filter((p) => p.team === team);
    const per = zm ? 6 : 5;
    document.querySelector(`.teamcol.t${team} .teamhead span`).textContent = zm ? (team ? '　' : '玩家') : TEAMS[team].name;
    $(`team${team}Count`).textContent = zm ? (team ? '' : `${r.players.length}/12`) : `${members.length}/5`;
    const box = $(`team${team}`);
    box.replaceChildren();
    for (let i = 0; i < per; i++) {
      const p = members[i];
      const slot = document.createElement('div');
      if (!p) {
        slot.className = 'slot free';
        slot.textContent = '空位';
        box.append(slot);
        continue;
      }
      slot.className = 'slot' + (p.id === me ? ' me' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hex(p.color);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = (p.bot ? '🤖 ' : '') + p.name + (p.id === me ? '（你）' : '');
      slot.append(dot, nm);
      if (p.bot) {
        const lv = document.createElement('span');
        lv.className = `lv ${p.bot}`;
        lv.textContent = LEVEL_NAMES[p.bot];
        slot.append(lv);
      }
      if (p.id === r.hostId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = '★ 房主';
        slot.append(tag);
      }
      if (isHost && p.id !== me) {
        const k = document.createElement('button');
        k.className = 'kick';
        k.textContent = '✕';
        k.title = p.bot ? '移除機器人' : '踢出房間';
        k.addEventListener('click', () => {
          if (p.bot || confirm(`要把「${p.name}」踢出房間嗎？`)) { uiClick(); send({ t: 'kick', id: p.id }); }
        });
        slot.append(k);
      }
      box.append(slot);
    }
    const joinBtn = document.querySelector(`.teamcol.t${team} [data-team]`);
    joinBtn.classList.toggle('hidden', zm);
    joinBtn.disabled = !mine || mine.team === team || members.length >= 5 || r.state === 'playing';
    joinBtn.textContent = mine?.team === team ? '你在這隊' : members.length >= 5 ? '已滿' : '加入';
    const botBtn = document.querySelector(`.teamcol.t${team} [data-bot-team]`);
    botBtn.classList.toggle('hidden', !isHost || r.state !== 'lobby' || (zm ? team === 1 || r.players.length >= 12 : members.length >= 5));
  }

  // 房主規則設定
  const hr = $('hostRules');
  hr.classList.toggle('hidden', !isHost || r.state !== 'lobby');
  hr.classList.toggle('tdm', r.mode === 'tdm');
  hr.classList.toggle('elim', r.mode !== 'tdm');
  hr.classList.toggle('bomb', r.mode === 'bomb' || r.mode === 'comp');
  hr.classList.toggle('comp', r.mode === 'comp');
  $('roundsLabel').textContent = zm ? '回合數' : '勝利回合';
  $('fillBots').textContent = zm ? '🤖 自動補滿 12 人' : '🤖 自動補滿兩隊';
  const mark = (id, v) => { for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(v)); };
  mark('ruleMap', r.rules.map);
  // 生化模式只顯示適合的地圖
  for (const b of $('ruleMap').querySelectorAll('button')) b.classList.toggle('hidden', zm && !window.GAME_MAP.zombieMaps.includes(b.dataset.v));
  mark('ruleMode', r.mode);
  mark('ruleScore', r.rules.scoreLimit);
  mark('ruleTime', r.rules.timeLimit);
  mark('ruleRounds', r.rules.rounds);

  const start = $('startMatch');
  start.classList.toggle('hidden', false);
  if (r.state === 'results') {
    start.disabled = true;
    start.textContent = '等其他人看完結算…';
  } else if (isHost) {
    start.disabled = false;
    start.textContent = '▶ 開始對戰';
  } else {
    start.disabled = true;
    start.textContent = '等待房主開始…';
  }
}

export function clearRoomStatus() { $('roomStatus').textContent = ''; }

export function initLobby(opts) {
  send = opts.send;
  myId = opts.myId;

  $('refreshRooms').addEventListener('click', () => { uiClick(); send({ t: 'rooms' }); });
  const joinByCode = () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { $('lobbyStatus').textContent = '房號是 4 個字喔'; return; }
    tryJoin(code, false);
  };
  $('joinCodeBtn').addEventListener('click', joinByCode);
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
  $('joinCode').addEventListener('input', () => {
    $('joinCode').value = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // 建立房間
  const setMode = (m) => {
    createMode = m;
    for (const b of $('createMode').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
    $('createModeDesc').textContent = MODE_DESC[m];
  };
  for (const b of $('createMode').querySelectorAll('button')) b.addEventListener('click', () => { uiClick(); setMode(b.dataset.mode); });
  setMode('tdm');
  $('createBtn').addEventListener('click', () => {
    uiClick();
    send({ t: 'create', name: $('roomName').value.trim() || `${profile.name}的房間`, mode: createMode, password: $('roomPass').value.trim() });
  });
  $('roomName').addEventListener('focus', () => { if (!$('roomName').value) $('roomName').placeholder = `${profile.name}的房間`; });

  // 密碼
  const submitPass = () => { uiClick(); send({ t: 'join', code: pendingCode, password: $('joinPass').value }); };
  $('passBtn').addEventListener('click', submitPass);
  $('joinPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPass(); });

  // 等待室
  for (const b of document.querySelectorAll('.teamcol [data-team]')) {
    b.addEventListener('click', () => { uiClick(); send({ t: 'team', team: Number(b.dataset.team) }); });
  }
  $('leaveRoom').addEventListener('click', () => { uiClick(); send({ t: 'leave' }); });
  $('startMatch').addEventListener('click', () => { uiClick(); clearRoomStatus(); send({ t: 'start' }); });
  $('copyCode').addEventListener('click', async () => {
    if (!room) return;
    uiClick();
    try {
      await navigator.clipboard.writeText(room.code);
      $('roomStatus').textContent = `已複製房號 ${room.code}，傳給朋友吧！`;
    } catch {
      $('roomStatus').textContent = `房號是 ${room.code}`;
    }
  });
  const rule = (id, key, parse) => {
    for (const b of $(id).querySelectorAll('button')) {
      b.addEventListener('click', () => { uiClick(); send({ t: 'rules', [key]: parse(b.dataset.v) }); });
    }
  };
  rule('ruleMap', 'map', String);
  rule('ruleMode', 'mode', String);
  rule('ruleScore', 'scoreLimit', Number);
  rule('ruleTime', 'timeLimit', Number);
  rule('ruleRounds', 'rounds', Number);

  // 機器人
  const openPick = (team) => {
    pickTeam = team;
    $('botPickTitle').firstChild.textContent = team < 0 ? (isZMode(room?.mode) ? '自動補滿 12 人' : '自動補滿兩隊') : isZMode(room?.mode) ? '加入機器人' : `加入${TEAMS[team].name}機器人`;
    $('botPick').classList.remove('hidden');
    uiClick();
  };
  for (const b of document.querySelectorAll('[data-bot-team]')) b.addEventListener('click', () => openPick(Number(b.dataset.botTeam)));
  $('fillBots').addEventListener('click', () => openPick(-1));
  for (const b of document.querySelectorAll('#botPick [data-level]')) {
    b.addEventListener('click', () => {
      uiClick();
      $('botPick').classList.add('hidden');
      const level = b.dataset.level;
      send(pickTeam < 0 ? { t: 'fillBots', level } : { t: 'addBot', team: pickTeam, level });
    });
  }
  $('botPickCancel').addEventListener('click', () => { $('botPick').classList.add('hidden'); uiBack(); });
}

export { TEAMS, isZMode };
