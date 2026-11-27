// Open Backup UI v1.3.0
export const browseCollectionNotFound = 'BROWSE_COLLECTION_NOT_FOUND'

// A cold repository can take several minutes to publish its Explorer collection.
const ownerRetryDelays = [5000, 12000, 25000, 45000, 60000, 90000, 90000]
export function initialOwnerRetryDelay(issue: {code?:string;status?:number}, workingSince: string | undefined, attempt: number, now = Date.now()): number | null {
  const delay = ownerRetryDelays[attempt]
  if (delay === undefined || issue.status !== 404 || issue.code !== browseCollectionNotFound || !workingSince) return null
  const age = now - Date.parse(workingSince)
  const remaining = 10 * 60 * 1000 - age
  return age >= 0 && remaining > 0 ? Math.min(delay,remaining) : null
}

/** One short retry may recover a transient read, but never extends its original deadline. */
export function readRetryDelay(status:number|undefined,retryAfter:string|null,deadline:number,now=Date.now()):number|null {
  if(status!==undefined && ![408,429,502,503,504].includes(status))return null
  let delay=status===429 ? 1000:500
  if(retryAfter?.trim()) {
    const seconds=Number(retryAfter),date=Date.parse(retryAfter)
    if(Number.isFinite(seconds) && seconds>=0)delay=seconds*1000
    else if(Number.isFinite(date))delay=Math.max(0,date-now)
  }
  // Long throttling pauses belong to an explicit user retry. Leave time for the read itself.
  return delay<=5000 && deadline-now>=delay+1000 ? delay:null
}

export function waitForReadRetry(delay:number,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('Read cancelled'))}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},delay)
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
  })
}
