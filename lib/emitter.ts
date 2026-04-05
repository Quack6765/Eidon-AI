type EventMap = Record<string, unknown[]>;

export type EmitterEvents<T extends EventMap> = {
  [K in keyof T]: T[K];
};

type Listener<T extends unknown[]> = (...args: T) => void;

export function createEmitter<T extends EventMap>() {
  const listeners = new Map<keyof T, Set<Listener<T[keyof T]>>>();

  function on<K extends keyof T>(event: K, listener: Listener<T[K]>): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener as Listener<T[keyof T]>);
    return () => {
      set!.delete(listener as Listener<T[keyof T]>);
    };
  }

  function off<K extends keyof T>(event: K) {
    listeners.delete(event);
  }

  function emit<K extends keyof T>(event: K, ...args: T[K]) {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as Listener<T[K]>)(...args);
    }
  }

  return { on, off, emit };
}
