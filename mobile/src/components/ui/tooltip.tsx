import { OverlayContent, OverlayRoot, OverlayTrigger } from './overlay';

export const TooltipProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const Tooltip = OverlayRoot;
export const TooltipTrigger = OverlayTrigger;
export const TooltipContent = OverlayContent;
