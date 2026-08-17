export interface ApiConfig {
  id: string
  name: string
  base_url: string
  api_key: string
  model: string
  provider: string
}

export interface ApiPreset {
  id: string
  name: string
  api_config_id: string
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  thinking_enabled?: number
  reasoning_effort?: string
}

export type VolumeStatus = 'planned' | 'writing' | 'done' | 'paused'

export interface OutlineVolume {
  id: string
  project_id: string
  title: string
  sort_order: number
  outline: string
  chapter_start: number | null
  chapter_end: number | null
  status: 'planned' | 'writing' | 'done' | 'paused'
  progress_notes: string
  created_at?: string
  updated_at?: string
}

export interface Project {
  id: string
  title: string
  created_at?: string
  updated_at?: string
  word_count?: number
  synopsis?: string
  outline?: string
  style_guidance?: string
  writing_restrictions?: string
  outline_migrated_at?: string | null
}

export interface Chapter {
  id: string
  project_id: string
  title: string
  content: string
  chapter_outline: string
  sort_order: number
  status: string
  word_count: number
  created_at?: string
  updated_at?: string
}

export interface CharacterCard {
  id: string
  project_id: string
  name: string
  alias: string
  description: string
  role: string
  traits: string[]
  appearance: string
  background: string
  relationships: string
  notes: string
  tags: string[]
  card_group: string
  sort_order: number
  gender: string
  age: string
}

export interface WorldCard {
  id: string
  project_id: string
  name: string
  card_type: string
  description: string
  tags: string[]
  card_group: string
  parent_id: string | null
  sort_order: number
  notes: string
}

export interface ProjectBackup {
  version: number
  exportedAt: string
  project: Project
  volumes?: OutlineVolume[]
  chapters: Chapter[]
  characterCards: CharacterCard[]
  worldCards: WorldCard[]
}

export interface UserSession {
  email: string
  token: string
  server_url: string
  logged_in: number
}
