# i18n — Merchant Copilot

Aligned with Dokipoki (`client/src/i18n/`): **i18next** + **react-i18next**.

| Locale | File |
|--------|------|
| `en` (default) | `locales/en.json` |
| `zh-TW` | `locales/zh-TW.json` |
| `ja` | `locales/ja.json` |

**Resolution:** cookie `Dokipoki_prefs.locale` (shared with main Dokipoki) → `localStorage.merchant_locale` → `en`. Never `navigator.language`.

**Switcher:** `components/LanguageSwitcher.jsx` in topnav.

## Parity check

```bash
cd client
node -e "
const fs=require('fs');
function keys(o,p=''){return Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?keys(v,p?p+'.'+k:k):[p?p+'.'+k:k]);}
const dir='src/i18n/locales';
const en=new Set(keys(JSON.parse(fs.readFileSync(dir+'/en.json','utf8'))));
const tw=new Set(keys(JSON.parse(fs.readFileSync(dir+'/zh-TW.json','utf8'))));
const ja=new Set(keys(JSON.parse(fs.readFileSync(dir+'/ja.json','utf8'))));
const miss=(a,b,l)=>{const d=[...a].filter(k=>!b.has(k)); if(d.length) console.log(l,d);};
miss(en,tw,'en-only'); miss(tw,en,'zh-only'); miss(en,ja,'en-only-ja'); miss(ja,en,'ja-only');
if([...en].every(k=>tw.has(k)&&ja.has(k))&&en.size===tw.size&&en.size===ja.size) console.log('PARITY OK',en.size);
"
```

## Adding keys

1. Add to all three locale files under the same path.
2. Use `t('namespace.key')` or `t('key', { count })` in components.
3. Re-run parity check.
