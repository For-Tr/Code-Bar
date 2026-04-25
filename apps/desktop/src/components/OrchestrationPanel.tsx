import { useMemo } from 'react'
import { useOrchestrationStore } from '../store/orchestrationStore'
import { useSessionStore } from '../store/sessionStore'
import { getDaemonDiagnostics, getDaemonNextAction, listDaemonApprovals, resolveDaemonApproval } from '../services/daemonCommands'

export function OrchestrationPanel() {
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId)
  const sessions = useSessionStore((s) => s.sessions)
  const approvalsBySessionId = useOrchestrationStore((s) => s.approvalsBySessionId)
  const nextActionBySessionId = useOrchestrationStore((s) => s.nextActionBySessionId)
  const diagnosticsBySessionId = useOrchestrationStore((s) => s.diagnosticsBySessionId)
  const setApprovals = useOrchestrationStore((s) => s.setApprovals)
  const setNextAction = useOrchestrationStore((s) => s.setNextAction)
  const setDiagnostics = useOrchestrationStore((s) => s.setDiagnostics)

  const session = useMemo(() => sessions.find((item) => item.id === expandedSessionId) ?? null, [expandedSessionId, sessions])

  const refresh = async () => {
    if (!session) return
    const [nextAction, approvalsResult, diagnostics] = await Promise.all([
      getDaemonNextAction(session.id).catch(() => null),
      listDaemonApprovals(session.id).catch(() => ({ requests: [] })),
      getDaemonDiagnostics(session.id, session.taskId).catch(() => null),
    ])
    if (nextAction) setNextAction(session.id, nextAction)
    setApprovals(
      session.id,
      (approvalsResult.requests ?? []).map((request) => ({
        id: String(request.id ?? ''),
        sessionId: String(request.sessionId ?? session.id),
        taskId: String(request.taskId ?? ''),
        actionType: String(request.actionType ?? ''),
        title: String(request.title ?? ''),
        description: String(request.description ?? ''),
        status: String(request.status ?? ''),
      }))
    )
    if (diagnostics) setDiagnostics(session.id, diagnostics)
  }

  if (!session) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ci-text-dim)', fontSize: 12 }}>
        Select a session to inspect orchestration state.
      </div>
    )
  }

  const approvals = approvalsBySessionId[session.id] ?? []
  const nextAction = nextActionBySessionId[session.id]
  const diagnostics = diagnosticsBySessionId[session.id]

  return (
    <div style={{ width: '100%', height: '100%', padding: 10, boxSizing: 'border-box', display: 'grid', gap: 10, alignContent: 'start', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ci-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Orchestration
        </div>
        <button
          onClick={() => void refresh()}
          style={{ background: 'var(--ci-btn-ghost-bg)', border: '1px solid var(--ci-toolbar-border)', color: 'var(--ci-text-muted)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      <div style={{ padding: '8px 9px', borderRadius: 10, background: 'var(--ci-surface)', border: '1px solid var(--ci-toolbar-border)', display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 10, color: 'var(--ci-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next action</div>
        <div style={{ fontSize: 12, color: 'var(--ci-text)' }}>{nextAction?.recommendedNextCalls.join(', ') || '—'}</div>
        {nextAction?.step?.title && <div style={{ fontSize: 11, color: 'var(--ci-text-dim)' }}>{nextAction.step.title}</div>}
      </div>

      <div style={{ padding: '8px 9px', borderRadius: 10, background: approvals.length > 0 ? 'var(--ci-yellow-bg)' : 'var(--ci-surface)', border: '1px solid var(--ci-toolbar-border)', display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--ci-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Approvals</div>
        {approvals.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ci-text-dim)' }}>No pending approvals.</div>
        ) : approvals.map((approval) => (
          <div key={approval.id} style={{ display: 'grid', gap: 6, paddingTop: 4, borderTop: '1px solid var(--ci-toolbar-border)' }}>
            <div style={{ fontWeight: 600 }}>{approval.title}</div>
            <div style={{ color: 'var(--ci-text-dim)', fontSize: 11 }}>{approval.description}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  void resolveDaemonApproval(approval.id, 'approved').then(() => {
                    void refresh()
                  })
                }}
                style={{ background: 'var(--ci-accent-bg)', border: '1px solid var(--ci-accent-bdr)', color: 'var(--ci-accent)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                Approve
              </button>
              <button
                onClick={() => {
                  void resolveDaemonApproval(approval.id, 'rejected').then(() => {
                    void refresh()
                  })
                }}
                style={{ background: 'var(--ci-deleted-bg)', border: '1px solid var(--ci-toolbar-border)', color: 'var(--ci-deleted-text)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 9px', borderRadius: 10, background: 'var(--ci-surface)', border: '1px solid var(--ci-toolbar-border)', display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 10, color: 'var(--ci-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Diagnostics</div>
        <div style={{ fontSize: 11, color: 'var(--ci-text)' }}>{diagnostics?.summary || 'No diagnostics loaded.'}</div>
        {diagnostics?.files?.length ? (
          <div style={{ fontSize: 10, color: 'var(--ci-text-dim)' }}>{diagnostics.files.length} files</div>
        ) : null}
      </div>
    </div>
  )
}
