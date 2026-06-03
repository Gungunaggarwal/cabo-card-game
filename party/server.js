import { reducer, DEFAULT_RULES } from '../app/lib/gameLogic.js';

export default class CaboServer {
  constructor(room) {
    this.room = room;
    // connectionId -> { slot: 0|1, name: string }
    this.connections = new Map();
    this.gameState = null;
    this.roomPhase = 'waiting'; // 'waiting' | 'playing'
  }

  onConnect(connection) {
    const usedSlots = new Set([...this.connections.values()].map(c => c.slot));
    const slot = !usedSlots.has(0) ? 0 : (!usedSlots.has(1) ? 1 : null);

    if (slot === null) {
      connection.close(1008, 'Room is full');
      return;
    }

    this.connections.set(connection.id, { slot, name: `Player ${slot + 1}` });

    connection.send(JSON.stringify({
      type: 'CONNECTED',
      slot,
      roomPhase: this.roomPhase,
      gameState: this.gameState,
      players: this._playerList(),
    }));

    this._broadcastRoomUpdate();
  }

  onMessage(message, connection) {
    const info = this.connections.get(connection.id);
    if (!info) return;

    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    if (msg.type === 'SET_NAME') {
      info.name = (msg.name || '').trim() || info.name;
      this._broadcastRoomUpdate();
      return;
    }

    if (msg.type === 'START_GAME') {
      if (info.slot !== 0 || this.roomPhase !== 'waiting') return;
      if (this.connections.size < 2) return;

      const names = ['Player 1', 'Player 2'];
      for (const [, p] of this.connections) names[p.slot] = p.name;

      this.gameState = reducer(
        { phase: 'lobby', rules: msg.rules || DEFAULT_RULES },
        {
          type: 'START_GAME',
          payload: {
            numPlayers: 2,
            names,
            rules: msg.rules || DEFAULT_RULES,
            aiFlags: [false, false],
          },
        }
      );
      this.roomPhase = 'playing';
      this._broadcast({ type: 'STATE', state: this.gameState });
      return;
    }

    if (msg.type === 'ACTION' && this.roomPhase === 'playing' && this.gameState) {
      const action = msg.action;
      // Validate sender is allowed to take this action
      const peekActions = ['PEEK_CARD', 'ADVANCE_PEEK'];
      if (peekActions.includes(action.type)) {
        if (this.gameState.phase !== 'peek') return;
        if (this.gameState.peekState?.idx !== info.slot) return;
      } else if (action.type === 'FINISH_GAME_INTRO') {
        // Both clients may send this; allow it to be idempotent
      } else {
        if (this.gameState.currentPlayerIdx !== info.slot) return;
      }

      const next = reducer(this.gameState, action);
      if (next === this.gameState) return; // no-op
      this.gameState = next;

      // If game returned to lobby (PLAY_AGAIN), reset room
      if (this.gameState.phase === 'lobby') {
        this.gameState = null;
        this.roomPhase = 'waiting';
        this._broadcastRoomUpdate();
      } else {
        this._broadcast({ type: 'STATE', state: this.gameState });
      }
      return;
    }
  }

  onClose(connection) {
    const info = this.connections.get(connection.id);
    this.connections.delete(connection.id);
    if (info && this.roomPhase === 'playing') {
      this._broadcast({ type: 'PLAYER_LEFT', name: info.name });
    }
    this._broadcastRoomUpdate();
  }

  _playerList() {
    return [...this.connections.values()].sort((a, b) => a.slot - b.slot);
  }

  _broadcastRoomUpdate() {
    this._broadcast({
      type: 'ROOM_UPDATE',
      roomPhase: this.roomPhase,
      players: this._playerList(),
      playerCount: this.connections.size,
    });
  }

  _broadcast(msg) {
    this.room.broadcast(JSON.stringify(msg));
  }
}
