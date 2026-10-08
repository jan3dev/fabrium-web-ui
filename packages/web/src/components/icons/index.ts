/**
 * The only icon import site. Drawn icons are 24×24 filled paths, imported with
 * `?react` (vite-plugin-svgr) and filled with `currentColor`. Glyphs with no drawn
 * icon yet come from lucide-react under the same `NameIcon` scheme, so swapping one
 * for a drawing later is a one-line change here.
 *
 * Icons are `aria-hidden`: they sit inside a labelled control or beside text.
 */

export { default as AppWindowIcon } from "./app-window.svg?react";
export { default as ArrowUpIcon } from "./arrow-up.svg?react";
export { default as ArrowUpRightIcon } from "./arrow-up-right.svg?react";
export { default as CardIcon } from "./card.svg?react";
export { default as CheckIcon } from "./check.svg?react";
export { default as ChevronDownIcon } from "./chevron-down.svg?react";
export { default as ChevronLeftIcon } from "./chevron-left.svg?react";
export { default as ChevronRightIcon } from "./chevron-right.svg?react";
export { default as CloseIcon } from "./close.svg?react";
export { default as CloudConnectionIcon } from "./cloud-connection.svg?react";
export { default as CodeIcon } from "./code.svg?react";
export { default as CoinIcon } from "./coin.svg?react";
export { default as CommentIcon } from "./comment.svg?react";
export { default as CopyIcon } from "./copy.svg?react";
export { default as CpuIcon } from "./cpu.svg?react";
export { default as DiagramIcon } from "./diagram.svg?react";
export { default as DownloadIcon } from "./download.svg?react";
export { default as EllipsisIcon } from "./ellipsis.svg?react";
export { default as ExpandIcon } from "./expand.svg?react";
export { default as FileTextIcon } from "./file-text.svg?react";
export { default as GhostIcon } from "./ghost.svg?react";
export { default as GhostFilledIcon } from "./ghost-filled.svg?react";
export { default as GlobeIcon } from "./globe.svg?react";
export { default as HistoryIcon } from "./history.svg?react";
export { default as ImageIcon } from "./image.svg?react";
export { default as InfoIcon } from "./info.svg?react";
export { default as LayersIcon } from "./layers.svg?react";
export { default as MenuIcon } from "./menu.svg?react";
export { default as PaperclipIcon } from "./paperclip.svg?react";
export { default as PencilIcon } from "./pencil.svg?react";
export { default as PinIcon } from "./pin.svg?react";
export { default as PinOffIcon } from "./pin-off.svg?react";
export { default as PlusIcon } from "./plus.svg?react";
export { default as RotateIcon } from "./rotate.svg?react";
export { default as SearchIcon } from "./search.svg?react";
export { default as SettingsIcon } from "./settings.svg?react";
export { default as ShareIcon } from "./share.svg?react";
export { default as ShieldCheckIcon } from "./shield-check.svg?react";
export { default as SignOutIcon } from "./sign-out.svg?react";
export { default as SquareIcon } from "./square.svg?react";
export { default as StopIcon } from "./stop.svg?react";
export { default as ThemeIcon } from "./theme.svg?react";
export { default as ThemeToggleIcon } from "./theme-toggle.svg?react";
export { default as ThinkingIcon } from "./thinking.svg?react";
export { default as TrashIcon } from "./trash.svg?react";
export { default as UndoIcon } from "./undo.svg?react";
export { default as WarningIcon } from "./warning.svg?react";

// lucide-react fallbacks: no drawn icon exists for these yet.
export {
  ALargeSmall as ALargeSmallIcon,
  Archive as ArchiveIcon,
  ArrowDown as ArrowDownIcon,
  ArrowLeft as ArrowLeftIcon,
  AtSign as AtSignIcon,
  Ban as BanIcon,
  Bell as BellIcon,
  BellOff as BellOffIcon,
  Bold as BoldIcon,
  ChevronsUpDown as ChevronsUpDownIcon,
  ChevronUp as ChevronUpIcon,
  CircleCheck as CircleCheckIcon,
  DoorOpen as DoorOpenIcon,
  FileEdit as FileEditIcon,
  FileSearch as FileSearchIcon,
  Flag as FlagIcon,
  Forward as ForwardIcon,
  Hash as HashIcon,
  House as HomeIcon,
  Italic as ItalicIcon,
  Link2 as LinkIcon,
  List as ListIcon,
  ListChecks as ListChecksIcon,
  ListOrdered as ListOrderedIcon,
  Loader2 as LoaderIcon,
  Lock as LockIcon,
  OctagonX as OctagonXIcon,
  PanelLeft as PanelLeftIcon,
  Quote as QuoteIcon,
  SendHorizontal as SendIcon,
  Smile as SmileIcon,
  SmilePlus as SmilePlusIcon,
  SquareCode as SquareCodeIcon,
  Star as StarIcon,
  Strikethrough as StrikethroughIcon,
  Terminal as TerminalIcon,
  Users as UsersIcon,
} from "lucide-react";
