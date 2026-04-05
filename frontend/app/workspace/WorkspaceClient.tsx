'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import SectionHeader from '@/components/ui/SectionHeader'
import { useAuth } from '@/lib/auth'
import { createAuthWebSocket } from '@/lib/ws'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type NodeType = 'note' | 'project' | 'idea' | 'knowledge' | 'custom'
type Visibility = 'private' | 'team' | 'public'

interface CanvasNode {
  id: string
  type: NodeType
  title: string
  body?: string
  x: number
  y: number
  visibility: Visibility
}

const NODE_COLORS: Record<NodeType, string> = {
  note: '#F5C518',
  project: '#FF3B3B',
  idea: '#FF8A2A',
  knowledge: '#3ABEFF',
  custom: '#637080',
}

const NODE_LABELS: Record<NodeType, string> = {
  note: 'NOTE',
  project: 'PROJECT',
  idea: 'IDEA',
  knowledge: 'KNOWLEDGE',
  custom: 'CUSTOM',
}

const VISIBILITY_COLORS: Record<Visibility, string> = {
  private: '#637080',
  team: '#A78BFA',
  public: '#38D37A',
}

const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: '⊘ PRIVATE',
  team: '⬡ TEAM',
  public: '◉ PUBLIC',
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('foundry_token') : null
}

async function fetchCanvas(workspaceId: string): Promise<{ nodes: CanvasNode[]; edges: unknown[] }> {
  try {
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${API_BASE}/api/blueprint?workspace_id=${workspaceId}`, { headers })
    if (!res.ok) return { nodes: [], edges: [] }
    return res.json()
  } catch {
    return { nodes: [], edges: [] }
  }
}

async function saveCanvas(nodes: CanvasNode[], edges: unknown[] = [], workspaceId?: string) {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    await fetch(`${API_BASE}/api/blueprint?workspace_id=${workspaceId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ nodes, edges }),
    })
  } catch {
    // silent fail — canvas is still usable offline
  }
}

export default function WorkspaceClient() {
  const { user } = useAuth()
  const workspaceId = user?.workspace_id || ''
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)
  const [presence, setPresence] = useState(1)
  const [saved, setSaved] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodesRef = useRef(nodes)

  // Keep ref in sync for use inside WS callbacks
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  // ── Load canvas from backend ─────────────────────────────────────────────
  useEffect(() => {
    if (!workspaceId) return
    fetchCanvas(workspaceId).then(data => {
      if (data.nodes && data.nodes.length > 0) {
        setNodes(data.nodes)
      } else {
        setNodes([
          { id: '1', type: 'note', title: 'Welcome to The Blueprint', body: 'Double-click to add nodes. Drag to move.', x: 300, y: 200, visibility: 'team' },
        ])
      }
      setLoaded(true)
    })
  }, [workspaceId])

  // ── Auto-save with debounce ──────────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !workspaceId) return
    setSaved(false)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveCanvas(nodesRef.current, [], workspaceId).then(() => setSaved(true))
    }, 1500)
  }, [nodes, loaded])

  // ── WebSocket for real-time collaboration ─────────────────────────────────
  useEffect(() => {
    if (!workspaceId) return
    let ws: WebSocket | null
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      try {
        ws = createAuthWebSocket(`/ws/blueprint/${workspaceId}`)
        if (!ws) return
        wsRef.current = ws

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'presence') {
              setPresence(msg.count as number)
            } else if (msg.type === 'canvas_op') {
              applyRemoteOp(msg)
            }
          } catch {
            // ignore malformed messages
          }
        }

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000)
        }

        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  function applyRemoteOp(msg: { op_type: string; payload: Record<string, unknown> }) {
    if (msg.op_type === 'add_node') {
      setNodes(prev => {
        if (prev.find(n => n.id === (msg.payload.id as string))) return prev
        return [...prev, msg.payload as unknown as CanvasNode]
      })
    } else if (msg.op_type === 'move_node') {
      setNodes(prev => prev.map(n =>
        n.id === msg.payload.id ? { ...n, x: msg.payload.x as number, y: msg.payload.y as number } : n
      ))
    } else if (msg.op_type === 'delete_node') {
      setNodes(prev => prev.filter(n => n.id !== msg.payload.id))
    } else if (msg.op_type === 'update_node') {
      setNodes(prev => prev.map(n =>
        n.id === msg.payload.id ? { ...n, ...(msg.payload as Partial<CanvasNode>) } : n
      ))
    }
  }

  function broadcastOp(op_type: string, payload: Record<string, unknown>) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'canvas_op', op_type, payload }))
    }
  }

  // ── Keyboard shortcut: Delete/Backspace ──────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setSelected(sel => {
          if (sel) {
            setNodes(prev => prev.filter(n => n.id !== sel))
            broadcastOp('delete_node', { id: sel })
          }
          return null
        })
      }
      if (e.key === 'Escape') {
        setPicker(null)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Canvas coordinate helpers ────────────────────────────────────────────
  function toCanvasCoords(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    }
  }

  // ── Double-click to open node picker ────────────────────────────────────
  function handleDoubleClick(e: React.MouseEvent) {
    if (e.target !== canvasRef.current && !(e.target as HTMLElement).dataset.canvas) return
    const coords = toCanvasCoords(e.clientX, e.clientY)
    setPicker(coords)
  }

  // ── Add node ────────────────────────────────────────────────────────────
  function addNode(type: NodeType) {
    if (!picker) return
    const node: CanvasNode = {
      id: Date.now().toString(),
      type,
      title: `New ${NODE_LABELS[type]}`,
      x: picker.x,
      y: picker.y,
      visibility: 'team',
    }
    setNodes(prev => [...prev, node])
    setPicker(null)
    setSelected(node.id)
    broadcastOp('add_node', node as unknown as Record<string, unknown>)
  }

  // ── Node drag (fixed: accounts for pan offset) ───────────────────────────
  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation()
    setSelected(nodeId)
    setDraggingNode(nodeId)
    const node = nodes.find(n => n.id === nodeId)!
    const rect = canvasRef.current?.getBoundingClientRect()
    const rectLeft = rect?.left ?? 0
    const rectTop = rect?.top ?? 0
    // Offset in canvas-space from grab point to node origin
    setDragOffset({
      x: (e.clientX - rectLeft - pan.x) / zoom - node.x,
      y: (e.clientY - rectTop - pan.y) / zoom - node.y,
    })
  }

  // ── Canvas pan ──────────────────────────────────────────────────────────
  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (e.target !== canvasRef.current && !(e.target as HTMLElement).dataset.canvas) return
    setSelected(null)
    setIsPanning(true)
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  // ── Mouse move: drag or pan ──────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent) {
    if (draggingNode) {
      const rect = canvasRef.current?.getBoundingClientRect()
      const rectLeft = rect?.left ?? 0
      const rectTop = rect?.top ?? 0
      const x = (e.clientX - rectLeft - pan.x) / zoom - dragOffset.x
      const y = (e.clientY - rectTop - pan.y) / zoom - dragOffset.y
      setNodes(prev => prev.map(n => n.id === draggingNode ? { ...n, x, y } : n))
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }

  function handleMouseUp() {
    if (draggingNode) {
      const node = nodesRef.current.find(n => n.id === draggingNode)
      if (node) broadcastOp('move_node', { id: node.id, x: node.x, y: node.y })
    }
    setDraggingNode(null)
    setIsPanning(false)
  }

  // ── Scroll wheel zoom ────────────────────────────────────────────────────
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.max(0.2, Math.min(3, z * delta)))
  }

  function deleteSelected() {
    if (selected) {
      setNodes(prev => prev.filter(n => n.id !== selected))
      broadcastOp('delete_node', { id: selected })
      setSelected(null)
    }
  }

  function updateNodeTitle(id: string, title: string) {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, title } : n))
    broadcastOp('update_node', { id, title })
  }

  function cycleVisibility(id: string) {
    const order: Visibility[] = ['private', 'team', 'public']
    setNodes(prev => prev.map(n => {
      if (n.id !== id) return n
      const next = order[(order.indexOf(n.visibility) + 1) % order.length]
      broadcastOp('update_node', { id, visibility: next })
      return { ...n, visibility: next }
    }))
  }

  const selectedNode = nodes.find(n => n.id === selected)

  return (
    <div style={{ height: 'calc(100vh - 52px - 48px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12, flexShrink: 0 }}>
        <SectionHeader title="Workspace" sublabel="Canvas" accent="#9B7BFF">
          {/* Presence indicator */}
          <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: '#A78BFA' }}>
            ● {presence} ONLINE
          </span>
          <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
            {Math.round(zoom * 100)}% · {saved ? '✓ SAVED' : '● SAVING…'}
          </span>
          {selected && (
            <button onClick={deleteSelected} className="btn btn-ghost btn-sm" style={{ color: '#FF3B3B' }}>
              DELETE NODE
            </button>
          )}
          {selected && selectedNode && (
            <button
              onClick={() => cycleVisibility(selected)}
              className="btn btn-ghost btn-sm"
              style={{ color: VISIBILITY_COLORS[selectedNode.visibility] }}
            >
              {VISIBILITY_LABELS[selectedNode.visibility]}
            </button>
          )}
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="btn btn-ghost btn-sm">
            RESET VIEW
          </button>
        </SectionHeader>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        data-canvas="true"
        className="blueprint-grid"
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 10,
          border: '1px solid rgba(167,139,250,0.15)',
          cursor: isPanning ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      >
        <div
          data-canvas="true"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'absolute',
            inset: 0,
          }}
        >
          {nodes.map(node => {
            const color = NODE_COLORS[node.type]
            const isSelected = selected === node.id
            const visColor = VISIBILITY_COLORS[node.visibility ?? 'team']
            return (
              <div
                key={node.id}
                onMouseDown={e => handleNodeMouseDown(e, node.id)}
                style={{
                  position: 'absolute',
                  left: node.x,
                  top: node.y,
                  width: 210,
                  cursor: draggingNode === node.id ? 'grabbing' : 'grab',
                  borderRadius: 8,
                  border: `1px solid ${isSelected ? color + '80' : 'rgba(255,255,255,0.1)'}`,
                  background: 'rgba(12,16,24,0.92)',
                  backdropFilter: 'blur(20px)',
                  boxShadow: isSelected
                    ? `0 0 0 1px ${color}40, 0 8px 24px rgba(0,0,0,0.5)`
                    : '0 4px 16px rgba(0,0,0,0.4)',
                  transform: 'translate(-50%, -50%)',
                  transition: 'box-shadow 0.15s ease',
                  overflow: 'hidden',
                }}
              >
                {/* Color bar */}
                <div style={{ height: 3, background: color }} />
                <div style={{ padding: '10px 12px 12px' }}>
                  {/* Type label + visibility */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-ibm-plex-mono)',
                        fontSize: 8,
                        color,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {NODE_LABELS[node.type]}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-ibm-plex-mono)',
                        fontSize: 7,
                        color: visColor,
                        letterSpacing: '0.06em',
                      }}
                    >
                      {VISIBILITY_LABELS[node.visibility ?? 'team']}
                    </span>
                  </div>

                  {/* Title */}
                  {isSelected ? (
                    <input
                      value={node.title}
                      onChange={e => updateNodeTitle(node.id, e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                      style={{
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-barlow)',
                        fontWeight: 600,
                        fontSize: 13,
                        width: '100%',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        fontFamily: 'var(--font-barlow)',
                        fontWeight: 600,
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        lineHeight: 1.3,
                      }}
                    >
                      {node.title}
                    </div>
                  )}

                  {node.body && (
                    <div
                      style={{
                        fontFamily: 'var(--font-barlow)',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      {node.body}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Node type picker */}
        {picker && (
          <div
            style={{
              position: 'absolute',
              left: picker.x * zoom + pan.x,
              top: picker.y * zoom + pan.y,
              transform: 'translate(-50%, -110%)',
              zIndex: 100,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div
              className="gl2"
              style={{
                padding: '8px',
                display: 'flex',
                gap: 4,
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
              }}
            >
              {(Object.keys(NODE_COLORS) as NodeType[]).map(type => (
                <button
                  key={type}
                  onClick={() => addNode(type)}
                  style={{
                    padding: '6px 10px',
                    background: `${NODE_COLORS[type]}18`,
                    border: `1px solid ${NODE_COLORS[type]}30`,
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fontSize: 9,
                    color: NODE_COLORS[type],
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {NODE_LABELS[type]}
                </button>
              ))}
              <button
                onClick={() => setPicker(null)}
                style={{
                  padding: '6px 8px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 14,
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Empty state hint */}
        {nodes.length === 0 && loaded && (
          <div
            data-canvas="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 8,
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em' }}>
              DOUBLE-CLICK ANYWHERE TO ADD A NODE
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
