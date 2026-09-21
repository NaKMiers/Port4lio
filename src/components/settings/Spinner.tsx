import React from 'react'
import { LuLoader2 } from 'react-icons/lu'

export default function Spinner({
  size = 16,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <LuLoader2
      size={size}
      className={`shrink-0 animate-spin ${className}`}
    />
  )
}
