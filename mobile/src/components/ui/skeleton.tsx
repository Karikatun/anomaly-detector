import { StyleSheet, View, type ViewProps } from 'react-native';

import { useUiTheme, withAlpha } from './theme';

export function Skeleton({ style, ...props }: ViewProps) {
  const theme = useUiTheme();

  return (
    <View
      {...props}
      style={[
        styles.skeleton,
        { backgroundColor: withAlpha(theme.colors.foreground, theme.scheme === 'dark' ? 0.14 : 0.08) },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    borderRadius: 12,
    height: 16,
  },
});
