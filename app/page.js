'use client';
import { useReducer, useEffect, useState, useRef, useCallback } from 'react';
import PartySocket from 'partysocket';
import { createDeck, shuffle, cardValue, cardPower, handScore, isRed, DEFAULT_RULES } from './lib/engine';
import { reducer, INIT } from './lib/gameLogic';

// ─────────────────────────────────────────────
// TYPEWRITER HOOK
// ─────────────────────────────────────────────
function useTypewriter(text, speed = 40) {
  const [disp, setDisp] = useState('');
  useEffect(() => {
    if (!text) { setDisp(''); return; }
    let i = 0;
    setDisp('');
    const t = setInterval(() => {
      i++;
      setDisp(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  return disp;
}

// ─────────────────────────────────────────────
// CARD COMPONENT
// ─────────────────────────────────────────────
function CardComp({ card, faceUp, onClick, selected, sm, botTarget }) {
  const red = isRed(card);
  const joker = card?.rank === 'JOKER';
  const cls = ['card-wrap', sm && 'sm', onClick && 'clickable', selected && 'selected', botTarget && 'bot-target'].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick}>
      <div className={`card-inner${faceUp ? ' face-up' : ''}`}>
        <div className="card-back-face" />
        <div className={`card-front-face${red ? ' red' : ' black'}`}>
          {joker ? (
            <div className="card-joker">
              <div className="joker-star">✦</div>
              <div className="joker-label">JOKER</div>
              <div className="joker-pts">−1 pt</div>
            </div>
          ) : card ? (
            <>
              <div className="card-corner tl">
                <div className="card-rank">{card.rank}</div>
                <div className="card-suit-sm">{card.suit}</div>
              </div>
              <div className="card-suit-lg">{card.suit}</div>
              <div className="card-corner br">
                <div className="card-rank">{card.rank}</div>
                <div className="card-suit-sm">{card.suit}</div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PLAYER AREA
// ─────────────────────────────────────────────
function PlayerArea({ player, isActive, isCabo, onCardClick, selectables, revealed, sm, botTargets }) {
  const revSet = new Set((revealed || []).map(r => r.cardIdx));
  const cls = ['player-area', isActive && 'is-active', isCabo && 'cabo-caller'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="player-info">
        {isActive && <div className="turn-dot" />}
        <span className="player-name">{player.name}</span>
        {player.score !== null && <span className="player-score-badge">{player.score} pts</span>}
      </div>
      <div className="hand-grid">
        {player.hand.map((card, idx) => {
          const faceUp = player.score !== null || revSet.has(idx);
          const selectable = selectables?.includes(idx);
          return (
            <CardComp
              key={card.id ?? idx}
              card={card}
              faceUp={faceUp}
              sm={sm}
              selected={selectable}
              botTarget={botTargets?.includes(idx)}
              onClick={selectable ? () => onCardClick(idx) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// INTRO SCREEN
// ─────────────────────────────────────────────
const INTRO_CARDS = [
  { suit: '♥', rank: 'A', pos: { top: '7%', left: '5%' },     rot: -28, delay: '0.05s' },
  { suit: '♠', rank: 'A', pos: { top: '2%', left: '40%' },    rot: 6,   delay: '0.15s' },
  { suit: '♦', rank: 'A', pos: { top: '5%', right: '6%' },    rot: 22,  delay: '0.1s'  },
  { suit: '♣', rank: 'A', pos: { bottom: '16%', left: '2%' }, rot: -40, delay: '0.2s'  },
  { suit: '♦', rank: 'A', pos: { bottom: '8%', right: '7%' }, rot: 16,  delay: '0.25s' },
];

function IntroScreen({ onDone }) {
  const [zooming, setZooming] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setZooming(true), 2400);
    const t2 = setTimeout(() => onDone(), 3150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);
  const skip = () => { setZooming(true); setTimeout(onDone, 750); };
  return (
    <div className={`intro-root${zooming ? ' intro-zoom' : ''}`}>
      <div className="intro-glow" />
      <div className="intro-lines" />
      {INTRO_CARDS.map((c, i) => {
        const red = c.suit === '♥' || c.suit === '♦';
        return (
          <div key={i} style={{ position: 'absolute', ...c.pos }}>
            <div style={{ transform: `rotate(${c.rot}deg)` }}>
              <div className="ifc-wrap" style={{ animationDelay: c.delay }}>
                <div className={`ifc-card${red ? ' red' : ' black'}`}>
                  <div className="ifc-corner ifc-tl"><span className="ifc-rank">{c.rank}</span><span className="ifc-s">{c.suit}</span></div>
                  <div className="ifc-big">{c.suit}</div>
                  <div className="ifc-corner ifc-br"><span className="ifc-rank">{c.rank}</span><span className="ifc-s">{c.suit}</span></div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="intro-title">
        <div className="intro-cabo">CABO</div>
        <div className="intro-tagline">THE CARD GAME</div>
      </div>
      <button className="intro-skip" onClick={skip}>Skip →</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// CUSTOM RULES PANEL
// ─────────────────────────────────────────────
const POWERS = [
  { val: 'swap', label: 'None (Just Swap)' },
  { val: 'peekOwn', label: 'Peek at your card' },
  { val: 'peekOpp', label: 'Peek at Opponent' },
  { val: 'blindSwap', label: 'Blind Swap' },
  { val: 'seeingSwap', label: 'Seeing Swap' },
  { val: 'king', label: 'Keep or Discard' },
];

function CustomRulesPanel({ show, rules, setRules, onBack, onStart }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { if (show) setMounted(true); }, [show]);
  const introText = "Welcome to the underground. Set your own rules for the game...";
  const typedIntro = useTypewriter(show ? introText : '', 45);
  if (!mounted && !show) return null;
  const handleChange = (card, val) => setRules(prev => ({ ...prev, [card]: val }));
  const crConfig = [
    { keys: ['7', '8'], label: '7 & 8', hint: 'Default: Peek Own' },
    { keys: ['9', '10'], label: '9 & 10', hint: 'Default: Peek Opponent' },
    { keys: ['J'], label: 'Jack', hint: 'Default: Blind Swap' },
    { keys: ['Q'], label: 'Queen', hint: 'Default: Seeing Swap' },
    { keys: ['K'], label: 'King', hint: 'Default: Keep/Discard' },
    { keys: ['JOKER'], label: 'Joker', hint: 'Default: Just Swap' },
  ];
  return (
    <div className={`cr-panel ${show ? 'cr-in' : ''}`} onTransitionEnd={() => { if (!show) setMounted(false); }}>
      <div className="cr-bg" />
      <video autoPlay loop muted playsInline className="cr-video-bg" src="/brick-bg.mp4" />
      <div className="cr-dim" />
      <div className="cr-body">
        <div className="cr-chalk-line">
          <div className="cr-chalk-title">CUSTOM RULES</div>
          <div className="cr-chalk-sub">{typedIntro}{typedIntro.length < introText.length && <span className="cr-caret">|</span>}</div>
        </div>
        <div className="cr-grid">
          {crConfig.map(cfg => (
            <div key={cfg.label} className="cr-card-item">
              <div className="cr-card-name">{cfg.label}</div>
              <div className="cr-card-hint">{cfg.hint}</div>
              <select className="cr-select" value={rules[cfg.keys[0]] || 'swap'} onChange={(e) => { const val = e.target.value; cfg.keys.forEach(k => handleChange(k, val)); }}>
                {POWERS.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="cr-btns">
          <button className="btn btn-ghost btn-lg" onClick={onBack}>← Back to Lobby</button>
          <button className="btn btn-gold btn-lg" onClick={onStart}>▶ Start with Custom Rules</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GAME INTRO SCREEN
// ─────────────────────────────────────────────
function GameIntroScreen({ dispatch }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 4500);
    const t2 = setTimeout(() => dispatch({ type: 'FINISH_GAME_INTRO' }), 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [dispatch]);
  const skip = () => { setFading(true); setTimeout(() => dispatch({ type: 'FINISH_GAME_INTRO' }), 500); };
  return (
    <div className={`game-intro-root ${fading ? 'fade-out' : ''}`}>
      <video autoPlay loop muted playsInline className="game-intro-vid" src="/intro-bg.mp4" />
      <button className="intro-skip" onClick={skip}>Skip →</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// ONLINE LOBBY
// ─────────────────────────────────────────────
function OnlineLobby({ playerName, onBack, onConnect }) {
  const [subMode, setSubMode] = useState('menu'); // 'menu' | 'create' | 'join'
  const [createdCode, setCreatedCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const connect = (code) => {
    setError('');
    onConnect(code.toUpperCase(), playerName);
  };

  const createRoom = () => {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    setCreatedCode(code);
    setSubMode('create');
    connect(code);
  };

  const joinRoom = () => {
    const code = joinInput.trim().toUpperCase();
    if (code.length < 4) { setError('Enter a valid room code'); return; }
    setSubMode('join');
    connect(code);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(createdCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lobby-root">
      <div className="lobby-card">
        <div className="lobby-brand">
          <h1>CABO</h1>
          <p>Play Online with a Friend</p>
        </div>

        {subMode === 'menu' && (
          <>
            <button className="btn btn-gold btn-lg ol-big-btn" onClick={createRoom}>
              🎲 Create a Room
            </button>
            <div className="ol-divider"><span>or</span></div>
            <div className="ol-join-row">
              <input
                className="form-input"
                placeholder="Enter room code (e.g. AB3XK)"
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && joinRoom()}
                maxLength={8}
                style={{ flex: 1 }}
              />
              <button className="btn btn-teal" onClick={joinRoom}>Join →</button>
            </div>
            {error && <div className="ol-error">{error}</div>}
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onBack}>← Back</button>
          </>
        )}

        {(subMode === 'create' || subMode === 'join') && (
          <div className="ol-connecting">
            <div className="ol-spinner" />
            <div className="ol-connect-msg">
              {subMode === 'create' ? 'Room created! Waiting for connection…' : `Joining room ${joinInput.toUpperCase()}…`}
            </div>
            {subMode === 'create' && (
              <div className="ol-code-box">
                <div className="ol-code-label">Share this code with your friend:</div>
                <div className="ol-code-value">{createdCode}</div>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={copyCode}>
                  {copied ? '✓ Copied!' : '📋 Copy Code'}
                </button>
              </div>
            )}
            <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={onBack}>← Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// WAITING ROOM (after socket connected, before game starts)
// ─────────────────────────────────────────────
function WaitingRoom({ roomId, mySlot, players, onStartGame, onLeave }) {
  const [copied, setCopied] = useState(false);
  const isHost = mySlot === 0;
  const bothConnected = players.length >= 2;

  const copyCode = () => {
    navigator.clipboard.writeText(roomId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lobby-root">
      <div className="lobby-card">
        <div className="lobby-brand">
          <h1>CABO</h1>
          <p>Waiting Room</p>
        </div>

        <div className="ol-code-box" style={{ marginBottom: 20 }}>
          <div className="ol-code-label">Room Code</div>
          <div className="ol-code-value">{roomId}</div>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={copyCode}>
            {copied ? '✓ Copied!' : '📋 Copy Code'}
          </button>
        </div>

        <div className="wr-players">
          {[0, 1].map(slot => {
            const p = players.find(pl => pl.slot === slot);
            return (
              <div key={slot} className={`wr-player-row ${p ? 'connected' : 'waiting'}`}>
                <div className="wr-dot" />
                <span>{p ? p.name : `Waiting for Player ${slot + 1}…`}</span>
                {slot === mySlot && <span className="wr-you-badge">You</span>}
              </div>
            );
          })}
        </div>

        {isHost && bothConnected && (
          <button className="btn btn-gold btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 20 }} onClick={onStartGame}>
            ▶ Start Game
          </button>
        )}
        {isHost && !bothConnected && (
          <div className="ol-connect-msg" style={{ marginTop: 16 }}>Waiting for your friend to join…</div>
        )}
        {!isHost && (
          <div className="ol-connect-msg" style={{ marginTop: 16 }}>Waiting for the host to start…</div>
        )}

        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onLeave}>← Leave Room</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LOBBY
// ─────────────────────────────────────────────
function Lobby({ state, dispatch, onGoOnline }) {
  const [n, setN] = useState(2);
  const [names, setNames] = useState(['', '', '', '']);
  const [mode, setMode] = useState('standard');
  const [customRules, setCustomRules] = useState({ ...DEFAULT_RULES });

  const updateName = (i, v) => setNames(prev => { const a = [...prev]; a[i] = v; return a; });
  const start = () => {
    dispatch({
      type: 'START_GAME',
      payload: { numPlayers: n, names, rules: mode === 'custom' ? customRules : DEFAULT_RULES }
    });
  };

  return (
    <>
      <div className="lobby-root">
        <div className="lobby-card">
          <div className="lobby-brand">
            <h1>CABO</h1>
            <p>The card game of memory &amp; cunning</p>
          </div>

          <div className="mode-row">
            <button className={`mode-btn ${mode === 'standard' ? 'active' : ''}`} onClick={() => setMode('standard')}>Standard Rules</button>
            <button className={`mode-btn ${mode === 'custom' ? 'active' : ''}`} onClick={() => setMode('custom')}>Custom Rules 🛠️</button>
          </div>

          <div className="form-row">
            <div className="form-label">Number of Players</div>
            <div className="count-btns">
              {[2,3,4].map(x => (
                <button key={x} className={`count-btn${n === x ? ' active' : ''}`} onClick={() => setN(x)}>{x}</button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="form-label">Your Name</div>
            <input className="form-input" placeholder="Enter your name" value={names[0]} onChange={e => updateName(0, e.target.value)} />
          </div>

          {mode === 'standard' ? (
            <div className="rules-box">
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Card Powers</div>
              {[
                ['1–6', 'Swap with your card OR discard'],
                ['7–8', 'Peek at one of YOUR cards'],
                ['9–10', 'Peek at an OPPONENT\'s card'],
                ['J', 'Blind swap (no looking)'],
                ['Q', 'Seeing swap (look first)'],
                ['K', 'Keep (swap in) or Discard'],
                ['K♦', '0 points — the best card!'],
                ['🃏', '−1 point — even better!'],
              ].map(([k, v]) => (
                <div key={k} className="rule-row"><span className="rule-key">{k}</span><span>{v}</span></div>
              ))}
            </div>
          ) : (
            <div className="cr-badge">
              <span>Custom Rules active.</span>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setMode('custom')}>Edit Config</button>
            </div>
          )}

          <button className="btn btn-gold btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={mode === 'custom' ? undefined : start}>
            {mode === 'custom' ? 'Configure Rules ➔' : '▶ Start Game vs Bots'}
          </button>

          <div className="ol-divider"><span>or</span></div>

          <button
            className="btn btn-online btn-lg"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => onGoOnline(names[0])}
          >
            🌐 Invite a Friend — Play Online
          </button>
        </div>
      </div>

      <CustomRulesPanel
        show={mode === 'custom'}
        rules={customRules}
        setRules={setCustomRules}
        onBack={() => setMode('standard')}
        onStart={start}
      />
    </>
  );
}

// ─────────────────────────────────────────────
// PEEK OVERLAY
// ─────────────────────────────────────────────
function PeekOverlay({ state, dispatch, mySlot = 0 }) {
  const { peekState, players, reveals } = state;
  if (!peekState) return null;
  const pIdx = peekState.idx;
  const player = players[pIdx];
  if (player.isAI) return null;
  if (pIdx !== mySlot) return null; // not my peek turn
  const revSet = new Set(reveals.filter(r => r.playerIdx === pIdx).map(r => r.cardIdx));
  const done = peekState.left <= 0;
  return (
    <div className="peek-overlay">
      <div className="peek-panel">
        <div className="peek-title">🃏 {player.name}, peek at your cards!</div>
        <div className="peek-sub">
          {done ? 'Remember them well! Click Done when ready.' : `Click ${peekState.left === 2 ? 'any 2' : '1 more'} card to see its value.`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="peek-badge">{peekState.left}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>cards left to peek</span>
        </div>
        <div className="peek-grid">
          {player.hand.map((card, idx) => {
            const isRevealed = revSet.has(idx);
            const alreadyKnown = player.known[idx] && !isRevealed;
            return (
              <CardComp
                key={card.id ?? idx}
                card={card}
                faceUp={isRevealed}
                onClick={!isRevealed && !alreadyKnown && !done ? () => dispatch({ type: 'PEEK_CARD', payload: { cardIdx: idx } }) : undefined}
                selected={isRevealed}
              />
            );
          })}
        </div>
        {done && (
          <button className="btn btn-gold" onClick={() => dispatch({ type: 'ADVANCE_PEEK' })}>
            Done, I remember! →
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// REVEAL SCREEN
// ─────────────────────────────────────────────
function RevealScreen({ state, dispatch }) {
  const { players, winner } = state;
  const sorted = [...players].sort((a, b) => a.score - b.score);
  return (
    <div className="reveal-root">
      <div className="reveal-panel">
        <div className="reveal-heading">🏆 Game Over!</div>
        <div className="reveal-sub">
          <span>{winner.name}</span> wins with the lowest score of <span>{winner.score}</span> pts!
        </div>
        <div className="score-rows">
          {sorted.map(p => (
            <div key={p.id} className={`score-row${p.id === winner.id ? ' is-winner' : ''}`}>
              <div className="score-row-top">
                <span className="score-name">{p.id === winner.id ? '👑 ' : ''}{p.name}</span>
                <span className="score-total">{p.score} pts</span>
              </div>
              <div className="score-cards-row">
                {p.hand.map((card, i) => <CardComp key={card.id ?? i} card={card} faceUp sm />)}
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-gold btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={() => dispatch({ type: 'PLAY_AGAIN' })}>
          ↩ Play Again
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GAME BOARD
// ─────────────────────────────────────────────
function GameBoard({ state, dispatch, mySlot = 0 }) {
  const { players, deck, pile, currentPlayerIdx, drawn, step, ctx, caboBy, reveals, msg, phase } = state;
  const isHumanActive = ['play','cabo'].includes(phase) && currentPlayerIdx === mySlot;
  const isHumanTurn = isHumanActive && step === 'idle';
  const pileTop = pile.length > 0 ? pile[pile.length - 1] : null;
  const opponents = players.filter((_, i) => i !== mySlot);

  const [timeLeft, setTimeLeft] = useState(40);

  useEffect(() => {
    if (!isHumanTurn) { setTimeLeft(40); return; }
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); dispatch({ type: 'SKIP_TURN' }); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isHumanTurn, dispatch]);

  // Bot turn effects (only fires when isAI is true, which is never in multiplayer)
  useEffect(() => {
    if (!['play','cabo'].includes(phase)) return;
    const p = players[currentPlayerIdx];
    if (!p?.isAI) return;
    let timer;
    if (step === 'idle') timer = setTimeout(() => dispatch({ type: 'BOT_START' }), 1200);
    else if (step === 'bot_draw' || step === 'bot_cabo') timer = setTimeout(() => dispatch({ type: 'BOT_DRAW' }), 1500);
    else if (step === 'bot_action') timer = setTimeout(() => dispatch({ type: 'BOT_ACTION' }), 2000);
    else if (step === 'bot_end') timer = setTimeout(() => dispatch({ type: 'BOT_END' }), 1800);
    return () => clearTimeout(timer);
  }, [phase, currentPlayerIdx, step, dispatch, players]);

  // Mask reveals that belong to the opponent's private peek actions
  const safeReveals = (currentPlayerIdx !== mySlot && reveals.length > 0)
    ? reveals.filter(r => r.playerIdx === mySlot)
    : reveals;

  const revFor = (pIdx) => safeReveals.filter(r => r.playerIdx === pIdx);

  const getSelectables = (pIdx) => {
    if (!isHumanActive) return [];
    if (pIdx === mySlot) {
      if (['swap','king_sel'].includes(step)) return [0,1,2,3,4,5];
      if (step === 'peekOwn') return players[mySlot].known.map((k,i) => !k ? i : null).filter(x => x !== null);
      if (step === 'bSwap_own') return [0,1,2,3,4,5];
      if (step === 'sSwap_own') return [0,1,2,3,4,5];
    } else {
      if (['peekOpp_sel','bSwap_opp','sSwap_opp'].includes(step)) return [0,1,2,3,4,5];
    }
    return [];
  };

  const handleHumanCard = (cardIdx) => {
    if (step === 'swap' || step === 'king_sel') dispatch({ type: 'SWAP_WITH_HAND', payload: { cardIdx } });
    else if (step === 'peekOwn') dispatch({ type: 'PEEK_OWN_SELECT', payload: { cardIdx } });
    else if (step === 'bSwap_own') dispatch({ type: 'BSWAP_OWN', payload: { cardIdx } });
    else if (step === 'sSwap_own') dispatch({ type: 'SSWAP_OWN', payload: { cardIdx } });
  };

  const handleOppCard = (oppIdx, cardIdx) => {
    if (step === 'peekOpp_sel') dispatch({ type: 'PEEK_OPP_SELECT', payload: { oppIdx, cardIdx } });
    else if (step === 'bSwap_opp') dispatch({ type: 'BSWAP_OPP', payload: { oppIdx, cardIdx } });
    else if (step === 'sSwap_opp') dispatch({ type: 'SSWAP_OPP', payload: { oppIdx, cardIdx } });
  };

  return (
    <div className="game-root">
      <div className="game-header">
        <div><div className="game-title">CABO</div></div>
        <div className="header-right">
          {phase === 'cabo' && (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--crimson)', background: 'rgba(230,57,70,0.12)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(230,57,70,0.3)' }}>
              🔴 LAST ROUND
            </span>
          )}
          {isHumanTurn && step === 'idle' && caboBy === null && (
            <button className="btn btn-purple" id="cabo-btn" onClick={() => dispatch({ type: 'CALL_CABO' })}>
              📣 Call CABO
            </button>
          )}
          <div className="deck-info">🂠 {deck.length} left</div>
        </div>
      </div>

      <div className="game-body">
        <div className="opponents-row">
          {opponents.map(opp => (
            <PlayerArea
              key={opp.id}
              player={opp}
              isActive={currentPlayerIdx === opp.id}
              isCabo={caboBy === opp.id}
              selectables={getSelectables(opp.id)}
              revealed={revFor(opp.id)}
              onCardClick={(cIdx) => handleOppCard(opp.id, cIdx)}
              botTargets={
                (opp.isAI && opp.id === currentPlayerIdx && ctx.botSwap !== undefined) ? [ctx.botSwap] :
                (opp.isAI && opp.id === currentPlayerIdx && ctx.botPeek !== undefined) ? [ctx.botPeek] :
                (opp.isAI && opp.id === currentPlayerIdx && ctx.botBlindSwapOwn !== undefined) ? [ctx.botBlindSwapOwn] :
                (!opp.isAI && ctx.botBlindSwapOpp === opp.id && ctx.botBlindSwapOppCard !== undefined) ? [ctx.botBlindSwapOppCard] : []
              }
            />
          ))}
        </div>

        <div className="center-zone">
          <div className="deck-pile-row">
            <div className="deck-pile-col">
              {deck.length > 0 ? (
                <div onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_DECK' }) : undefined} style={{ cursor: isHumanTurn && step === 'idle' ? 'pointer' : 'default' }}>
                  <CardComp card={deck[0]} faceUp={false} onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_DECK' }) : undefined} />
                </div>
              ) : <div className="empty-card">Empty</div>}
              <div className="pile-label">Draw Deck</div>
            </div>

            {drawn && (
              <div className="drawn-display anim-in">
                <div className="drawn-label">⚡ Just Drew</div>
                <CardComp card={drawn.card} faceUp />
              </div>
            )}
            {!drawn && <div className="center-sep" />}

            <div className="deck-pile-col">
              {pileTop ? (
                <div onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_PILE' }) : undefined} style={{ cursor: isHumanTurn && step === 'idle' ? 'pointer' : 'default' }}>
                  <CardComp card={pileTop} faceUp onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_PILE' }) : undefined} />
                </div>
              ) : <div className="empty-card">Empty</div>}
              <div className="pile-label">Discard Pile</div>
            </div>
          </div>

          <div className="action-panel">
            <div className="msg-box">{msg}</div>
            {isHumanTurn && (
              <div className="timer-wrap">
                <div className="timer-bar" style={{ width: `${(timeLeft / 40) * 100}%` }} />
              </div>
            )}
            <div className="action-btns">
              {step === 'swap' && drawn?.from !== 'pile' && (
                <button className="btn btn-danger" id="discard-btn" onClick={() => dispatch({ type: 'DISCARD_DRAWN' })}>🗑 Discard It</button>
              )}
              {step === 'king' && (
                <>
                  <button className="btn btn-teal" onClick={() => dispatch({ type: 'KING_KEEP' })}>Keep King →</button>
                  <button className="btn btn-danger" onClick={() => dispatch({ type: 'KING_DISCARD' })}>🗑 Discard</button>
                </>
              )}
              {(step === 'peekReveal' || step === 'oppPeekReveal') && (
                <button className="btn btn-gold" onClick={() => dispatch({ type: 'END_PEEK_REVEAL' })}>Got it! ✓</button>
              )}
              {step === 'sSwap_confirm' && (
                <>
                  <button className="btn btn-green" onClick={() => dispatch({ type: 'SSWAP_CONFIRM', payload: { doSwap: true } })}>✅ Swap Cards</button>
                  <button className="btn btn-ghost" onClick={() => dispatch({ type: 'SSWAP_CONFIRM', payload: { doSwap: false } })}>✗ Don't Swap</button>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <PlayerArea
            player={players[mySlot]}
            isActive={currentPlayerIdx === mySlot}
            isCabo={caboBy === mySlot}
            selectables={getSelectables(mySlot)}
            revealed={revFor(mySlot)}
            onCardClick={handleHumanCard}
            botTargets={
              (ctx.botBlindSwapOpp === mySlot && ctx.botBlindSwapOppCard !== undefined) ? [ctx.botBlindSwapOppCard] : []
            }
          />
        </div>
      </div>

      {state.phase === 'peek' && <PeekOverlay state={state} dispatch={dispatch} mySlot={mySlot} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────
export default function Home() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const [showIntro, setShowIntro] = useState(true);

  // ── Multiplayer state ──
  const [onlineMode, setOnlineMode] = useState(false);  // true = show online lobby UI
  const [mpConnected, setMpConnected] = useState(false); // true = socket is open
  const [mySlot, setMySlot] = useState(0);
  const [mpRoomId, setMpRoomId] = useState('');
  const [mpPlayers, setMpPlayers] = useState([]);
  const [mpRoomPhase, setMpRoomPhase] = useState('waiting');
  const [mpState, setMpState] = useState(null);
  const [mpPlayerLeft, setMpPlayerLeft] = useState(false);
  const [mpPlayerName, setMpPlayerName] = useState('');
  const socketRef = useRef(null);

  const mpDispatch = useCallback((action) => {
    socketRef.current?.send(JSON.stringify({ type: 'ACTION', action }));
  }, []);

  const connectToRoom = useCallback((roomId, playerName) => {
    // Close any existing connection
    socketRef.current?.close();
    setMpPlayerLeft(false);

    const host = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PARTYKIT_HOST) || 'localhost:1999';
    const socket = new PartySocket({ host, room: roomId });
    socketRef.current = socket;
    setMpRoomId(roomId);
    setMpPlayerName(playerName || 'Player');

    socket.addEventListener('open', () => {
      // Send our name once connected
      socket.send(JSON.stringify({ type: 'SET_NAME', name: playerName || 'Player' }));
    });

    socket.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'CONNECTED') {
        setMySlot(msg.slot);
        setMpConnected(true);
        if (msg.roomPhase) setMpRoomPhase(msg.roomPhase);
        if (msg.players) setMpPlayers(msg.players);
        if (msg.gameState) setMpState(msg.gameState);
      }
      if (msg.type === 'ROOM_UPDATE') {
        if (msg.roomPhase) setMpRoomPhase(msg.roomPhase);
        if (msg.players) setMpPlayers(msg.players);
      }
      if (msg.type === 'STATE') {
        setMpState(msg.state);
        setMpRoomPhase('playing');
      }
      if (msg.type === 'PLAYER_LEFT') {
        setMpPlayerLeft(true);
      }
    });

    socket.addEventListener('close', () => {
      setMpConnected(false);
    });
  }, []);

  const leaveOnline = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setOnlineMode(false);
    setMpConnected(false);
    setMpState(null);
    setMpRoomId('');
    setMpPlayers([]);
    setMpRoomPhase('waiting');
    setMpPlayerLeft(false);
  }, []);

  const startMpGame = useCallback(() => {
    socketRef.current?.send(JSON.stringify({ type: 'START_GAME', rules: DEFAULT_RULES }));
  }, []);

  // Determine active state and dispatch
  const isMultiplayer = onlineMode && mpConnected && mpRoomPhase === 'playing' && mpState;
  const activeState = isMultiplayer ? mpState : state;
  const activeDispatch = isMultiplayer ? mpDispatch : dispatch;

  // Local bot AI effect (single-player only)
  useEffect(() => {
    if (isMultiplayer) return;
    if (!['play','cabo'].includes(state.phase)) return;
    const cur = state.players?.[state.currentPlayerIdx];
    if (!cur?.isAI || state.step !== 'idle') return;
    const t = setTimeout(() => dispatch({ type: 'AI_TURN' }), 1100);
    return () => clearTimeout(t);
  }, [state.currentPlayerIdx, state.step, state.phase, isMultiplayer]);

  // ── Render ──

  if (showIntro) return <IntroScreen onDone={() => setShowIntro(false)} />;

  // Player left mid-game notification
  if (isMultiplayer && mpPlayerLeft) {
    return (
      <div className="lobby-root">
        <div className="lobby-card">
          <div className="lobby-brand"><h1>CABO</h1></div>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>😢</div>
            <div style={{ fontSize: 16, marginBottom: 20, color: 'var(--text)' }}>Your friend disconnected.</div>
            <button className="btn btn-gold btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={leaveOnline}>← Back to Lobby</button>
          </div>
        </div>
      </div>
    );
  }

  // Online: show waiting room
  if (onlineMode && mpConnected && mpRoomPhase === 'waiting') {
    return (
      <WaitingRoom
        roomId={mpRoomId}
        mySlot={mySlot}
        players={mpPlayers}
        onStartGame={startMpGame}
        onLeave={leaveOnline}
      />
    );
  }

  // Online: connecting / waiting to connect
  if (onlineMode && !mpConnected) {
    return (
      <OnlineLobby
        playerName={mpPlayerName}
        onBack={leaveOnline}
        onConnect={connectToRoom}
      />
    );
  }

  // Main offline lobby
  if (!isMultiplayer && activeState.phase === 'lobby') {
    return (
      <Lobby
        state={state}
        dispatch={dispatch}
        onGoOnline={(name) => {
          setMpPlayerName(name || 'Player');
          setOnlineMode(true);
        }}
      />
    );
  }

  if (activeState.phase === 'game_intro') return <GameIntroScreen dispatch={activeDispatch} />;
  if (activeState.phase === 'reveal') return <RevealScreen state={activeState} dispatch={activeDispatch} />;

  return <GameBoard state={activeState} dispatch={activeDispatch} mySlot={isMultiplayer ? mySlot : 0} />;
}
