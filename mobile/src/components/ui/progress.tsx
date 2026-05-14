import { StyleSheet, View, type ViewProps } from 'react-native';

import { useUiTheme } from './theme';

export type ProgressProps = ViewProps & {
  value?: number | null;
  max?: number;
};

export function Progress({ value = 0, max = 100, style, ...props }: ProgressProps) {
  const theme = useUiTheme();
  const percent = Math.max(0, Math.min(100, ((value ?? 0) / max) * 100));

  return (
    <View
      {...props}
      accessibilityRole="progressbar"
      style={[styles.track, { backgroundColor: theme.colors.secondary, borderRadius: theme.radius.full }, style]}>
      <View
        style={[
          styles.indicator,
          {
            width: `${percent}%`,
            backgroundColor: theme.colors.primary,
            borderRadius: theme.radius.full,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    height: '100%',
  },
  track: {
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
});
