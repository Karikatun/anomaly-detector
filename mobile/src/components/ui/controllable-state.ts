import { useCallback, useState } from 'react';

export function getControllableValue<T>(controlledValue: T | undefined, uncontrolledValue: T) {
  return controlledValue === undefined ? uncontrolledValue : controlledValue;
}

export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value?: T;
  defaultValue: T;
  onChange?: (value: T) => void;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = getControllableValue(value, uncontrolledValue);

  const setValue = useCallback(
    (nextValue: T | ((currentValue: T) => T)) => {
      const resolvedValue =
        typeof nextValue === 'function'
          ? (nextValue as (currentValue: T) => T)(currentValue)
          : nextValue;

      if (!isControlled) {
        setUncontrolledValue(resolvedValue);
      }

      onChange?.(resolvedValue);
    },
    [currentValue, isControlled, onChange],
  );

  return [currentValue, setValue] as const;
}
