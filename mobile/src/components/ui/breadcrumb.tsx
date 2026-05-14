import type { ReactNode } from 'react';
import { StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';

import { UiPressable, UiText } from './primitives';

export function Breadcrumb({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}

export function BreadcrumbList({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.list, style]}>
      {children}
    </View>
  );
}

export function BreadcrumbItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.item, style]}>
      {children}
    </View>
  );
}

export function BreadcrumbLink({ children, style, ...props }: PressableProps & { children?: ReactNode }) {
  return (
    <UiPressable {...props} style={style}>
      <UiText variant="sm" muted>{children}</UiText>
    </UiPressable>
  );
}

export function BreadcrumbPage({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" weight="700" style={style}>
      {children}
    </UiText>
  );
}

export function BreadcrumbSeparator({ children = '>', style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" muted style={style}>
      {children}
    </UiText>
  );
}

export function BreadcrumbEllipsis({ style, ...props }: ViewProps) {
  return (
    <UiText {...props} variant="sm" muted style={style}>
      ...
    </UiText>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  list: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
