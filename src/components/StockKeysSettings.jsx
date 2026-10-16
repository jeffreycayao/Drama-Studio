import { useEffect, useState } from 'react'
import { getStockApiKey, setStockApiKey } from '../services/pexelsSettings'
import { STOCK_PROVIDERS } from '../services/stockProviders'

const inputClass = 'w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent'

/** Settings › Stock: keys for the extra providers (Pexels has its own field
 * above) and the list of sources that need no key. Saved on blur. */
export default function StockKeysSettings() {
  const keyed = STOCK_PROVIDERS.filter(provider => provider.keySetting && provider.id !== 'pexels')
  const free = STOCK_PROVIDERS.filter(provider => !provider.keySetting)
  const [values, setValues] = useState({})
  const [saved, setSaved] = useState('')
  useEffect(() => {
    Promise.all(keyed.map(provider => getStockApiKey(provider.keySetting).then(value => [provider.keySetting, value || ''])))
      .then(entries => setValues(Object.fromEntries(entries)))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async provider => {
    await setStockApiKey(provider.keySetting, String(values[provider.keySetting] || '').trim())
    setSaved(`${provider.label} key saved.`)
    setTimeout(() => setSaved(''), 2000)
  }

  return <div className="space-y-4" data-testid="stock-keys-settings">
    {keyed.map(provider => <div key={provider.id}>
      <label htmlFor={`stock-key-${provider.id}`} className="block text-xs text-sf-text-muted mb-1">{provider.label} {provider.id === 'unsplash' ? 'Access Key' : 'API key'}</label>
      <input id={`stock-key-${provider.id}`} type="password" autoComplete="off" value={values[provider.keySetting] || ''}
        onChange={event => setValues(previous => ({ ...previous, [provider.keySetting]: event.target.value }))} onBlur={() => save(provider)}
        placeholder={`Your ${provider.label} key`} className={inputClass} />
      <p className="text-[10px] text-sf-text-muted mt-1">Free at{' '}
        <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">{provider.keyUrl.replace(/^https:\/\//, '')}</a>. {provider.note}</p>
    </div>)}
    <div className="rounded border border-sf-dark-700 p-3 text-[11px] text-sf-text-secondary">
      <p className="mb-1 font-medium text-sf-text-primary">No key needed</p>
      <ul className="space-y-1 text-[10px] text-sf-text-muted">
        {free.map(provider => <li key={provider.id}><span className="text-sf-text-secondary">{provider.label}:</span> {provider.note}</li>)}
      </ul>
    </div>
    {saved && <p role="status" className="text-xs text-sf-text-secondary">{saved}</p>}
  </div>
}
