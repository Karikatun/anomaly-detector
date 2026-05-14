import type { ReactNode } from 'react';
import type { TextProps } from 'react-native';

import { Typography } from './primitives';

export type LabelProps = TextProps & {
  children?: ReactNode;
};

export function Label({ children, style, ...props }: LabelProps) {
  return (
    <Typography {...props} variant="bodySm" weight="600" style={style}>
      {children}
    </Typography>
  );
}
