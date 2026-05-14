import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Separator } from './separator';
import { Surface, UiText } from './primitives';
import { useUiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

export function Item({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface {...props} tone="transparent" rounded="xl" style={[styles.item, { gap: theme.spacing.md }, style]}>
      {children}
    </Surface>
  );
}

export function ItemMedia({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface
      {...props}
      tone="muted"
      rounded="xl"
      style={[styles.media, { backgroundColor: theme.colors.muted }, style]}>
      {children}
    </Surface>
  );
}

export function ItemContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.content, style]}>
      {children}
    </View>
  );
}

export function ItemActions({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.actions, style]}>
      {children}
    </View>
  );
}

export function ItemGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function ItemSeparator(props: ViewProps) {
  return <Separator {...props} />;
}

export function ItemTitle({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" weight="700" style={style}>
      {children}
    </UiText>
  );
}

export function ItemDescription({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" muted style={style}>
      {children}
    </UiText>
  );
}

export function ItemHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.header, style]}>
      {children}
    </View>
  );
}

export function ItemFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.footer, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
  },
  group: {
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    gap: 8,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    padding: 12,
  },
  media: {
    alignItems: 'center',
    height: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    width: MIN_TOUCH_TARGET,
  },
});
