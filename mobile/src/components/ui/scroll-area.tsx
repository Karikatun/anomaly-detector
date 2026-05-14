import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps, type ViewProps } from 'react-native';

export function ScrollArea({ children, ...props }: ScrollViewProps & { children?: ReactNode }) {
  return <ScrollView {...props}>{children}</ScrollView>;
}

export function ScrollBar(props: ViewProps) {
  return <View {...props} />;
}
