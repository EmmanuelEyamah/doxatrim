import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface DragHandlers {
  onStart?: (e: ReactPointerEvent) => void;
  /** dx/dy are pixels from the pointer-down position. */
  onMove: (dx: number, dy: number, e: PointerEvent) => void;
  onEnd?: (dx: number, dy: number, e: PointerEvent) => void;
}

/**
 * Pointer-capture based dragging (no dependency): returns an onPointerDown to
 * spread onto the draggable element. Movement is reported in raw pixels; the
 * caller converts through the timeline scale.
 */
export function usePointerDrag(handlers: DragHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    target.setPointerCapture(e.pointerId);
    handlersRef.current.onStart?.(e);

    const onMove = (ev: PointerEvent) => {
      handlersRef.current.onMove(ev.clientX - startX, ev.clientY - startY, ev);
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
      handlersRef.current.onEnd?.(ev.clientX - startX, ev.clientY - startY, ev);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, []);

  return onPointerDown;
}
