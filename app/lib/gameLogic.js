import { createDeck, shuffle, cardValue, cardPower, handScore, DEFAULT_RULES } from './engine.js';

export { DEFAULT_RULES };
export const INIT = { phase: 'lobby', numPlayers: 2, rules: DEFAULT_RULES };

function cp(players) {
  return players.map(p => ({ ...p, hand: [...p.hand], known: [...p.known] }));
}

function endTurn(state) {
  const { phase, players, currentPlayerIdx, lastRound } = state;
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

export function reducer(state, action) {
  const { type, payload = {} } = action;
  switch (type) {

    case 'SET_NUM': return { ...state, numPlayers: payload.n };

    case 'START_GAME': {
      const { numPlayers, names, rules = DEFAULT_RULES, aiFlags } = payload;
      const deck = createDeck();
      const players = [];
      for (let i = 0; i < numPlayers; i++) {
        const hand = deck.splice(0, 6);
        const name = names[i]?.trim() || (i === 0 ? 'You' : `Bot ${i}`);
        const isAI = aiFlags ? aiFlags[i] : i > 0;
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
      if (state.phase !== 'game_intro') return state;
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

    case 'MATCH_DISCARD': {
      if (state.step !== 'idle' || !['play','cabo'].includes(state.phase)) return state;
      const { cardIdx } = payload;
      const players = cp(state.players);
      const player = players[state.currentPlayerIdx];
      const card = player.hand[cardIdx];
      const topCard = state.pile.length > 0 ? state.pile[state.pile.length - 1] : null;
      
      if (topCard && (card.rank === topCard.rank || cardValue(card) === cardValue(topCard))) {
        // Match successful! Remove card from hand
        player.hand.splice(cardIdx, 1);
        player.known.splice(cardIdx, 1);
        return endTurn({
          ...state,
          players,
          pile: [...state.pile, card],
          msg: `Match successful! Discarded ${card.rank}${card.suit||''}.`
        });
      } else {
        // Penalty for wrong match (usually draw a card, but let's just warn and end turn or something)
        // A simple penalty: you must keep it, turn ends.
        return {
          ...state,
          msg: `❌ Not a match! ${card.rank}${card.suit||''} doesn't match ${topCard ? topCard.rank : 'nothing'}. Turn lost.`,
        };
      }
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
        if (bestIdx >= 0) { ts.ctx = { botSwap: bestIdx }; ts.msg = `${me.name} is swapping with their card ${bestIdx + 1}...`; return { ...ts, step: 'bot_end' }; }
        if (drawnFrom === 'pile') { const ui = me.known.findIndex(k => !k); ts.ctx = { botSwap: ui >= 0 ? ui : 0 }; ts.msg = `${me.name} is swapping with an unknown card...`; return { ...ts, step: 'bot_end' }; }
        if (power === 'king' && drawnCard.suit === '♦') { let wi = -1, wv = 1; for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; } if (wi >= 0) { ts.ctx = { botSwap: wi }; ts.msg = `${me.name} uses King to swap!`; return { ...ts, step: 'bot_end' }; } }
        ts.ctx = { botDiscard: true }; ts.msg = `${me.name} decided to discard the card.`; return { ...ts, step: 'bot_end' };
      }
      if (power === 'peekOwn') { const ui = me.known.findIndex(k => !k); ts.ctx = { botPeek: ui >= 0 ? ui : 0 }; ts.msg = `${me.name} is peeking at their own card...`; return { ...ts, step: 'bot_end' }; }
      if (power === 'peekOpp') { ts.ctx = { botDiscard: true }; ts.msg = `${me.name} peeked at an opponent's card (discarded the draw).`; return { ...ts, step: 'bot_end' }; }
      if (power === 'blindSwap' || power === 'seeingSwap') {
        let wi = 0, wv = -99;
        for (let i = 0; i < 6; i++) if (me.known[i] && cardValue(me.hand[i]) > wv) { wv = cardValue(me.hand[i]); wi = i; }
        const oppIdx = (state.currentPlayerIdx + 1) % state.players.length;
        ts.ctx = { botBlindSwapOwn: wi, botBlindSwapOpp: oppIdx, botBlindSwapOppCard: 0 };
        ts.msg = `${me.name} uses ${power} to swap cards!`;
        return { ...ts, step: 'bot_end' };
      }
      ts.ctx = { botDiscard: true }; ts.msg = `${me.name} discarded the card.`; return { ...ts, step: 'bot_end' };
    }

    case 'BOT_END': {
      if (state.step !== 'bot_end' || !state.drawn) return state;
      const { ctx, drawn, currentPlayerIdx: cIdx } = state;
      let ts = { ...state, ctx: {} };
      if (ctx.botSwap !== undefined) return swapHandCard(ts, drawn.card, cIdx, ctx.botSwap);
      if (ctx.botPeek !== undefined) { const pl = cp(ts.players); pl[cIdx].known[ctx.botPeek] = true; return endTurn({ ...ts, players: pl, pile: [...ts.pile, drawn.card], drawn: null }); }
      if (ctx.botBlindSwapOwn !== undefined) return doBlindSwap(ts, cIdx, ctx.botBlindSwapOwn, ctx.botBlindSwapOpp, ctx.botBlindSwapOppCard);
      return endTurn({ ...ts, pile: [...ts.pile, drawn.card], drawn: null });
    }

    case 'PLAY_AGAIN': return INIT;
    default: return state;
  }
}
