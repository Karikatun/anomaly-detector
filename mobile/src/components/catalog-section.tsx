import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Typography } from '@/components/ui/typography';
import { useUiTheme } from '@/components/ui/theme';

type CatalogSectionProps = {
  children: ReactNode;
  title: ReactNode;
};

export function CatalogSection({ children, title }: CatalogSectionProps) {
  const theme = useUiTheme();
  const sectionStyle = { gap: theme.spacing.md };

  return (
    <View style={sectionStyle}>
      <Typography variant="bodyLg" weight="700">
        {title}
      </Typography>
      <View style={sectionStyle}>{children}</View>
    </View>
  );
}
