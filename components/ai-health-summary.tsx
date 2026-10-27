"use client";


import { Card, CardContent } from '@/components/ui/card';
import { Activity, ShieldCheck, Database, AlertTriangle, CheckCircle2, ChevronRight, Info, Lightbulb, Bot, BrainCircuit } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AiHealthSummary() {
  const [completion, setCompletion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);

  const sections = React.useMemo(() => {
    if (!completion) return [];
    // The regex /(?:^|\n)###\s+/ handles both the start of the string and newlines
    const parts = completion.split(/(?:^|\n)###\s+/);
    const result: { title: string, content: string, thinkingProcess: string | null }[] = [];

    const initialText = parts[0].trim();

    for (let i = 1; i < parts.length; i++) {
      const newlineIndex = parts[i].indexOf('\n');
      if (newlineIndex === -1) {
        result.push({ title: parts[i].trim(), content: '', thinkingProcess: null });
      } else {
        const title = parts[i].substring(0, newlineIndex).trim();
        let content = parts[i].substring(newlineIndex).trim();

        let thinkingProcess = null;
        const thinkingRegex = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/i;
        const match = content.match(thinkingRegex);
        if (match) {
            thinkingProcess = match[1].trim();
            content = content.replace(thinkingRegex, '').trim();
        }

        result.push({ title, content, thinkingProcess });
      }
    }

    if (initialText) {
       const overviewSection = result.find(s => s.title.toLowerCase().includes('overview'));
       if (overviewSection) {
           overviewSection.content = initialText + '\n\n' + overviewSection.content;
       } else {
           result.unshift({ title: 'Overview', content: initialText, thinkingProcess: null });
       }
    }

    // Deduplicate any sections that have the exact same title base (ignores confidence score changes)
    const uniqueSections: { title: string, content: string, thinkingProcess: string | null }[] = [];
    const seenTitles = new Set();
    for (const sec of result) {
        const rawTitle = sec.title.split('|')[0].trim().toLowerCase();
        if (seenTitles.has(rawTitle)) {
           const existing = uniqueSections.find(s => s.title.split('|')[0].trim().toLowerCase() === rawTitle);
           if (existing) {
             existing.content += '\n\n' + sec.content;
             if (!existing.thinkingProcess && sec.thinkingProcess) existing.thinkingProcess = sec.thinkingProcess;
             // Update the title to keep the most recent confidence score if streaming
             existing.title = sec.title;
           }
        } else {
           seenTitles.add(rawTitle);
           uniqueSections.push({ ...sec });
        }
    }

    return uniqueSections.filter(s => s.title || s.content);
  }, [completion]);

  // Keep active index in bounds if sections update
  useEffect(() => {
    if (sections.length > 0 && activeSectionIdx >= sections.length) {
       setActiveSectionIdx(sections.length - 1);
    }
  }, [sections.length, activeSectionIdx]);

  const complete = async (promptText: string) => {
      setIsLoading(true);
      setError(null);
      setCompletion('');
      try {
          const res = await fetch('/api/ai/health-summary', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: promptText })
          });

          if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || 'Failed to generate AI summary');
          }

          if (!res.body) throw new Error('No readable stream returned by API');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let done = false;

          while (!done) {
              const { value, done: readerDone } = await reader.read();
              done = readerDone;
              if (value) {
                  const chunk = decoder.decode(value, { stream: true });
                  setCompletion(prev => prev + chunk);
              }
          }
      } catch (err) {
          console.error('[AI UI] error during stream:', err);
          setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
          setIsLoading(false);
      }
  };



  useEffect(() => {
    // We could auto-generate on load, or wait for user interaction.
    // Given it's a premium feature, let's let the user trigger it to save tokens,
    // or we can auto-trigger it once. Let's auto-trigger once if they visit the tab.
    const autoRun = async () => {
      if (!hasGenerated && !isLoading && !completion && !error) {
         try {
             setHasGenerated(true);
             console.log('[AI UI] Auto-running complete()...');
             await complete("Analyze the environment and provide a health summary.");
         } catch (err) {
             console.error('[AI UI] Auto-run error:', err);
         }
      }
    };
    autoRun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <Card className="border shadow-sm overflow-hidden bg-background relative flex flex-col rounded-xl">
      <CardContent className="p-0">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-6"
            >
              <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm">
                <AlertTriangle className="h-5 w-5" />
                <div className="ml-2 font-semibold text-base">Analysis Failed</div>
                <div className="ml-2 mt-1 text-sm opacity-90">{error.message}</div>
              </Alert>
            </motion.div>
          )}

          {!error && (
            <div className="min-h-[400px]">
              {isLoading && !completion ? (
                <div className="flex flex-col items-center justify-center h-[400px] space-y-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-20 rounded-full animate-pulse" />
                    <motion.div
                      animate={{ scale: [1, 1.1, 1], rotate: [0, 180, 360] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className="relative bg-background p-4 rounded-2xl shadow-lg border border-indigo-500/20"
                    >
                      <Bot className="w-10 h-10 text-indigo-500" />
                    </motion.div>
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse">
                      Synthesizing telemetry data...
                    </p>
                    <p className="text-sm text-muted-foreground">This may take a few seconds as the AI analyzes your environment.</p>
                  </div>

                  <div className="flex gap-4 mt-2">
                    {[Activity, ShieldCheck, Database].map((Icon, i) => (
                      <motion.div
                        key={i}
                        animate={{ y: [0, -10, 0], opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                      >
                        <Icon className="w-5 h-5 text-indigo-400" />
                      </motion.div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row min-h-[500px]">
                  {/* Left Sidebar (Topics/Sections) */}
                  <div className="w-full md:w-[280px] border-r bg-muted/5 shrink-0">
                    <div className="sticky top-6 py-2 flex flex-col">
                      {sections.map((section, idx) => {
                        // Parse title to remove confidence score for the sidebar
                        const rawTitle = section.title || 'Generating...';
                        const displayTitle = rawTitle.includes('|') ? rawTitle.split('|')[0].trim() : rawTitle;

                        return (
                          <button
                            key={idx}
                            onClick={() => setActiveSectionIdx(idx)}
                            className={`w-full text-left px-5 py-3.5 transition-all duration-200 group flex items-center justify-between border-l-2 ${
                              idx === activeSectionIdx
                                ? 'bg-background border-l-indigo-500 text-foreground font-semibold shadow-[inset_0_1px_0_0_rgba(0,0,0,0.02),inset_0_-1px_0_0_rgba(0,0,0,0.02)]'
                                : 'border-l-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground font-medium'
                            }`}
                          >
                            <span className="text-[13.5px] pr-2 leading-tight">
                              {displayTitle}
                            </span>
                            <ChevronRight className={`w-4 h-4 shrink-0 transition-all ${idx === activeSectionIdx ? 'text-indigo-500 translate-x-0.5' : 'opacity-0 group-hover:opacity-40 -translate-x-1 group-hover:translate-x-0'}`} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Main Content Area */}
                  <div className="flex-1 p-6 md:p-10 bg-background relative">
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-[85ch] mx-auto pb-10">
                      {completion && sections[activeSectionIdx] ? (
                          <>
                              {(() => {
                                  const rawTitle = sections[activeSectionIdx].title;
                                  const parts = rawTitle.split('|');
                                  const displayTitle = parts[0].trim();
                                  let confidence = null;
                                  if (parts.length > 1 && parts[1].toLowerCase().includes('confidence')) {
                                      confidence = parts[1].trim();
                                  }

                                  return (
                                    <div className="mb-8 pb-5 border-b flex items-center justify-between">
                                        <h2 className="text-2xl font-bold text-foreground tracking-tight">
                                            {displayTitle}
                                        </h2>
                                        {confidence && (
                                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 px-2.5 py-0.5">
                                                {confidence.replace(/confidence/i, 'Confidence')}
                                            </Badge>
                                        )}
                                    </div>
                                  );
                              })()}

                              {sections[activeSectionIdx].thinkingProcess && (() => {
                                  const rawThinking = sections[activeSectionIdx].thinkingProcess as string;
                                  const cleanThinking = rawThinking.replace(/^>\s*/gm, '');
                                  const steps = cleanThinking.split(/(?:^|\n)\d+\.\s*/).filter(s => s.trim());

                                  return (
                                      <Collapsible className="mb-8 border border-indigo-500/20 rounded-none overflow-hidden shadow-sm bg-[#050505]">
                                          <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-3 bg-[#0a0a0a] hover:bg-[#111] transition-colors text-sm font-semibold text-indigo-400">
                                              <BrainCircuit className="w-4 h-4 text-indigo-500" />
                                              View AI Reasoning Process
                                              <ChevronRight className="w-4 h-4 ml-auto text-indigo-500/50 transition-transform duration-200 data-[state=open]:rotate-90" />
                                          </CollapsibleTrigger>
                                          <CollapsibleContent className="px-5 py-6 border-t border-indigo-500/20">
                                              <div className="relative pl-[32px] space-y-5 text-[13px]" style={{ fontFamily: '"Consolas", "Monaco", "Courier New", monospace' }}>
                                                  {/* The vertical line */}
                                                  <div className="absolute left-[15px] top-[22px] bottom-[22px] w-[2px] bg-indigo-500/30" />

                                                  {steps.map((step, idx) => (
                                                      <div key={idx} className="relative group">
                                                          {/* The circle */}
                                                          <div className="absolute -left-[21px] top-[18px] w-[10px] h-[10px] rounded-full bg-indigo-500 ring-[4px] ring-[#050505] z-10" />

                                                          {/* The content */}
                                                          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-none p-3.5 text-indigo-200/90 shadow-sm leading-relaxed whitespace-pre-wrap">
                                                              {step}
                                                          </div>
                                                      </div>
                                                  ))}
                                              </div>
                                          </CollapsibleContent>
                                      </Collapsible>
                                  );
                              })()}

                              <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                      h1: () => null,
                                      h2: ({node, ...props}) => { void node; return <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground/90" {...props} /> },
                                      h3: ({node, ...props}) => { void node; return <h3 className="text-lg font-semibold mt-6 mb-3 text-foreground/80" {...props} /> },
                                      p: ({node, children, ...props}) => {
                                          void node;
                                          const getText = (nodes: React.ReactNode): string => {
                                              let text = '';
                                              React.Children.forEach(nodes, (child) => {
                                                  if (typeof child === 'string') text += child;
                                                  else if (React.isValidElement<{ children?: React.ReactNode }>(child)) text += getText(child.props.children);
                                              });
                                              return text;
                                          };

                                          const rawText = getText(children).trim();
                                          const isUrgent = rawText.toLowerCase().startsWith('urgent:');
                                          const isRecommendation = rawText.toLowerCase().startsWith('recommendation:');

                                          if (isUrgent || isRecommendation) {
                                              const Icon = isUrgent ? AlertTriangle : Lightbulb;
                                              return (
                                                  <Alert className={`my-6 border-l-4 shadow-sm overflow-hidden relative ${isUrgent ? 'border-l-rose-500 bg-rose-500/5 dark:bg-rose-500/10 text-rose-900 dark:text-rose-200 border-y-0 border-r-0' : 'border-l-amber-500 bg-amber-500/5 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200 border-y-0 border-r-0'}`}>
                                                      <Icon className={`w-5 h-5 ${isUrgent ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} />
                                                      <div className="ml-2 mt-0.5 text-sm leading-relaxed font-medium">
                                                          {children}
                                                      </div>
                                                  </Alert>
                                              );
                                          }

                                          return <p className="leading-relaxed [&:not(:first-child)]:mt-5 text-muted-foreground/90 text-[15px]" {...props}>{children}</p>;
                                      },
                                      ul: ({node, ...props}) => { void node; return <ul className="my-5 flex flex-col gap-3" {...props} /> },
                                      ol: ({node, ...props}) => { void node; return <ol className="my-5 ml-6 flex flex-col gap-3 list-decimal text-muted-foreground text-[15px]" {...props} /> },
                                      li: ({node, children, ...props}) => {
                                          void node;
                                          const getText = (nodes: React.ReactNode): string => {
                                              let text = '';
                                              React.Children.forEach(nodes, (child) => {
                                                  if (typeof child === 'string') text += child;
                                                  else if (React.isValidElement<{ children?: React.ReactNode }>(child)) text += getText(child.props.children);
                                              });
                                              return text;
                                          };
                                          const textContent = getText(children).toLowerCase();

                                          const isNegative = /fail|violat|critic|error|warn|high risk/i.test(textContent);
                                          const isPositive = /success|health|compli|good|secure/i.test(textContent);

                                          let Icon = ChevronRight;
                                          let iconColor = "text-indigo-400 dark:text-indigo-500";
                                          let bulletClass = "bg-indigo-500/10";

                                          if (isNegative) {
                                              Icon = AlertTriangle;
                                              iconColor = "text-rose-500";
                                              bulletClass = "bg-rose-500/10";
                                          } else if (isPositive) {
                                              Icon = CheckCircle2;
                                              iconColor = "text-emerald-500";
                                              bulletClass = "bg-emerald-500/10";
                                          }

                                          return (
                                              <li className="flex items-start gap-3.5 group" {...props}>
                                                  <div className={`mt-0.5 shrink-0 rounded-full p-1 transition-colors ${bulletClass}`}>
                                                      <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
                                                  </div>
                                                  <span className="text-foreground/80 group-hover:text-foreground/90 leading-relaxed text-[15px] pt-0.5 transition-colors">{children}</span>
                                              </li>
                                          );
                                      },
                                      strong: ({node, ...props}) => { void node; return <strong className="font-semibold text-foreground" {...props} /> },
                                      blockquote: ({node, children}) => {
                                          void node;
                                          return (
                                          <Alert className="my-8 border-l-4 border-l-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 shadow-sm border-y-0 border-r-0">
                                              <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                              <div className="ml-2 text-indigo-900 dark:text-indigo-200 font-medium text-sm">
                                                  {children}
                                              </div>
                                          </Alert>
                                          );
                                      },
                                  }}
                              >
                                  {sections[activeSectionIdx].content}
                              </ReactMarkdown>
                          </>
                      ) : (
                          <div className="text-center flex flex-col items-center justify-center py-20 text-muted-foreground/60 h-full">
                              <Bot className="w-16 h-16 mb-6 opacity-20" />
                              <p className="font-medium text-lg text-foreground/60">No insights available</p>
                              <p className="text-sm mt-1">Click Refresh Insights to generate an AI analysis of your environment.</p>
                          </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
