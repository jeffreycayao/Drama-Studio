// Japanese Help Center. Loaded on demand by HelpCenter.jsx when the app
// language is Japanese; see src/utils/helpLocale.mjs for how it is merged
// with the English guide.
import start from './start.js'
import files from './files.js'
import ai from './ai.js'
import sound from './sound.js'
import edit from './edit.js'
import exportArticles from './export.js'
import assistant from './assistant.js'
import story from './story.js'
import trouble from './trouble.js'
import roadmap from './roadmap.js'
import visuals from './visuals.js'

export const HELP_JA = {
  // Diagram labels, English -> Japanese.
  visuals,
  categories: {
    start: { title: 'はじめに', blurb: 'Drama Studio とは、必要なもの、最初のプロジェクト。' },
    files: { title: 'ファイルとプロジェクト', blurb: 'すべての保存場所と、その見つけ方。' },
    ai: { title: 'AI で画像と動画を作る', blurb: 'テキストから画像、画像から動画、テキストから動画、ローカルとクラウド。' },
    sound: { title: '音楽・声・効果音', blurb: '歌、BGM、声、リップシンク、効果音。' },
    edit: { title: '編集', blurb: 'タイムライン、カット、テキスト、エフェクト、色、オーディオ、字幕。' },
    export: { title: '書き出しと共有', blurb: '完成した動画を YouTube や TikTok などに向けて保存します。' },
    assistant: { title: 'AI アシスタントとエージェント', blurb: '編集を AI に安全に任せます。' },
    story: { title: 'ストーリー・キャスト・ストック', blurb: 'ストーリーの企画、登場人物の一貫性、ストック素材探し。' },
    trouble: { title: '困ったとき', blurb: 'うまくいかないときは、ここから。' },
    roadmap: { title: 'まだアプリにないもの', blurb: '要望の多い今後の機能と、それまでの回避方法。' },
  },
  popular: {
    'where-files-are-saved': 'ファイルはすべてパソコンに保存される？',
    'assets-panel-folders': '生成やダウンロードしたファイルは自動で追加される？',
    'local-vs-cloud': '自分のパソコンではなくクラウドを使う理由は？',
    'assistant-overview': 'AI アシスタントに編集を任せられる？',
    'where-models-go': 'ダウンロードした AI モデルはどこに入る？',
    dubbing: '動画を別の言語に吹き替えできる？',
  },
  articles: {
    ...start,
    ...files,
    ...ai,
    ...sound,
    ...edit,
    ...exportArticles,
    ...assistant,
    ...story,
    ...trouble,
    ...roadmap,
  },
}
