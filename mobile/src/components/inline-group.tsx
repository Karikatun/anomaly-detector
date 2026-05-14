import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useUiTheme } from '@/components/ui/theme';

type InlineGroupProps = {
  children: ReactNode;
  wrap?: boolean;
};

export function InlineGroup({ children, wrap = true }: InlineGroupProps) {
  const theme = useUiTheme();

  return <View style={[styles.root, { gap: theme.spacing.md }, wrap && styles.wrap]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  wrap: {
    flexWrap: 'wrap',
  },
});
