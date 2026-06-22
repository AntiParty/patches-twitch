import { strict as assert } from 'assert';
import { selectPeakByRS, RS_COMPARABLE_MIN_SEASON, type SeasonRSEntry } from '@/jobs/peakUpdater';

function entry(season: number, rank: number, rankScore: number): SeasonRSEntry {
  return { season, file: `regular_s${season}`, rank, rankScore, league: 'Ruby' };
}

describe('selectPeakByRS', () => {
  it('picks the season with the highest RS, not the lowest rank', () => {
    // S7: great rank but lower RS. S10: worse rank but higher RS → S10 wins.
    const best = selectPeakByRS([entry(7, 20, 60000), entry(10, 400, 61402)]);
    assert.equal(best?.season, 10);
    assert.equal(best?.rankScore, 61402);
    assert.equal(best?.rank, 400);
  });

  it('excludes pre-S4 seasons whose RS is on a different scale', () => {
    // S3 RS (63,929-scale) must never beat a comparable S9 value.
    const best = selectPeakByRS([entry(3, 1, 91075), entry(9, 142, 58234)]);
    assert.equal(best?.season, 9);
    assert.equal(best?.rankScore, 58234);
  });

  it('ignores entries with non-numeric RS (S1/S2 league-only era)', () => {
    const s1: SeasonRSEntry = { season: 1, file: 'regular_s1', rank: 5, rankScore: undefined as any, league: 'Diamond 1' };
    const best = selectPeakByRS([s1, entry(8, 300, 52044)]);
    assert.equal(best?.season, 8);
  });

  it('returns null when there are no comparable seasons', () => {
    const s2: SeasonRSEntry = { season: 2, file: 'regular_s2', rank: 5, rankScore: undefined as any, league: 'Diamond 1' };
    assert.equal(selectPeakByRS([s2, entry(3, 1, 91075)]), null);
  });

  it('exposes the comparable-season floor as S4', () => {
    assert.equal(RS_COMPARABLE_MIN_SEASON, 4);
  });
});
