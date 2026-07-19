"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sparkles, Save, CheckCircle2, AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface AiSettings {
    provider: string;
    modelName: string;
    apiKey: string;
}

export default function AiSettingsPage() {
    const [settings, setSettings] = useState<AiSettings>({
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        apiKey: ''
    })
    
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch('/api/settings/ai')
                if (response.ok) {
                    const data = await response.json()
                    setSettings(prev => ({
                        ...prev,
                        ...data,
                        apiKey: data.apiKey || ''
                    }))
                }
            } catch (error) {
                console.error("Failed to load AI settings:", error)
                setMessage({ type: 'error', text: 'Failed to load configuration.' })
            } finally {
                setIsLoading(false)
            }
        }
        
        fetchSettings()
    }, [])

    const handleSave = async () => {
        setIsSaving(true)
        setMessage(null)
        
        try {
            const response = await fetch('/api/settings/ai', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            })
            
            if (response.ok) {
                setMessage({ type: 'success', text: 'Settings saved successfully. Your API key is encrypted.' })
            } else {
                setMessage({ type: 'error', text: 'Failed to save settings.' })
            }
        } catch (error) {
            console.error("Failed to save AI settings:", error)
            setMessage({ type: 'error', text: 'An unexpected error occurred.' })
        } finally {
            setIsSaving(false)
        }
    }

    const providerDefaults: Record<string, string> = {
        'openai': 'gpt-4o-mini',
        'gemini': 'gemini-2.5-flash',
        'anthropic': 'claude-3-7-sonnet-20250219'
    }

    const providerModels: Record<string, {id: string, name: string}[]> = {
        'openai': [
            { id: 'o3-mini', name: 'o3-mini (Reasoning Fast)' },
            { id: 'o1', name: 'o1 (Reasoning Powerful)' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
            { id: 'gpt-4o', name: 'GPT-4o (Powerful)' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
        ],
        'gemini': [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Powerful)' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast)' },
            { id: 'gemini-2.0-pro-exp-02-05', name: 'Gemini 2.0 Pro Experimental' },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
            { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro (Legacy)' },
            { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash (Legacy)' }
        ],
        'anthropic': [
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Latest)' },
            { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)' },
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Powerful)' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
        ]
    }

    const handleProviderChange = (provider: string) => {
        setSettings(prev => ({
            ...prev,
            provider,
            modelName: providerDefaults[provider] || prev.modelName
        }))
    }

    if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading AI configuration...</div>

    return (
        <div className="container mx-auto py-8 max-w-3xl space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Sparkles className="h-8 w-8 text-indigo-500" />
                    AI Integrations
                </h1>
                <p className="text-muted-foreground mt-2">
                    Configure your AI provider to power smart features like the Health Summary dashboard.
                    Your API keys are encrypted at rest using machine-specific keys.
                </p>
            </div>

            {message && (
                <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300' : ''}>
                    {message.type === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" /> : <AlertCircle className="h-4 w-4" />}
                    <AlertTitle>{message.type === 'success' ? 'Success' : 'Error'}</AlertTitle>
                    <AlertDescription>
                        {message.text}
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Provider Settings</CardTitle>
                    <CardDescription>
                        Select an AI provider and enter your API credentials.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="provider">AI Provider</Label>
                        <Select 
                            value={settings.provider} 
                            onValueChange={handleProviderChange}
                        >
                            <SelectTrigger id="provider">
                                <SelectValue placeholder="Select a provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="gemini">Google Gemini</SelectItem>
                                <SelectItem value="anthropic">Anthropic</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Make sure you have an active account and billing set up with the selected provider.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        <Input 
                            id="apiKey" 
                            type="password" 
                            placeholder={settings.apiKey?.startsWith('sk-••••') ? '••••••••••••••••••••••••••••' : 'Enter your API key'}
                            value={settings.apiKey}
                            onChange={(e) => setSettings({...settings, apiKey: e.target.value})}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="modelName">Model</Label>
                        <Select 
                            value={settings.modelName} 
                            onValueChange={(val) => setSettings({...settings, modelName: val})}
                        >
                            <SelectTrigger id="modelName">
                                <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent>
                                {(providerModels[settings.provider] || []).map(model => (
                                    <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            We offer the recommended fast and powerful models for the selected provider.
                        </p>
                    </div>
                </CardContent>
                <CardFooter className="bg-muted/50 px-6 py-4 border-t flex justify-end">
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? (
                            <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Save Configuration
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
