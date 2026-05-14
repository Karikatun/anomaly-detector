import { StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useControllableState } from './controllable-state';
import { UiPressable } from './primitives';
import { useUiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

export type CheckboxProps = Omit<PressableProps, 'onPress' | 'style'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

export function Checkbox({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  style,
  ...props
}: CheckboxProps) {
  const theme = useUiTheme();
  const [isChecked, setChecked] = useControllableState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const accessibilityChecked = isChecked === true;
  const accessibilityDisabled = disabled === true;

  return (
    <UiPressable
      {...props}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: accessibilityChecked, disabled: accessibilityDisabled }}
      disabled={disabled}
      style={[
        styles.root,
        style,
      ]}
      onPress={() => setChecked(!accessibilityChecked)}>
      <View
        style={[
          styles.box,
          {
            borderColor: isChecked ? theme.colors.primary : theme.colors.input,
            backgroundColor: isChecked ? theme.colors.primary : theme.colors.transparent,
            borderRadius: theme.radius.sm,
          },
        ]}>
        {isChecked && <View style={[styles.check, { borderColor: theme.colors.primaryForeground }]} />}
      </View>
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  check: {
    borderBottomWidth: 2,
    borderRightWidth: 2,
    height: 10,
    transform: [{ rotate: '45deg' }],
    width: 6,
  },
  root: {
    alignItems: 'center',
    height: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    width: MIN_TOUCH_TARGET,
  },
});
