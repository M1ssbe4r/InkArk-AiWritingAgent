import { describe, it, expect, beforeAll } from 'vitest'

let jieba: any

beforeAll(async () => {
  jieba = require('jieba-wasm')
  jieba.cut('预热', true)
})

describe('jieba-wasm 基础分词', () => {
  it('中文句子正确切词', () => {
    const result = jieba.cut('他在图书馆里看书', true)
    expect(result).toContain('图书馆')
    expect(result).toContain('看书')
  })

  it('英文和数字保持原样', () => {
    const result = jieba.cut('iPhone 15 价格是7999元', true)
    expect(result).toContain('iPhone')
    expect(result).toContain('15')
    expect(result).toContain('7999')
  })

  it('空文本返回空数组', () => {
    const result = jieba.cut('', true)
    expect(result).toEqual([])
  })

  it('纯英文文本正常处理', () => {
    const result = jieba.cut('Hello World', true)
    expect(result.join(' ')).toContain('Hello')
    expect(result.join(' ')).toContain('World')
  })

  it('标点符号不干扰分词', () => {
    const result = jieba.cut('他说："你好！"', true)
    expect(result).toContain('他')
    expect(result).toContain('说')
    expect(result).toContain('你好')
  })
})

describe('jieba-wasm 自定义词', () => {
  it('add_word 后自定义词被识别', () => {
    jieba.add_word('路明非', 100)
    const result = jieba.cut('路明非是一个学生', true)
    expect(result).toContain('路明非')
    expect(result).not.toContain('路')
  })

  it('with_dict 批量加载自定义词', () => {
    jieba.with_dict('卡塞尔学院 100 n\n言灵 100 n')
    const result = jieba.cut('路明非在卡塞尔学院学习言灵', true)
    expect(result).toContain('路明非')
    expect(result).toContain('卡塞尔学院')
    expect(result).toContain('言灵')
  })
})

describe('jieba-wasm 搜索场景', () => {
  beforeAll(() => {
    jieba.add_word('路明非', 100)
    jieba.add_word('楚子航', 100)
    jieba.add_word('卡塞尔学院', 100)
    jieba.add_word('言灵', 100)
    jieba.add_word('绘梨衣', 100)
    jieba.add_word('源稚生', 100)
    jieba.add_word('源稚女', 100)
    jieba.add_word('爆血', 100)
    jieba.add_word('黑月之潮', 100)
  })

  it('路明非作为完整词', () => {
    const result = jieba.cut('路明非等了十八年', true)
    expect(result[0]).toBe('路明非')
  })

  it('卡塞尔学院作为完整词', () => {
    const result = jieba.cut('卡塞尔学院是一所神秘的学校', true)
    expect(result).toContain('卡塞尔学院')
  })

  it('楚子航 爆血各自独立', () => {
    const result = jieba.cut('楚子航不得不冒险使用爆血技能', true)
    expect(result).toContain('楚子航')
    expect(result).toContain('爆血')
  })

  it('言灵作为完整词', () => {
    const result = jieba.cut('等级考试、言灵考验', true)
    expect(result).toContain('言灵')
  })

  it('日本名字正确识别', () => {
    const result = jieba.cut('源稚生与源稚女在红井对决', true)
    expect(result).toContain('源稚生')
    expect(result).toContain('源稚女')
  })

  it('绘梨衣作为完整词', () => {
    const result = jieba.cut('路明非与绘梨衣为躲避追捕', true)
    expect(result).toContain('绘梨衣')
  })

  it('黑月之潮作为完整词', () => {
    const result = jieba.cut('龙族3：黑月之潮', true)
    expect(result).toContain('黑月之潮')
  })

  it('误匹配排除：法学不命中魔法学院', () => {
    jieba.add_word('魔法学院', 100)
    const result = jieba.cut('他在魔法学院学习', true)
    expect(result).toContain('魔法学院')
    expect(result).not.toContain('法学')
    expect(result).not.toContain('法学' as any)
    const tokens = result.filter((t: string) => t === '法学')
    expect(tokens).toHaveLength(0)
  })
})

describe('jieba-wasm cut 模式输出空格分隔', () => {
  it('cut 结果 join 空格后可被 unicode61 正确切回', () => {
    jieba.add_word('路明非', 100)
    jieba.add_word('卡塞尔学院', 100)
    const tokens = jieba.cut('路明非在卡塞尔学院学习', true)
    const spaced = tokens.join(' ')
    const recovered = spaced.split(/\s+/)
    expect(recovered).toEqual(tokens)
  })
})
