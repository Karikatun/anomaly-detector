import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';

import { UiText } from './primitives';
import { useUiTheme } from './theme';

export function Table({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View {...props} style={[styles.table, style]}>
        {children}
      </View>
    </ScrollView>
  );
}

export function TableHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.section, style]}>
      {children}
    </View>
  );
}

export function TableBody({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.body, style]}>
      {children}
    </View>
  );
}

export function TableFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.section, style]}>
      {children}
    </View>
  );
}

export function TableHead({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <TableCell {...props} style={style}>
      <UiText variant="sm" weight="700" muted>
        {children}
      </UiText>
    </TableCell>
  );
}

export function TableRow({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.row, { borderBottomColor: theme.colors.border }, style]}>
      {children}
    </View>
  );
}

export function TableCell({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.cell, style]}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <UiText variant="sm">{children}</UiText>
      ) : (
        children
      )}
    </View>
  );
}

export function TableCaption({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="sm" muted style={[styles.caption, style]}>
      {children}
    </UiText>
  );
}

const styles = StyleSheet.create({
  body: {},
  caption: {
    marginTop: 8,
    textAlign: 'center',
  },
  cell: {
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 120,
    paddingHorizontal: 12,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  section: {},
  table: {
    minWidth: 320,
  },
});
