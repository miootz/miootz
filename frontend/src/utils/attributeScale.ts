export const ATTRIBUTE_MIN = 50;
export const ATTRIBUTE_MAX = 100;

export const ATTRIBUTE_COLOR = {
  pac: "text-attribute-pac",
  sho: "text-attribute-sho",
  pas: "text-attribute-pas",
  dri: "text-attribute-dri",
  def: "text-attribute-def",
} as const;

export function toAttributeScale(score: number): number {
  return Math.round(ATTRIBUTE_MIN + (score - 1) * 12.5);
}

export function fromAttributeScale(score: number): number {
  return 1 + (score - ATTRIBUTE_MIN) / 12.5;
}
