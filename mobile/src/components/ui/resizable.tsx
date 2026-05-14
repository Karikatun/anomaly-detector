import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useUiTheme } from './theme';

export function ResizablePanelGroup({
  children,
  direction = 'horizontal',
  style,
  ...props
}: ViewProps & { children?: ReactNode; direction?: 'horizontal' | 'vertical' }) {
  return (
    <View
      {...props}
      style={[styles.group, { flexDirection: direction === 'horizontal' ? 'row' : 'column' }, style]}>
      {children}
    </View>
  );
}

export function ResizablePanel({ children, defaultSize = 1, style, ...props }: ViewProps & { children?: ReactNode; defaultSize?: number }) {
  return (
    <View {...props} style={[{ flex: defaultSize }, style]}>
      {children}
    </View>
  );
}

export function ResizableHandle({ style, ...props }: ViewProps) {
  const theme = useUiTheme();
  return <View {...props} style={[styles.handle, { backgroundColor: theme.colors.border }, style]} />;
}

const styles = StyleSheet.create({
  group: {
    overflow: 'hidden',
    width: '100%',
  },
  handle: {
    minHeight: 1,
    minWidth: 1,
  },
});
