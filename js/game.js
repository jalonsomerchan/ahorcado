import { connect } from 'https://esm.sh/itty-sockets';
import frases from './palabras.js';

const api = new GameAPI();
const GAME_ID = 14;

const VALORES_LETRAS = {
  a:1, b:3, c:3, d:2, e:1, f:4, g:2, h:4, i:1, j:8, k:8, l:1, m:3,
  n:1, ñ:8, o:1, p:3, q:5, r:1, s:1, t:1, u:1, v:4, w:8, x:8, y:4, z:10
};

const LETRAS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z'];

const S = {
  user: null,
  room: null,
  isHost: false,
  socket: null,
  gameState: null,
  timer: null,
  timeLeft: 0,
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function toast(msg, type = 'info') {
  const colors = { info: 'bg-blue-700', ok: 'bg-green-700', error: 'bg-red-700' };
  const el = document.createElement('div');
  el.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-lg text-white text-sm font-semibold shadow-xl animate-toast ${colors[type] || colors.info}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function normalizar(str) {
  if (!str) return '';
  return str.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-zñ ]/g, '');
}

function valorLetra(letra) {
  return VALORES_LETRAS[letra.toLowerCase()] || 1;
}

function contarOcurrencias(frase, letra) {
  return [...normalizar(frase)].filter(c => c === normalizar(letra)).length;
}

function fraseALetrasUnicas(frase) {
  return [...new Set([...normalizar(frase)].filter(c => c !== ' '))];
}

function esFraseResuelta(frase, letrasAdivinadas) {
  return [...normalizar(frase)].every(c => c === ' ' || letrasAdivinadas.includes(c));
}

function getFraseDisplay(frase, letrasAdivinadas) {
  return [...frase].map(c => {
    if (c === ' ') return ' ';
    const n = normalizar(c);
    if (!n) return c; // puntuación: visible siempre
    return letrasAdivinadas.includes(n) ? c : '_';
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── INIT ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  loadSavedUser();
  setupListeners();
  checkURLRoom();
});

function loadSavedUser() {
  const saved = localStorage.getItem('ahorcado_user');
  if (saved) {
    try {
      S.user = JSON.parse(saved);
      $('login-saved-name').textContent = S.user.username;
      $('login-saved').classList.remove('hidden');
      $('login-new-form').classList.add('hidden');
    } catch {
      localStorage.removeItem('ahorcado_user');
    }
  } else {
    $('login-saved').classList.add('hidden');
    $('login-new-form').classList.remove('hidden');
  }
}

function checkURLRoom() {
  const code = new URLSearchParams(location.search).get('sala');
  if (!code) return;
  if (S.user) {
    showScreen('screen-lobby');
    $('lobby-username').textContent = S.user.username;
    $('join-code').value = code.toUpperCase();
    setTimeout(() => joinRoom(code), 200);
  } else {
    localStorage.setItem('ahorcado_pending_room', code.toUpperCase());
  }
}

// ─── EVENT LISTENERS ───────────────────────────────────────────────────────────

function setupListeners() {
  $('btn-continue-user').addEventListener('click', () => {
    showScreen('screen-lobby');
    $('lobby-username').textContent = S.user.username;
    const pending = localStorage.getItem('ahorcado_pending_room');
    if (pending) {
      localStorage.removeItem('ahorcado_pending_room');
      $('join-code').value = pending;
      joinRoom(pending);
    }
  });

  $('btn-new-user').addEventListener('click', () => {
    $('login-saved').classList.add('hidden');
    $('login-new-form').classList.remove('hidden');
    $('input-username').focus();
  });

  $('btn-create-account').addEventListener('click', () => createUser($('input-username').value.trim()));
  $('input-username').addEventListener('keydown', e => e.key === 'Enter' && $('btn-create-account').click());

  $('btn-create-room').addEventListener('click', createRoom);
  $('btn-join-room').addEventListener('click', () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (!code) return toast('Introduce un código de sala', 'error');
    joinRoom(code);
  });
  $('join-code').addEventListener('keydown', e => e.key === 'Enter' && $('btn-join-room').click());
  $('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

  $('btn-share-room').addEventListener('click', shareRoom);
  $('btn-show-qr').addEventListener('click', toggleQR);
  $('btn-start-game').addEventListener('click', startGame);
  $('setting-turn-time').addEventListener('change', updateSettings);
  $('setting-max-errors').addEventListener('change', updateSettings);

  $('btn-guess-phrase').addEventListener('click', () => {
    const area = $('phrase-input-area');
    const visible = area.style.display !== 'none' && area.style.display !== '';
    area.style.display = visible ? 'none' : 'flex';
    if (!visible) $('input-phrase-guess').focus();
  });
  $('btn-submit-phrase').addEventListener('click', submitPhraseGuess);
  $('input-phrase-guess').addEventListener('keydown', e => e.key === 'Enter' && submitPhraseGuess());

  $('btn-play-again').addEventListener('click', playAgain);
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────

async function createUser(username) {
  if (!username) return toast('Escribe un nombre de jugador', 'error');
  const btn = $('btn-create-account');
  btn.disabled = true;
  try {
    const password = crypto.randomUUID();
    const res = await api.createUser(username, password);
    S.user = { id: res.id, username };
    localStorage.setItem('ahorcado_user', JSON.stringify(S.user));
    toast(`¡Bienvenido, ${username}!`, 'ok');
    const pending = localStorage.getItem('ahorcado_pending_room');
    if (pending) {
      localStorage.removeItem('ahorcado_pending_room');
      showScreen('screen-lobby');
      $('lobby-username').textContent = S.user.username;
      $('join-code').value = pending;
      joinRoom(pending);
    } else {
      showScreen('screen-lobby');
      $('lobby-username').textContent = S.user.username;
    }
  } catch (e) {
    toast(e.message || 'Error al crear usuario', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── LOBBY ─────────────────────────────────────────────────────────────────────

async function createRoom() {
  const btn = $('btn-create-room');
  btn.disabled = true;
  try {
    const settings = { turn_time: 30, max_errors: 6 };
    const initialState = {
      status: 'waiting',
      player_registry: { [S.user.id]: S.user.username }
    };
    const res = await api.createRoom(GAME_ID, S.user.id, settings, initialState);
    const code = res.room_code;
    S.room = { code, hostId: S.user.id, settings };
    S.isHost = true;
    enterWaitingRoom(code);
  } catch (e) {
    toast(e.message || 'Error al crear la sala', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function joinRoom(code) {
  const btn = $('btn-join-room');
  if (btn) btn.disabled = true;
  try {
    const roomData = await api.getRoom(code);
    // Register ourselves in player_registry
    const registry = { ...((roomData.game_state || {}).player_registry || {}) };
    registry[S.user.id] = S.user.username;
    await api.joinRoom(code, S.user.id);
    await api.updateRoomState(code, { gameState: { ...roomData.game_state, player_registry: registry } });

    S.room = { code, hostId: roomData.host_id, settings: roomData.room_settings || {} };
    S.isHost = S.user.id === roomData.host_id;
    enterWaitingRoom(code);
  } catch (e) {
    toast(e.message || 'Sala no encontrada', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── WAITING ROOM ──────────────────────────────────────────────────────────────

function enterWaitingRoom(code) {
  showScreen('screen-waiting');
  $('waiting-room-code').textContent = code;
  $('host-controls').classList.toggle('hidden', !S.isHost);
  $('guest-waiting-msg').classList.toggle('hidden', S.isHost);

  const s = S.room.settings;
  if ($('setting-turn-time')) $('setting-turn-time').value = s.turn_time || 30;
  if ($('setting-max-errors')) $('setting-max-errors').value = s.max_errors || 6;

  // Update URL without reload
  const url = new URL(location.href);
  url.searchParams.set('sala', code);
  history.replaceState({}, '', url);

  connectSocket(code);

  // Refresh player list from API
  refreshPlayerList();

  // Announce presence
  setTimeout(() => {
    S.socket && S.socket.send({ type: 'player_joined', userId: S.user.id, username: S.user.username, senderId: S.user.id });
  }, 400);
}

async function refreshPlayerList() {
  try {
    const room = await api.getRoom(S.room.code);
    const registry = (room.game_state || {}).player_registry || {};
    renderPlayerList(Object.entries(registry).map(([uid, name]) => ({ user_id: uid, username: name })));
    S.room.settings = room.room_settings || S.room.settings;
  } catch { /* ignore */ }
}

function renderPlayerList(players) {
  const list = $('player-list');
  list.innerHTML = '';
  players.forEach(p => {
    const isHost = p.user_id === S.room.hostId;
    const isMe = p.user_id === S.user.id;
    const li = document.createElement('li');
    li.className = 'flex items-center gap-3 py-2 px-3 bg-gray-800 rounded-xl';
    li.innerHTML = `
      <span class="w-8 h-8 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-bold shrink-0">
        ${p.username.charAt(0).toUpperCase()}
      </span>
      <span class="flex-1 font-medium ${isMe ? 'text-white' : 'text-gray-300'}">${p.username}${isMe ? ' <span class="text-xs text-gray-500">(tú)</span>' : ''}</span>
      ${isHost ? '<span class="text-yellow-400 text-sm shrink-0">👑</span>' : ''}
    `;
    list.appendChild(li);
  });
  $('player-count').textContent = players.length;
}

async function updateSettings() {
  if (!S.isHost) return;
  const settings = {
    turn_time: parseInt($('setting-turn-time').value),
    max_errors: parseInt($('setting-max-errors').value)
  };
  S.room.settings = settings;
  try {
    await api.updateRoomState(S.room.code, { roomSettings: settings });
    S.socket && S.socket.send({ type: 'settings_updated', settings, senderId: S.user.id });
  } catch { /* ignore */ }
}

function shareRoom() {
  const url = `${location.origin}${location.pathname}?sala=${S.room.code}`;
  if (navigator.share) {
    navigator.share({ title: '¡Juega al Ahorcado conmigo!', text: `Únete con el código ${S.room.code}`, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => toast('¡Enlace copiado!', 'ok')).catch(() => toast(url, 'info'));
  }
}

function toggleQR() {
  const qrContainer = $('qr-container');
  if (qrContainer.classList.contains('hidden')) {
    qrContainer.classList.remove('hidden');
    qrContainer.innerHTML = '';
    const url = `${location.origin}${location.pathname}?sala=${S.room.code}`;
    new QRCode(qrContainer, { text: url, width: 160, height: 160, colorDark: '#000', colorLight: '#fff' });
  } else {
    qrContainer.classList.add('hidden');
  }
}

async function startGame() {
  if (!S.isHost) return;
  const btn = $('btn-start-game');
  btn.disabled = true;
  try {
    const room = await api.getRoom(S.room.code);
    const registry = (room.game_state || {}).player_registry || {};
    const playerIds = Object.keys(registry);

    if (playerIds.length < 1) {
      toast('No hay jugadores registrados', 'error');
      return;
    }

    const fraseObj = frases[Math.floor(Math.random() * frases.length)];
    const frase = fraseObj.frase[0];
    const settings = room.room_settings || S.room.settings;

    const playersOrder = shuffle(playerIds);
    const gameState = {
      phrase: frase,
      category: fraseObj.categoria,
      guessed_letters: [],
      wrong_letters: [],
      current_player_index: 0,
      players_order: playersOrder,
      player_names: registry,
      scores: Object.fromEntries(playersOrder.map(id => [id, 0])),
      max_errors: settings.max_errors || 6,
      turn_time: settings.turn_time || 30,
      errors_count: 0,
      status: 'playing',
      phrase_solved: false
    };

    await api.updateRoomState(S.room.code, { status: 'playing', gameState });
    S.socket && S.socket.send({ type: 'game_started', gameState, senderId: S.user.id });
    initGame(gameState);
  } catch (e) {
    toast(e.message || 'Error al iniciar', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── WEBSOCKET ─────────────────────────────────────────────────────────────────

function connectSocket(roomCode) {
  if (S.socket) return;
  S.socket = connect(`ahorcado-sala-${roomCode}`, { as: S.user.username })
    .on('message', ({ message }) => {
      if (!message || !message.type) return;
      if (message.senderId === S.user.id) return; // ignore own messages
      handleSocketMessage(message);
    })
    .on('open', () => console.log('[WS] conectado'))
    .on('close', () => console.log('[WS] desconectado'));
}

function handleSocketMessage(msg) {
  switch (msg.type) {
    case 'player_joined':
      toast(`${msg.username} se unió`, 'info');
      refreshPlayerList();
      break;
    case 'player_left':
      refreshPlayerList();
      break;
    case 'settings_updated':
      S.room.settings = msg.settings;
      break;
    case 'game_started':
      initGame(msg.gameState);
      break;
    case 'game_update':
      applyGameUpdate(msg.gameState);
      break;
    case 'game_ended':
      stopTimer();
      S.gameState = msg.gameState;
      showResults(msg.gameState);
      break;
    case 'new_game':
      if (!S.isHost) {
        toast('El host creó una nueva sala', 'info');
        setTimeout(() => { location.href = `?sala=${msg.roomCode}`; }, 1500);
      }
      break;
  }
}

// ─── GAME INIT & RENDER ────────────────────────────────────────────────────────

function initGame(gameState) {
  S.gameState = gameState;
  showScreen('screen-game');
  renderGame(gameState);
  startTurnTimer(gameState);
}

function applyGameUpdate(newState) {
  stopTimer();
  S.gameState = newState;
  if (newState.status === 'ended') {
    showResults(newState);
    return;
  }
  renderGame(newState);
  startTurnTimer(newState);
}

function renderGame(gs) {
  $('game-category').textContent = gs.category;
  $('game-room-code').textContent = S.room.code;
  renderHangman(gs.errors_count, gs.max_errors);
  renderPhraseDisplay(gs);
  $('wrong-letters').textContent = gs.wrong_letters.map(l => l.toUpperCase()).join(' ') || '—';
  $('error-count').textContent = `${gs.errors_count} / ${gs.max_errors}`;
  renderScores(gs);

  const currentPlayerId = gs.players_order[gs.current_player_index];
  const isMyTurn = currentPlayerId === S.user.id;
  const currentName = gs.player_names[currentPlayerId] || 'Jugador';

  $('turn-indicator').textContent = isMyTurn ? '¡Es tu turno!' : `Turno de ${currentName}`;
  $('turn-indicator').className = `text-center font-bold text-lg ${isMyTurn ? 'text-green-400' : 'text-gray-400'}`;

  renderKeyboard(gs, isMyTurn);

  $('btn-guess-phrase').classList.toggle('hidden', !isMyTurn);
  $('phrase-input-area').style.display = 'none';
  $('input-phrase-guess').value = '';
}

function renderPhraseDisplay(gs) {
  const container = $('phrase-display');
  container.innerHTML = '';
  const words = gs.phrase.split(' ');
  words.forEach(word => {
    const wordEl = document.createElement('span');
    wordEl.className = 'inline-flex gap-1 mx-1 my-1';
    [...word].forEach(char => {
      const charEl = document.createElement('span');
      const norm = normalizar(char);
      if (!norm) {
        charEl.className = 'inline-flex items-end justify-center w-5 h-9 text-base font-bold text-gray-400 pb-1';
        charEl.textContent = char;
      } else if (gs.guessed_letters.includes(norm)) {
        charEl.className = 'inline-flex items-end justify-center w-7 h-9 border-b-2 border-indigo-500 text-base font-bold uppercase text-white pb-1';
        charEl.textContent = char;
      } else {
        charEl.className = 'inline-flex items-end justify-center w-7 h-9 border-b-2 border-gray-600 text-base font-bold';
        charEl.textContent = '';
      }
      wordEl.appendChild(charEl);
    });
    container.appendChild(wordEl);
  });
}

function renderKeyboard(gs, isMyTurn) {
  const keyboard = $('keyboard');
  keyboard.innerHTML = '';
  LETRAS.forEach(letra => {
    const norm = normalizar(letra);
    const guessed = gs.guessed_letters.includes(norm);
    const wrong = gs.wrong_letters.includes(norm);
    const btn = document.createElement('button');
    btn.className = [
      'w-9 h-9 rounded-lg text-sm font-bold transition-all select-none',
      guessed ? 'bg-indigo-900/50 text-indigo-400 cursor-default' :
      wrong   ? 'bg-red-950 text-red-500 cursor-default line-through' :
      isMyTurn ? 'bg-gray-700 hover:bg-indigo-600 hover:scale-110 active:scale-95 cursor-pointer text-white' :
                 'bg-gray-800 text-gray-600 cursor-not-allowed'
    ].join(' ');
    btn.textContent = letra;
    btn.disabled = !isMyTurn || guessed || wrong;
    if (isMyTurn && !guessed && !wrong) {
      btn.addEventListener('click', () => guessLetter(norm));
    }
    keyboard.appendChild(btn);
  });
}

function renderHangman(errors) {
  const parts = [
    'hangman-head','hangman-body','hangman-arm-left',
    'hangman-arm-right','hangman-leg-left','hangman-leg-right'
  ];
  parts.forEach((id, i) => {
    const el = $(id);
    if (el) el.style.opacity = i < errors ? '1' : '0';
  });
}

function renderScores(gs) {
  const table = $('scores-table');
  table.innerHTML = '';
  const currentId = gs.players_order[gs.current_player_index];
  const sorted = [...gs.players_order]
    .map(id => ({ id, name: gs.player_names[id] || id, score: gs.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const isActive = p.id === currentId;
    const isMe = p.id === S.user.id;
    const div = document.createElement('div');
    div.className = `flex items-center gap-2 py-1 px-2 rounded-lg text-xs ${isActive ? 'bg-indigo-900/40 ring-1 ring-indigo-600' : ''}`;
    div.innerHTML = `
      <span class="text-gray-500 w-3">${i + 1}</span>
      <span class="flex-1 truncate ${isMe ? 'text-white font-semibold' : 'text-gray-400'}">${p.name}</span>
      <span class="font-bold text-indigo-400">${p.score}</span>
    `;
    table.appendChild(div);
  });
}

// ─── TIMER ─────────────────────────────────────────────────────────────────────

function startTurnTimer(gs) {
  stopTimer();
  const isMyTurn = gs.players_order[gs.current_player_index] === S.user.id;
  S.timeLeft = gs.turn_time || 30;
  updateTimerDisplay(isMyTurn);

  S.timer = setInterval(async () => {
    S.timeLeft--;
    updateTimerDisplay(isMyTurn);
    if (S.timeLeft <= 0) {
      stopTimer();
      if (isMyTurn) {
        toast('¡Tiempo agotado! Turno perdido', 'error');
        const newState = { ...S.gameState };
        newState.current_player_index = (newState.current_player_index + 1) % newState.players_order.length;
        await broadcastGameUpdate(newState);
      }
    }
  }, 1000);
}

function stopTimer() {
  if (S.timer) { clearInterval(S.timer); S.timer = null; }
}

function updateTimerDisplay(isMyTurn) {
  const el = $('timer');
  el.textContent = S.timeLeft;
  const urgent = S.timeLeft <= 5;
  el.className = `text-2xl font-bold tabular-nums transition-colors ${
    !isMyTurn ? 'text-gray-600' :
    urgent ? 'text-red-400 animate-pulse' : 'text-white'
  }`;
}

// ─── GAME ACTIONS ──────────────────────────────────────────────────────────────

async function guessLetter(letra) {
  const gs = S.gameState;
  if (gs.players_order[gs.current_player_index] !== S.user.id) return;
  if (gs.guessed_letters.includes(letra) || gs.wrong_letters.includes(letra)) return;

  stopTimer();
  const newState = JSON.parse(JSON.stringify(gs));
  const inPhrase = [...normalizar(gs.phrase)].includes(letra);

  if (inPhrase) {
    newState.guessed_letters.push(letra);
    const ocurrencias = contarOcurrencias(gs.phrase, letra);
    const puntos = valorLetra(letra) * ocurrencias;
    newState.scores[S.user.id] = (newState.scores[S.user.id] || 0) + puntos;
    toast(`+${puntos} pt${puntos !== 1 ? 's' : ''}`, 'ok');

    if (esFraseResuelta(gs.phrase, newState.guessed_letters)) {
      newState.scores[S.user.id] += 50;
      newState.phrase_solved = true;
      newState.status = 'ended';
      toast('¡Frase completada! +50 pts bonus', 'ok');
      await broadcastGameUpdate(newState);
      return;
    }
    // Keep turn
    await broadcastGameUpdate(newState);
    return;
  } else {
    newState.wrong_letters.push(letra);
    newState.errors_count++;
    renderHangman(newState.errors_count);
    toast('Letra incorrecta', 'error');

    if (newState.errors_count >= newState.max_errors) {
      newState.status = 'ended';
      newState.phrase_solved = false;
      await broadcastGameUpdate(newState);
      return;
    }
    newState.current_player_index = (newState.current_player_index + 1) % newState.players_order.length;
  }

  await broadcastGameUpdate(newState);
}

async function submitPhraseGuess() {
  const gs = S.gameState;
  if (gs.players_order[gs.current_player_index] !== S.user.id) return;
  const guess = $('input-phrase-guess').value.trim();
  if (!guess) return;

  stopTimer();
  $('phrase-input-area').style.display = 'none';

  const newState = JSON.parse(JSON.stringify(gs));

  if (normalizar(guess) === normalizar(gs.phrase)) {
    newState.guessed_letters = fraseALetrasUnicas(gs.phrase);
    const bonus = 100;
    newState.scores[S.user.id] = (newState.scores[S.user.id] || 0) + bonus;
    newState.phrase_solved = true;
    newState.status = 'ended';
    toast(`¡Correcto! +${bonus} pts bonus`, 'ok');
  } else {
    toast('Incorrecto ❌', 'error');
    newState.errors_count++;
    if (newState.errors_count >= newState.max_errors) {
      newState.status = 'ended';
      newState.phrase_solved = false;
      await broadcastGameUpdate(newState);
      return;
    }
    newState.current_player_index = (newState.current_player_index + 1) % newState.players_order.length;
  }

  await broadcastGameUpdate(newState);
}

async function broadcastGameUpdate(newState, updateAPI = true) {
  S.gameState = newState;

  if (updateAPI) {
    try {
      await api.updateRoomState(S.room.code, {
        gameState: newState,
        status: newState.status === 'ended' ? 'finished' : 'playing'
      });
    } catch (e) { console.warn('API update failed:', e); }
  }

  const type = newState.status === 'ended' ? 'game_ended' : 'game_update';
  S.socket && S.socket.send({ type, gameState: newState, senderId: S.user.id });

  if (newState.status === 'ended') {
    stopTimer();
    showResults(newState);
  } else {
    renderGame(newState);
    startTurnTimer(newState);
  }
}

// ─── RESULTS ───────────────────────────────────────────────────────────────────

function showResults(gs) {
  stopTimer();
  showScreen('screen-results');

  const outcomeEl = $('result-outcome');
  if (gs.phrase_solved) {
    outcomeEl.textContent = '¡Frase adivinada! 🎉';
    outcomeEl.className = 'text-2xl font-bold text-green-400 text-center';
  } else {
    outcomeEl.textContent = '¡Ahorcado! 💀';
    outcomeEl.className = 'text-2xl font-bold text-red-400 text-center';
  }
  $('result-phrase').textContent = gs.phrase;

  const sorted = [...gs.players_order]
    .map(id => ({ id, name: gs.player_names[id] || id, score: gs.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score);

  const list = $('results-list');
  list.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  sorted.forEach((p, i) => {
    const isMe = p.id === S.user.id;
    const div = document.createElement('div');
    div.className = `flex items-center gap-3 p-3 rounded-xl ${isMe ? 'bg-indigo-900/30 ring-1 ring-indigo-500' : 'bg-gray-800'}`;
    div.innerHTML = `
      <span class="text-2xl w-8 text-center">${medals[i] || `${i + 1}`}</span>
      <span class="flex-1 font-semibold ${isMe ? 'text-white' : 'text-gray-300'}">${p.name}${isMe ? ' <span class="text-xs text-gray-500">(tú)</span>' : ''}</span>
      <span class="text-xl font-bold text-indigo-400">${p.score} pts</span>
    `;
    list.appendChild(div);
  });

  $('btn-play-again').classList.toggle('hidden', !S.isHost);
  $('waiting-new-game').classList.toggle('hidden', S.isHost);

  // Save scores
  sorted.forEach(p => {
    api.saveScore(p.id, GAME_ID, p.score, null, { phrase: gs.phrase, category: gs.category })
      .catch(() => {});
  });
}

async function playAgain() {
  if (!S.isHost) return;
  const btn = $('btn-play-again');
  btn.disabled = true;
  try {
    const settings = S.room.settings;
    const initialState = {
      status: 'waiting',
      player_registry: { [S.user.id]: S.user.username }
    };
    const res = await api.createRoom(GAME_ID, S.user.id, settings, initialState);
    const newCode = res.room_code;
    S.socket && S.socket.send({ type: 'new_game', roomCode: newCode, senderId: S.user.id });
    location.href = `?sala=${newCode}`;
  } catch (e) {
    toast('Error al crear nueva sala', 'error');
    btn.disabled = false;
  }
}
