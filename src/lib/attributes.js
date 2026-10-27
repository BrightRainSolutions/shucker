export const OVERALL = { key: 'overall', label: 'Overall', low: 'meh', high: 'marry it' }

export const ATTRIBUTES = [
  { key: 'brininess', label: 'Brininess', low: 'pond', high: 'ocean spray' },
  { key: 'smell_of_the_sea', label: 'Smell of the Sea', low: 'tap water', high: 'Hood Canal at low tide' },
  { key: 'sweetness', label: 'Sweetness', low: 'none', high: 'candy' },
  // Stored as `creaminess` (the industry term); we call it butteriness.
  { key: 'creaminess', label: 'Butteriness', low: 'lean', high: 'butter' },
  { key: 'minerality', label: 'Minerality', low: 'none', high: 'licking a penny' },
  { key: 'brightness', label: 'Brightness', low: 'flat', high: 'squeeze of lemon' },
  { key: 'texture', label: 'Texture', low: 'soft', high: 'crunchy' },
  { key: 'size', label: 'Size', low: 'petite', high: 'whopper' },
]

export const ALL_SCORES = [OVERALL, ...ATTRIBUTES]

export const SPECIES = [
  { value: 'pacific', label: 'Pacific' },
  { value: 'atlantic', label: 'Atlantic' },
  { value: 'kumamoto', label: 'Kumamoto' },
  { value: 'olympia', label: 'Olympia' },
  { value: 'european_flat', label: 'European flat' },
]

export const speciesLabel = (v) => SPECIES.find((s) => s.value === v)?.label ?? ''

const loading = [
  'Shucking…',
  'Consulting the tide tables…',
  'Fetching lemon wedges…',
  'Sharpening the shucker…',
  'Chilling on crushed ice…',
]
export const loadingLine = () => loading[Math.floor(Math.random() * loading.length)]
