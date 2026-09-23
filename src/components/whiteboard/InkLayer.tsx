'use client'

import { useReactFlow, useViewport } from '@xyflow/react'
import { useRef, useState } from 'react'

import {
  INK_SIZE,
  simplifyStroke,
  strokePath,
} from '@/components/whiteboard/ink'
import type { InkPoint } from '@/lib/whiteboard/limits'

/**
 * The pen: a pointer-capture layer over the canvas while the P tool is on.
 *
 * Pointer events rather than mouse events, so an Apple Pencil draws on the md tier with its
 * real pressure (DR8). The live stroke is drawn in screen space; the saved stroke is in canvas
 * space, simplified and capped (ink.ts), with its points made local to the stroke's own
 * top-left so the ink node's box is exactly the stroke's bbox.
 */
export default function InkLayer({
  onStroke,
}: {
  onStroke: (points: InkPoint[], origin: { x: number; y: number }) => void
}) {
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const flowPoints = useRef<InkPoint[]>([])
  const [screen, setScreen] = useState<InkPoint[]>([])
  const drawing = useRef(false)

  const local = (event: React.PointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top] as const
  }
  const pressure = (event: React.PointerEvent) =>
    event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5

  const add = (event: React.PointerEvent) => {
    const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const [sx, sy] = local(event)
    flowPoints.current.push([p.x, p.y, pressure(event)])
    setScreen(prev => [...prev, [sx, sy, pressure(event)]])
  }

  const finish = () => {
    if (!drawing.current) return
    drawing.current = false
    const raw = flowPoints.current
    flowPoints.current = []
    setScreen([])
    if (raw.length < 2) return
    const simplified = simplifyStroke(raw)
    const minX = Math.min(...simplified.map(p => p[0]))
    const minY = Math.min(...simplified.map(p => p[1]))
    const origin = { x: Math.round(minX), y: Math.round(minY) }
    onStroke(
      simplified.map(([x, y, pr]) => [
        Math.round((x - origin.x) * 10) / 10,
        Math.round((y - origin.y) * 10) / 10,
        pr,
      ]),
      origin
    )
  }

  return (
    <div
      ref={layerRef}
      data-testid="wb-ink-layer"
      className="absolute inset-0 z-[4] cursor-crosshair touch-none"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drawing.current = true
        flowPoints.current = []
        setScreen([])
        add(event)
      }}
      onPointerMove={event => {
        if (drawing.current) add(event)
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {screen.length > 1 ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <path
            d={strokePath(screen, INK_SIZE * zoom)}
            className="fill-pp-text"
          />
        </svg>
      ) : null}
    </div>
  )
}
