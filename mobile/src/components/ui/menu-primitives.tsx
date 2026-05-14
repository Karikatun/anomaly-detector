import type { ReactNode } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Checkbox } from './checkbox';
import { RadioGroupItem } from './radio-group';
import { Separator } from './separator';
import { renderTextChild, UiPressable, UiText } from './primitives';
import { useUiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

export function MenuGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function MenuLabel({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="xs" weight="700" muted style={[styles.label, style]}>
      {children}
    </UiText>
  );
}

export function MenuItem({
  children,
  inset,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  children?: ReactNode;
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <UiPressable {...props} accessibilityRole="menuitem" style={[styles.item, inset && styles.inset, style]}>
      {renderTextChild(children)}
    </UiPressable>
  );
}

export function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
  ...props
}: Omit<PressableProps, 'style'> & {
  children?: ReactNode;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <MenuItem
      {...props}
      onPress={(event) => {
        props.onPress?.(event);
        onCheckedChange?.(!checked);
      }}>
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <UiText variant="sm">{children}</UiText>
    </MenuItem>
  );
}

export function MenuRadioItem({
  children,
  value,
  ...props
}: Omit<PressableProps, 'style'> & { children?: ReactNode; value: string; style?: StyleProp<ViewStyle> }) {
  return (
    <MenuItem {...props}>
      <RadioGroupItem value={value} />
      <UiText variant="sm">{children}</UiText>
    </MenuItem>
  );
}

export function MenuSeparator(props: ViewProps) {
  return <Separator {...props} />;
}

export function MenuShortcut({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="xs" muted style={[styles.shortcut, style]}>
      {children}
    </UiText>
  );
}

export function MenuSubTrigger({
  children,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <MenuItem {...props}>{children} &gt;</MenuItem>;
}

export function MenuSubContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.subContent, { borderColor: theme.colors.border }, style]}>
      {children}
    </View>
  );
}

export function MenuNoop({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

const styles = StyleSheet.create({
  group: {
    gap: 4,
  },
  inset: {
    paddingLeft: 32,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  shortcut: {
    marginLeft: 'auto',
  },
  subContent: {
    borderLeftWidth: 1,
    gap: 4,
    marginLeft: 16,
    paddingLeft: 8,
  },
});
