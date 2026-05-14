export function getRadioGroupItemState({
  currentValue,
  disabled,
  groupDisabled,
  value,
}: {
  currentValue?: string;
  disabled?: boolean | null;
  groupDisabled?: boolean;
  value: string;
}) {
  const isDisabled = disabled === true || groupDisabled === true;

  return {
    isDisabled,
    isSelected: currentValue === value,
  };
}

export function shouldHandleMenuRadioRowPress(isDisabled: boolean) {
  return !isDisabled;
}
