import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps, type ViewProps } from 'react-native';

import { renderTextChild } from './primitives';

export function ScrollArea({ children, ...props }: ScrollViewProps & { children?: ReactNode }) {
  return <ScrollView {...props}>{renderTextChild(children)}</ScrollView>;
}

export function ScrollBar(props: ViewProps) {
  return <View {...props} />;
}
