export const ATTRIBUTE_MIN = 50;
export const ATTRIBUTE_MAX = 100;

export function toAttributeScale(score: number): number {
  return Number((ATTRIBUTE_MIN + (score - 1) * 12.5).toFixed(2));
}

export function fromAttributeScale(score: number): number {
  return 1 + (score - ATTRIBUTE_MIN) / 12.5;
}
