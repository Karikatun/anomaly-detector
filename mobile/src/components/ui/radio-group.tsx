import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useControllableState } from './controllable-state';
import { UiPressable } from './primitives';
import { useUiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

type RadioContextValue = {
  value?: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

const RadioContext = createContext<RadioContextValue | null>(null);

export function RadioGroup({
  value,
  defaultValue,
  onValueChange,
  disabled,
  children,
  style,
  ...props
}: ViewProps & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue: defaultValue ?? '',
    onChange: onValueChange,
  });

  const contextValue = {
    value: currentValue,
    onValueChange: (nextValue: string) => setValue(nextValue),
    disabled,
  };

  return (
    <RadioContext.Provider value={contextValue}>
      <View {...props} accessibilityRole="radiogroup" style={[styles.group, style]}>
        {children}
      </View>
    </RadioContext.Provider>
  );
}

export function RadioGroupItem({
  value,
  disabled,
  style,
  ...props
}: Omit<PressableProps, 'style'> & { value: string; style?: StyleProp<ViewStyle> }) {
  const theme = useUiTheme();
  const context = useContext(RadioContext);
  const isSelected = context?.value === value;
  const isDisabled = disabled === true || context?.disabled === true;

  return (
    <UiPressable
      {...props}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected, disabled: isDisabled }}
      disabled={isDisabled}
      style={[
        styles.item,
        style,
      ]}
      onPress={() => context?.onValueChange(value)}>
      <View
        style={[
          styles.circle,
          {
            borderColor: isSelected ? theme.colors.primary : theme.colors.input,
            borderRadius: theme.radius.full,
          },
        ]}>
        {isSelected && <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />}
      </View>
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  dot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  group: {
    gap: 10,
  },
  item: {
    alignItems: 'center',
    height: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    width: MIN_TOUCH_TARGET,
  },
});
