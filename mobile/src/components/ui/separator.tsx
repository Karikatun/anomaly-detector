import { View, type ViewProps } from 'react-native';

import { useUiTheme } from './theme';

export type SeparatorProps = ViewProps & {
  orientation?: 'horizontal' | 'vertical';
};

export function Separator({ orientation = 'horizontal', style, ...props }: SeparatorProps) {
  const theme = useUiTheme();

  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: theme.colors.border,
          height: orientation === 'horizontal' ? 1 : '100%',
          width: orientation === 'horizontal' ? '100%' : 1,
        },
        style,
      ]}
    />
  );
}
