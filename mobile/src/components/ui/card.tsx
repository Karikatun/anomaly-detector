import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Surface, UiText } from './primitives';
import { useUiTheme } from './theme';

export type CardProps = ViewProps & {
  children?: ReactNode;
  size?: 'default' | 'sm';
};

export function Card({ children, style, size = 'default', ...props }: CardProps) {
  const theme = useUiTheme();

  return (
    <Surface
      {...props}
      tone="card"
      bordered
      rounded="xxl"
      style={[styles.card, { gap: size === 'sm' ? theme.spacing.lg : theme.spacing.xl }, style]}>
      {children}
    </Surface>
  );
}

export function CardHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.header, { paddingHorizontal: theme.spacing.xl }, style]}>
      {children}
    </View>
  );
}

export function CardTitle({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="base" weight="600" style={style}>
      {children}
    </UiText>
  );
}

export function CardDescription({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" muted style={style}>
      {children}
    </UiText>
  );
}

export function CardAction({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.action, style]}>
      {children}
    </View>
  );
}

export function CardContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[{ paddingHorizontal: theme.spacing.xl }, style]}>
      {children}
    </View>
  );
}

export function CardFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.footer, { paddingHorizontal: theme.spacing.xl }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'flex-end',
  },
  card: {
    overflow: 'hidden',
    paddingVertical: 24,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  header: {
    gap: 8,
  },
});
