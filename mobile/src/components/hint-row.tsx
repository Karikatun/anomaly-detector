import React, { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';

import { ThemedView } from './themed-view';
import { Typography } from './ui/typography';

import { Spacing } from '@/constants/theme';

type HintRowProps = {
  title?: string;
  hint?: ReactNode;
};

export function HintRow({ title = 'Try editing', hint = 'app/index.tsx' }: HintRowProps) {
  return (
    <View style={styles.stepRow}>
      <Typography variant="bodySm">{title}</Typography>
      <ThemedView type="backgroundSelected" style={styles.codeSnippet}>
        <Typography muted>{hint}</Typography>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeSnippet: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
  },
});
