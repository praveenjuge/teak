import { useState } from "react";
import { flushSync } from "react-dom";

export function useCloseAfterPaint(open: boolean, onClose?: () => void) {
  const [hidden, setHidden] = useState(false);
  if (hidden && !open) {
    setHidden(false);
  }
  const closeAfterPaint = () => {
    if (!onClose) {
      return;
    }
    flushSync(() => setHidden(true));
    requestAnimationFrame(() => setTimeout(onClose, 0));
  };
  return { closeAfterPaint, hidden };
}
