import type { ReactNode } from 'react';

import { Surface } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';

type KeyValueCardProps = {
  label: ReactNode;
  value: ReactNode;
};

export function KeyValueCard({ label, value }: KeyValueCardProps) {
  const theme = useUiTheme();

  return (
    <Surface bordered padded style={{ gap: theme.spacing.sm }}>
      <Typography variant="caption" muted>
        {label}
      </Typography>
      <Typography variant="code">{value}</Typography>
    </Surface>
  );
}
