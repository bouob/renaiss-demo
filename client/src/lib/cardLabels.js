export function formatYearSetLabel(year, setName) {
  if (year && setName) return `${year}・${setName}`;
  return setName || year || '';
}

export function getCardYear(card) {
  return (card?.set?.releaseYear != null ? String(card.set.releaseYear) : null)
    || (card?.year != null ? String(card.year) : null)
    || '';
}

export function getCardSetName(card) {
  return card?.set?.name
    || card?.expansion?.name
    || card?.set
    || '';
}
