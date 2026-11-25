/**
 * Icons whose lucide names are easy to mix up.
 *
 * lucide-react 1.x renamed the flip icons after the axis they draw, and kept the old names as
 * aliases that now point the "wrong" way for us: `FlipHorizontal2` draws a horizontal axis with
 * carets above and below (an upside-down flip), `FlipVertical2` the left/right one. Always use these.
 */
export {
  /** Mirror left ↔ right: carets either side of a vertical dashed axis. */
  CaretsToAxisDashedVertical as FlipLeftRight,
  /** Flip upside down: carets above and below a horizontal dashed axis. */
  CaretsToAxisDashedHorizontal as FlipUpDown,
} from 'lucide-react';
