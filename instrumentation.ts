// Open Backup UI v1.0.2
export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build') {
    const {startCapacityCollector}=await import('./lib/server/capacity-collector')
    startCapacityCollector()
    const {startForecastRefresh}=await import('./lib/server/forecast-cache')
    startForecastRefresh()
    const {startSessionThroughputCollector}=await import('./lib/server/session-throughput-collector')
    startSessionThroughputCollector()
  }
}
