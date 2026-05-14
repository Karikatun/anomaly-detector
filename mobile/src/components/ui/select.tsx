import type { ReactNode } from 'react';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Button, type ButtonProps } from './button';
import { useControllableState } from './controllable-state';
import { OverlayNoop } from './overlay';
import { Separator } from './separator';
import { OverlayFrame, UiPressable, UiText } from './primitives';
import { createMinTouchTargetStyle } from './touch-target';

type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type SelectContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  value?: string;
  setValue: (value: string) => void;
  options: SelectOption[];
  registerOption: (option: SelectOption) => void;
};

const SelectContext = createContext<SelectContextValue | null>(null);

export function Select({
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue: defaultValue ?? '',
    onChange: onValueChange,
  });
  const [currentOpen, setOpen] = useControllableState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  const [options, setOptions] = useState<SelectOption[]>([]);
  const context = useMemo<SelectContextValue>(
    () => ({
      open: currentOpen,
      setOpen,
      value: currentValue,
      setValue,
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
    [currentOpen, currentValue, options, setOpen, setValue],
  );

  return <SelectContext.Provider value={context}>{children}</SelectContext.Provider>;
}

export function SelectTrigger({ children, ...props }: ButtonProps) {
  const context = useContext(SelectContext);
  return (
    <Button
      {...props}
      variant={props.variant ?? 'outline'}
      onPress={(event) => {
        props.onPress?.(event);
        context?.setOpen(true);
      }}>
      {children ?? <SelectValue />}
    </Button>
  );
}

export function SelectValue({ placeholder = 'Select' }: { placeholder?: ReactNode }) {
  const context = useContext(SelectContext);
  const selected = context?.options.find((option) => option.value === context.value);
  return (
    <UiText variant="sm" muted={!selected}>
      {selected?.label ?? placeholder}
    </UiText>
  );
}

export function SelectContent({ children, ...props }: ViewProps & { children?: ReactNode }) {
  const context = useContext(SelectContext);
  return (
    <>
      <View style={styles.hidden}>{children}</View>
      <OverlayFrame
        visible={Boolean(context?.open)}
        scrollable
        onRequestClose={() => context?.setOpen(false)}>
        <View {...props} style={[styles.list, props.style]}>
          {context?.options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </View>
      </OverlayFrame>
    </>
  );
}

export function SelectGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function SelectItem({
  value,
  children,
  disabled,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  value: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const context = useContext(SelectContext);
  const isDisabled = disabled === true;

  React.useEffect(() => {
    context?.registerOption({ value, label: children ?? value, disabled: isDisabled });
  }, [children, context, isDisabled, value]);

  return (
    <UiPressable
      {...props}
      disabled={isDisabled}
      style={[styles.item, style]}
      onPress={(event) => {
        props.onPress?.(event);
        context?.setValue(value);
        context?.setOpen(false);
      }}>
      <UiText variant="sm" weight={context?.value === value ? '700' : '500'}>
        {children}
      </UiText>
    </UiPressable>
  );
}

export function SelectLabel({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <UiText {...props} variant="xs" weight="700" muted style={[styles.label, style]}>
      {children}
    </UiText>
  );
}

export const SelectScrollDownButton = OverlayNoop;
export const SelectScrollUpButton = OverlayNoop;
export const SelectSeparator = Separator;

const styles = StyleSheet.create({
  group: {
    gap: 4,
  },
  hidden: {
    display: 'none',
  },
  item: {
    ...createMinTouchTargetStyle('height'),
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    paddingHorizontal: 10,
  },
  list: {
    gap: 4,
  },
});
