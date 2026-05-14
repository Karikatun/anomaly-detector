import type { ReactNode } from 'react';
import React, { createContext, useCallback, useContext } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useControllableState } from './controllable-state';
import { UiPressable } from './primitives';
import { getRadioGroupItemState } from './radio-utils';
import { useUiTheme } from './theme';
import { createMinTouchTargetStyle } from './touch-target';

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
  const { isSelected, isDisabled, select } = useRadioGroupItem(value, disabled);

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
      onPress={(event) => {
        props.onPress?.(event);
        select();
      }}>
      <RadioCircle theme={theme} selected={isSelected} />
    </UiPressable>
  );
}

export function RadioGroupIndicator({
  value,
  disabled,
  style,
}: {
  value: string;
  disabled?: boolean | null;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useUiTheme();
  const { isSelected } = useRadioGroupItem(value, disabled);

  return (
    <View pointerEvents="none" style={[styles.item, style]}>
      <RadioCircle theme={theme} selected={isSelected} />
    </View>
  );
}

export function useRadioGroupItem(value: string, disabled?: boolean | null) {
  const context = useContext(RadioContext);
  const { isDisabled, isSelected } = getRadioGroupItemState({
    currentValue: context?.value,
    disabled,
    groupDisabled: context?.disabled,
    value,
  });
  const select = useCallback(() => {
    if (!isDisabled) {
      context?.onValueChange(value);
    }
  }, [context, isDisabled, value]);

  return { isSelected, isDisabled, select };
}

function RadioCircle({
  selected,
  theme,
}: {
  selected?: boolean;
  theme: ReturnType<typeof useUiTheme>;
}) {
  return (
    <View
      style={[
        styles.circle,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.input,
          borderRadius: theme.radius.full,
        },
      ]}>
      {selected && <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />}
    </View>
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
    ...createMinTouchTargetStyle(),
    justifyContent: 'center',
  },
});
