import type { ReactNode } from 'react';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';

import { Button } from './button';
import { useControllableState } from './controllable-state';
import { OverlayFrame, UiPressable, Typography } from './primitives';
import { Separator } from './separator';

type NativeSelectOptionValue = {
  label: ReactNode;
  value: string;
  disabled?: boolean;
};

type NativeSelectContextValue = {
  value?: string;
  setValue: (value: string) => void;
  options: NativeSelectOptionValue[];
  registerOption: (option: NativeSelectOptionValue) => void;
};

const NativeSelectContext = createContext<NativeSelectContextValue | null>(null);

export function NativeSelect({
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select',
  children,
  style,
  ...props
}: ViewProps & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue: defaultValue ?? '',
    onChange: onValueChange,
  });
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<NativeSelectOptionValue[]>([]);
  const selected = options.find((option) => option.value === currentValue);
  const context = useMemo<NativeSelectContextValue>(
    () => ({
      value: currentValue,
      setValue: (nextValue: string) => setValue(nextValue),
      options,
      registerOption: (option) => {
        setOptions((currentOptions) => {
          if (currentOptions.some((currentOption) => currentOption.value === option.value)) {
            return currentOptions;
          }
          return [...currentOptions, option];
        });
      },
    }),
    [currentValue, options, setValue],
  );

  return (
    <NativeSelectContext.Provider value={context}>
      <View {...props} style={style}>
        <Button variant="outline" onPress={() => setOpen(true)}>
          {selected?.label ?? placeholder}
          {' v'}
        </Button>
        <View style={styles.hidden}>{children}</View>
        <OverlayFrame visible={open} onRequestClose={() => setOpen(false)} scrollable>
          <View style={styles.menu}>
            {options.map((option) => (
              <UiPressable
                key={option.value}
                disabled={option.disabled}
                style={styles.option}
                onPress={() => {
                  setValue(option.value);
                  setOpen(false);
                }}>
                <Typography weight={option.value === currentValue ? '700' : '500'}>{option.label}</Typography>
              </UiPressable>
            ))}
          </View>
        </OverlayFrame>
      </View>
    </NativeSelectContext.Provider>
  );
}

export function NativeSelectOptGroup({ children, label, style, ...props }: ViewProps & { label?: ReactNode; children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {label ? <Typography variant="caption" muted weight="700">{label}</Typography> : null}
      {children}
      <Separator />
    </View>
  );
}

export function NativeSelectOption({
  value,
  children,
  disabled,
}: PressableProps & { value: string; children?: ReactNode }) {
  const context = useContext(NativeSelectContext);
  React.useEffect(() => {
    context?.registerOption({ value, label: children ?? value, disabled: disabled === true });
  }, [children, context, disabled, value]);

  return null;
}

const styles = StyleSheet.create({
  group: {
    gap: 6,
  },
  hidden: {
    display: 'none',
  },
  menu: {
    gap: 4,
  },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
