'use client'
// Open Backup UI v1.0.2

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Activity, AlertTriangle, BrainCircuit, ChevronDown, FileClock, Info, LayoutDashboard, Lightbulb, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'
import remarkGfm from 'remark-gfm'
import { useI18n } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import { healthAlertPrefix, healthConfidence, healthSectionTitle, healthSummaryError } from '@/lib/ai-integrations/health-presentation'
import { HEALTH_STREAM_TYPE, HealthSummaryError, readHealthSummaryResponse } from '@/lib/ai-integrations/health-stream'
import { providers } from '@/lib/ai-integrations/model'
import { readHealthSections } from '@/lib/ai-integrations/health-sections'
import { HealthPdfExport } from '@/components/ai-health-pdf-export'
import styles from './ai-health-summary.module.css'

function sectionIcon(title: string) {
  switch (title.split('|')[0].trim().toLowerCase()) {
    case 'operations health': return Activity
    case 'security posture': return ShieldCheck
    case 'audit events': return FileClock
    default: return LayoutDashboard
  }
}

function nodeText(nodes: React.ReactNode): string {
  let text = ''
  React.Children.forEach(nodes, child => {
    if (typeof child === 'string') text += child
    else if (React.isValidElement<{ children?: React.ReactNode }>(child)) text += nodeText(child.props.children)
  })
  return text
}

function SummaryMarkdown({ content }: { content: string }) {
  const { t } = useI18n()
  return <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1: () => null,
    p: ({ node, children, ...props }) => {
      void node
      const text = nodeText(children).trim()
      const urgent = text.toLowerCase().startsWith('urgent:') || text.startsWith(t('Urgent:'))
      const recommendation = text.toLowerCase().startsWith('recommendation:') || text.startsWith(t('Recommendation:'))
      if (!urgent && !recommendation) return <p {...props}>{children}</p>
      let prefixPending = true
      const localizePrefix = (nodes: React.ReactNode): React.ReactNode => React.Children.map(nodes, child => {
        if (!prefixPending) return child
        if (typeof child === 'string') {
          if (!child.trim()) return child
          prefixPending = false
          return healthAlertPrefix(t, child)
        }
        if (React.isValidElement<{ children?: React.ReactNode }>(child)) return React.cloneElement(child, {}, localizePrefix(child.props.children))
        return child
      })
      const Icon = urgent ? AlertTriangle : Lightbulb
      return <div className={styles.callout} data-tone={urgent ? 'danger' : 'recommendation'}><Icon size={17} aria-hidden="true" /><div>{localizePrefix(children)}</div></div>
    },
    table: ({ node, ...props }) => { void node; return <div className={styles.tableScroll}><table {...props} /></div> },
  }}>{content}</ReactMarkdown></div>
}

type SummaryPanelProps = {
  completion: string
  isLoading: boolean
  error: Error | null
  hasGenerated: boolean
  generatedAt?: Date
  onGenerate: () => void
}

/** Presentation is shared by ready, streaming, empty and error states. */
export function AiHealthSummaryPanel({ completion, isLoading, error, hasGenerated, generatedAt, onGenerate }: SummaryPanelProps) {
  const { t, locale } = useI18n()
  const [activeSection, setActiveSection] = useState('0')
  const [expanded, setExpanded] = useState(true)
  const id = useId()
  const sections = useMemo(() => readHealthSections(completion, t('Overview')), [completion, t])
  const selected = Number(activeSection) < sections.length ? activeSection : '0'
  const hasBody = hasGenerated || isLoading || !!error || sections.length > 0
  const generate = () => { setExpanded(true); setActiveSection('0'); onGenerate() }
  const problem = error instanceof HealthSummaryError ? error.problem : null

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <div className={styles.identity}><span className={styles.identityIcon}><Sparkles size={20} strokeWidth={1.75} aria-hidden="true" /></span><div><h2 id={`${id}-title`}>{t('AI health summary')}</h2><p>{t('Sends environment context to your configured provider')}</p></div></div>
      <div className={styles.actions}>
        {sections.length > 0 && <HealthPdfExport completion={completion} generatedAt={generatedAt} disabled={isLoading || !!error || !sections.some(section => section.content.trim())} />}
        <Button variant="outline" size="sm" onClick={generate} disabled={isLoading}>
          {isLoading ? <Loader2 size={14} className={styles.spinner} aria-hidden="true" /> : hasGenerated ? <RefreshCw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          {t(isLoading ? 'Generating...' : hasGenerated ? 'Refresh Insights' : 'Generate AI health summary')}
        </Button>
        {hasBody && <button className={styles.collapse} aria-expanded={expanded} aria-controls={`${id}-body`} aria-label={t(expanded ? 'Collapse {section}' : 'Expand {section}', { section: t('AI health summary') })} onClick={() => setExpanded(value => !value)}><ChevronDown size={16} data-expanded={expanded} aria-hidden="true" /></button>}
      </div>
    </header>
    {hasBody && <div id={`${id}-body`} hidden={!expanded} className={styles.body}>
      {error && <div className={styles.state} data-tone="danger" role="alert"><AlertTriangle size={22} aria-hidden="true" /><div><h3>{t('Analysis Failed')}</h3>
        {problem?.provider && <p className={styles.errorMeta}>{providers[problem.provider].name}{problem.status ? ` · HTTP ${problem.status}` : ''}</p>}
        <p>{healthSummaryError(t, error.message)}</p>
        <div className={styles.errorActions}><Link href="/administration/ai-settings">{t('AI Integrations')}</Link>{problem?.kind === 'billing' && problem.provider === 'gemini' && <a href="https://ai.studio/projects" target="_blank" rel="noreferrer">{t('Open AI Studio')} ↗</a>}</div>
      </div></div>}
      {!error && isLoading && !sections.length && <div className={styles.state} role="status"><Loader2 size={22} className={styles.spinner} aria-hidden="true" /><div><h3>{t('Synthesizing telemetry data...')}</h3><p>{t('This may take a few seconds as the AI analyzes your environment.')}</p></div></div>}
      {!error && !isLoading && !sections.length && <div className={styles.state} role="status"><Info size={22} aria-hidden="true" /><div><h3>{t('No insights available')}</h3><p>{t('Click Refresh Insights to generate an AI analysis of your environment.')}</p></div></div>}
      {!error && sections.length > 0 && <Tabs.Root value={selected} onValueChange={setActiveSection} className={styles.report}>
        <Tabs.List className={styles.tabs} aria-label={t('AI health summary')}>
          {sections.map((section, index) => { const Icon = sectionIcon(section.title); return <Tabs.Trigger key={index} value={String(index)} className={styles.tab}><Icon size={16} strokeWidth={1.75} aria-hidden="true" /><span>{healthSectionTitle(t, section.title.split('|')[0].trim() || t('Generating...'))}</span></Tabs.Trigger> })}
        </Tabs.List>
        {isLoading && <div className={styles.streaming} role="status"><Loader2 size={13} className={styles.spinner} aria-hidden="true" />{t('Generating...')}</div>}
        {sections.map((section, index) => {
          const [title, confidenceText] = section.title.split('|')
          const confidence = confidenceText ? healthConfidence(t, confidenceText, locale) : null
          const steps = section.thinkingProcess?.replace(/^>\s*/gm, '').split(/(?:^|\n)\d+\.\s*/).filter(step => step.trim())
          return <Tabs.Content key={index} value={String(index)} className={styles.content}>
            <div className={styles.sectionHeading}><h3>{healthSectionTitle(t, title.trim() || t('Generating...'))}</h3>{confidence && <span className={styles.confidence}>{confidence}</span>}</div>
            {steps?.length ? <details className={styles.reasoning}><summary><BrainCircuit size={16} aria-hidden="true" /><span>{t('View AI Reasoning Process')}</span><ChevronDown size={14} aria-hidden="true" /></summary><ol>{steps.map((step, stepIndex) => <li key={stepIndex}>{step.trim()}</li>)}</ol></details> : null}
            <SummaryMarkdown content={section.content} />
          </Tabs.Content>
        })}
      </Tabs.Root>}
    </div>}
  </section>
}

export function AiHealthSummary() {
  const { locale } = useI18n()
  const [completion, setCompletion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<Date>()
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort() }, [])

  const complete = async () => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setHasGenerated(true)
    setIsLoading(true)
    setError(null)
    setCompletion('')
    setGeneratedAt(undefined)
    try {
      const response = await fetch('/api/ai/health-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: HEALTH_STREAM_TYPE }, signal: controller.signal,
        body: JSON.stringify({ prompt: 'Analyze the environment and provide a health summary.', locale }),
      })
      await readHealthSummaryResponse(response, text => {
        if (!controller.signal.aborted) setCompletion(previous => previous + text)
      })
      if (!controller.signal.aborted) setGeneratedAt(new Date())
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      request.current = null
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }

  return <AiHealthSummaryPanel completion={completion} isLoading={isLoading} error={error} hasGenerated={hasGenerated} generatedAt={generatedAt} onGenerate={() => void complete()} />
}
