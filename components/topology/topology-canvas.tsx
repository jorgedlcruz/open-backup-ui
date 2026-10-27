'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Node, type NodeProps, type Edge, type ReactFlowInstance } from '@xyflow/react'
import { useTheme } from 'next-themes'
import { Box, BriefcaseBusiness, Database, Loader2 } from 'lucide-react'
import type { TopologyEntity, TopologyGraph } from '@/lib/topology/model'

type EntityNode = Node<{ entity: TopologyEntity; dimmed: boolean; active: boolean; onSelect: (id: string) => void }, 'entity'>
const icons = { workload: Box, job: BriefcaseBusiness, repository: Database }
const colors = { workload: '#38bdf8', job: '#a78bfa', repository: '#2dd4bf' }

const TopologyNode = memo(function TopologyNode({ data }: NodeProps<EntityNode>) {
  const { entity, dimmed } = data
  const Icon = icons[entity.kind]
  return (
    <button type="button" aria-label={`${entity.kind}: ${entity.name}. ${entity.status}`} aria-pressed={data.active}
      onClick={event => { event.stopPropagation(); data.onSelect(entity.id) }} className={`topology-node text-left ${data.active ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''}`} style={{ borderTopColor: colors[entity.kind] }}>
      {entity.kind !== 'workload' && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-muted p-2" style={{ color: colors[entity.kind] }}><Icon size={18} /></span>
        <div className="min-w-0"><div className="truncate font-semibold text-sm" title={entity.name}>{entity.name}</div>
          <div className="truncate text-xs text-muted-foreground">{entity.subtitle}</div></div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`size-1.5 rounded-full ${entity.health === 'attention' ? 'bg-amber-500' : entity.health === 'healthy' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        {entity.status}
      </div>
      {entity.kind !== 'repository' && <Handle type="source" position={Position.Right} />}
    </button>
  )
})

const nodeTypes = { entity: TopologyNode }

export default function TopologyCanvas({ graph, selectedId, highlightedIds, highlightedLinkIds, onSelect }: {
  graph: TopologyGraph; selectedId: string | null; highlightedIds: Set<string>; highlightedLinkIds: Set<string>; onSelect: (id: string | null) => void
}) {
  const { resolvedTheme } = useTheme()
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [layoutError, setLayoutError] = useState(false)
  const [layingOut, setLayingOut] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<ReactFlowInstance<EntityNode> | null>(null)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(() => { void instance.current?.fitView({ padding: 0.15, maxZoom: 1 }) })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [layingOut])
  useEffect(() => {
    let cancelled = false
    setLayingOut(true)
    setLayoutError(false)
    async function layout() {
      try {
        const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
        const elk = new ELK()
        const result = await elk.layout({
          id: 'protection',
          layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.separateConnectedComponents': 'false',
            'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '110',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' },
          children: graph.entities.map(entity => ({ id: entity.id, width: 244, height: 110 })),
          edges: graph.links.map(link => ({ id: link.id, sources: [link.source], targets: [link.target] })),
        })
        if (!cancelled) setPositions(new Map(result.children?.map(n => [n.id, { x: n.x || 0, y: n.y || 0 }]) || []))
      } catch {
        // Keep the view usable if automatic layout fails.
        const rows = { workload: 0, job: 0, repository: 0 }
        const columns = { workload: 0, job: 1, repository: 2 }
        if (!cancelled) {
          setLayoutError(true)
          setPositions(new Map(graph.entities.map(e => [e.id, { x: columns[e.kind] * 360, y: rows[e.kind]++ * 138 }])))
        }
      } finally { if (!cancelled) setLayingOut(false) }
    }
    void layout()
    return () => { cancelled = true }
  }, [graph])

  const nodes: EntityNode[] = useMemo(() => graph.entities.map(entity => ({
    id: entity.id, type: 'entity', width: 244, height: 110, measured: { width: 244, height: 110 }, position: positions.get(entity.id) || { x: 0, y: 0 },
    data: { entity, dimmed: !!selectedId && !highlightedIds.has(entity.id), active: selectedId === entity.id, onSelect },
    ariaLabel: `${entity.kind}: ${entity.name}. ${entity.status}. Press Enter to inspect.`,
  })), [graph, positions, selectedId, highlightedIds, onSelect])
  const edges: Edge[] = useMemo(() => graph.links.map(link => ({
    ...link, type: 'smoothstep',
    style: { stroke: selectedId && highlightedLinkIds.has(link.id) ? 'var(--ops-accent)' : 'var(--muted-foreground)', strokeWidth: selectedId && highlightedLinkIds.has(link.id) ? 2.5 : 1.5,
      opacity: selectedId && !highlightedLinkIds.has(link.id) ? 0.1 : 0.65 },
    focusable: false,
  })), [graph, selectedId, highlightedLinkIds])

  if (layingOut) return <div className="flex h-full items-center justify-center gap-2 text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />Arranging protection paths…</div>
  return (
    <div ref={container} className="h-full w-full" aria-label="Protection relationship map">
      {layoutError && <p className="absolute z-10 bg-background p-2 text-xs" role="status">Automatic layout unavailable. Using a column layout.</p>}
      <ReactFlow<EntityNode> key={graph.entities.map(e => e.id).join('|')} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onInit={flow => { instance.current = flow; void flow.fitView({ padding: 0.15, maxZoom: 1 }) }}
        onNodeClick={(_, node) => onSelect(node.id)} onPaneClick={() => onSelect(null)}
        elementsSelectable={false} nodesFocusable={false} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
        fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.08} maxZoom={1.6}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}>
        <Background gap={22} size={1} color={resolvedTheme === 'dark' ? '#334155' : '#cbd5e1'} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={node => colors[(node.data.entity as TopologyEntity).kind]} pannable zoomable className="!hidden sm:!block" />
      </ReactFlow>
    </div>
  )
}
