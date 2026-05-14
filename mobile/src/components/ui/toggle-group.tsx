import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useControllableState } from './controllable-state';
import { Toggle, type ToggleProps } from './toggle';

type ToggleGroupContextValue = {
  type: 'single' | 'multiple';
  value: string | string[] | undefined;
  onItemPress: (value: string) => void;
};

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

export function ToggleGroup({
  type = 'single',
  value,
  defaultValue,
  onValueChange,
  children,
  style,
  ...props
}: ViewProps & {
  type?: 'single' | 'multiple';
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  children?: ReactNode;
}) {
  const fallback = type === 'multiple' ? [] : '';
  const [currentValue, setValue] = useControllableState<string | string[]>({
    value,
    defaultValue: defaultValue ?? fallback,
    onChange: onValueChange,
  });

  return (
    <ToggleGroupContext.Provider
      value={{
        type,
        value: currentValue,
        onItemPress: (itemValue) => {
          if (type === 'multiple') {
            const values = Array.isArray(currentValue) ? currentValue : [];
            setValue(
              values.includes(itemValue)
                ? values.filter((value) => value !== itemValue)
                : [...values, itemValue],
            );
            return;
          }

          setValue(currentValue === itemValue ? '' : itemValue);
        },
      }}>
      <View {...props} style={[styles.group, style]}>
        {children}
      </View>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({ value, ...props }: ToggleProps & { value: string }) {
  const context = useContext(ToggleGroupContext);
  const isPressed = Array.isArray(context?.value)
    ? context?.value.includes(value)
    : context?.value === value;

  return (
    <Toggle
      {...props}
      pressed={isPressed}
      onPressedChange={() => {
        context?.onItemPress(value);
      }}
    />
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
});
