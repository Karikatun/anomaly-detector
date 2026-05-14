import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { useUiTheme, withAlpha } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

export type InputProps = TextInputProps & {
  invalid?: boolean;
};

export function Input({ style, invalid, placeholderTextColor, editable = true, ...props }: InputProps) {
  const theme = useUiTheme();

  return (
    <TextInput
      {...props}
      editable={editable}
      placeholderTextColor={placeholderTextColor ?? theme.colors.mutedForeground}
      style={[
        styles.input,
        {
          backgroundColor: withAlpha(theme.colors.input, theme.scheme === 'dark' ? 0.35 : 0.3),
          borderColor: invalid ? theme.colors.destructive : theme.colors.input,
          borderRadius: theme.radius.full,
          color: theme.colors.foreground,
        },
        !editable && { opacity: theme.opacity.disabled },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
