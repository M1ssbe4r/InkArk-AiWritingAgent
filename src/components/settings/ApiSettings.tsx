import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Trash2, Check, Loader2, Save } from 'lucide-react'
import { generateId } from '@/lib/utils'
import { FontSettings } from './FontSettings'
import { ThemeSettings } from './ThemeSettings'
import { AboutSettings } from './AboutSettings'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { clampContextK, MIN_CONTEXT_K, MAX_CONTEXT_K, DEFAULT_CONTEXT_K } from '@/lib/modelContext'

interface ApiSettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ApiSettings({ open, onOpenChange }: ApiSettingsProps) {
  const [apiConfigs, setApiConfigs] = useState<any[]>([])
  const [presets, setPresets] = useState<any[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Draft state for manual save
  const [draftConfig, setDraftConfig] = useState<any>(null)
  const [draftPreset, setDraftPreset] = useState<any>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const loadData = async () => {
    const configs = await window.electronAPI.apiConfig.list()
    const presetsList = await window.electronAPI.preset.list()
    setApiConfigs(configs)
    setPresets(presetsList)
  }

  // Sync draft from DB data when selection changes
  const syncDraft = useCallback(() => {
    const config = apiConfigs.find((c) => c.id === selectedConfigId)
    const preset = presets.find((p) => p.api_config_id === selectedConfigId)
    if (config) {
      // 旧 DB 行可能没有 context_length 列，兜底默认值
      setDraftConfig({ ...config, context_length: config.context_length ?? DEFAULT_CONTEXT_K })
      setDraftPreset(preset ? { ...preset } : null)
      setHasChanges(false)
    }
  }, [apiConfigs, presets, selectedConfigId])

  useEffect(() => {
    if (open) {
      const init = async () => {
        const configs = await window.electronAPI.apiConfig.list()
        const presetsList = await window.electronAPI.preset.list()
        setApiConfigs(configs)
        setPresets(presetsList)
        const def = await window.electronAPI.apiConfig.getDefault()
        if (def) {
          setSelectedConfigId(def.id)
        }
      }
      init()
    }
  }, [open])

  useEffect(() => {
    syncDraft()
  }, [syncDraft])

  const createDefaultPreset = async (configId: string) => {
    await window.electronAPI.preset.create({
      id: generateId(),
      name: '默认预设',
      api_config_id: configId,
      temperature: 1,
      top_p: 1,
      max_tokens: 8192,
      frequency_penalty: 0,
      presence_penalty: 0,
      thinking_enabled: 1,
      reasoning_effort: 'high',
    })
  }

  const handleCreateConfig = async () => {
    const configId = generateId()
    const config = {
      id: configId,
      name: '新 API',
      base_url: '',
      api_key: '',
      model: '',
      provider: 'openai_compatible',
      context_length: DEFAULT_CONTEXT_K,
    }
    await window.electronAPI.apiConfig.create(config)
    await createDefaultPreset(configId)
    await loadData()
    setSelectedConfigId(configId)
  }

  const handleUpdateDraftConfig = (field: string, value: string) => {
    if (!draftConfig) return
    setDraftConfig((prev: any) => ({ ...prev!, [field]: field === 'model' ? value.trim() : value }))
    setHasChanges(true)
  }

  const handleUpdateContextLength = (raw: string) => {
    if (!draftConfig) return
    const cleaned = raw.replace(/[^\d]/g, '')
    setDraftConfig((prev: any) => ({ ...prev!, context_length: cleaned === '' ? DEFAULT_CONTEXT_K : clampContextK(cleaned) }))
    setHasChanges(true)
  }

  const handleUpdateDraftPreset = (field: string, value: any) => {
    if (!draftPreset) return
    setDraftPreset((prev: any) => ({ ...prev!, [field]: value }))
    setHasChanges(true)
  }

  const handleProviderChange = (provider: string) => {
    if (!draftConfig) return
    const baseUrlMap: Record<string, string> = {
      deepseek: 'https://api.deepseek.com',
    }
    const modelMap: Record<string, string> = {
      deepseek: 'deepseek-v4-flash',
    }
    const nextDraft: any = {
      ...draftConfig,
      provider,
      base_url: baseUrlMap[provider] ?? draftConfig.base_url,
      model: modelMap[provider] ?? draftConfig.model,
    }
    setDraftConfig(nextDraft)
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (!draftConfig) return
    await window.electronAPI.apiConfig.update(draftConfig)
    if (draftPreset) {
      await window.electronAPI.preset.update(draftPreset)
    }
    setHasChanges(false)
    await loadData()
    setSelectedConfigId(draftConfig.id)
  }

  const handleDeleteConfig = async (id: string) => {
    await window.electronAPI.apiConfig.delete(id)
    await loadData()
    if (selectedConfigId === id) {
      setSelectedConfigId(null)
      setDraftConfig(null)
      setDraftPreset(null)
      setHasChanges(false)
    }
  }

  const handleTest = async () => {
    if (!draftConfig) return
    setTesting(true)
    setTestResult(null)
    const result = await window.electronAPI.apiConfig.test(draftConfig)
    setTestResult(result.success ? '连接成功' : `连接失败: ${result.error}`)
    setTesting(false)
  }

  return (
    <TooltipProvider delayDuration={300}>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="api" className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="api">API 配置</TabsTrigger>
            <TabsTrigger value="font">字体设置</TabsTrigger>
            <TabsTrigger value="theme">主题</TabsTrigger>
            <TabsTrigger value="about">关于</TabsTrigger>
          </TabsList>
          <TabsContent value="api" className="flex-1 min-h-0">
            <div className="flex gap-4 h-full">
            <div className="w-52 flex flex-col shrink-0 min-h-0">
              <Button variant="outline" size="sm" className="w-full mb-2 shrink-0" onClick={handleCreateConfig}>
                <Plus className="h-3.5 w-3.5 mr-1" /> 添加 API
              </Button>
              <ScrollArea className="flex-1">
                <div className="space-y-1">
                  {apiConfigs.map((config) => (
                    <div
                      key={config.id}
                      className={`flex items-center justify-between rounded px-2 py-1.5 text-xs cursor-pointer ${
                        selectedConfigId === config.id
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/50'
                      }`}
                      onClick={() => setSelectedConfigId(config.id)}
                    >
                      <span className="truncate">{config.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteConfig(config.id) }}>
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="flex-1 flex flex-col space-y-3 min-h-0">
              {draftConfig ? (
                <>
                  <div className="flex-1 overflow-y-auto space-y-3 px-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>名称</Label>
                        <Input value={draftConfig.name} onChange={(e) => handleUpdateDraftConfig('name', e.target.value)} />
                      </div>
                      <div>
                        <Label>提供方</Label>
                        <Select value={draftConfig.provider} onValueChange={handleProviderChange}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="deepseek">DeepSeek</SelectItem>
                            <SelectItem value="openai_compatible">OpenAI 兼容</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label>Base URL</Label>
                          <Input
                            value={draftConfig.base_url}
                            onChange={(e) => handleUpdateDraftConfig('base_url', e.target.value)}
                            placeholder="例如: https://api.openai.com/v1"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            填写 API 根地址，以 /v1 结尾。如 OpenAI: https://api.openai.com/v1，DeepSeek: https://api.deepseek.com
                          </p>
                        </div>
                        <div className="col-span-2">
                          <Label>API Key</Label>
                          <Input type="password" value={draftConfig.api_key} onChange={(e) => handleUpdateDraftConfig('api_key', e.target.value)} />
                        </div>
                        <div className="col-span-2 grid grid-cols-[1fr_140px] gap-3">
                          <div>
                            <Label>模型</Label>
                            {draftConfig.provider === 'deepseek' ? (
                              <Select value={draftConfig.model} onValueChange={(v) => handleUpdateDraftConfig('model', v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="deepseek-v4-flash">deepseek-v4-flash</SelectItem>
                                  <SelectItem value="deepseek-v4-pro">deepseek-v4-pro</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input value={draftConfig.model} onChange={(e) => handleUpdateDraftConfig('model', e.target.value)} placeholder="例如 gpt-4o" />
                            )}
                          </div>
                          <div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Label className="cursor-help">上下文 (k)</Label>
                              </TooltipTrigger>
                              <TooltipContent side="top">模型支持的上下文窗口大小（k tokens），范围 {MIN_CONTEXT_K}~{MAX_CONTEXT_K}</TooltipContent>
                            </Tooltip>
                            <Input
                              type="number"
                              min={MIN_CONTEXT_K}
                              max={MAX_CONTEXT_K}
                              step={1}
                              value={draftConfig.context_length ?? DEFAULT_CONTEXT_K}
                              onChange={(e) => handleUpdateContextLength(e.target.value)}
                            />
                          </div>
                        </div>
                  </div>
                  </div>
                  {draftPreset ? (
                    <div className="border-t pt-3 mt-1">
                      <h4 className="text-xs font-medium mb-2">参数</h4>
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Label className="cursor-help">Temperature: {draftPreset.temperature}</Label>
                              </TooltipTrigger>
                              <TooltipContent side="top">控制生成文本的随机性。0=确定，2=最随机</TooltipContent>
                            </Tooltip>
                            <Slider value={[draftPreset.temperature]} onValueChange={([v]) => handleUpdateDraftPreset('temperature', Math.round(v * 20) / 20)} min={0} max={2} step={0.05} />
                          </div>
                          <div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Label className="cursor-help">Top-P: {draftPreset.top_p}</Label>
                              </TooltipTrigger>
                              <TooltipContent side="top">核采样，只考虑概率累计达到该值的词汇。0=精准，1=多样</TooltipContent>
                            </Tooltip>
                            <Slider value={[draftPreset.top_p]} onValueChange={([v]) => handleUpdateDraftPreset('top_p', Math.round(v * 100) / 100)} min={0} max={1} step={0.05} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Label className="cursor-help">Max Tokens</Label>
                              </TooltipTrigger>
                              <TooltipContent side="top">单次请求最多生成的 token 数量，越长消耗越大</TooltipContent>
                            </Tooltip>
                             <Input type="number" value={draftPreset.max_tokens} onChange={(e) => handleUpdateDraftPreset('max_tokens', parseInt(e.target.value) || 8192)} className="h-8 text-xs" />
                          </div>
                          <div>
                            <Label>思考模式</Label>
                            {(() => {
                              const isDeep = (/deepseek/i.test(draftConfig.model) || /deepseek/i.test(draftConfig.base_url) || draftConfig.provider === 'deepseek')
                              if (isDeep) {
                                return (
                                  <Select
                                    value={draftPreset.thinking_enabled ? (draftPreset.reasoning_effort || 'high') : 'off'}
                                    onValueChange={(v) => {
                                      if (v === 'off') {
                                        handleUpdateDraftPreset('thinking_enabled', 0)
                                      } else {
                                        handleUpdateDraftPreset('thinking_enabled', 1)
                                        handleUpdateDraftPreset('reasoning_effort', v)
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 py-1 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="off">关闭</SelectItem>
                                      <SelectItem value="high">high</SelectItem>
                                      <SelectItem value="max">max</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )
                              }
                              return (
                                <Select
                                  value={draftPreset.thinking_enabled ? 'on' : 'off'}
                                  onValueChange={(v) => handleUpdateDraftPreset('thinking_enabled', v === 'on' ? 1 : 0)}
                                >
                                  <SelectTrigger className="h-8 py-1 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="off">关闭</SelectItem>
                                    <SelectItem value="on">打开</SelectItem>
                                  </SelectContent>
                                </Select>
                              )
                            })()}
                          </div>
                        </div>
                        {draftPreset?.thinking_enabled ? (
                          <p className="text-[9px] text-orange-500">思考模式下 Temperature、Top-P 参数不生效</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 shrink-0 pt-2 border-t">
                    <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
                      <Save className="h-3.5 w-3.5 mr-1" />
                      {hasChanges ? '保存 (已修改)' : '保存'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                      {testing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                      测试连接
                    </Button>
                    {testResult && (
                      <span className={`text-xs ${testResult.includes('成功') ? 'text-green-600' : 'text-red-600'}`}>
                        {testResult}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  选择或添加一个 API 配置
                </div>
              )}
            </div>
            </div>
          </TabsContent>
          <TabsContent value="font" className="min-h-0 mt-1">
            <FontSettings />
          </TabsContent>
          <TabsContent value="theme" className="min-h-0 mt-1">
            <ThemeSettings />
          </TabsContent>
          <TabsContent value="about" className="min-h-0 mt-1">
            <AboutSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    </TooltipProvider>
  )
}
