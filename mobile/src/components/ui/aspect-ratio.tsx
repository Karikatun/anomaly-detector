import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { renderTextChild } from './primitives';

export function AspectRatio({
  ratio = 16 / 9,
  children,
  style,
  ...props
}: ViewProps & { ratio?: number; children?: ReactNode }) {
  return (
    <View {...props} style={[{ aspectRatio: ratio, width: '100%' }, style]}>
      {renderTextChild(children)}
    </View>
  );
}
