'use client';
import { useReducer, useEffect, useState } from 'react';
import { createDeck, shuffle, cardValue, cardPower, handScore, isRed, DEFAULT_RULES } from './lib/engine';

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
// HELPERS
// ─────────────────────────────────────────────
function cp(players) {
  return players.map(p => ({ ...p, hand: [...p.hand], known: [...p.known] }));
}

function endTurn(state) {
  const { phase, players, currentPlayerIdx, caboBy, lastRound } = state;
  if (phase === 'cabo') {
    if (lastRound.length === 0) return revealGame(state);
    const next = lastRound[0];
    return {
      ...state,
      currentPlayerIdx: next,
      lastRound: lastRound.slice(1),
      drawn: null, step: 'idle', ctx: {}, reveals: [],
      msg: players[next].isAI
        ? `${players[next].name} is thinking…`
        : `⚡ ${players[next].name}: Your LAST turn!`,
    };
  }
  const next = (currentPlayerIdx + 1) % players.length;
  return {
    ...state,
    currentPlayerIdx: next,
    drawn: null, step: 'idle', ctx: {}, reveals: [],
    msg: players[next].isAI
      ? `${players[next].name} is thinking…`
      : `${players[next].name}'s turn — Draw a card or call CABO.`,
  };
}

function revealGame(state) {
  const players = state.players.map(p => ({
    ...p, known: [true, true, true, true, true, true],
    score: handScore(p.hand),
  }));
  const minScore = Math.min(...players.map(p => p.score));
  const winner = players.find(p => p.score === minScore);
  return {
    ...state, phase: 'reveal', players,
    drawn: null, step: 'idle', ctx: {}, reveals: [], winner,
    msg: `🏆 ${winner.name} wins with ${winner.score} points!`,
  };
}

function swapHandCard(state, drawnCard, pIdx, cIdx) {
  const players = cp(state.players);
  const old = players[pIdx].hand[cIdx];
  players[pIdx].hand[cIdx] = drawnCard;
  players[pIdx].known[cIdx] = true;
  return endTurn({
    ...state, players,
    pile: [...state.pile, old],
    drawn: null,
    msg: `Swapped! ${old.rank}${old.suit || ''} discarded.`,
  });
}

function doBlindSwap(state, aIdx, aCIdx, tIdx, tCIdx) {
  const players = cp(state.players);
  const aC = players[aIdx].hand[aCIdx];
  const tC = players[tIdx].hand[tCIdx];
  players[aIdx].hand[aCIdx] = tC;
  players[tIdx].hand[tCIdx] = aC;
  players[aIdx].known[aCIdx] = false;
  players[tIdx].known[tCIdx] = false;
  const pile = state.drawn ? [...state.pile, state.drawn.card] : [...state.pile];
  return endTurn({ ...state, players, pile, drawn: null, msg: `Blind swap done!` });
}

function doSeeingSwap(state, aIdx, aCIdx, tIdx, tCIdx, doSwap) {
  if (!doSwap) {
    const pile = state.drawn ? [...state.pile, state.drawn.card] : [...state.pile];
    return endTurn({ ...state, pile, drawn: null, reveals: [], msg: `Chose not to swap.` });
  }
  const players = cp(state.players);
  const aC = players[aIdx].hand[aCIdx];
  const tC = players[tIdx].hand[tCIdx];
  players[aIdx].hand[aCIdx] = tC;
  players[tIdx].hand[tCIdx] = aC;
  players[aIdx].known[aCIdx] = true;
  players[tIdx].known[tCIdx] = false;
  const pile = state.drawn ? [...state.pile, state.drawn.card] : [...state.pile];
  return endTurn({ ...state, players, pile, drawn: null, reveals: [], msg: `Cards swapped!` });
}

function callCabo(state) {
  const { currentPlayerIdx, players } = state;
  const lr = [];
  let i = (currentPlayerIdx + 1) % players.length;
  while (i !== currentPlayerIdx) { lr.push(i); i = (i + 1) % players.length; }
  if (lr.length === 0) return revealGame({ ...state, caboBy: currentPlayerIdx });
  const next = lr[0];
  return {
    ...state,
    caboBy: currentPlayerIdx, lastRound: lr.slice(1),
    currentPlayerIdx: next, phase: 'cabo',
    drawn: null, step: 'idle', ctx: {}, reveals: [],
    msg: `📣 ${players[currentPlayerIdx].name} called CABO! ${players[next].name}'s last turn.`,
  };
}

// ─────────────────────────────────────────────
// AI LOGIC
// ─────────────────────────────────────────────
function aiTurn(state) {
  const { players, currentPlayerIdx, pile, deck } = state;
  const me = players[currentPlayerIdx];
  const unknownCnt = me.known.filter(k => !k).length;
  const knownScore = me.hand.reduce((s, c, i) => me.known[i] ? s + cardValue(c) : s, 0);

  // Call CABO?
  if (state.caboBy === null && unknownCnt === 0 && knownScore <= 14) {
    return callCabo(state);
  }

  // Draw
  const pileTop = pile.length > 0 ? pile[pile.length - 1] : null;
  let drawnCard, drawnFrom, nd = [...deck], np = [...pile];

  if (pileTop && cardValue(pileTop) <= 0) {
    drawnCard = pileTop; drawnFrom = 'pile'; np = pile.slice(0, -1);
  } else {
    if (nd.length === 0) {
      if (np.length <= 1) return endTurn(state);
      const top = np[np.length - 1];
      nd = shuffle(np.slice(0, -1)); np = [top];
    }
    drawnCard = nd[0]; drawnFrom = 'deck'; nd = nd.slice(1);
  }

  const power = drawnFrom === 'pile' ? 'swap' : cardPower(drawnCard, state.rules);
  const ts = { ...state, deck: nd, pile: np };

  if (power === 'swap' || power === 'king') {
    const dv = cardValue(drawnCard);
    let bestIdx = -1, bestVal = dv;
    for (let i = 0; i < 6; i++) {
      if (me.known[i] && cardValue(me.hand[i]) > bestVal) {
        bestVal = cardValue(me.hand[i]); bestIdx = i;
      }
    }
    if (bestIdx >= 0) return swapHandCard(ts, drawnCard, currentPlayerIdx, bestIdx);
    if (drawnFrom === 'pile') {
      const ui = me.known.findIndex(k => !k);
      return swapHandCard(ts, drawnCard, currentPlayerIdx, ui >= 0 ? ui : 0);
    }
    if (power === 'king' && drawnCard.suit === '♦') {
      let wi = -1, wv = 1;
      for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; }
      if (wi >= 0) return swapHandCard(ts, drawnCard, currentPlayerIdx, wi);
    }
    return endTurn({ ...ts, pile: [...np, drawnCard], drawn: null, msg: `${me.name} discarded.` });
  }

  if (power === 'peekOwn') {
    const ui = me.known.findIndex(k => !k);
    const pi = ui >= 0 ? ui : 0;
    const pl = cp(ts.players);
    pl[currentPlayerIdx].known[pi] = true;
    return endTurn({ ...ts, players: pl, pile: [...np, drawnCard], drawn: null, msg: `${me.name} peeked at own card.` });
  }

  if (power === 'peekOpp') {
    return endTurn({ ...ts, pile: [...np, drawnCard], drawn: null, msg: `${me.name} peeked at opponent's card.` });
  }

  if (power === 'blindSwap') {
    let wi = 0, wv = -99;
    for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; }
    const oppIdx = (currentPlayerIdx + 1) % players.length;
    const withDrawn = { ...ts, drawn: { card: drawnCard, from: 'deck' } };
    return doBlindSwap(withDrawn, currentPlayerIdx, wi, oppIdx, 0);
  }

  if (power === 'seeingSwap') {
    let wi = 0, wv = -99;
    for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; }
    const oppIdx = (currentPlayerIdx + 1) % players.length;
    const oppVal = cardValue(players[oppIdx].hand[0]);
    const withDrawn = { ...ts, drawn: { card: drawnCard, from: 'deck' } };
    return doSeeingSwap(withDrawn, currentPlayerIdx, wi, oppIdx, 0, oppVal < wv);
  }

  return endTurn({ ...ts, pile: [...np, drawnCard], drawn: null, msg: `${me.name} discarded.` });
}

// ─────────────────────────────────────────────
// PEEK ADVANCE
// ─────────────────────────────────────────────
function advancePeek(state) {
  const { peekState, players } = state;
  const next = peekState.idx + 1;
  if (next >= players.length) {
    return {
      ...state, phase: 'play', peekState: null, reveals: [],
      currentPlayerIdx: 0, step: 'idle',
      msg: `${players[0].name}'s turn — Draw a card or call CABO.`,
    };
  }
  if (players[next].isAI) {
    return advancePeek({ ...state, peekState: { idx: next, left: 0 } });
  }
  return { ...state, peekState: { idx: next, left: 2 }, reveals: [], msg: `${players[next].name}: Peek at 2 of your cards.` };
}

// ─────────────────────────────────────────────
// REDUCER
// ─────────────────────────────────────────────
const INIT = { phase: 'lobby', numPlayers: 2, rules: DEFAULT_RULES };

function reducer(state, action) {
  const { type, payload = {} } = action;
  switch (type) {

    case 'SET_NUM': return { ...state, numPlayers: payload.n };

    case 'START_GAME': {
      const { numPlayers, names, rules = DEFAULT_RULES } = payload;
      const deck = createDeck();
      const players = [];
      for (let i = 0; i < numPlayers; i++) {
        const hand = deck.splice(0, 6);
        const name = names[i]?.trim() || (i === 0 ? 'You' : `Bot ${i}`);
        const isAI = i > 0;
        const known = Array(6).fill(false);
        if (isAI) { known[0] = true; known[1] = true; }
        players.push({ id: i, name, isAI, hand, known, score: null });
      }
      const topCard = deck.splice(0, 1)[0];
      return {
        phase: 'game_intro', players, deck, pile: [topCard],
        currentPlayerIdx: 0, drawn: null, step: 'idle',
        ctx: {}, caboBy: null, lastRound: [], rules,
        peekState: { idx: 0, left: 2 }, reveals: [], winner: null, numPlayers,
        msg: `${players[0].name}: Peek at 2 of your face-down cards.`,
      };
    }

    case 'FINISH_GAME_INTRO': {
      return { ...state, phase: 'peek' };
    }

    case 'PEEK_CARD': {
      if (state.phase !== 'peek') return state;
      const { cardIdx } = payload;
      const pIdx = state.peekState.idx;
      const p = state.players[pIdx];
      if (p.isAI || p.known[cardIdx] || state.peekState.left <= 0) return state;
      const players = cp(state.players);
      players[pIdx].known[cardIdx] = true;
      const left = state.peekState.left - 1;
      return {
        ...state, players,
        peekState: { ...state.peekState, left },
        reveals: [...state.reveals, { playerIdx: pIdx, cardIdx }],
        msg: left > 0 ? `${p.name}: Peek at 1 more card.` : `${p.name}: Nice! Click "Done" when ready.`,
      };
    }

    case 'ADVANCE_PEEK': {
      if (state.peekState?.left > 0) return state;
      return advancePeek(state);
    }

    case 'CALL_CABO': {
      if (!['play','cabo'].includes(state.phase) || state.caboBy !== null || state.step !== 'idle') return state;
      return callCabo(state);
    }

    case 'DRAW_DECK': {
      if (state.step !== 'idle' || !['play','cabo'].includes(state.phase)) return state;
      let { deck, pile } = state;
      if (deck.length === 0) {
        if (pile.length <= 1) return state;
        const top = pile[pile.length - 1];
        deck = shuffle(pile.slice(0, -1)); pile = [top];
      }
      if (deck.length === 0) return state;
      const card = deck[0]; const nd = deck.slice(1);
      const power = cardPower(card, state.rules);
      const steps = { swap:'swap', peekOwn:'peekOwn', peekOpp:'peekOpp_sel', blindSwap:'bSwap_own', seeingSwap:'sSwap_own', king:'king' };
      const msgs = {
        swap: `Drew ${card.rank}${card.suit||''}. Discard it or swap with one of your cards.`,
        peekOwn: `Drew ${card.rank}${card.suit||''}. Click one of YOUR cards to peek.`,
        peekOpp: `Drew ${card.rank}${card.suit||''}. Click an opponent's card to peek at.`,
        blindSwap: `Drew ${card.rank}${card.suit||''}. Select YOUR card, then an opponent's card (blind swap).`,
        seeingSwap: `Drew ${card.rank}${card.suit||''}. Select YOUR card, then an opponent's card (you'll see both).`,
        king: `Drew ${card.rank}${card.suit||''}! Keep it (swap into hand) or Discard it.`,
      };
      return {
        ...state, deck: nd, pile,
        drawn: { card, from: 'deck' },
        step: steps[power] || 'swap',
        ctx: {}, reveals: [],
        msg: msgs[power] || `Drew ${card.rank}.`,
      };
    }

    case 'DRAW_PILE': {
      if (state.step !== 'idle' || !['play','cabo'].includes(state.phase) || state.pile.length === 0) return state;
      const card = state.pile[state.pile.length - 1];
      return {
        ...state,
        pile: state.pile.slice(0, -1),
        drawn: { card, from: 'pile' },
        step: 'swap', ctx: {}, reveals: [],
        msg: `Picked up ${card.rank}${card.suit||''}. Swap it with one of your cards.`,
      };
    }

    case 'DISCARD_DRAWN': {
      if (!state.drawn || !['swap','king'].includes(state.step) || state.drawn.from === 'pile') return state;
      return endTurn({ ...state, pile: [...state.pile, state.drawn.card], drawn: null });
    }

    case 'SWAP_WITH_HAND': {
      if (!state.drawn || !['swap','king_sel'].includes(state.step)) return state;
      return swapHandCard(state, state.drawn.card, state.currentPlayerIdx, payload.cardIdx);
    }

    case 'KING_KEEP': {
      if (state.step !== 'king') return state;
      return { ...state, step: 'king_sel', msg: `Click one of your cards to replace with the King.` };
    }
    case 'KING_DISCARD': {
      if (state.step !== 'king') return state;
      return endTurn({ ...state, pile: [...state.pile, state.drawn.card], drawn: null, msg: `King discarded.` });
    }

    case 'PEEK_OWN_SELECT': {
      if (state.step !== 'peekOwn') return state;
      const { cardIdx } = payload;
      const players = cp(state.players);
      players[state.currentPlayerIdx].known[cardIdx] = true;
      return {
        ...state, players,
        pile: [...state.pile, state.drawn.card], drawn: null,
        step: 'peekReveal',
        ctx: { peekP: state.currentPlayerIdx, peekC: cardIdx },
        reveals: [{ playerIdx: state.currentPlayerIdx, cardIdx }],
        msg: `You peeked at card ${cardIdx + 1}! Click "Got it" to continue.`,
      };
    }

    case 'END_PEEK_REVEAL': {
      if (state.step !== 'peekReveal' && state.step !== 'oppPeekReveal') return state;
      return endTurn({ ...state, reveals: [], ctx: {} });
    }

    case 'PEEK_OPP_SELECT': {
      if (state.step !== 'peekOpp_sel') return state;
      const { oppIdx, cardIdx } = payload;
      const oppCard = state.players[oppIdx].hand[cardIdx];
      return {
        ...state,
        pile: [...state.pile, state.drawn.card], drawn: null,
        step: 'oppPeekReveal',
        ctx: { peekP: oppIdx, peekC: cardIdx, peekCard: oppCard },
        reveals: [{ playerIdx: oppIdx, cardIdx }],
        msg: `Peeked at ${state.players[oppIdx].name}'s card ${cardIdx + 1} — value: ${cardValue(oppCard)}. Click "Got it".`,
      };
    }

    case 'BSWAP_OWN': {
      if (state.step !== 'bSwap_own') return state;
      return { ...state, step: 'bSwap_opp', ctx: { ownC: payload.cardIdx }, msg: `Now click an opponent's card to swap with (blind).` };
    }
    case 'BSWAP_OPP': {
      if (state.step !== 'bSwap_opp') return state;
      return doBlindSwap(state, state.currentPlayerIdx, state.ctx.ownC, payload.oppIdx, payload.cardIdx);
    }

    case 'SSWAP_OWN': {
      if (state.step !== 'sSwap_own') return state;
      return {
        ...state, step: 'sSwap_opp',
        ctx: { ownC: payload.cardIdx },
        reveals: [{ playerIdx: state.currentPlayerIdx, cardIdx: payload.cardIdx }],
        msg: `Now click an opponent's card (you'll see both before deciding).`,
      };
    }
    case 'SSWAP_OPP': {
      if (state.step !== 'sSwap_opp') return state;
      const { oppIdx, cardIdx } = payload;
      return {
        ...state, step: 'sSwap_confirm',
        ctx: { ...state.ctx, oppIdx, oppC: cardIdx },
        reveals: [
          { playerIdx: state.currentPlayerIdx, cardIdx: state.ctx.ownC },
          { playerIdx: oppIdx, cardIdx },
        ],
        msg: `Both cards revealed! Swap them?`,
      };
    }
    case 'SSWAP_CONFIRM': {
      if (state.step !== 'sSwap_confirm') return state;
      return doSeeingSwap(state, state.currentPlayerIdx, state.ctx.ownC, state.ctx.oppIdx, state.ctx.oppC, payload.doSwap);
    }

    case 'SKIP_TURN': {
      let ts = { ...state };
      if (ts.drawn) { ts.pile = [...ts.pile, ts.drawn.card]; ts.drawn = null; }
      return endTurn({ ...ts, step: 'idle', ctx: {}, msg: `⏰ Turn skipped due to timeout!` });
    }

    case 'BOT_START': {
      const cur = state.players[state.currentPlayerIdx];
      if (!cur?.isAI || state.step !== 'idle' || !['play','cabo'].includes(state.phase)) return state;
      const unknownCnt = cur.known.filter(k => !k).length;
      const knownScore = cur.hand.reduce((s, c, i) => cur.known[i] ? s + cardValue(c) : s, 0);
      if (state.caboBy === null && unknownCnt === 0 && knownScore <= 14) {
         return { ...state, step: 'bot_cabo', msg: `${cur.name} is thinking...` };
      }
      return { ...state, step: 'bot_draw', msg: `${cur.name} is thinking...` };
    }

    case 'BOT_DRAW': {
      const cur = state.players[state.currentPlayerIdx];
      if (state.step === 'bot_cabo') return callCabo(state);
      if (state.step !== 'bot_draw') return state;

      const pileTop = state.pile.length > 0 ? state.pile[state.pile.length - 1] : null;
      let drawnCard, drawnFrom, nd = [...state.deck], np = [...state.pile];
      if (pileTop && cardValue(pileTop) <= 0) {
        drawnCard = pileTop; drawnFrom = 'pile'; np = state.pile.slice(0, -1);
      } else {
        if (nd.length === 0) {
          if (np.length <= 1) return endTurn(state);
          const top = np[np.length - 1];
          nd = shuffle(np.slice(0, -1)); np = [top];
        }
        drawnCard = nd[0]; drawnFrom = 'deck'; nd = nd.slice(1);
      }
      return {
        ...state, deck: nd, pile: np, drawn: { card: drawnCard, from: drawnFrom },
        step: 'bot_action', msg: `${cur.name} drew a card from the ${drawnFrom}.`
      };
    }

    case 'BOT_ACTION': {
      if (state.step !== 'bot_action' || !state.drawn) return state;
      const me = state.players[state.currentPlayerIdx];
      const { card: drawnCard, from: drawnFrom } = state.drawn;
      const power = drawnFrom === 'pile' ? 'swap' : cardPower(drawnCard, state.rules);
      let ts = { ...state, msg: '' };
      
      if (power === 'swap' || power === 'king') {
        const dv = cardValue(drawnCard);
        let bestIdx = -1, bestVal = dv;
        for (let i = 0; i < 6; i++) {
          if (me.known[i] && cardValue(me.hand[i]) > bestVal) { bestVal = cardValue(me.hand[i]); bestIdx = i; }
        }
        if (bestIdx >= 0) {
           ts.ctx = { botSwap: bestIdx }; ts.msg = `${me.name} is swapping with their card ${bestIdx + 1}...`;
           return { ...ts, step: 'bot_end' };
        }
        if (drawnFrom === 'pile') {
          const ui = me.known.findIndex(k => !k);
          ts.ctx = { botSwap: ui >= 0 ? ui : 0 }; ts.msg = `${me.name} is swapping with an unknown card...`;
          return { ...ts, step: 'bot_end' };
        }
        if (power === 'king' && drawnCard.suit === '♦') {
          let wi = -1, wv = 1;
          for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; }
          if (wi >= 0) {
             ts.ctx = { botSwap: wi }; ts.msg = `${me.name} uses King to swap!`;
             return { ...ts, step: 'bot_end' };
          }
        }
        ts.ctx = { botDiscard: true }; ts.msg = `${me.name} decided to discard the card.`;
        return { ...ts, step: 'bot_end' };
      }

      if (power === 'peekOwn') {
        const ui = me.known.findIndex(k => !k);
        ts.ctx = { botPeek: ui >= 0 ? ui : 0 }; ts.msg = `${me.name} is peeking at their own card...`;
        return { ...ts, step: 'bot_end' };
      }

      if (power === 'peekOpp') {
        ts.ctx = { botDiscard: true }; ts.msg = `${me.name} peeked at an opponent's card (discarded the draw).`;
        return { ...ts, step: 'bot_end' };
      }

      if (power === 'blindSwap' || power === 'seeingSwap') {
        let wi = 0, wv = -99;
        for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; }
        const oppIdx = (state.currentPlayerIdx + 1) % state.players.length;
        ts.ctx = { botBlindSwapOwn: wi, botBlindSwapOpp: oppIdx, botBlindSwapOppCard: 0 };
        ts.msg = `${me.name} uses ${power} to swap cards!`;
        return { ...ts, step: 'bot_end' };
      }
      
      ts.ctx = { botDiscard: true }; ts.msg = `${me.name} discarded the card.`;
      return { ...ts, step: 'bot_end' };
    }

    case 'BOT_END': {
      if (state.step !== 'bot_end' || !state.drawn) return state;
      const { ctx, drawn, currentPlayerIdx: cIdx } = state;
      let ts = { ...state, ctx: {} };
      if (ctx.botSwap !== undefined) return swapHandCard(ts, drawn.card, cIdx, ctx.botSwap);
      if (ctx.botPeek !== undefined) {
         const pl = cp(ts.players); pl[cIdx].known[ctx.botPeek] = true;
         return endTurn({ ...ts, players: pl, pile: [...ts.pile, drawn.card], drawn: null });
      }
      if (ctx.botBlindSwapOwn !== undefined) {
         return doBlindSwap(ts, cIdx, ctx.botBlindSwapOwn, ctx.botBlindSwapOpp, ctx.botBlindSwapOppCard);
      }
      return endTurn({ ...ts, pile: [...ts.pile, drawn.card], drawn: null });
    }

    case 'PLAY_AGAIN': return INIT;
    default: return state;
  }
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
                  <div className="ifc-corner ifc-tl">
                    <span className="ifc-rank">{c.rank}</span>
                    <span className="ifc-s">{c.suit}</span>
                  </div>
                  <div className="ifc-big">{c.suit}</div>
                  <div className="ifc-corner ifc-br">
                    <span className="ifc-rank">{c.rank}</span>
                    <span className="ifc-s">{c.suit}</span>
                  </div>
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

  const handleChange = (card, val) => {
    setRules(prev => ({ ...prev, [card]: val }));
  };

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
          <div className="cr-chalk-sub">
            {typedIntro}
            {typedIntro.length < introText.length && <span className="cr-caret">|</span>}
          </div>
        </div>

        <div className="cr-grid">
          {crConfig.map(cfg => (
            <div key={cfg.label} className="cr-card-item">
              <div className="cr-card-name">{cfg.label}</div>
              <div className="cr-card-hint">{cfg.hint}</div>
              <select
                className="cr-select"
                value={rules[cfg.keys[0]] || 'swap'}
                onChange={(e) => {
                  const val = e.target.value;
                  cfg.keys.forEach(k => handleChange(k, val));
                }}
              >
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

  const skip = () => {
    setFading(true);
    setTimeout(() => dispatch({ type: 'FINISH_GAME_INTRO' }), 500);
  };

  return (
    <div className={`game-intro-root ${fading ? 'fade-out' : ''}`}>
      <video autoPlay loop muted playsInline className="game-intro-vid" src="/intro-bg.mp4" />
      <button className="intro-skip" onClick={skip}>Skip →</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// LOBBY
// ─────────────────────────────────────────────
function Lobby({ state, dispatch }) {
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
            <button className={`mode-btn ${mode === 'standard' ? 'active' : ''}`} onClick={() => setMode('standard')}>
              Standard Rules
            </button>
            <button className={`mode-btn ${mode === 'custom' ? 'active' : ''}`} onClick={() => setMode('custom')}>
              Custom Rules 🛠️
            </button>
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
                <div key={k} className="rule-row">
                  <span className="rule-key">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="cr-badge">
              <span>Custom Rules active.</span>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setMode('custom')}>Edit Config</button>
            </div>
          )}

          <button className="btn btn-gold btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={mode === 'custom' ? undefined : start}>
            {mode === 'custom' ? 'Configure Rules ➔' : '▶ Start Game'}
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
function PeekOverlay({ state, dispatch }) {
  const { peekState, players, reveals } = state;
  if (!peekState) return null;
  const pIdx = peekState.idx;
  const player = players[pIdx];
  if (player.isAI) return null;
  const revSet = new Set(reveals.filter(r => r.playerIdx === pIdx).map(r => r.cardIdx));
  const done = peekState.left <= 0;

  return (
    <div className="peek-overlay">
      <div className="peek-panel">
        <div className="peek-title">🃏 {player.name}, peek at your cards!</div>
        <div className="peek-sub">
          {done
            ? 'Remember them well! Click Done when ready.'
            : `Click ${peekState.left === 2 ? 'any 2' : '1 more'} card to see its value.`}
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
                {p.hand.map((card, i) => (
                  <CardComp key={card.id ?? i} card={card} faceUp sm />
                ))}
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
function GameBoard({ state, dispatch }) {
  const { players, deck, pile, currentPlayerIdx, drawn, step, ctx, caboBy, reveals, msg, phase } = state;
  const isHumanTurn = ['play','cabo'].includes(phase) && currentPlayerIdx === 0 && step === 'idle';
  const pileTop = pile.length > 0 ? pile[pile.length - 1] : null;
  const opponents = players.filter((_, i) => i !== 0);

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

  const revFor = (pIdx) => reveals.filter(r => r.playerIdx === pIdx);

  // Which cards are selectable for a given player index
  const getSelectables = (pIdx) => {
    if (!isHumanTurn) return [];
    if (pIdx === 0) {
      if (['swap','king_sel'].includes(step)) return [0,1,2,3,4,5];
      if (step === 'peekOwn') return players[0].known.map((k,i) => !k ? i : null).filter(x => x !== null);
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
      {/* Header */}
      <div className="game-header">
        <div>
          <div className="game-title">CABO</div>
        </div>
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
        {/* Opponents */}
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

        {/* Center */}
        <div className="center-zone">
          <div className="deck-pile-row">
            {/* Deck */}
            <div className="deck-pile-col">
              {deck.length > 0 ? (
                <div
                  onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_DECK' }) : undefined}
                  style={{ cursor: isHumanTurn && step === 'idle' ? 'pointer' : 'default' }}
                >
                  <CardComp
                    card={deck[0]}
                    faceUp={false}
                    onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_DECK' }) : undefined}
                  />
                </div>
              ) : (
                <div className="empty-card">Empty</div>
              )}
              <div className="pile-label">Draw Deck</div>
            </div>

            {/* Drawn card */}
            {drawn && (
              <div className="drawn-display anim-in">
                <div className="drawn-label">⚡ Just Drew</div>
                <CardComp card={drawn.card} faceUp />
              </div>
            )}

            {!drawn && <div className="center-sep" />}

            {/* Pile */}
            <div className="deck-pile-col">
              {pileTop ? (
                <div
                  onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_PILE' }) : undefined}
                  style={{ cursor: isHumanTurn && step === 'idle' ? 'pointer' : 'default' }}
                >
                  <CardComp
                    card={pileTop}
                    faceUp
                    onClick={isHumanTurn && step === 'idle' ? () => dispatch({ type: 'DRAW_PILE' }) : undefined}
                  />
                </div>
              ) : (
                <div className="empty-card">Empty</div>
              )}
              <div className="pile-label">Discard Pile</div>
            </div>
          </div>

          {/* Action / Msg */}
          <div className="action-panel">
            <div className="msg-box">{msg}</div>
            {isHumanTurn && (
               <div className="timer-wrap">
                 <div className="timer-bar" style={{ width: `${(timeLeft / 40) * 100}%` }} />
               </div>
            )}
            <div className="action-btns">
                {/* swap: discard option */}
                {step === 'swap' && drawn?.from !== 'pile' && (
                  <button className="btn btn-danger" id="discard-btn" onClick={() => dispatch({ type: 'DISCARD_DRAWN' })}>
                    🗑 Discard It
                  </button>
                )}
                {/* king options */}
                {step === 'king' && (
                  <>
                    <button className="btn btn-teal" onClick={() => dispatch({ type: 'KING_KEEP' })}>Keep King →</button>
                    <button className="btn btn-danger" onClick={() => dispatch({ type: 'KING_DISCARD' })}>🗑 Discard</button>
                  </>
                )}
                {/* peek reveal done */}
                {(step === 'peekReveal' || step === 'oppPeekReveal') && (
                  <button className="btn btn-gold" onClick={() => dispatch({ type: 'END_PEEK_REVEAL' })}>
                    Got it! ✓
                  </button>
                )}
                {/* seeing swap confirm */}
                {step === 'sSwap_confirm' && (
                  <>
                    <button className="btn btn-green" onClick={() => dispatch({ type: 'SSWAP_CONFIRM', payload: { doSwap: true } })}>
                      ✅ Swap Cards
                    </button>
                    <button className="btn btn-ghost" onClick={() => dispatch({ type: 'SSWAP_CONFIRM', payload: { doSwap: false } })}>
                      ✗ Don't Swap
                    </button>
                  </>
                )}
            </div>
          </div>
        </div>

        {/* Bottom (You) */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <PlayerArea
            player={players[0]}
            isActive={currentPlayerIdx === 0}
            isCabo={caboBy === 0}
            selectables={getSelectables(0)}
            revealed={revFor(0)}
            onCardClick={handleHumanCard}
            botTargets={
              (ctx.botBlindSwapOpp === 0 && ctx.botBlindSwapOppCard !== undefined) ? [ctx.botBlindSwapOppCard] : []
            }
          />
        </div>
      </div>

      {/* Peek overlay */}
      {state.phase === 'peek' && <PeekOverlay state={state} dispatch={dispatch} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────
export default function Home() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const [showIntro, setShowIntro] = useState(true);

  // AI turn effect
  useEffect(() => {
    if (!['play','cabo'].includes(state.phase)) return;
    const cur = state.players?.[state.currentPlayerIdx];
    if (!cur?.isAI || state.step !== 'idle') return;
    const t = setTimeout(() => dispatch({ type: 'AI_TURN' }), 1100);
    return () => clearTimeout(t);
  }, [state.currentPlayerIdx, state.step, state.phase]);

  if (showIntro) return <IntroScreen onDone={() => setShowIntro(false)} />;
  if (state.phase === 'lobby') return <Lobby state={state} dispatch={dispatch} />;
  if (state.phase === 'game_intro') return <GameIntroScreen dispatch={dispatch} />;
  if (state.phase === 'reveal') return <RevealScreen state={state} dispatch={dispatch} />;
  return <GameBoard state={state} dispatch={dispatch} />;
}
