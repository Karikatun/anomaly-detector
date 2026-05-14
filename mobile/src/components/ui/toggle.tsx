import type { ReactNode } from 'react';
import { type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Button, type ButtonProps } from './button';
import { useControllableState } from './controllable-state';

export type ToggleProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  style?: StyleProp<ViewStyle>;
  textStyle?: ButtonProps['textStyle'];
};

export function toggleVariants(options?: { variant?: ToggleProps['variant']; size?: ToggleProps['size'] }) {
  return options ?? {};
}

export function Toggle({
  pressed,
  defaultPressed = false,
  onPressedChange,
  variant,
  children,
  ...props
}: ToggleProps) {
  const [isPressed, setPressed] = useControllableState({
    value: pressed,
    defaultValue: defaultPressed,
    onChange: onPressedChange,
  });
  const isSelected = isPressed === true;
  const isDisabled = props.disabled === true;

  return (
    <Button
      {...props}
      accessibilityState={{ selected: isSelected, disabled: isDisabled }}
      variant={variant ?? (isSelected ? 'secondary' : 'ghost')}
      onPress={(event) => {
        props.onPress?.(event);
        setPressed(!isSelected);
      }}>
      {children}
    </Button>
  );
}
