import { useMemo } from 'react'
import { useSyncStore } from '../utils/sync'

/** 当前榫卯下处于待核对状态的项目。 */
export function useReviews(jointTypeId: string) {
  const reviews = useSyncStore((state) => state.reviews)
  return useMemo(
    () => reviews.filter((review) => review.jointTypeId === jointTypeId && review.status === 'open'),
    [reviews, jointTypeId],
  )
}
