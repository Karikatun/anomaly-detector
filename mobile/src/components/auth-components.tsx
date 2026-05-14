import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Surface, UiPressable } from '@/components/ui/primitives';
import { Typography } from '@/components/ui/typography';
import { useUiTheme } from '@/components/ui/theme';

export type AuthMode = 'register' | 'login';

type AuthPanelProps = {
  children: ReactNode;
};

export function AuthPanel({ children }: AuthPanelProps) {
  const theme = useUiTheme();

  return (
    <Surface bordered rounded="xxl" tone="card" style={{ gap: theme.spacing.lg, padding: theme.spacing.lg }}>
      {children}
    </Surface>
  );
}

type AuthModeTabsProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  loginTestID: string;
  registerTestID: string;
};

export function AuthModeTabs({ mode, onModeChange, loginTestID, registerTestID }: AuthModeTabsProps) {
  const theme = useUiTheme();

  return (
    <View style={[styles.tabs, { backgroundColor: theme.colors.muted, borderRadius: theme.radius.full, gap: theme.spacing.xs, padding: theme.spacing.xs }]}>
      <AuthModeTab
        active={mode === 'register'}
        label="Register"
        testID={registerTestID}
        onPress={() => onModeChange('register')}
      />
      <AuthModeTab
        active={mode === 'login'}
        label="Login"
        testID={loginTestID}
        onPress={() => onModeChange('login')}
      />
    </View>
  );
}

function AuthModeTab({
  active,
  label,
  onPress,
  testID,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useUiTheme();

  return (
    <UiPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.tab,
        {
          backgroundColor: active ? theme.colors.background : theme.colors.transparent,
          borderRadius: theme.radius.full,
          minHeight: 48,
        },
      ]}
      testID={testID}
      onPress={onPress}>
      <Typography variant="label" color={active ? 'foreground' : 'mutedForeground'}>
        {label}
      </Typography>
    </UiPressable>
  );
}

type AuthTextFieldProps = {
  errors: unknown[];
  label: string;
  testID: string;
  value: string;
  onBlur: () => void;
  onChangeText: (value: string) => void;
} & Pick<
  ComponentProps<typeof Input>,
  'autoCapitalize' | 'autoComplete' | 'keyboardType' | 'secureTextEntry'
>;

export function AuthTextField({ errors, label, testID, ...inputProps }: AuthTextFieldProps) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        {...inputProps}
        accessibilityLabel={label}
        invalid={errors.length > 0}
        testID={testID}
      />
      <FieldError errors={errors} />
    </Field>
  );
}

type AuthSubmitButtonProps = {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  loading: boolean;
  testID: string;
  onPress: () => void;
};

export function AuthSubmitButton({
  accessibilityLabel,
  disabled,
  label,
  loading,
  onPress,
  testID,
}: AuthSubmitButtonProps) {
  return (
    <Button
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      loading={loading}
      testID={testID}
      onPress={onPress}>
      {label}
    </Button>
  );
}

export function AuthError({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <Typography color="destructive" variant="body" weight="700">
      {message}
    </Typography>
  );
}

const styles = StyleSheet.create({
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
  },
});
