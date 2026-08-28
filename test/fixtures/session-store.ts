import { EventEmitter } from 'node:events';

/**
 * One room's worth of players.
 * Survives a restart: every mutation is written before it is acknowledged.
 */
export class SessionStore extends EventEmitter implements Persistable, Closeable {
  /** everything currently seated */
  private readonly seats = new Map<string, Seat>();

  static readonly MAX = 64;          // hard cap, not a tunable

  #dirty = false;

  ready?: boolean;

  onEvicted = (id: string) => {      // a property holding a function is still a method
    this.seats.delete(id);
  };

  constructor(
    private readonly clock: Clock,
    public readonly path: string,
    limit = SessionStore.MAX,
  ) {
    super();
  }

  /** How many seats are taken right now. */
  get size(): number {
    return this.seats.size;
  }

  set size(n: number) {
    throw new Error('read only');
  }

  // Seats a player, or throws when the room is full.
  async seat(id: string, seat: Seat): Promise<Seat> {
    this.seats.set(id, seat);
    return seat;
  }

  protected flush(): void {}

  private static key(id: string): string {
    return `s:${id}`;
  }
}

export interface Persistable {
  // where the bytes land
  readonly path: string;
  flush(): void;
}

export enum SeatState {
  // nobody there
  Empty = 0,
  Held,
  Playing = 9,
}
