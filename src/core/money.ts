import Decimal from 'break_infinity.js';

export type Money = Decimal;

export function toMoney(x: number | string | Decimal): Money {
  return x instanceof Decimal ? x : new Decimal(x);
}

export function add(a: number | string | Decimal, b: number | string | Decimal): Money {
  return toMoney(a).add(toMoney(b));
}

export function sub(a: number | string | Decimal, b: number | string | Decimal): Money {
  return toMoney(a).sub(toMoney(b));
}

export function gte(a: number | string | Decimal, b: number | string | Decimal): boolean {
  return toMoney(a).gte(toMoney(b));
}

export function mul(a: number | string | Decimal, b: number | string | Decimal): Money {
  return toMoney(a).mul(toMoney(b));
}

export function format(a: number | string | Decimal): string {
  const dec = toMoney(a);
  const n = dec.toNumber();
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'b';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'k';
  return Math.floor(n).toString();
}
