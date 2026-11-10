// Open Backup UI v1.0.2
/** Each caption appears once per shuffled cycle, including across short-lived loading panels. */
export function shuffledCycle<T>(choices: readonly [T, ...T[]], random: () => number = Math.random) {
  let queue: T[] = []
  let previous: T | undefined
  return () => {
    if (!queue.length) {
      queue = [...choices]
      for (let i = queue.length - 1; i > 0; i--) {
        const index = Math.floor(random() * (i + 1))
        const entry = queue[i]
        queue[i] = queue[index]
        queue[index] = entry
      }
      const last = queue.length - 1
      if (last > 0 && queue[last] === previous) [queue[0], queue[last]] = [queue[last], queue[0]]
    }
    previous = queue.pop()!
    return previous
  }
}

export const workshopCaptions = [
  'Tightening a loose bolt on the server rack.',
  'Giving the tape reels a little spin.',
  'Looking for the tiny screwdriver.',
  'Coiling a spare patch cable.',
  'Counting the spare screws in the tray.',
  'The little fan has the night shift.',
  'Checking which way up the USB plug goes.',
  'A few dots are doing the talking.',
  'The cursor has taken the night shift.',
  'The cursor got here first.',
  'Dusting off the time machine’s keyboard.',
  'Labeling both ends of the same cable.',
  'Saving the last rack screw for later.',
  'Asking the blinking lights for directions.',
] as const

export const nextWorkshopCaption = shuffledCycle(workshopCaptions)
