import type { ComponentProps } from 'react';

import { OverlayContent, OverlayDescription, OverlayHeader, OverlayRoot, OverlayTitle, OverlayTrigger } from './overlay';

export const Popover = OverlayRoot;
export const PopoverTrigger = OverlayTrigger;
export const PopoverAnchor = OverlayTrigger;
export const PopoverHeader = OverlayHeader;
export const PopoverTitle = OverlayTitle;
export const PopoverDescription = OverlayDescription;

export function PopoverContent(props: ComponentProps<typeof OverlayContent>) {
  return <OverlayContent {...props} position={props.position ?? 'center'} />;
}
