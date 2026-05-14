import React, { type ReactNode } from 'react';

export function mapTextChildren(
  children: ReactNode,
  wrapText: (child: string | number, index: number) => ReactNode,
) {
  let textIndex = 0;

  function mapNode(node: ReactNode): ReactNode {
    return React.Children.map(node, (child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        const wrapped = wrapText(child, textIndex);
        textIndex += 1;
        return wrapped;
      }

      if (React.isValidElement(child) && child.type === React.Fragment) {
        const fragment = child as React.ReactElement<{ children?: ReactNode }>;
        return React.cloneElement(fragment, undefined, mapNode(fragment.props.children));
      }

      return child;
    });
  }

  return mapNode(children);
}
