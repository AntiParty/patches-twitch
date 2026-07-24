const UNRANKED_ICON = 'https://www.thefinals.wiki/w/images/d/d4/League_Unranked.png';

export const RANK_ICON_URLS: Readonly<Record<string, string>> = {
  'Bronze 4': 'https://www.thefinals.wiki/w/images/d/da/League_Bronze_4.png',
  'Bronze 3': 'https://www.thefinals.wiki/w/images/4/43/League_Bronze_3.png',
  'Bronze 2': 'https://www.thefinals.wiki/w/images/6/60/League_Bronze_2.png',
  'Bronze 1': 'https://www.thefinals.wiki/w/images/8/84/League_Bronze_1.png',
  'Silver 4': 'https://www.thefinals.wiki/w/images/d/d4/League_Silver_4.png',
  'Silver 3': 'https://www.thefinals.wiki/w/images/1/1f/League_Silver_3.png',
  'Silver 2': 'https://www.thefinals.wiki/w/images/0/0e/League_Silver_2.png',
  'Silver 1': 'https://www.thefinals.wiki/w/images/b/b3/League_Silver_1.png',
  'Gold 4': 'https://www.thefinals.wiki/w/images/2/27/League_Gold_4.png',
  'Gold 3': 'https://www.thefinals.wiki/w/images/9/9f/League_Gold_3.png',
  'Gold 2': 'https://www.thefinals.wiki/w/images/1/15/League_Gold_2.png',
  'Gold 1': 'https://www.thefinals.wiki/w/images/8/8d/League_Gold_1.png',
  'Platinum 4': 'https://www.thefinals.wiki/w/images/8/85/League_Platinum_4.png',
  'Platinum 3': 'https://www.thefinals.wiki/w/images/2/2c/League_Platinum_3.png',
  'Platinum 2': 'https://www.thefinals.wiki/w/images/c/cd/League_Platinum_2.png',
  'Platinum 1': 'https://www.thefinals.wiki/w/images/7/7a/League_Platinum_1.png',
  'Diamond 4': 'https://www.thefinals.wiki/w/images/c/c4/League_Diamond_4.png',
  'Diamond 3': 'https://www.thefinals.wiki/w/images/b/b5/League_Diamond_3.png',
  'Diamond 2': 'https://www.thefinals.wiki/w/images/b/b3/League_Diamond_2.png',
  'Diamond 1': 'https://www.thefinals.wiki/w/images/2/2c/League_Diamond_1.png',
  Ruby: 'https://www.thefinals.wiki/w/images/8/81/League_Ruby.png',
  Unranked: UNRANKED_ICON,
};

export function getRankIconUrl(league: string | null | undefined): string {
  return RANK_ICON_URLS[String(league || 'Unranked')] || UNRANKED_ICON;
}
