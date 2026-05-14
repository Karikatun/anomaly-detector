import { StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useControllableState } from './controllable-state';
import { UiPressable } from './primitives';
import { useUiTheme } from './theme';

export type SwitchProps = Omit<PressableProps, 'onPress' | 'style'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  style,
  ...props
}: SwitchProps) {
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
      accessibilityRole="switch"
      accessibilityState={{ checked: accessibilityChecked, disabled: accessibilityDisabled }}
      disabled={disabled}
      style={[
        styles.track,
        {
          backgroundColor: accessibilityChecked ? theme.colors.primary : theme.colors.input,
          borderRadius: theme.radius.full,
        },
        style,
      ]}
      onPress={() => setChecked(!accessibilityChecked)}>
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: accessibilityChecked ? theme.colors.primaryForeground : theme.colors.background,
            transform: [{ translateX: accessibilityChecked ? 22 : 0 }],
          },
        ]}
      />
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  thumb: {
    borderRadius: 999,
    height: 22,
    width: 22,
  },
  track: {
    height: 26,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 50,
  },
});
