import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Typography } from './primitives';
import { useUiTheme } from './theme';

export type ChartConfig = Record<string, { label?: ReactNode; color?: string; theme?: { light: string; dark: string } }>;

type ChartContextValue = {
  config: ChartConfig;
};

const ChartContext = createContext<ChartContextValue | null>(null);

export function ChartContainer({ children, config, style, ...props }: ViewProps & { children?: ReactNode; config: ChartConfig }) {
  const theme = useUiTheme();
  return (
    <ChartContext.Provider value={{ config }}>
      <View {...props} style={[styles.container, { borderColor: theme.colors.border }, style]}>
        {children}
      </View>
    </ChartContext.Provider>
  );
}

export function ChartTooltip({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function ChartTooltipContent({ label, payload }: { label?: ReactNode; payload?: { name?: string; value?: ReactNode; color?: string }[] }) {
  return (
    <View style={styles.tooltip}>
      {label ? <Typography variant="bodySm" weight="700">{label}</Typography> : null}
      {payload?.map((item, index) => (
        <Typography key={`${item.name ?? index}`} variant="caption" muted>
          {item.name}: {item.value}
        </Typography>
      ))}
    </View>
  );
}

export function ChartLegend({ children }: { children?: ReactNode }) {
  return <View style={styles.legend}>{children}</View>;
}

export function ChartLegendContent() {
  const context = useContext(ChartContext);
  const theme = useUiTheme();
  return (
    <View style={styles.legend}>
      {Object.entries(context?.config ?? {}).map(([key, item]) => (
        <View key={key} style={styles.legendItem}>
          <View
            style={[
              styles.swatch,
              { backgroundColor: item.theme?.[theme.scheme] ?? item.color ?? theme.colors.primary },
            ]}
          />
          <Typography variant="caption" muted>
            {item.label ?? key}
          </Typography>
        </View>
      ))}
    </View>
  );
}

export function ChartStyle() {
  return null;
}

export function ChartBar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const theme = useUiTheme();
  return (
    <View style={[styles.barTrack, { backgroundColor: theme.colors.muted }]}>
      <View
        style={[
          styles.bar,
          { width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, backgroundColor: color ?? theme.colors.primary },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: '100%',
  },
  barTrack: {
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
    width: '100%',
  },
  container: {
    borderWidth: 1,
    gap: 12,
    padding: 16,
    width: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  swatch: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  tooltip: {
    gap: 4,
  },
});
