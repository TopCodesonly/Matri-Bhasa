/* ============================================================
   CONTACT — live multiplayer game server
   Zero dependencies. Node's built-in http only.
   Real-time updates via Server-Sent Events (SSE).
   Run:  node server.js
   ============================================================ */
const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const PORT = process.env.PORT || 3000;

function lanIP(){
  const nets = os.networkInterfaces();
  let lan = 'localhost';
  for(const name of Object.keys(nets))
    for(const ni of nets[name])
      if(ni.family==='IPv4' && !ni.internal) lan = ni.address;
  return lan;
}
const LAN_URL = 'http://' + lanIP() + ':' + PORT;

/* ---------------- in-memory game state ---------------- */
const rooms = {};            // code -> room
const sse   = {};            // code -> [ {playerId, res} ]

function newRoom(code){
  return {
    code,
    players: [],             // {id, name, role}  role: 'attacker'|'defender'|null
    phase: 'lobby',          // lobby | secret | clue | live | over
    secret: '',
    revealed: 1,
    contacts: 0,
    cluerId: null,
    turn: null,              // {clueWord, clue}
    log: [],
    winner: null,
  };
}

function getRoom(code){
  if(!rooms[code]) rooms[code] = newRoom(code);
  return rooms[code];
}
function player(room, id){ return room.players.find(p => p.id === id); }
function attackers(room){ return room.players.filter(p => p.role === 'attacker'); }
function defender(room){ return room.players.find(p => p.role === 'defender'); }
function prefix(room){ return room.secret.slice(0, room.revealed); }
function guesserId(room){
  const a = attackers(room);
  const other = a.find(p => p.id !== room.cluerId);
  return other ? other.id : null;
}
function pushLog(room, kind, html){
  room.log.push({kind, html});
  if(room.log.length > 60) room.log.shift();
}

/* ---------------- per-player sanitized view ---------------- */
function viewFor(room, playerId){
  const me = player(room, playerId);
  const showFullWord = (me && me.role === 'defender') || room.phase === 'over';
  return {
    code: room.code,
    invite: LAN_URL + '/?room=' + room.code,
    phase: room.phase,
    you: me ? {id: me.id, name: me.name, role: me.role} : null,
    players: room.players.map(p => ({id:p.id, name:p.name, role:p.role})),
    canStart: attackers(room).length === 2 && !!defender(room),
    word: {
      length: room.secret.length,
      prefix: prefix(room),
      full: showFullWord ? room.secret : null,
    },
    contacts: room.contacts,
    cluerId: room.cluerId,
    cluerName: room.cluerId ? (player(room, room.cluerId)||{}).name : null,
    guesserId: guesserId(room),
    guesserName: guesserId(room) ? (player(room, guesserId(room))||{}).name : null,
    defenderName: defender(room) ? defender(room).name : null,
    clue: room.turn ? room.turn.clue : null,
    winner: room.winner,
    log: room.log,
  };
}

/* ---------------- broadcast to everyone in a room ---------------- */
function broadcast(code){
  const room = rooms[code];
  const conns = sse[code] || [];
  for(const c of conns){
    try{
      const data = JSON.stringify(viewFor(room, c.playerId));
      c.res.write(`data: ${data}\n\n`);
    }catch(e){ /* connection gone */ }
  }
}

/* ---------------- game actions ---------------- */
function actRegister(room, {playerId, name}){
  let p = player(room, playerId);
  if(p){ p.name = name || p.name; }
  else if(room.players.length < 3){
    room.players.push({id: playerId, name: name || 'Player', role: null});
    pushLog(room, 'sys', `<b>${name}</b> joined the room.`);
  }
}
function actRole(room, {playerId, role}){
  if(room.phase !== 'lobby') return;
  const p = player(room, playerId); if(!p) return;
  if(role === 'defender' && defender(room) && defender(room).id !== playerId) return; // one defender max
  if(role === 'attacker' && attackers(room).length >= 2 && p.role !== 'attacker') return;
  p.role = role;
}
function actStart(room){
  if(room.phase !== 'lobby') return;
  if(!(attackers(room).length === 2 && defender(room))) return;
  room.phase = 'secret';
  room.cluerId = attackers(room)[0].id;
  pushLog(room, 'sys', `Game started! ${defender(room).name} is the Defender. Choosing a secret word…`);
}
function actSecret(room, {playerId, word}){
  if(room.phase !== 'secret') return;
  const d = defender(room); if(!d || d.id !== playerId) return;
  const w = String(word||'').toLowerCase().replace(/[^a-z]/g,'');
  if(w.length < 4) return;
  room.secret = w; room.revealed = 1; room.contacts = 0;
  room.phase = 'clue'; room.turn = null;
  pushLog(room, 'sys', `Secret locked: a <b>${w.length}-letter</b> word. First letter revealed: <b>${w[0].toUpperCase()}</b>.`);
}
function actClue(room, {playerId, word, clue}){
  if(room.phase !== 'clue') return;
  if(playerId !== room.cluerId) return;
  const w = String(word||'').toLowerCase().replace(/[^a-z]/g,'');
  const c = String(clue||'').trim();
  const p = prefix(room);
  if(!w.startsWith(p) || w.length <= p.length || !c) return;
  room.turn = {clueWord: w, clue: c};
  room.phase = 'live';
  pushLog(room, 'att', `<b>${player(room,playerId).name}</b> gives a clue: <i>“${c}”</i> &nbsp;<small>(word starts ${p.toUpperCase()})</small>`);
}
function actDefend(room, {playerId, guess}){
  if(room.phase !== 'live') return;
  const d = defender(room); if(!d || d.id !== playerId) return;
  const g = String(guess||'').toLowerCase().replace(/[^a-z]/g,'');
  if(!g) return;
  if(g === room.turn.clueWord){
    pushLog(room, 'block', `🛡️ <b>BLOCKED!</b> ${d.name} guessed “<b>${g.toUpperCase()}</b>” — exactly the cluer's word. No letter revealed.`);
    room.turn = null; room.phase = 'clue';   // same cluer tries a new clue
  } else {
    pushLog(room, 'def', `${d.name} tried “<b>${g.toUpperCase()}</b>” — wrong.`);
  }
}
function actContact(room, {playerId, guess}){
  if(room.phase !== 'live') return;
  if(playerId !== guesserId(room)) return;
  const g = String(guess||'').toLowerCase().replace(/[^a-z]/g,'');
  if(!g) return;
  const cluerWord = room.turn.clueWord;
  const cluer = player(room, room.cluerId);
  const guesser = player(room, playerId);
  if(g === cluerWord){
    room.contacts++;
    pushLog(room, 'contact',
      `⚡ <b>CONTACT!</b> ${cluer.name} &amp; ${guesser.name} both had <b>${g.toUpperCase()}</b>.`);
    if(g === room.secret){
      room.phase = 'over';
      room.winner = 'attackers';
      pushLog(room, 'win', `🎯 That word IS the secret! Attackers crack <b>${room.secret.toUpperCase()}</b> and win! 🏆`);
      room.turn = null;
      return;
    }
    if(room.revealed < room.secret.length){
      room.revealed++;
      if(room.revealed === room.secret.length)
        pushLog(room, 'sys', `New letter! The whole word now shows: <b>${room.secret.toUpperCase()}</b>. Contact on it to win!`);
      else
        pushLog(room, 'sys', `New letter revealed → words must now start with <b>${prefix(room).toUpperCase()}</b>.`);
    }
    // swap cluer to the other attacker
    room.cluerId = guesserId(room);
    room.turn = null; room.phase = 'clue';
  } else {
    pushLog(room, 'att', `${guesser.name} called Contact with “<b>${g.toUpperCase()}</b>” — no match. Keep going!`);
    // stays live; cluer's word still hidden
  }
}
function actReclue(room, {playerId}){
  if(room.phase !== 'live') return;
  if(playerId !== room.cluerId) return;
  pushLog(room, 'sys', `${player(room,playerId).name} withdrew the clue. New clue coming…`);
  room.turn = null; room.phase = 'clue';
}
function actGiveUp(room, {playerId}){
  if(room.phase !== 'live' && room.phase !== 'clue') return;
  const d = defender(room); if(!d || d.id !== playerId) return;
  room.phase = 'over'; room.winner = 'attackers';
  pushLog(room, 'win', `🏳️ ${d.name} concedes! The word was <b>${room.secret.toUpperCase()}</b>. Attackers win! 🏆`);
}
function actNewGame(room){
  room.phase = 'secret';
  room.secret=''; room.revealed=1; room.contacts=0; room.turn=null; room.winner=null;
  room.cluerId = attackers(room).length ? attackers(room)[0].id : null;
  room.log = [];
  pushLog(room, 'sys', `New round! ${defender(room)?defender(room).name:'Defender'} is choosing a word…`);
}

const ACTIONS = {
  register: actRegister, role: actRole, start: actStart, secret: actSecret,
  clue: actClue, defend: actDefend, contact: actContact, reclue: actReclue,
  giveup: actGiveUp, newgame: actNewGame,
};

/* ---------------- http server ---------------- */
function send(res, code, type, body){
  res.writeHead(code, {'Content-Type': type, 'Cache-Control':'no-cache'});
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  // --- serve client page ---
  if(req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')){
    fs.readFile(path.join(__dirname,'index.html'), (e,buf)=>{
      if(e) return send(res,500,'text/plain','index.html missing');
      send(res,200,'text/html',buf);
    });
    return;
  }

  // --- SSE live stream ---
  if(req.method === 'GET' && u.pathname === '/events'){
    const code = (u.searchParams.get('room')||'').toUpperCase();
    const playerId = u.searchParams.get('playerId')||'';
    if(!code || !playerId){ return send(res,400,'text/plain','room & playerId required'); }
    getRoom(code);
    res.writeHead(200, {
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache',
      'Connection':'keep-alive',
    });
    res.write('retry: 2000\n\n');
    sse[code] = sse[code] || [];
    sse[code].push({playerId, res});
    // immediately send current state
    res.write(`data: ${JSON.stringify(viewFor(rooms[code], playerId))}\n\n`);
    const ping = setInterval(()=>{ try{res.write(': ping\n\n');}catch(e){} }, 20000);
    req.on('close', ()=>{
      clearInterval(ping);
      sse[code] = (sse[code]||[]).filter(c => c.res !== res);
    });
    return;
  }

  // --- action endpoint ---
  if(req.method === 'POST' && u.pathname.startsWith('/api/')){
    const action = u.pathname.slice(5);
    let body='';
    req.on('data', d => { body += d; if(body.length>1e5) req.destroy(); });
    req.on('end', ()=>{
      let data={}; try{ data = JSON.parse(body||'{}'); }catch(e){}
      const code = String(data.room||'').toUpperCase();
      if(!code) return send(res,400,'application/json','{"ok":false}');
      const room = getRoom(code);
      const fn = ACTIONS[action];
      if(fn){ fn(room, data); broadcast(code); }
      send(res,200,'application/json','{"ok":true}');
    });
    return;
  }

  send(res,404,'text/plain','not found');
});

server.listen(PORT, '0.0.0.0', ()=>{
  console.log('\n  ⚡  CONTACT multiplayer server is live!\n');
  console.log('  On THIS computer:      http://localhost:'+PORT);
  console.log('  On OTHER devices:      '+LAN_URL+'   (same Wi-Fi)\n');
  console.log('  Share that second link with your 2 friends. Ctrl+C to stop.\n');
});
