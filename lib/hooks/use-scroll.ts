"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Hook to detect if the user has scrolled past a certain threshold.
 * Returns true if scrolled past threshold, false otherwise.
 */
export function useScroll(threshold: number = 10) {
    const [scrolled, setScrolled] = useState(false)

    const onScroll = useCallback(() => {
        setScrolled(window.scrollY > threshold)
    }, [threshold])

    useEffect(() => {
        window.addEventListener("scroll", onScroll)
        onScroll()
        return () => window.removeEventListener("scroll", onScroll)
    }, [onScroll])

    return scrolled
}
