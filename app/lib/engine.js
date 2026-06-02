export const DEFAULT_RULES = {
  '7': 'peekOwn', '8': 'peekOwn',
  '9': 'peekOpp', '10': 'peekOpp',
  J: 'blindSwap', Q: 'seeingSwap',
  K: 'king', JOKER: 'swap',
};

export function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  let id = 0;
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: id++, rank, suit });
    }
  }
  deck.push({ id: id++, rank: 'JOKER', suit: null });
  deck.push({ id: id++, rank: 'JOKER', suit: null });
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardValue(card) {
  if (!card) return 0;
  if (card.rank === 'JOKER') return -1;
  if (card.rank === 'K' && card.suit === '♦') return 0;
  if (card.rank === 'A') return 1;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

export function cardPower(card, rules = DEFAULT_RULES) {
  if (!card) return rules['JOKER'] || 'swap';
  if (card.rank === 'JOKER') return rules['JOKER'] || 'swap';
  // A-6 are always swap/discard (not configurable)
  if (['A','2','3','4','5','6'].includes(card.rank)) return 'swap';
  // 7-K use the ruleset
  return rules[card.rank] || 'swap';
}

export function handScore(hand) {
  return hand.reduce((s, c) => s + cardValue(c), 0);
}

export function isRed(card) {
  return card?.suit === '♥' || card?.suit === '♦';
}
