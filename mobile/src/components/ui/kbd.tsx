import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Surface, UiText } from './primitives';
import { useUiTheme } from './theme';

export function Kbd({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface
      {...props}
      tone="muted"
      bordered
      rounded="sm"
      style={[styles.kbd, { paddingHorizontal: theme.spacing.sm }, style]}>
      <UiText variant="mono" weight="700">
        {children}
      </UiText>
    </Surface>
  );
}

export function KbdGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  kbd: {
    alignSelf: 'flex-start',
    minHeight: 24,
    justifyContent: 'center',
  },
});
