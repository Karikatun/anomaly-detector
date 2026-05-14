import { StyleSheet, View, type ViewProps } from 'react-native';

import { Button } from './button';
import { useControllableState } from './controllable-state';
import { normalizeSliderValues } from './slider-utils';
import { useUiTheme } from './theme';

export function Slider({
  value,
  defaultValue = [0],
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  style,
  ...props
}: ViewProps & {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const theme = useUiTheme();
  const [values, setValues] = useControllableState({
    value,
    defaultValue: normalizeSliderValues(defaultValue, min, max, step),
    onChange: onValueChange,
  });
  const firstValue = values[0] ?? min;
  const percent = ((firstValue - min) / (max - min || 1)) * 100;

  function update(delta: number) {
    setValues(normalizeSliderValues([firstValue + delta], min, max, step));
  }

  return (
    <View {...props} style={[styles.root, disabled && { opacity: theme.opacity.disabled }, style]}>
      <Button size="icon-xs" variant="outline" disabled={disabled} onPress={() => update(-step)}>
        -
      </Button>
      <View style={[styles.track, { backgroundColor: theme.colors.secondary, borderRadius: theme.radius.full }]}>
        <View
          style={[
            styles.range,
            {
              width: `${Math.max(0, Math.min(100, percent))}%`,
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radius.full,
            },
          ]}
        />
        <View
          style={[
            styles.thumb,
            {
              left: `${Math.max(0, Math.min(100, percent))}%`,
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.primary,
            },
          ]}
        />
      </View>
      <Button size="icon-xs" variant="outline" disabled={disabled} onPress={() => update(step)}>
        +
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  range: {
    height: '100%',
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  thumb: {
    borderRadius: 999,
    borderWidth: 2,
    height: 22,
    marginLeft: -11,
    position: 'absolute',
    top: -7,
    width: 22,
  },
  track: {
    flex: 1,
    height: 8,
  },
});
