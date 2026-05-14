import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewProps } from 'react-native';

import { useControllableState } from './controllable-state';
import { getOtpSlots, normalizeOtpValue } from './input-otp-utils';
import { Separator } from './separator';
import { Typography } from './primitives';
import { useUiTheme } from './theme';

export function InputOTP({
  value,
  defaultValue = '',
  onValueChange,
  maxLength = 6,
  style,
  ...props
}: Omit<TextInputProps, 'value' | 'defaultValue' | 'onChange' | 'onChangeText' | 'onValueChange'> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  maxLength?: number;
}) {
  const theme = useUiTheme();
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });

  return (
    <TextInput
      {...props}
      keyboardType={props.keyboardType ?? 'number-pad'}
      maxLength={maxLength}
      value={currentValue}
      onChangeText={(nextValue) => setValue(normalizeOtpValue(nextValue, maxLength))}
      placeholderTextColor={theme.colors.mutedForeground}
      style={[
        styles.input,
        {
          borderColor: theme.colors.input,
          borderRadius: theme.radius.xl,
          color: theme.colors.foreground,
        },
        style,
      ]}
    />
  );
}

export function InputOTPGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function InputOTPSlot({
  char,
  index,
  value = '',
  style,
  ...props
}: ViewProps & { char?: string; index?: number; value?: string }) {
  const theme = useUiTheme();
  const slots = getOtpSlots(value, Math.max((index ?? 0) + 1, value.length));
  const resolvedChar = char ?? slots[index ?? 0] ?? '';

  return (
    <View
      {...props}
      style={[
        styles.slot,
        { borderColor: theme.colors.input, borderRadius: theme.radius.lg },
        style,
      ]}>
      <Typography variant="bodyLg" weight="700">
        {resolvedChar}
      </Typography>
    </View>
  );
}

export function InputOTPSeparator() {
  return <Separator orientation="vertical" style={styles.separator} />;
}

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  input: {
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  separator: {
    height: 24,
  },
  slot: {
    alignItems: 'center',
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 38,
  },
});
