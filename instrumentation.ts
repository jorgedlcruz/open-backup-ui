export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build') {
    const {startCapacityCollector}=await import('./lib/server/capacity-collector')
    startCapacityCollector()
  }
}
