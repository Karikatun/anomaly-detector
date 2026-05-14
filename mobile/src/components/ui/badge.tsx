import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewProps } from 'react-native';

import { getInteractiveColors, renderTextChild, Surface, type UiVariant } from './primitives';
import { useUiTheme } from './theme';

export type BadgeProps = ViewProps & {
  children?: ReactNode;
  variant?: UiVariant;
  textStyle?: StyleProp<TextStyle>;
};

export function badgeVariants(options?: { variant?: UiVariant }) {
  return options ?? {};
}

export function Badge({ children, variant = 'default', style, textStyle, ...props }: BadgeProps) {
  const theme = useUiTheme();
  const colors = getInteractiveColors(theme, variant);

  return (
    <Surface
      {...props}
      tone="transparent"
      style={[
        styles.badge,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: variant === 'outline' ? theme.colors.border : colors.borderColor,
          borderRadius: theme.radius.full,
        },
        style,
      ]}>
      {renderTextChild(children, [{ color: colors.color }, textStyle], undefined, 'caption')}
    </Surface>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
