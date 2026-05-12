import { useForm } from '@tanstack/react-form';
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@web-app-demo/contracts';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type AuthMode = 'register' | 'login';

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
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (auth.user) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.dashboard} testID={TEST_IDS.auth.dashboard}>
            <ThemedText type="small" themeColor="textSecondary">
              Current user
            </ThemedText>
            <ThemedText type="title">{auth.user.displayName ?? auth.user.email}</ThemedText>
            <ThemedText themeColor="textSecondary" testID={TEST_IDS.auth.userEmail}>
              {auth.user.email}
            </ThemedText>
            <ThemedView type="backgroundElement" style={styles.factBox}>
              <ThemedText type="smallBold">User ID</ThemedText>
              <ThemedText type="code" themeColor="textSecondary">
                {auth.user.id}
              </ThemedText>
            </ThemedView>
            <Pressable
              accessibilityLabel="Logout"
              accessibilityRole="button"
              style={styles.primaryButton}
              testID={TEST_IDS.auth.logoutButton}
              onPress={() => void auth.logout()}>
              <ThemedText type="smallBold" style={styles.primaryButtonText}>
                Logout
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <ThemedText type="small" themeColor="textSecondary">
                Golden path template
              </ThemedText>
              <ThemedText type="title" style={styles.title}>
                Auth, Zod contracts, Query, and Form are ready.
              </ThemedText>
            </View>

            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={styles.segmented}>
                <Pressable
                  accessibilityLabel="Register"
                  accessibilityRole="button"
                  style={[styles.segment, isRegister && styles.segmentActive]}
                  testID={TEST_IDS.auth.registerTab}
                  onPress={() => setMode('register')}>
                  <ThemedText type="smallBold" themeColor={isRegister ? 'text' : 'textSecondary'}>
                    Register
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityLabel="Login"
                  accessibilityRole="button"
                  style={[styles.segment, !isRegister && styles.segmentActive]}
                  testID={TEST_IDS.auth.loginTab}
                  onPress={() => setMode('login')}>
                  <ThemedText type="smallBold" themeColor={!isRegister ? 'text' : 'textSecondary'}>
                    Login
                  </ThemedText>
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
                    secureTextEntry
                    onBlur={field.handleBlur}
                    onChangeText={field.handleChange}
                    errors={field.state.meta.errors}
                  />
                )}
              </form.Field>

              {error && <ThemedText style={styles.formError}>{error}</ThemedText>}

              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
                {([canSubmit, isSubmitting]) => (
                  <Pressable
                    accessibilityLabel={isRegister ? 'Create account' : 'Login'}
                    accessibilityRole="button"
                    disabled={!canSubmit || isSubmitting}
                    style={[styles.primaryButton, (!canSubmit || isSubmitting) && styles.disabled]}
                    testID={TEST_IDS.auth.submitButton}
                    onPress={() => void form.handleSubmit()}>
                    <ThemedText type="smallBold" style={styles.primaryButtonText}>
                      {isSubmitting ? 'Working...' : isRegister ? 'Create account' : 'Login'}
                    </ThemedText>
                  </Pressable>
                )}
              </form.Subscribe>
            </ThemedView>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
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
      <ThemedText type="smallBold">{label}</ThemedText>
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
  return <ThemedText style={styles.fieldError}>{errors.map(formatError).join(', ')}</ThemedText>;
}

function formatError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Invalid value';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.four,
    gap: Spacing.four,
    flexGrow: 1,
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 40,
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
  fieldError: {
    color: '#B42318',
    fontSize: 13,
    fontWeight: 700,
  },
  formError: {
    color: '#B42318',
    fontWeight: 700,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2D5F35',
    paddingHorizontal: Spacing.three,
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.55,
  },
  dashboard: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  factBox: {
    gap: Spacing.one,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
