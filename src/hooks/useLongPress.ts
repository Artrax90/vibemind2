import { useCallback, useRef } from 'react';

export function useLongPress(
  onLongPress: (e: any) => void,
  onClick?: (e: any) => void,
  { shouldPreventDefault = false, delay = 500 } = {}
) {
  const timeout = useRef<NodeJS.Timeout>();
  const target = useRef<EventTarget>();
  const longPressTriggered = useRef(false);

  const start = useCallback(
    (event: any) => {
      longPressTriggered.current = false;
      if (shouldPreventDefault && event.target) {
        event.target.addEventListener('touchend', preventDefault, {
          passive: false
        });
        target.current = event.target;
      }
      timeout.current = setTimeout(() => {
        longPressTriggered.current = true;
        onLongPress(event);
      }, delay);
    },
    [onLongPress, delay, shouldPreventDefault]
  );

  const clear = useCallback(
    (event: any, shouldTriggerClick = true) => {
      timeout.current && clearTimeout(timeout.current);
      if (shouldTriggerClick && !longPressTriggered.current && onClick) {
        onClick(event);
      }
      if (shouldPreventDefault && target.current) {
        target.current.removeEventListener('touchend', preventDefault);
      }
    },
    [shouldPreventDefault, onClick]
  );

  return {
    onMouseDown: (e: any) => start(e),
    onTouchStart: (e: any) => start(e),
    onMouseUp: (e: any) => clear(e),
    onMouseLeave: (e: any) => clear(e, false),
    onTouchEnd: (e: any) => clear(e)
  };
}

const preventDefault = (event: Event) => {
  if (!('touches' in event)) return;
  if ((event as TouchEvent).touches.length < 2 && event.preventDefault) {
    event.preventDefault();
  }
};
