/** Static seed data for the demo default portfolio. */

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fakeMoneyFromFmv(priceUsdCents, cert, salt) {
  if (!Number.isFinite(priceUsdCents)) return null;
  const fraction = (stableHash(`${cert}:${salt}`) % 5001) / 10_000;
  const factor = 0.75 + fraction;
  return Math.round((priceUsdCents / 100) * factor * 100) / 100;
}

// Demo-only fallback signals for marquee cards. Live /movers data wins in the
// client whenever it is available, so these keep the offline demo presentable
// without changing live classifications.
//
// SOURCE OF TRUTH. Mirrored in client/src/lib/merchantCopilot.js, which needs
// the same values in guest mode (no Firebase → no server-side seeding, so the
// rows never carry a persisted alphaPct30d). The client cannot import server
// code, so the copy is deliberate; tests/demoAlphaParity.test.js fails the
// build if the two drift.
export const DEMO_PROMOTE_ALPHA_BY_CERT = new Map([
  ['PSA122603338', 0.12], // 25th Anniversary Birthday Pikachu
  ['PSA161025105', 0.09], // Umbreon ex
  ['PSA151789461', 0.08], // Grey Felt Hat Pikachu
]);

export const DEFAULT_PORTFOLIO_ITEMS = [
  ['PSA114662766', 'PSA 10 Gem Mint 2023 Pokemon Sword And Shield Crown Zenith 160 Pikachu', 'Pokemon Sword And Shield Crown Zenith', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA114662766/nft_image.jpg', 29531, '/card/pokemon/pokemon-sword-and-shield-crown-zenith/160-pikachu-psa-10-35d7f310'],
  ['PSA136225944', 'PSA 10 Gem Mint 2025 Pokemon Japanese Mbg-Mega Starter Set Mega Gengar Ex 003 Mega Gengar Ex', 'Pokemon Japanese Mbg-Mega Starter Set Mega Gengar Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA136225944/nft_image.jpg', 3684, '/card/pokemon/pokemon-japanese-mbg-mega-starter-set-mega-gengar-ex/003-mega-gengar-ex-psa-10-japanese-de0d46db'],
  ['PSA129297256', 'PSA 10 Gem Mint 2025 Pokemon Japanese M-P Promo 020 Pikachu', 'Pokemon Japanese M-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA129297256/nft_image_silver.jpg', 8766, '/card/pokemon/mcdonald-s-japanese-m-p-promo/020-pikachu-psa-10-japanese-2fabc70d'],
  ['PSA82880232', 'PSA 10 Gem Mint 2022 Pokemon Japanese Sv Promo 001 Pikachu', 'Pokemon Japanese Sv Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA82880232/nft_image_silver.jpg', 10644, '/card/pokemon/pokemon-japanese-sv-promo/001-pikachu-psa-10-japanese-3755455e'],
  ['PSA138521137', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 068 Leafeon', 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA138521137/nft_image_silver.jpg', 16082, '/card/pokemon/pokemon-japanese-sv-p-promo/068-leafeon-psa-10-japanese-59d384c8'],
  ['PSA102412061', 'PSA 10 Gem Mint 2021 Pokemon Japanese S Promo 208 Pikachu', 'Pokemon Japanese S Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA102412061/nft_image_silver.jpg', 34570, '/card/pokemon/pokemon-japanese-s-promo/208-pikachu-psa-10-japanese-cb41f898'],
  ['PSA115076682', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 070 Sylveon', 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA115076682/nft_image_silver.jpg', 16503, '/card/pokemon/pokemon-japanese-sv-p-promo/070-sylveon-psa-10-japanese-bb6789a5'],
  ['PSA123551179', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv5a-Crimson Haze 078 Eevee', 'Pokemon Japanese Sv5a-Crimson Haze', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA123551179/nft_image.jpg', 10757, '/card/pokemon/pokemon-japanese-sv5a-crimson-haze/078-eevee-psa-10-japanese-afbe060d'],
  ['PSA123315980', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 064 Jolteon', 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA123315980/nft_image_silver.jpg', 16546, '/card/pokemon/pokemon-japanese-sv-p-promo/064-jolteon-psa-10-japanese-efef4bb7'],
  ['PSA124850705', "PSA 10 Gem Mint 2025 Pokemon Japanese Sv10-Glory Of Team Rocket 109 Team Rocket's Meowth", 'Pokemon Japanese Sv10-Glory Of Team Rocket', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA124850705/nft_image.jpg', 5754, '/card/pokemon/pokemon-japanese-sv10-glory-of-team-rocket/109-team-rocket-s-meowth-psa-10-japanese-5ce00471'],
  ['PSA113221413', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 205 Vaporeon Ex', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA113221413/nft_image.jpg', null, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/205-vaporeon-ex-psa-10-japanese-97448cc3'],
  ['PSA113813015', 'PSA 10 Gem Mint 2021 Pokemon Japanese Sword & Shield Eevee Heroes 077 Glaceon V', 'Pokemon Japanese Sword & Shield Eevee Heroes', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA113813015/nft_image.jpg', 22393, '/card/pokemon/pokemon-japanese-sword-shield-eevee-heroes/077-glaceon-v-psa-10-japanese-b23b0aab'],
  ['PSA116808013', 'PSA 10 Gem Mint 2021 Pokemon Japanese Sword & Shield Vmax Climax 252 Rayquaza Vmax', 'Pokemon Japanese Sword & Shield Vmax Climax', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA116808013/nft_image_silver.jpg', 41303, '/card/pokemon/pokemon-japanese-sword-shield-vmax-climax/252-rayquaza-vmax-psa-10-japanese-4633a68b'],
  ['PSA138043745', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 202 Flareon Ex', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA138043745/nft_image.jpg', 10683, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/202-flareon-ex-psa-10-japanese-651a14fc'],
  ['PSA103938915', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 120 Pikachu', 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA103938915/nft_image.jpg', 7422, '/card/pokemon/pokemon-japanese-sv-p-promo/120-pikachu-psa-10-japanese-f9e8e4ac'],
  ['PSA110241961', "PSA 10 Gem Mint 2025 Pokemon Japanese Sv-P Promo 232 Iono's Wattrel", 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA110241961/nft_image.jpg', 3977, '/card/pokemon/pokemon-japanese-sv-p-promo/232-iono-s-wattrel-psa-10-japanese-0db0d045'],
  ['PSA131053643', 'PSA 10 Gem Mint 2023 Pokemon Japanese Cll-Trading Card Game Classic Charizard & Ho-Oh Ex Deck 008 Pikachu', 'Pokemon Japanese Cll-Trading Card Game Classic Charizard & Ho-Oh Ex Deck', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA131053643/nft_image.jpg', 24924, '/card/pokemon/pokemon-japanese-cll-trading-card-game-classic-charizard-ho-oh-ex-deck/008-pikachu-psa-10-japanese-79d9305f'],
  ['PSA125215675', "PSA 9 Mint 2025 Pokemon Japanese M1l-Mega Brave 086 Lillie's Determination", 'Pokemon Japanese M1l-Mega Brave', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA125215675/nft_image.jpg', 4108, '/card/pokemon/pokemon-japanese-m1l-mega-brave/086-lillie-s-determination-psa-9-japanese-dea74bac'],
  ['PSA119266732', 'PSA 9 Mint 2023 Pokemon Svp EN-SV Black Star Promo 053 Mew EX', 'Pokemon Svp EN-SV Black Star Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA119266732/nft_image_silver.jpg', 11519, '/card/pokemon/pokemon-svp-en-sv-black-star-promo/053-mew-ex-psa-9-665dd14f'],
  ['PSA129115395', 'PSA 8 NM-MT 2023 Pokemon Svp EN-SV Black Star Promo 053 Mew EX', 'Pokemon Svp EN-SV Black Star Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA129115395/nft_image.jpg', 7618, '/card/pokemon/pokemon-svp-en-sv-black-star-promo/053-mew-ex-psa-8-665dd14f'],
  ['PSA128691284', 'PSA 9 Mint 2023 Pokemon Svp En-Sv Black Star Promo 53 Mew Ex', 'Pokemon Svp En-Sv Black Star Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA128691284/nft_image_silver.jpg', 11519, '/card/pokemon/pokemon-svp-en-sv-black-star-promo/053-mew-ex-psa-9-665dd14f'],
  ['PSA84735372', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv2a-Pokemon 151 205 Mew Ex', 'Pokemon Japanese Sv2a-Pokemon 151', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA84735372/nft_image_golden.jpg', 54106, '/card/pokemon/pokemon-japanese-sv2a-pokemon-151/205-mew-ex-psa-10-japanese-828b4b41'],
  ['PSA116935093', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv7a-Paradise Dragona 070 Latios', 'Pokemon Japanese Sv7a-Paradise Dragona', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA116935093/nft_image.jpg', 5917, '/card/pokemon/pokemon-japanese-sv7a-paradise-dragona/070-latios-psa-10-japanese-6e274832'],
  ['PSA82880237', 'PSA 10 Gem Mint 2022 Pokemon Go Japanese 086 dragonite Vstar', 'Pokemon Go Japanese', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA82880237/nft_image_silver.jpg', 12117, '/card/pokemon/pokemon-go-japanese/086-dragonite-vstar-psa-10-japanese-a29688cf'],
  ['PSA140641881', 'PSA 10 Gem Mint 2025 Pokemon Japanese M2a-Mega Dream Ex 232 Mega Dragonite Ex', 'Pokemon Japanese M2a-Mega Dream Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA140641881/nft_image.jpg', 5627, '/card/pokemon/mega-dream-ex/232-mega-dragonite-ex-psa-10-japanese-7e0b860d'],
  ['PSA141238421', 'PSA 10 Gem Mint 2025 Pokemon Japanese M2a-Mega Dream Ex 126 Mega Dragonite Ex', 'Pokemon Japanese M2a-Mega Dream Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA141238421/nft_image.jpg', 5481, '/card/pokemon/mega-dream-ex/126-mega-dragonite-ex-psa-10-japanese-95d87ed0'],
  ['PSA95798519', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv2a-Pokemon 151 166 Bulbasaur', 'Pokemon Japanese Sv2a-Pokemon 151', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA95798519/nft_image_silver.jpg', 8425, '/card/pokemon/pokemon-japanese-sv2a-pokemon-151/166-bulbasaur-psa-10-japanese-38ad9189'],
  ['CGC6022972042', 'CGC 10 Pristine 2023 Pokemon Japanese Sv2a-Pokemon 151 166 Bulbasaur', 'Pokemon Japanese Sv2a-Pokemon 151', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/CGC6022972042/nft_image_silver.jpg', 4453, '/card/pokemon/pokemon-japanese-sv2a-pokemon-151/166-bulbasaur-cgc-10-japanese-38ad9189'],
  ['PSA99891546', 'PSA 10 Gem Mint 2023 Pokemon Japanese Clf-Trading Card Game Classic Venusaur & Lugia Ex Deck 001 Bulbasaur', 'Pokemon Japanese Clf-Trading Card Game Classic Venusaur & Lugia Ex Deck', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA99891546/nft_image.jpg', 4409, '/card/pokemon/pokemon-japanese-clf-trading-card-game-classic-venusaur-lugia-ex-deck/001-bulbasaur-psa-10-japanese-2f63fe9d'],
  ['PSA124560801', 'PSA 10 Gem Mint 2023 Pokemon Japanese Clf-Trading Card Game Classic Venusaur & Lugia Ex Deck 001 Bulbasaur', 'Pokemon Japanese Clf-Trading Card Game Classic Venusaur & Lugia Ex Deck', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA124560801/nft_image.jpg', 4409, '/card/pokemon/pokemon-japanese-clf-trading-card-game-classic-venusaur-lugia-ex-deck/001-bulbasaur-psa-10-japanese-2f63fe9d'],
  ['PSA133140294', 'PSA 10 Gem Mint 2025 Pokemon Japanese Mbg-Mega Starter Set Mega Gengar Ex 022 Haunter', 'Pokemon Japanese Mbg-Mega Starter Set Mega Gengar Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA133140294/nft_image.jpg', 7197, '/card/pokemon/pokemon-japanese-mbg-mega-starter-set-mega-gengar-ex/022-haunter-psa-10-japanese-a8099684'],
  ['PSA138252555', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 098 Detective Pikachu', 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA138252555/nft_image.jpg', 43696, '/card/pokemon/pokemon-japanese-sv-p-promo/098-detective-pikachu-psa-10-japanese-b8bc9b38'],
  ['PSA83834360', 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 098 Detective Pikachu', 'Pokemon Japanese Sv-P Promo', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA83834360/nft_image.jpg', 43696, '/card/pokemon/pokemon-japanese-sv-p-promo/098-detective-pikachu-psa-10-japanese-b8bc9b38'],
  ['PSA122603338', 'PSA 10 Gem Mint 2021 Pokemon Japanese Promo Card Pack 25th Anniversary Edition 007 Birthday Pikachu-Holo', 'Pokemon Japanese Promo Card Pack 25th Anniversary Edition', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA122603338/nft_image_golden.jpg', 74544, '/card/pokemon/pokemon-japanese-promo-card-pack-25th-anniversary-edition/007-birthday-pikachu-holo-psa-10-japanese-680e0afb'],
  ['PSA96834868', 'PSA 10 Gem Mint 2021 Pokemon Celebrations Classic Collection 24 Birthday Pikachu-Holo', 'Pokemon Celebrations Classic Collection', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA96834868/nft_image.jpg', 27255, '/card/pokemon/pokemon-celebrations-classic-collection/24-birthday-pikachu-holo-psa-10-349c113e'],
  ['CGC6106213044', 'CGC 10 Gem Mint 2021 Pokemon Celebrations Classic Collection 24 Birthday Pikachu-Holo', 'Pokemon Celebrations Classic Collection', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/CGC6106213044/nft_image_silver.jpg', null, '/card/pokemon/pokemon-celebrations-classic-collection/24-birthday-pikachu-holo-cgc-10-349c113e'],
  ['PSA161025105', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 217 Umbreon Ex', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA161025105/nft_image_golden.jpg', 61614, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/217-umbreon-ex-psa-10-japanese-6665a22b'],
  ['PSA134155719', 'PSA 10 Gem Mint 2025 Pokemon Pre En-Prismatic Evolutions 60 Umbreon Ex', 'Pokemon Pre En-Prismatic Evolutions', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA134155719/nft_image.jpg', 10025, '/card/pokemon/pokemon-pre-en-prismatic-evolutions/60-umbreon-ex-psa-10-8935bea5'],
  ['PSA112235618', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 092 Umbreon', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA112235618/nft_image.jpg', 3960, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/092-umbreon-psa-10-japanese-557fcf15'],
  ['PSA112636277', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 092 Umbreon', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA112636277/nft_image.jpg', 20966, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/092-umbreon-psa-10-japanese-befa191c'],
  ['PSA151789461', 'PSA 10 Gem Mint 2023 Pokemon SVP Black Star Promos 85 Pikachu with Grey Felt Hat', 'Pokemon SVP Black Star Promos', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA151789461/nft_image_diamond.jpg', 289014, '/card/pokemon/pokemon-svp-black-star-promos/085-pikachu-with-grey-felt-hat-psa-10-1ac559f4'],
  ['PSA118168792', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 200 Leafeon Ex', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA118168792/nft_image_silver.jpg', 12031, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/200-leafeon-ex-psa-10-japanese-e43da7a5'],
  ['PSA138276414', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 200 Leafeon Ex', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA138276414/nft_image.jpg', 12031, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/200-leafeon-ex-psa-10-japanese-e43da7a5'],
  ['PSA113887087', 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 200 Leafeon Ex', 'Pokemon Japanese Sv8a-Terastal Fest Ex', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA113887087/nft_image_silver.jpg', 12031, '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/200-leafeon-ex-psa-10-japanese-e43da7a5'],
  ['PSA84224844', 'PSA 10 Gem Mint 2022 Pokemon Japanese Sword & Shield Vstar Universe 210 Leafeon Vstar', 'Pokemon Japanese Sword & Shield Vstar Universe', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA84224844/nft_image.jpg', 8804, '/card/pokemon/pokemon-japanese-sword-shield-vstar-universe/210-leafeon-vstar-psa-10-japanese-4dad7a64'],
  ['PSA120135473', 'PSA 8 NM-MT 2021 Pokemon Sword & Shield: Evolving Skies 167 Leafeon V', 'Pokemon Sword & Shield: Evolving Skies', 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA120135473/nft_image_silver.jpg', 13250, '/card/pokemon/pokemon-sword-shield-evolving-skies/167-leafeon-v-psa-8-bed5b6fe'],
].map(([cert, name, setName, imageUrl, priceUsdCents, href]) => {
  const listPrice = stableHash(`${cert}:list`) % 4 === 0
    ? null
    : fakeMoneyFromFmv(priceUsdCents, cert, 'list');
  return {
    cert,
    name,
    setName,
    grade: name.match(/(?:PSA|CGC) (?:10|9) (?:Gem Mint|Mint|Pristine)/)?.[0]?.replace(/^(?:PSA|CGC) /, '') || '10 Gem Mint',
    imageUrl,
    ...(priceUsdCents == null ? {} : {
      priceUsdCents,
      cost: fakeMoneyFromFmv(priceUsdCents, cert, 'cost'),
      ...(listPrice == null ? {} : { listPrice }),
    }),
    ...(DEMO_PROMOTE_ALPHA_BY_CERT.has(cert)
      ? { alphaPct30d: DEMO_PROMOTE_ALPHA_BY_CERT.get(cert) }
      : {}),
    href,
    status: 'active',
  };
});
