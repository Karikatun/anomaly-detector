import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Label, type LabelProps } from './label';
import { Separator } from './separator';
import { UiText } from './primitives';
import { useUiTheme } from './theme';

export function Field({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.field, { gap: theme.spacing.sm }, style]}>
      {children}
    </View>
  );
}

export function FieldLabel({ children, ...props }: LabelProps) {
  return <Label {...props}>{children}</Label>;
}

export function FieldDescription({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" muted style={style}>
      {children}
    </UiText>
  );
}

export function FieldError({ children, errors, style, ...props }: ViewProps & { children?: ReactNode; errors?: unknown[] }) {
  const theme = useUiTheme();
  const content = children ?? errors?.map(formatFieldError).join(', ');
  if (!content) return null;

  return (
    <UiText {...props} variant="sm" weight="700" style={[{ color: theme.colors.destructive }, style]}>
      {content}
    </UiText>
  );
}

export function FieldGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.group, { gap: theme.spacing.lg }, style]}>
      {children}
    </View>
  );
}

export function FieldLegend({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="base" weight="700" style={style}>
      {children}
    </UiText>
  );
}

export function FieldSeparator(props: ViewProps) {
  return <Separator {...props} />;
}

export function FieldSet({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.set, style]}>
      {children}
    </View>
  );
}

export function FieldContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.content, style]}>
      {children}
    </View>
  );
}

export function FieldTitle({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" weight="700" style={style}>
      {children}
    </UiText>
  );
}

function formatFieldError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Invalid value';
}

const styles = StyleSheet.create({
  content: {
    gap: 4,
  },
  field: {},
  group: {},
  set: {
    gap: 12,
  },
});
