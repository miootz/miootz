export interface SubstitutionPick<Id> {
  id: Id;
  key: string;
}

export function pickSubstitute<Id>(
  selected: SubstitutionPick<Id> | null,
  next: SubstitutionPick<Id>,
  changeSelection: (pick: SubstitutionPick<Id> | null) => void,
  swap: (first: SubstitutionPick<Id>, second: SubstitutionPick<Id>) => void,
): void {
  if (!selected || selected.key === next.key) {
    changeSelection(selected?.id === next.id ? null : next);
    return;
  }
  swap(selected, next);
}
