import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Surface, UiText } from './primitives';
import { useUiTheme, withAlpha } from './theme';

export type AlertProps = ViewProps & {
  children?: ReactNode;
  variant?: 'default' | 'destructive';
};

export function Alert({ children, variant = 'default', style, ...props }: AlertProps) {
  const theme = useUiTheme();
  const isDestructive = variant === 'destructive';

  return (
    <Surface
      {...props}
      tone="transparent"
      rounded="xl"
      style={[
        styles.alert,
        {
          backgroundColor: isDestructive
            ? withAlpha(theme.colors.destructive, theme.scheme === 'dark' ? 0.18 : 0.08)
            : theme.colors.card,
          borderColor: isDestructive ? withAlpha(theme.colors.destructive, 0.4) : theme.colors.border,
        },
        style,
      ]}>
      {children}
    </Surface>
  );
}

export function AlertTitle({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" weight="700" style={style}>
      {children}
    </UiText>
  );
}

export function AlertDescription({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" muted style={style}>
      {children}
    </UiText>
  );
}

export function AlertAction({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.action, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    marginTop: 4,
  },
  alert: {
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
});
