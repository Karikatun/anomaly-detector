import type { ReactNode } from 'react';
import type { TextProps } from 'react-native';

import { UiText } from './primitives';

export type LabelProps = TextProps & {
  children?: ReactNode;
};

export function Label({ children, style, ...props }: LabelProps) {
  return (
    <UiText {...props} variant="sm" weight="600" style={style}>
      {children}
    </UiText>
  );
}
