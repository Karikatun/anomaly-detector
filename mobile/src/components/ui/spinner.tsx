import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';

import { useUiTheme } from './theme';

export function Spinner({ color, size = 'small', ...props }: ActivityIndicatorProps) {
  const theme = useUiTheme();
  return <ActivityIndicator {...props} color={color ?? theme.colors.foreground} size={size} />;
}
