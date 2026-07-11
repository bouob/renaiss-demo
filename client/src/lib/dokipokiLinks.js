/**
 * User-facing "Dokipoki" brand mentions → https://dokipoki.app/
 */
import { createElement } from 'react';

export const DOKIPOKI_HOME_URL = 'https://dokipoki.app/';

const SPLIT_RE = /(Dokipoki)/g;

/**
 * Turn every "Dokipoki" substring into an external home link.
 * @param {string|null|undefined} text
 * @param {string} [className='dokipoki-link']
 * @returns {import('react').ReactNode}
 */
export function linkDokipokiMentions(text, className = 'dokipoki-link') {
  if (text == null || text === '') return text;
  const str = String(text);
  if (!str.includes('Dokipoki')) return str;

  const parts = str.split(SPLIT_RE);
  return parts.map((part, i) => {
    if (part !== 'Dokipoki') return part;
    return createElement(
      'a',
      {
        key: `dokipoki-${i}`,
        href: DOKIPOKI_HOME_URL,
        target: '_blank',
        rel: 'noopener noreferrer',
        className,
      },
      'Dokipoki',
    );
  });
}
