import { StyleSheet } from 'react-native';

import { Input, type InputProps } from './input';

export function Textarea({ style, multiline = true, textAlignVertical = 'top', ...props }: InputProps) {
  return (
    <Input
      {...props}
      multiline={multiline}
      textAlignVertical={textAlignVertical}
      style={[styles.textarea, style]}
    />
  );
}

const styles = StyleSheet.create({
  textarea: {
    borderRadius: 18,
    minHeight: 92,
    paddingTop: 12,
  },
});
