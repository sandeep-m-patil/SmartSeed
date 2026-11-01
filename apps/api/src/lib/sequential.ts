/** Runs query thunks one after another: a single pg client must not execute overlapping queries. */
export async function sequential<T extends unknown[]>(thunks: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const out: unknown[] = [];
  for (const thunk of thunks as (() => Promise<unknown>)[]) out.push(await thunk());
  return out as T;
}
