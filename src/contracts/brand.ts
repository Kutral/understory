/**
 * Branded primitive helpers so IDs and opaque handles cannot be mixed up.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Seed = Brand<number, 'Seed'>;

export function seedOf(n: number): Seed {
  return Math.trunc(n) as Seed;
}
