import { useForm } from '@tanstack/react-form';
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@web-app-demo/contracts';
import type { ComponentProps } from 'react';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type AuthMode = 'register' | 'login';
const isE2eMode = process.env.EXPO_PUBLIC_E2E === '1';

export default function HomeScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('register');
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === 'register';

  const form = useForm({
    defaultValues: {
      displayName: '' as string | undefined,
      email: '',
      password: '',
    },
    validators: {
      onChange: ({ value }) => {
        const result = registerRequestSchema.safeParse(value);
        return result.success ? undefined : result.error.issues;
      },
    },
    onSubmit: async ({ value }) => {
      setError(null);

      try {
        if (isRegister) {
          await auth.register(registerRequestSchema.parse(value) as RegisterRequest);
        } else {
          await auth.login(loginRequestSchema.parse(value) as LoginRequest);
        }
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setError(caughtError.message);
          return;
        }
        setError('Unexpected auth error');
      }
    },
  });

  if (auth.isBootstrapping) {
    return (
      <Screen centered padded={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (auth.user) {
    return <Redirect href="/components" />;
  }

  return (
    <Screen
      centered
      keyboardAvoiding
      padded={false}
      scroll
      contentStyle={styles.scrollContent}
      scrollViewProps={{
        keyboardDismissMode: 'on-drag',
        keyboardShouldPersistTaps: 'handled',
        showsVerticalScrollIndicator: false,
      }}>
      <View style={styles.header}>
        <Typography variant="bodySm" muted>
          Golden path template
        </Typography>
        <Typography variant="h1" style={styles.title}>
          Auth, Zod contracts, Query, and Form are ready.
        </Typography>
      </View>

      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.segmented}>
          <Pressable
            accessibilityLabel="Register"
            accessibilityRole="button"
            style={[styles.segment, isRegister && styles.segmentActive]}
            testID={TEST_IDS.auth.registerTab}
            onPress={() => setMode('register')}>
            <Typography variant="label" color={isRegister ? 'foreground' : 'mutedForeground'}>
              Register
            </Typography>
          </Pressable>
          <Pressable
            accessibilityLabel="Login"
            accessibilityRole="button"
            style={[styles.segment, !isRegister && styles.segmentActive]}
            testID={TEST_IDS.auth.loginTab}
            onPress={() => setMode('login')}>
            <Typography variant="label" color={!isRegister ? 'foreground' : 'mutedForeground'}>
              Login
            </Typography>
          </Pressable>
        </View>

        {isRegister && (
          <form.Field name="displayName">
            {(field) => (
              <Field
                label="Name"
                testID={TEST_IDS.auth.nameInput}
                value={field.state.value ?? ''}
                autoComplete="name"
                onBlur={field.handleBlur}
                onChangeText={field.handleChange}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
        )}

        <form.Field name="email">
          {(field) => (
            <Field
              label="Email"
              testID={TEST_IDS.auth.emailInput}
              value={field.state.value}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field
              label="Password"
              testID={TEST_IDS.auth.passwordInput}
              value={field.state.value}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              secureTextEntry={!isE2eMode}
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>

        {error && (
          <Typography color="destructive" variant="body" weight="700">
            {error}
          </Typography>
        )}

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Pressable
              accessibilityLabel={isRegister ? 'Create account' : 'Login'}
              accessibilityRole="button"
              disabled={!canSubmit || isSubmitting}
              style={[styles.primaryButton, (!canSubmit || isSubmitting) && styles.disabled]}
              testID={TEST_IDS.auth.submitButton}
              onPress={() => void form.handleSubmit()}>
              <Typography colorValue="#FFFFFF" variant="button">
                {isSubmitting ? 'Working...' : isRegister ? 'Create account' : 'Login'}
              </Typography>
            </Pressable>
          )}
        </form.Subscribe>
      </ThemedView>
    </Screen>
  );
}

type FieldProps = {
  label: string;
  testID: string;
  value: string;
  errors: unknown[];
  onBlur: () => void;
  onChangeText: (value: string) => void;
} & Pick<
  ComponentProps<typeof TextInput>,
  'autoCapitalize' | 'autoComplete' | 'keyboardType' | 'secureTextEntry'
>;

function Field({ label, testID, value, errors, onBlur, onChangeText, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Typography variant="label">{label}</Typography>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        value={value}
        onBlur={onBlur}
        onChangeText={onChangeText}
        placeholderTextColor="#879182"
        style={styles.input}
        testID={testID}
      />
      <FieldErrors errors={errors} />
    </View>
  );
}

function FieldErrors({ errors }: { errors: unknown[] }) {
  if (!errors.length) return null;
  return (
    <Typography color="destructive" variant="bodyXs" weight="700">
      {errors.map(formatError).join(', ')}
    </Typography>
  );
}

function formatError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Invalid value';
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  title: {
    maxWidth: 520,
  },
  card: {
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  segmented: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.one,
    borderRadius: Spacing.two,
    backgroundColor: '#DCE5D7',
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
  },
  field: {
    gap: Spacing.two,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#C2CCBD',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    color: '#172018',
    backgroundColor: '#FFFFFF',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2D5F35',
    paddingHorizontal: Spacing.three,
  },
  disabled: {
    opacity: 0.55,
  },
});
