import { describe, it, expect, beforeEach } from 'vitest'

let db: any = null

async function initTestDb() {
  const { initSqlJs } = await import('fts5-sql-bundle')
  const SQL = await initSqlJs()
  db = new SQL.Database()

  db.run(`
    CREATE TABLE IF NOT EXISTS api_configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
      api_key TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS api_presets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_config_id TEXT NOT NULL,
      temperature REAL DEFAULT 0.8, top_p REAL DEFAULT 0.9, max_tokens INTEGER DEFAULT 2048,
      frequency_penalty REAL DEFAULT 0, presence_penalty REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (api_config_id) REFERENCES api_configs(id)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      word_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '未命名章节', content TEXT DEFAULT '',
      summary TEXT DEFAULT '', sort_order INTEGER NOT NULL,
      status TEXT DEFAULT 'draft', word_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS character_cards (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      alias TEXT DEFAULT '', description TEXT DEFAULT '', role TEXT DEFAULT '',
      traits TEXT DEFAULT '[]', appearance TEXT DEFAULT '', background TEXT DEFAULT '',
      relationships TEXT DEFAULT '', notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]', card_group TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS world_cards (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      name TEXT NOT NULL, card_type TEXT NOT NULL DEFAULT 'location',
      description TEXT DEFAULT '', tags TEXT DEFAULT '[]', card_group TEXT DEFAULT '',
      parent_id TEXT, sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL,
      content TEXT NOT NULL, prompt TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chapter_id) REFERENCES chapters(id)
    );
    CREATE TABLE IF NOT EXISTS task_bindings (
      id TEXT PRIMARY KEY, task_type TEXT NOT NULL,
      chapter_id TEXT, project_id TEXT, preset_id TEXT NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES api_presets(id)
    );
    CREATE TABLE IF NOT EXISTS sensitive_words (
      id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, is_builtin INTEGER DEFAULT 0
    );
  `)
}

function queryAll(sql: string, params?: any[]): any[] {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) results.push(stmt.getAsObject())
  stmt.free()
  return results
}

function queryOne(sql: string, params?: any[]): any | null {
  const results = queryAll(sql, params)
  return results.length > 0 ? results[0] : null
}

function run(sql: string, params?: any[]) {
  if (params) db.run(sql, params)
  else db.run(sql)
}

function transaction(fn: () => void) {
  db.run('BEGIN TRANSACTION')
  try {
    fn()
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}

beforeEach(async () => {
  await initTestDb()
})

describe('db.ts 封装方法', () => {
  describe('queryOne', () => {
    it('查询存在记录返回单条', () => {
      run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
      const p = queryOne('SELECT * FROM projects WHERE id=?', ['p1'])
      expect(p).not.toBeNull()
      expect(p.title).toBe('测试')
    })

    it('查询不存在记录返回 null', () => {
      const p = queryOne('SELECT * FROM projects WHERE id=?', ['nonexistent'])
      expect(p).toBeNull()
    })
  })

  describe('queryAll', () => {
    it('返回全部匹配记录', () => {
      run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', 'A'])
      run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p2', 'B'])
      const list = queryAll('SELECT * FROM projects')
      expect(list).toHaveLength(2)
    })

    it('无匹配返回空数组', () => {
      const list = queryAll('SELECT * FROM projects')
      expect(list).toEqual([])
    })
  })

  describe('transaction', () => {
    it('事务内全部操作原子提交', () => {
      run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
      transaction(() => {
        run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c1', 'p1', '第一章', 0])
        run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c2', 'p1', '第二章', 1])
      })
      expect(queryAll('SELECT * FROM chapters')).toHaveLength(2)
    })

    it('事务失败时回滚', () => {
      run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
      run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c1', 'p1', '已有章节', 0])
      try {
        transaction(() => {
          run('DELETE FROM chapters WHERE id=?', ['c1'])
          throw new Error('模拟失败')
        })
      } catch {}
      expect(queryAll('SELECT * FROM chapters')).toHaveLength(1)
    })
  })

  describe('参数化查询', () => {
    it('参数化 INSERT 防止 SQL 注入', () => {
      run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', "'; DROP TABLE projects; --"])
      const p = queryOne('SELECT * FROM projects WHERE id=?', ['p1'])
      expect(p.title).toBe("'; DROP TABLE projects; --")
      expect(queryAll('SELECT * FROM projects')).toHaveLength(1)
    })
  })
})

describe('业务逻辑：项目与章节关联', () => {
  it('删除项目时手动级联删除章节', () => {
    run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
    run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c1', 'p1', '第一章', 0])
    run('DELETE FROM chapters WHERE project_id=?', ['p1'])
    run('DELETE FROM projects WHERE id=?', ['p1'])
    expect(queryAll('SELECT * FROM projects')).toHaveLength(0)
    expect(queryAll('SELECT * FROM chapters')).toHaveLength(0)
  })

  it('章节按 sort_order 排序', () => {
    run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
    run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c2', 'p1', '第二章', 1])
    run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c1', 'p1', '第一章', 0])
    const list = queryAll('SELECT * FROM chapters WHERE project_id=? ORDER BY sort_order ASC', ['p1'])
    expect(list[0].title).toBe('第一章')
    expect(list[1].title).toBe('第二章')
  })

  it('拖拽排序通过事务批量更新', () => {
    run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
    run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c1', 'p1', 'A', 0])
    run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c2', 'p1', 'B', 1])
    run('INSERT INTO chapters (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)', ['c3', 'p1', 'C', 2])
    transaction(() => {
      run('UPDATE chapters SET sort_order=? WHERE id=?', [2, 'c1'])
      run('UPDATE chapters SET sort_order=? WHERE id=?', [0, 'c2'])
      run('UPDATE chapters SET sort_order=? WHERE id=?', [1, 'c3'])
    })
    const list = queryAll('SELECT * FROM chapters WHERE project_id=? ORDER BY sort_order ASC', ['p1'])
    expect(list[0].id).toBe('c2')
    expect(list[1].id).toBe('c3')
    expect(list[2].id).toBe('c1')
  })
})

describe('业务逻辑：角色卡 JSON 字段', () => {
  it('traits 存储为 JSON 字符串，读取时解析', () => {
    run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
    run('INSERT INTO character_cards (id, project_id, name, traits, tags) VALUES (?, ?, ?, ?, ?)',
      ['ch1', 'p1', '叶凡', '["勇敢","坚韧"]', '["主角","人族"]'])
    const card = queryOne('SELECT * FROM character_cards WHERE id=?', ['ch1'])
    expect(JSON.parse(card.traits)).toEqual(['勇敢', '坚韧'])
    expect(JSON.parse(card.tags)).toEqual(['主角', '人族'])
  })

  it('更新角色全部字段', () => {
    run('INSERT INTO projects (id, title) VALUES (?, ?)', ['p1', '测试'])
    run('INSERT INTO character_cards (id, project_id, name, alias, description, role, traits, appearance, background, relationships, notes, tags, card_group, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['ch1', 'p1', '叶凡', '', '', '主角', '[]', '', '', '', '', '[]', '', 0])
    run("UPDATE character_cards SET name=?, alias=?, description=?, role=?, traits=?, appearance=?, background=?, relationships=?, notes=?, tags=?, card_group=? WHERE id=?",
      ['叶凡（改名）', '叶黑', '荒古圣体', '主角', '["坚韧"]', '清秀', '被挖骨', '姬紫月', '重要角色', '["人族"]', '主角团', 'ch1'])
    const c = queryOne('SELECT * FROM character_cards WHERE id=?', ['ch1'])
    expect(c.alias).toBe('叶黑')
    expect(c.description).toBe('荒古圣体')
  })
})

describe('业务逻辑：任务绑定覆盖', () => {
  it('同一任务类型重复设置时覆盖', () => {
    run('INSERT INTO api_configs (id, name, base_url, api_key, model, provider) VALUES (?, ?, ?, ?, ?, ?)',
      ['a1', 'API', 'https://test.com/v1', 'key', 'gpt-4', 'openai'])
    run('INSERT INTO api_presets (id, name, api_config_id, temperature) VALUES (?, ?, ?, ?)',
      ['p1', '预设1', 'a1', 0.8])
    run('INSERT INTO api_presets (id, name, api_config_id, temperature) VALUES (?, ?, ?, ?)',
      ['p2', '预设2', 'a1', 0.5])
    run('INSERT INTO projects (id, title) VALUES (?, ?)', ['proj1', '测试'])
    run('INSERT INTO task_bindings (id, task_type, project_id, preset_id) VALUES (?, ?, ?, ?)',
      ['b1', 'continue', 'proj1', 'p1'])
    run('UPDATE task_bindings SET preset_id=? WHERE task_type=? AND project_id=?',
      ['p2', 'continue', 'proj1'])
    const binding = queryOne('SELECT * FROM task_bindings WHERE task_type=? AND project_id=?',
      ['continue', 'proj1'])
    expect(binding.preset_id).toBe('p2')
  })
})

describe('业务逻辑：敏感词约束', () => {
  it('UNIQUE 约束防止重复词', () => {
    run('INSERT INTO sensitive_words (id, word, is_builtin) VALUES (?, ?, ?)',
      ['s1', '重复词', 0])
    run('INSERT OR IGNORE INTO sensitive_words (id, word, is_builtin) VALUES (?, ?, ?)',
      ['s2', '重复词', 0])
    expect(queryAll('SELECT * FROM sensitive_words WHERE word=?', ['重复词'])).toHaveLength(1)
  })

  it('内置词通过 is_builtin=0 条件保护不被删除', () => {
    run('INSERT INTO sensitive_words (id, word, is_builtin) VALUES (?, ?, ?)',
      ['s1', '违规词', 1])
    run('DELETE FROM sensitive_words WHERE id=? AND is_builtin=0', ['s1'])
    expect(queryAll('SELECT * FROM sensitive_words')).toHaveLength(1)
  })
})
