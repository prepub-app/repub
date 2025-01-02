import { MarginValue, Margin } from "./types";

export function getMargin(margin: MarginValue): Margin {

   /* if (!margin) {
        return {
            top: undefined,
            bottom: undefined,
            left: undefined,
            right: undefined
        }
    }*/
    if (typeof margin === 'number') {
      // Case 1: Single number, applies to all sides
      return { top: margin, bottom: margin, left: margin, right: margin };
    } else if (typeof margin === 'string') {
      // Case 2: Parse space-separated string values
      const values = margin.split(' ').map(Number);
  
      switch (values.length) {
        case 1:
          // Single value
          return { top: values[0], bottom: values[0], left: values[0], right: values[0] };
        case 2:
          // Two values: top/bottom and left/right
          return { top: values[0], bottom: values[0], left: values[1], right: values[1] };
        case 3:
          // Three values: top, left/right, and bottom
          return { top: values[0], bottom: values[2], left: values[1], right: values[1] };
        case 4:
          // Four values: top, right, bottom, left
          return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
        default:
          // Invalid input or more than 4 values
          throw new Error('Invalid margin format');
      }
    } else {
      // Case 3: Object with specific top/bottom/left/right
      return {
        top: margin.top ?? 0,
        bottom: margin.bottom ?? margin.top ?? 0,
        left: margin.left ?? margin.right ?? margin.top ?? 0,
        right: margin.right ?? margin.left ?? margin.top ?? 0,
      };
    }
  }
  