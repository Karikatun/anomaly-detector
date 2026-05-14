import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@/components/ui/typography';
import { useUiTheme } from '@/components/ui/theme';

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  descriptionTestID?: string;
  eyebrow?: ReactNode;
  rootTestID?: string;
  size?: 'default' | 'hero';
  title: ReactNode;
  titleTestID?: string;
};

export function PageHeader({
  actions,
  description,
  descriptionTestID,
  eyebrow,
  rootTestID,
  size = 'default',
  title,
  titleTestID,
}: PageHeaderProps) {
  const theme = useUiTheme();
  const hasActions = Boolean(actions);
  const titleVariant = size === 'hero' ? 'h1' : 'h4';

  return (
    <View testID={rootTestID} style={[styles.root, hasActions && styles.withActions, { gap: theme.spacing.lg }]}>
      <View style={[styles.copy, { gap: theme.spacing.xs }]}>
        {eyebrow ? (
          <Typography variant="caption" muted>
            {eyebrow}
          </Typography>
        ) : null}
        <Typography variant={titleVariant} weight="700" testID={titleTestID}>
          {title}
        </Typography>
        {description ? (
          <Typography variant="bodySm" muted testID={descriptionTestID}>
            {description}
          </Typography>
        ) : null}
      </View>
      {hasActions ? <View style={[styles.actions, { gap: theme.spacing.sm }]}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  root: {
    alignItems: 'flex-start',
  },
  withActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
});
